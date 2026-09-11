"""
Plan routes — /api/v1/plans/*

Handles the identity-based plan catalog (read-only templates) and a user's
live plan instances. Every write is scoped to g.current_user.id so a user
can never mutate another user's plan by guessing a UUID (IDOR protection —
the WHERE clause always includes user_id, enforced at the query layer, not
just "checked after the fact").
"""
from datetime import date
import re
from zoneinfo import ZoneInfo
from flask import Blueprint, request, jsonify, g

from app.models.models import db, PlanTemplate, PlanDay, UserPlan, DailyLog, LogStatus, gen_uuid
from app.security.session_auth import login_required
from app.security.limiter import limiter, HABIT_LOG_RATE_LIMIT
from app.utils.validation import validate_uuid_param

plans_bp = Blueprint("plans", __name__, url_prefix="/api/v1/plans")

REMINDER_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
SUPPORT_STYLES = {"gentle", "focused", "reflective"}


def _read_custom_settings(payload):
    """
    Validate flexible custom-plan settings.

    Returns:
        ((length_days, identity_statement, support_style,
          reminder_times, reminder_timezone), None)
        or
        (None, error_code)
    """
    length_days = payload.get("length_days")

    if (
        not isinstance(length_days, int)
        or isinstance(length_days, bool)
        or not 3 <= length_days <= 365
    ):
        return None, "invalid_length_days"

    identity_statement = payload.get("identity_statement") or ""
    if not isinstance(identity_statement, str):
        return None, "invalid_identity_statement"

    identity_statement = identity_statement.strip()
    if len(identity_statement) > 160:
        return None, "invalid_identity_statement"

    support_style = payload.get("support_style") or "gentle"
    if support_style not in SUPPORT_STYLES:
        return None, "invalid_support_style"

    raw_times = payload.get("reminder_times", [])
    if raw_times is None:
        raw_times = []

    if not isinstance(raw_times, list) or len(raw_times) > 3:
        return None, "invalid_reminder_times"

    normalized_times = []
    for reminder_time in raw_times:
        if (
            not isinstance(reminder_time, str)
            or not REMINDER_TIME_RE.fullmatch(reminder_time)
        ):
            return None, "invalid_reminder_times"

        if reminder_time not in normalized_times:
            normalized_times.append(reminder_time)

    normalized_times.sort(
        key=lambda value: int(value[:2]) * 60 + int(value[3:])
    )

    reminder_timezone = payload.get("reminder_timezone") or "UTC"

    if (
        not isinstance(reminder_timezone, str)
        or len(reminder_timezone) > 64
    ):
        return None, "invalid_timezone"

    try:
        ZoneInfo(reminder_timezone)
    except Exception:
        return None, "invalid_timezone"

    return (
        (
            length_days,
            identity_statement,
            support_style,
            normalized_times,
            reminder_timezone,
        ),
        None,
    )


@plans_bp.route("/mine", methods=["GET"])
@login_required
def my_plans():
    """List the current user's plans for the dashboard — active ones first,
    each with today's micro-goal pre-computed so the dashboard doesn't need
    a second round trip per plan."""
    user_plans = UserPlan.query.filter_by(user_id=g.current_user.id).order_by(UserPlan.created_at.desc()).all()

    out = []
    for up in user_plans:
        day_number = max(1, min((date.today() - up.start_date).days + 1, up.template.length_days))
        plan_day = PlanDay.query.filter_by(template_id=up.template_id, day_number=day_number).first()
        already_logged = DailyLog.query.filter_by(user_plan_id=up.id, log_date=date.today()).first()
        out.append({
            "user_plan_id": up.id,
            "template_id": up.template_id,
            "category": up.template.category,
            "photo_url": up.template.photo_url,
            "title": up.template.title,
            "identity_statement": up.template.identity_statement,
            "direction": up.template.direction.value,
            "day_number": day_number,
            "total_days": up.template.length_days,
            "current_streak": up.current_streak,
            "goal_text": up.goal_text or up.template.title,
            "identity_statement": (
                up.identity_statement or up.template.identity_statement
            ),
            "support_style": up.support_style,
            "reminder_times": up.reminder_times or [],
            "reminder_timezone": up.reminder_timezone,
            "reminders_enabled": up.reminders_enabled,
            "longest_streak": up.longest_streak,
            "is_completed": up.is_completed,
            "is_abandoned": up.is_abandoned,
            "micro_goal": plan_day.micro_goal if plan_day else None,
            "identity_cue": plan_day.identity_cue if plan_day else None,
            "already_logged_today": already_logged is not None,
        })
    return jsonify(out), 200


@plans_bp.route("/templates", methods=["GET"])
def list_templates():
    """Browse the identity-plan catalog. Deliberately PUBLIC (no
    @login_required) — the whole point of the landing page's plan cards is
    to let a logged-out visitor browse before they ever create an account.
    Nothing in this response is user-specific or sensitive. Supports
    ?direction=break|build and ?length=7|15|30 filters — both validated
    against the Enum, so an arbitrary query string can never reach raw SQL.
    arbitrary query string can never reach raw SQL."""
    direction = request.args.get("direction")
    length = request.args.get("length", type=int)

    query = PlanTemplate.query.filter_by(is_active=True)
    if direction in ("break", "build"):
        query = query.filter_by(direction=direction)
    if length in (7, 15, 30):
        query = query.filter_by(length_days=length)

    templates = query.order_by(PlanTemplate.title).all()
    return jsonify([{
        "id": t.id,
        "slug": t.slug,
        "title": t.title,
        "identity_statement": t.identity_statement,
        "direction": t.direction.value,
        "category": t.category,
        "length_days": t.length_days,
        "description": t.description,
        "photo_url": t.photo_url,
        "price_cents": t.price_cents,
        "trial_days": t.trial_days,
        "tagline": t.tagline,
        "cta_text": t.cta_text,
        "age_rating": t.age_rating,
        "is_included": t.is_included,
    } for t in templates]), 200


@plans_bp.route("/adopt", methods=["POST"])
@login_required
def adopt_plan():
    """Start a plan. Refuses to double-enroll a user in the same template
    while an active instance already exists."""
    payload = request.get_json(silent=True) or {}
    template_id = payload.get("template_id")

    if not validate_uuid_param(template_id):
        return jsonify({"error": "invalid_template_id"}), 400

    template = db.session.get(PlanTemplate, template_id)
    if template is None or not template.is_active:
        return jsonify({"error": "template_not_found"}), 404

    existing = UserPlan.query.filter_by(
        user_id=g.current_user.id,
        template_id=template_id,
        is_completed=False,
        is_abandoned=False,
    ).first()
    if existing:
        return jsonify({"error": "plan_already_active", "user_plan_id": existing.id}), 409

    user_plan = UserPlan(user_id=g.current_user.id, template_id=template_id, start_date=date.today())
    db.session.add(user_plan)
    db.session.commit()
    return jsonify({"user_plan_id": user_plan.id, "start_date": user_plan.start_date.isoformat()}), 201


@plans_bp.route("/<user_plan_id>/today", methods=["GET"])
@login_required
def get_today(user_plan_id):
    if not validate_uuid_param(user_plan_id):
        return jsonify({"error": "invalid_id"}), 400

    # Scoped by BOTH id and user_id in the same filter — this is the IDOR
    # guard. A user supplying someone else's user_plan_id simply gets a 404,
    # never another user's data.
    user_plan = UserPlan.query.filter_by(id=user_plan_id, user_id=g.current_user.id).first()
    if user_plan is None:
        return jsonify({"error": "plan_not_found"}), 404

    day_number = (date.today() - user_plan.start_date).days + 1
    day_number = max(1, min(day_number, user_plan.template.length_days))

    plan_day = PlanDay.query.filter_by(template_id=user_plan.template_id, day_number=day_number).first()
    already_logged = DailyLog.query.filter_by(user_plan_id=user_plan.id, log_date=date.today()).first()

    return jsonify({
        "day_number": day_number,
        "total_days": user_plan.template.length_days,
        "micro_goal": plan_day.micro_goal if plan_day else None,
        "identity_cue": plan_day.identity_cue if plan_day else None,
        "reward_tier": plan_day.reward_tier if plan_day else 1,
        "current_streak": user_plan.current_streak,
        "already_logged_today": already_logged is not None,
    }), 200


@plans_bp.route("/<user_plan_id>/checkin", methods=["POST"])
@limiter.limit(HABIT_LOG_RATE_LIMIT)
@login_required
def checkin(user_plan_id):
    """The core loop: mark today complete/missed/relapsed, recompute streak,
    return the reward_tier so the frontend knows which Three.js bloom stage
    to fire. Runs inside a single DB transaction so a crash mid-request
    can never leave the streak counter and the log row out of sync."""
    if not validate_uuid_param(user_plan_id):
        return jsonify({"error": "invalid_id"}), 400

    payload = request.get_json(silent=True) or {}
    status_raw = payload.get("status")
    if status_raw not in [s.value for s in LogStatus]:
        return jsonify({"error": "invalid_status"}), 400

    user_plan = UserPlan.query.filter_by(id=user_plan_id, user_id=g.current_user.id).first()
    if user_plan is None:
        return jsonify({"error": "plan_not_found"}), 404
    if user_plan.is_completed or user_plan.is_abandoned:
        return jsonify({"error": "plan_not_active"}), 409

    today = date.today()
    existing_log = DailyLog.query.filter_by(user_plan_id=user_plan.id, log_date=today).first()
    if existing_log:
        return jsonify({"error": "already_logged_today"}), 409

    day_number = max(1, min((today - user_plan.start_date).days + 1, user_plan.template.length_days))
    plan_day = PlanDay.query.filter_by(template_id=user_plan.template_id, day_number=day_number).first()

    log = DailyLog(
        user_id=g.current_user.id,
        user_plan_id=user_plan.id,
        plan_day_id=plan_day.id,
        log_date=today,
        status=status_raw,
        note=(payload.get("note") or "")[:280] or None,
    )
    db.session.add(log)

    if status_raw == LogStatus.COMPLETED.value:
        user_plan.current_streak += 1
        user_plan.longest_streak = max(user_plan.longest_streak, user_plan.current_streak)
        if day_number >= user_plan.template.length_days:
            user_plan.is_completed = True
    else:
        # Missed or relapsed day breaks the streak but does NOT end the
        # plan — Quiter's whole design thesis is "the plan survives a slip",
        # which is deliberately reflected here at the data layer.
        user_plan.current_streak = 0

    db.session.commit()

    return jsonify({
        "status": status_raw,
        "current_streak": user_plan.current_streak,
        "longest_streak": user_plan.longest_streak,
        "is_completed": user_plan.is_completed,
        "reward_tier": plan_day.reward_tier if (plan_day and status_raw == LogStatus.COMPLETED.value) else 0,
    }), 200

@plans_bp.route("/custom", methods=["POST"])
@login_required
def create_custom_plan():
    """
    Create a flexible user-owned plan.

    The generated PlanTemplate remains hidden from the public catalog,
    while UserPlan stores the user's personal goal, support preferences,
    reminder schedule, and timezone.
    """
    payload = request.get_json(silent=True) or {}

    goal_text = payload.get("goal_text") or ""
    if not isinstance(goal_text, str):
        return jsonify({"error": "invalid_goal_text"}), 400

    goal_text = goal_text.strip()
    if not 3 <= len(goal_text) <= 160:
        return jsonify({"error": "invalid_goal_text"}), 400

    direction = payload.get("direction")
    if direction not in ("break", "build"):
        return jsonify({"error": "invalid_direction"}), 400

    settings, error = _read_custom_settings(payload)
    if error:
        return jsonify({"error": error}), 400

    (
        length_days,
        identity_statement,
        support_style,
        reminder_times,
        reminder_timezone,
    ) = settings

    if not identity_statement:
        identity_statement = (
            "I am someone who is "
            + (
                "breaking free from "
                if direction == "break"
                else "building "
            )
            + goal_text
            + "."
        )

    if support_style == "gentle":
        daily_action = (
            f"Take one small, kind step toward — {goal_text}."
        )
    elif support_style == "focused":
        daily_action = (
            f"Complete one clear action toward — {goal_text}."
        )
    else:
        daily_action = (
            f"Pause, notice what you need, and take one step toward — "
            f"{goal_text}."
        )

    template = PlanTemplate(
        slug=f"custom-{gen_uuid()[:8]}",
        title=goal_text[:120],
        identity_statement=identity_statement,
        direction=direction,
        category="custom",
        length_days=length_days,
        description="A flexible custom plan built by the user.",
        is_active=False,
    )

    db.session.add(template)
    db.session.flush()

    for day_number in range(1, length_days + 1):
        db.session.add(
            PlanDay(
                template_id=template.id,
                day_number=day_number,
                micro_goal=f"Day {day_number}: {daily_action}",
                identity_cue=identity_statement,
                reward_tier=1,
            )
        )

    user_plan = UserPlan(
        user_id=g.current_user.id,
        template_id=template.id,
        goal_text=goal_text,
        identity_statement=identity_statement,
        support_style=support_style,
        reminder_times=reminder_times,
        reminder_timezone=reminder_timezone,
        reminders_enabled=bool(reminder_times),
        start_date=date.today(),
    )

    db.session.add(user_plan)
    db.session.commit()

    return jsonify(
        {
            "user_plan_id": user_plan.id,
            "template_id": template.id,
            "title": template.title,
            "goal_text": goal_text,
            "identity_statement": identity_statement,
            "support_style": support_style,
            "length_days": length_days,
            "reminder_times": reminder_times,
            "reminder_timezone": reminder_timezone,
            "reminders_enabled": bool(reminder_times),
            "start_date": user_plan.start_date.isoformat(),
        }
    ), 201