"""
Quiter reminder worker — sends the daily coach email.

Run as its own service (e.g. a second Railway service):

    cd backend && python reminder_worker.py

Why a separate process: email scheduling must not depend on web traffic.

Each cycle (every REMINDER_POLL_SECONDS, default 60) it looks at every active
plan with reminders on, converts "now" into the plan's own timezone, and for
each chosen reminder time that is due it:
  1. claims the (plan, local date, HH:MM) slot in reminder_deliveries
     (unique constraint = no duplicate emails, even with 2 workers),
  2. skips the email if the user already marked today done,
  3. fetches/creates today's coach message (AI or template fallback),
  4. sends the email with the one-tap "Yes, I'm on track" button.
If Resend fails, the claim is released so the next cycle retries.
"""
import logging
import os
import time
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from sqlalchemy.exc import IntegrityError

from app import create_app
from app.models.models import db, DailyLog, ReminderDelivery, User, UserPlan
from app.security.checkin_tokens import make_checkin_token
from app.security.email import send_goal_reminder_email, _APP_BASE_URL
from app.utils.coach_ai import get_or_create_coach_message

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("quiter.reminders")

POLL_SECONDS = max(15, int(os.environ.get("REMINDER_POLL_SECONDS", "60")))


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


DUE_WINDOW_MINUTES = 15


def _is_due(reminder_time: str, local_now: datetime) -> bool:
    # Due from the chosen minute until DUE_WINDOW_MINUTES later. The window makes
    # a slow cycle or a worker restart harmless (no skipped reminders), and the
    # claim row in reminder_deliveries guarantees it is still sent only once.
    elapsed = (local_now.hour * 60 + local_now.minute) - _minutes(reminder_time)
    return 0 <= elapsed < DUE_WINDOW_MINUTES


def _claim_delivery(user_plan_id: str, reminder_date: date, reminder_time: str) -> bool:
    db.session.add(ReminderDelivery(
        user_plan_id=user_plan_id,
        reminder_date=reminder_date,
        reminder_time=reminder_time,
    ))
    try:
        db.session.commit()
        return True
    except IntegrityError:
        db.session.rollback()
        return False


def _release_claim(user_plan_id: str, reminder_date: date, reminder_time: str) -> None:
    row = ReminderDelivery.query.filter_by(
        user_plan_id=user_plan_id, reminder_date=reminder_date, reminder_time=reminder_time
    ).first()
    if row:
        db.session.delete(row)
        db.session.commit()


def _video_due(plan, day_number: int) -> bool:
    if plan.video_checkin_frequency == "weekly":
        return day_number % 7 == 0
    if plan.video_checkin_frequency == "monthly":
        return day_number % 30 == 0
    return False


def process_due_reminders() -> int:
    now_utc = datetime.now(timezone.utc)

    plans = (
        UserPlan.query
        .join(User, User.id == UserPlan.user_id)
        .filter(
            UserPlan.is_completed.is_(False),
            UserPlan.is_abandoned.is_(False),
            UserPlan.reminders_enabled.is_(True),
            User.is_active.is_(True),
        )
        .all()
    )

    sent_count = 0
    for plan in plans:
        if not plan.user or not plan.user.email:
            continue

        try:
            local_now = now_utc.astimezone(ZoneInfo(plan.reminder_timezone or "UTC"))
        except Exception:
            logger.warning("Invalid timezone for plan %s; using UTC", plan.id)
            local_now = now_utc
        local_date = local_now.date()

        for reminder_time in plan.reminder_times or []:
            if not isinstance(reminder_time, str) or not _is_due(reminder_time, local_now):
                continue

            # Already marked today (dashboard or earlier email)? Don't nag.
            if DailyLog.query.filter_by(user_plan_id=plan.id, log_date=local_date).first():
                continue

            if not _claim_delivery(plan.id, local_date, reminder_time):
                continue

            day_number = max(1, min((local_date - plan.start_date).days + 1, plan.template.length_days))
            coach = get_or_create_coach_message(plan, local_date)
            token = make_checkin_token(plan.id, local_date)

            ok = send_goal_reminder_email(
                email=plan.user.email,
                display_name=plan.user.display_name,
                goal_text=plan.goal_text or plan.template.title,
                day_number=day_number,
                total_days=plan.template.length_days,
                support_style=plan.support_style or "gentle",
                checkin_url=f"{_APP_BASE_URL}/checkin.html?token={token}",
                coach_message=coach.body if coach else None,
                streak=plan.current_streak,
                video_due=_video_due(plan, day_number),
            )

            if ok:
                sent_count += 1
                logger.info("Sent reminder for plan %s at %s", plan.id, reminder_time)
            else:
                _release_claim(plan.id, local_date, reminder_time)   # retry next cycle

    db.session.remove()
    return sent_count


def main():
    app = create_app("production")
    with app.app_context():
        logger.info("Quiter reminder worker started; polling every %ss", POLL_SECONDS)
        while True:
            try:
                process_due_reminders()
            except Exception:
                db.session.rollback()
                db.session.remove()
                logger.exception("Reminder cycle failed")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()