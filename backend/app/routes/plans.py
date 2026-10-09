"""
Plan routes — /api/v1/plans/*

Handles the plan catalog (read-only templates), a user's live plan
instances, the athlete exercise tracker, and the analytics/diagnosis feed.
Every write is scoped to g.current_user.id so a user can never mutate
another user's plan by guessing a UUID (IDOR protection — the WHERE clause
always includes user_id, enforced at the query layer, not "checked after
the fact").
"""
import math
import logging
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from flask import Blueprint, request, jsonify, g
from sqlalchemy.exc import IntegrityError

from app.models.models import (
    db, PlanTemplate, PlanDay, UserPlan, DailyLog, LogStatus, HabitDirection,
    ProgressVideo, ExerciseLog, gen_uuid,
)
from app.data.exercise_catalog import (
    CATALOG, METRICS, METRIC_DEFAULTS, MAX_TRACKED_EXERCISES, sport_exists, find_exercise, custom_exercise_key,
    EXPERIENCE_LEVELS, DIET_STYLES, find_phase, phases_for,
)
from app.utils.blue_ai import get_or_create_suggestions
from app.security.email import (
    send_plan_started_email, send_plan_completed_email,
    send_plan_closed_email, send_streak_milestone_email,
)
from app.utils.analytics import build_analytics
from app.utils.coach_ai import get_or_create_coach_message, get_existing_coach_message
from app.utils.plan_ai import suggest_plan_name, get_or_create_insight, suggest_goal_placeholder
from app.security.checkin_tokens import read_checkin_token
from app.utils.supabase_storage import upload_progress_video, SupabaseStorageError
from app.security.session_auth import login_required
from app.security.limiter import limiter, HABIT_LOG_RATE_LIMIT
from app.utils.validation import validate_uuid_param

plans_bp = Blueprint("plans", __name__, url_prefix="/api/v1/plans")

logger = logging.getLogger("quiter.plans")
CREATE_PLAN_RATE_LIMIT = "10 per hour"
STREAK_EMAIL_MILESTONES = {7, 14, 30, 60, 100}
REMINDER_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
SUPPORT_STYLES = {"gentle", "focused", "reflective"}
MAX_ACTIVE_PLANS = 3
AUTO_QUIT_DAYS = 15
VIDEO_FREQUENCIES = {"weekly", "monthly", None}
COACH_MESSAGE_RATE_LIMIT = "30 per hour"
GOAL_HINT_RATE_LIMIT = "30 per hour"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _active_plan_count(user_id):
    return UserPlan.query.filter_by(
        user_id=user_id, is_completed=False, is_abandoned=False
    ).count()


def _plan_type(user_plan):
    if user_plan.athletic_metadata:
        return "athletic"
    if user_plan.template.category == "custom":
        return "custom"
    return "catalog"


def _tracked_exercises(user_plan):
    meta = user_plan.athletic_metadata or {}
    items = meta.get("tracked_exercises")
    return items if isinstance(items, list) else []


def _today_in(tz_name):
    """Today's date in a named timezone (falls back to UTC on a bad name)."""
    try:
        return datetime.now(ZoneInfo(tz_name or "UTC")).date()
    except Exception:
        return datetime.utcnow().date()


def _local_today(user_plan):
    """'Today' in the plan's own timezone. The server runs in UTC, so using
    date.today() would put users east of UTC (e.g. Egypt) on yesterday for the
    first hours of their day — and make the dashboard disagree with the email."""
    return _today_in(user_plan.reminder_timezone)


def _current_day_number(user_plan, today):
    return max(1, min((today - user_plan.start_date).days + 1, user_plan.template.length_days))


def _read_custom_settings(payload):
    """
    Validate flexible custom-plan settings.

    Returns:
        ((length_days, identity_statement, support_style,
          reminder_times, reminder_timezone, video_checkin_frequency), None)
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
        if not isinstance(reminder_time, str) or not REMINDER_TIME_RE.fullmatch(reminder_time):
            return None, "invalid_reminder_times"
        if reminder_time not in normalized_times:
            normalized_times.append(reminder_time)
    normalized_times.sort(key=lambda value: int(value[:2]) * 60 + int(value[3:]))

    reminder_timezone = payload.get("reminder_timezone") or "UTC"
    if not isinstance(reminder_timezone, str) or len(reminder_timezone) > 64:
        return None, "invalid_timezone"
    try:
        ZoneInfo(reminder_timezone)
    except Exception:
        return None, "invalid_timezone"

    # Optional 10-second video check-ins. Off (None) unless the user opts in.
    video_frequency = payload.get("video_checkin_frequency") or None
    if video_frequency not in VIDEO_FREQUENCIES:
        return None, "invalid_video_frequency"

    return (
        (length_days, identity_statement, support_style, normalized_times, reminder_timezone, video_frequency),
        None,
    )

def _read_default_number(value):
    """A daily default must be a real number: 0 < value <= 100000."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or not 0 < value <= 100000:
        return None
    return round(float(value), 2)


def _read_athletic_payload(payload):
    """
    Validate the athlete setup.

    Payload:
        sport:               key from the exercise catalog
        progression_goal:    3-200 chars
        phase:               optional phase key for that sport
        experience, diet:    optional keys (see exercise_catalog)
        tracked_exercises:   1..8 items, each either
                               {"key": "<catalog exercise key>"}
                             or a custom move
                               {"label": "Cable fly", "metric": "reps"}
    """
    sport = payload.get("sport")
    if not sport_exists(sport):
        return None, "invalid_sport"

    progression_goal = payload.get("progression_goal")
    if not isinstance(progression_goal, str):
        return None, "invalid_progression_goal"
    progression_goal = progression_goal.strip()
    if not 3 <= len(progression_goal) <= 200:
        return None, "invalid_progression_goal"

    phase_key = payload.get("phase")
    phase = None
    if phase_key is not None:
        phase = find_phase(sport, phase_key)
        if phase is None:
            return None, "invalid_phase"

    experience = payload.get("experience") or None
    if experience is not None and experience not in EXPERIENCE_LEVELS:
        return None, "invalid_experience"

    diet = payload.get("diet") or None
    if diet is not None and diet not in DIET_STYLES:
        return None, "invalid_diet"

    raw = payload.get("tracked_exercises")
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_TRACKED_EXERCISES:
        return None, "invalid_tracked_exercises"

    tracked, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            return None, "invalid_tracked_exercises"

        if item.get("key") is not None:
            entry = find_exercise(sport, item.get("key"))
            if entry is None:
                return None, "invalid_tracked_exercises"
            normalized = {**entry, "custom": False}
        else:
            label = item.get("label")
            metric = item.get("metric")
            if not isinstance(label, str) or metric not in METRICS:
                return None, "invalid_tracked_exercises"
            label = label.strip()
            if not 2 <= len(label) <= 60:
                return None, "invalid_tracked_exercises"
            key = custom_exercise_key(label)
            if key == "custom-":
                return None, "invalid_tracked_exercises"
            normalized = {"key": key, "label": label, "metric": metric, "unit": METRICS[metric], "custom": True}

        default = _read_default_number(item.get("default"))
        if default is None:
            return None, "invalid_default_numbers"
        
        normalized["default"] = default

        if normalized["key"] in seen:
            continue
        seen.add(normalized["key"])
        tracked.append(normalized)

    if not tracked:
        return None, "invalid_tracked_exercises"

    return {
        "sport": sport,
        "sport_label": CATALOG[sport]["label"],
        "progression_goal": progression_goal,
        "phase": phase["key"] if phase else None,
        "phase_label": phase["label"] if phase else None,
        "experience": experience,
        "diet": diet,
        "tracked_exercises": tracked,
    }, None


def _add_plan_days(template, length_days, daily_action, identity_statement):
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


def _record_checkin(user_plan, status, note, today):
    """
    Shared check-in logic (used by /checkin and by /exercise-log).
    Adds rows to the session but does NOT commit — the caller commits so the
    whole request stays one transaction.

    Returns (result_dict, None) or (None, (error_code, http_status)).
    """
    if user_plan.is_completed or user_plan.is_abandoned:
        return None, ("plan_not_active", 409)

    if DailyLog.query.filter_by(user_plan_id=user_plan.id, log_date=today).first():
        return None, ("already_logged_today", 409)

    day_number = _current_day_number(user_plan, today)
    plan_day = PlanDay.query.filter_by(template_id=user_plan.template_id, day_number=day_number).first()

    db.session.add(DailyLog(
        user_id=user_plan.user_id,
        user_plan_id=user_plan.id,
        plan_day_id=plan_day.id if plan_day else None,
        log_date=today,
        status=status,
        note=(note or "")[:280] or None,
    ))

    if status == LogStatus.COMPLETED.value:
        # A streak only continues if the previous completed day was YESTERDAY.
        # Any gap (even without an explicit "missed" log) restarts it at 1.
        previous = (
            DailyLog.query
            .filter(
                DailyLog.user_plan_id == user_plan.id,
                DailyLog.status == LogStatus.COMPLETED,
                DailyLog.log_date < today,
            )
            .order_by(DailyLog.log_date.desc())
            .first()
        )
        if previous and (today - previous.log_date).days == 1:
            user_plan.current_streak += 1
        else:
            user_plan.current_streak = 1
        user_plan.longest_streak = max(user_plan.longest_streak, user_plan.current_streak)
        if day_number >= user_plan.template.length_days:
            user_plan.is_completed = True
    else:
        # A missed day breaks the streak but does NOT end the plan — the plan
        # survives a slip, by design.
        user_plan.current_streak = 0

    # Any check-in at all counts as showing up and resets the 15-day auto-quit clock.
    user_plan.last_checkin_date = today

    return {
        "status": status,
        "current_streak": user_plan.current_streak,
        "longest_streak": user_plan.longest_streak,
        "is_completed": user_plan.is_completed,
        "reward_tier": (plan_day.reward_tier if (plan_day and status == LogStatus.COMPLETED.value) else 0),
    }, None


def _load_plan(user_plan_id):
    """(user_plan, None) or (None, (json_response, status))."""
    if not validate_uuid_param(user_plan_id):
        return None, (jsonify({"error": "invalid_id"}), 400)
    user_plan = UserPlan.query.filter_by(id=user_plan_id, user_id=g.current_user.id).first()
    if user_plan is None:
        return None, (jsonify({"error": "plan_not_found"}), 404)
    return user_plan, None


# ---------------------------------------------------------------------------
# Lifecycle emails (Resend templates). Always called AFTER commit; never raise.
# ---------------------------------------------------------------------------

def _plan_goal(user_plan):
    return user_plan.goal_text or user_plan.template.title


def _notify_plan_started(user_plan):
    """Call AFTER commit. Never raises (email failures must not break plan creation)."""
    try:
        times = user_plan.reminder_times or []
        when = f"{', '.join(times)} ({user_plan.reminder_timezone})" if times else "No reminders set"
        send_plan_started_email(
            g.current_user.email, g.current_user.display_name, _plan_goal(user_plan),
            user_plan.template.length_days, when, idempotency_key=f"plan-started:{user_plan.id}",
        )
    except Exception:
        logger.exception("plan-started email failed")


def _notify_after_checkin(user_plan, result):
    """Call AFTER commit with the dict from _record_checkin. Sends the completion or
    streak-milestone email. Never raises."""
    if not result or result.get("status") != LogStatus.COMPLETED.value:
        return
    try:
        user = user_plan.user
        if result.get("is_completed"):
            days_logged = DailyLog.query.filter_by(
                user_plan_id=user_plan.id, status=LogStatus.COMPLETED).count()
            send_plan_completed_email(
                user.email, user.display_name, _plan_goal(user_plan), user_plan.template.length_days,
                days_logged, user_plan.longest_streak, idempotency_key=f"plan-completed:{user_plan.id}",
            )
        elif result.get("current_streak") in STREAK_EMAIL_MILESTONES:
            send_streak_milestone_email(
                user.email, user.display_name, _plan_goal(user_plan), result["current_streak"],
                idempotency_key=f"streak:{user_plan.id}:{result['current_streak']}",
            )
    except Exception:
        logger.exception("lifecycle email failed")


# ---------------------------------------------------------------------------
# Dashboard / catalog
# ---------------------------------------------------------------------------

@plans_bp.route("/mine", methods=["GET"])
@login_required
def my_plans():
    """List the current user's plans for the dashboard — each with today's
    micro-goal pre-computed so the dashboard needs no per-plan round trip."""
    user_plans = UserPlan.query.filter_by(user_id=g.current_user.id).order_by(UserPlan.created_at.desc()).all()

    out = []
    for up in user_plans:
        today = _local_today(up)
        day_number = _current_day_number(up, today)
        plan_day = PlanDay.query.filter_by(template_id=up.template_id, day_number=day_number).first()
        already_logged = DailyLog.query.filter_by(user_plan_id=up.id, log_date=today).first()
        meta = up.athletic_metadata or {}
        today_values = {}
        if meta:
            today_values = {
                row.exercise_key: row.value
                for row in ExerciseLog.query.filter_by(user_plan_id=up.id, log_date=today).all()
            }
        existing_message = get_existing_coach_message(up.id, today)
        out.append({
            "user_plan_id": up.id,
            "template_id": up.template_id,
            "plan_type": _plan_type(up),
            "category": up.template.category,
            "sport_label": meta.get("sport_label"),
            "phase_label": meta.get("phase_label"),
            "tracked_exercise_count": len(_tracked_exercises(up)),
            "tracked_exercises": _tracked_exercises(up),
            "today_values": today_values,
            "video_checkin_frequency": up.video_checkin_frequency,
            "coach_message": existing_message.body if existing_message else None,
            "photo_url": up.template.photo_url,
            "title": up.template.title,
            "direction": up.template.direction.value,
            "day_number": day_number,
            "total_days": up.template.length_days,
            "current_streak": up.current_streak,
            "longest_streak": up.longest_streak,
            "goal_text": up.goal_text or up.template.title,
            "identity_statement": up.identity_statement or up.template.identity_statement,
            "support_style": up.support_style,
            "reminder_times": up.reminder_times or [],
            "reminder_timezone": up.reminder_timezone,
            "reminders_enabled": up.reminders_enabled,
            "is_completed": up.is_completed,
            "is_abandoned": up.is_abandoned,
            "micro_goal": plan_day.micro_goal if plan_day else None,
            "identity_cue": plan_day.identity_cue if plan_day else None,
            "already_logged_today": already_logged is not None,
        })
    return jsonify(out), 200


@plans_bp.route("/templates", methods=["GET"])
def list_templates():
    """Browse the plan catalog. Deliberately PUBLIC (no @login_required) so a
    logged-out visitor can browse before creating an account. Nothing in this
    response is user-specific. Supports ?direction=break|build and
    ?length=7|15|30 filters — both validated, so an arbitrary query string
    can never reach raw SQL."""
    direction = request.args.get("direction")
    length = request.args.get("length", type=int)

    query = PlanTemplate.query.filter_by(is_active=True)
    if direction in ("break", "build"):
        query = query.filter_by(direction=direction)
    if length in (7, 15, 30):
        query = query.filter_by(length_days=length)

    templates = query.order_by(PlanTemplate.created_at.asc()).limit(6).all()
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


@plans_bp.route("/exercise-catalog", methods=["GET"])
def get_exercise_catalog():
    """Public: sports -> exercises (with metric + unit) and phases for the athlete picker."""
    return jsonify({
        "max_tracked": MAX_TRACKED_EXERCISES,
        "metrics": METRICS,
        "experience_levels": EXPERIENCE_LEVELS,
        "diet_styles": DIET_STYLES,
        "metric_defaults": METRIC_DEFAULTS,
        "sports": [
            {"key": key, "label": sport["label"], "exercises": sport["exercises"], "phases": phases_for(key)}
            for key, sport in CATALOG.items()
        ],
    }), 200


@plans_bp.route("/goal-placeholder", methods=["POST"])
@limiter.limit(GOAL_HINT_RATE_LIMIT)
@login_required
def goal_placeholder():
    """AI-written example for the 'What do you want to reach?' box, based on the
    answers so far (sport, phase, level, food style, exercises, and the user's
    optional 'about me'). Falls back to a free heuristic. Never fails the form."""
    payload = request.get_json(silent=True) or {}
    sport = payload.get("sport")
    if not sport_exists(sport):
        return jsonify({"error": "invalid_sport"}), 400

    phase = find_phase(sport, payload.get("phase")) if payload.get("phase") else None
    experience = EXPERIENCE_LEVELS.get(payload.get("experience") or "", "")
    diet = DIET_STYLES.get(payload.get("diet") or "", "")

    labels = []
    raw = payload.get("tracked_exercises")
    if isinstance(raw, list):
        for item in raw[:MAX_TRACKED_EXERCISES]:
            if not isinstance(item, dict):
                continue
            if item.get("key") is not None:
                entry = find_exercise(sport, item.get("key"))
                if entry:
                    labels.append(entry["label"])
            elif isinstance(item.get("label"), str) and 2 <= len(item["label"].strip()) <= 60:
                labels.append(item["label"].strip())

    text, source = suggest_goal_placeholder(
        CATALOG[sport]["label"], phase, experience, diet, labels, g.current_user.about_me or "",
    )
    return jsonify({"placeholder": text, "source": source}), 200


@plans_bp.route("/adopt", methods=["POST"])
@login_required
def adopt_plan():
    """Start a catalog plan. Refuses to double-enroll in the same template
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

    if _active_plan_count(g.current_user.id) >= MAX_ACTIVE_PLANS:
        return jsonify({"error": "max_plans_reached", "max": MAX_ACTIVE_PLANS}), 409

    # Same optional settings as a custom plan (coaching style, email check-ins,
    # video check-ins). The plan length always comes from the template.
    settings, error = _read_custom_settings({**payload, "length_days": template.length_days})
    if error:
        return jsonify({"error": error}), 400
    _, identity_statement, support_style, reminder_times, reminder_timezone, video_frequency = settings

    user_plan = UserPlan(
        user_id=g.current_user.id,
        template_id=template_id,
        identity_statement=identity_statement or None,
        support_style=support_style,
        reminder_times=reminder_times,
        reminder_timezone=reminder_timezone,
        reminders_enabled=bool(reminder_times),
        video_checkin_frequency=video_frequency,
        start_date=_today_in(reminder_timezone),
        last_checkin_date=_today_in(reminder_timezone),
    )
    db.session.add(user_plan)
    db.session.commit()
    _notify_plan_started(user_plan)
    return jsonify({"user_plan_id": user_plan.id, "start_date": user_plan.start_date.isoformat()}), 201


# ---------------------------------------------------------------------------
# Daily loop
# ---------------------------------------------------------------------------

@plans_bp.route("/<user_plan_id>/today", methods=["GET"])
@login_required
def get_today(user_plan_id):
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    today = _local_today(user_plan)
    day_number = _current_day_number(user_plan, today)
    plan_day = PlanDay.query.filter_by(template_id=user_plan.template_id, day_number=day_number).first()
    already_logged = DailyLog.query.filter_by(user_plan_id=user_plan.id, log_date=today).first()

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
    """The core loop: mark today complete/missed, recompute streak, return the
    reward_tier so the frontend knows which bloom stage to fire. One DB
    transaction, so the streak counter and the log row can never drift."""
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    payload = request.get_json(silent=True) or {}
    status_raw = payload.get("status")
    if status_raw not in [s.value for s in LogStatus]:
        return jsonify({"error": "invalid_status"}), 400

    result, error = _record_checkin(user_plan, status_raw, payload.get("note"), _local_today(user_plan))
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "already_logged_today"}), 409

    _notify_after_checkin(user_plan, result)
    return jsonify(result), 200


@plans_bp.route("/<user_plan_id>/exercise-log", methods=["POST"])
@limiter.limit(HABIT_LOG_RATE_LIMIT)
@login_required
def log_exercises(user_plan_id):
    """
    Save today's numbers for the plan's tracked exercises (upsert — the user
    can correct today's values). With "checkin": true it also records today's
    check-in as completed, in the same transaction.

    Body: {"entries": [{"exercise_key": "bench-press", "value": 80}, ...],
           "checkin": true}
    """
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err
    if user_plan.is_completed or user_plan.is_abandoned:
        return jsonify({"error": "plan_not_active"}), 409

    tracked = {ex["key"]: ex for ex in _tracked_exercises(user_plan)}
    if not tracked:
        return jsonify({"error": "no_tracked_exercises"}), 400

    payload = request.get_json(silent=True) or {}
    entries = payload.get("entries")
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_TRACKED_EXERCISES:
        return jsonify({"error": "invalid_entries"}), 400

    cleaned = {}
    for entry in entries:
        if not isinstance(entry, dict):
            return jsonify({"error": "invalid_entries"}), 400
        key, value = entry.get("exercise_key"), entry.get("value")
        if key not in tracked:
            return jsonify({"error": "unknown_exercise"}), 400
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return jsonify({"error": "invalid_value"}), 400
        if not math.isfinite(value) or not 0 <= value <= 100000:
            return jsonify({"error": "invalid_value"}), 400
        cleaned[key] = round(float(value), 2)

    today = _local_today(user_plan)
    existing = {
        row.exercise_key: row
        for row in ExerciseLog.query.filter_by(user_plan_id=user_plan.id, log_date=today).all()
    }
    for key, value in cleaned.items():
        if key in existing:
            existing[key].value = value
        else:
            db.session.add(ExerciseLog(
                user_id=g.current_user.id,
                user_plan_id=user_plan.id,
                log_date=today,
                exercise_key=key,
                value=value,
            ))

    checkin_result = None
    if payload.get("checkin") is True:
        already = DailyLog.query.filter_by(user_plan_id=user_plan.id, log_date=today).first()
        if not already:
            checkin_result, _ = _record_checkin(user_plan, LogStatus.COMPLETED.value, payload.get("note"), today)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "conflict"}), 409

    _notify_after_checkin(user_plan, checkin_result)
    return jsonify({"saved": cleaned, "checkin": checkin_result}), 200


# ---------------------------------------------------------------------------
# Progress + analytics
# ---------------------------------------------------------------------------

@plans_bp.route("/<user_plan_id>/progress", methods=["GET"])
@login_required
def get_progress(user_plan_id):
    """Everything the progress header needs in one call: streaks, completion,
    the auto-quit countdown, a 30-day heatmap, and (athlete plans) the
    tracked exercises plus today's saved values."""
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    today = _local_today(user_plan)
    day_number = _current_day_number(user_plan, today)
    completion_pct = round((day_number / user_plan.template.length_days) * 100)

    days_since_checkin = (today - user_plan.last_checkin_date).days
    days_until_auto_quit = max(0, AUTO_QUIT_DAYS - days_since_checkin)

    window_start = today - timedelta(days=29)
    logs = DailyLog.query.filter(
        DailyLog.user_plan_id == user_plan.id,
        DailyLog.log_date >= window_start,
        DailyLog.log_date <= today,
    ).all()
    log_by_date = {log.log_date.isoformat(): log.status.value for log in logs}

    heatmap = []
    for i in range(30):
        d = (window_start + timedelta(days=i)).isoformat()
        heatmap.append({"date": d, "status": log_by_date.get(d, "none")})

    already_logged_today = DailyLog.query.filter_by(user_plan_id=user_plan.id, log_date=today).first() is not None

    athletic = None
    if user_plan.athletic_metadata:
        meta = user_plan.athletic_metadata
        today_rows = ExerciseLog.query.filter_by(user_plan_id=user_plan.id, log_date=today).all()
        athletic = {
            "sport": meta.get("sport"),
            "sport_label": meta.get("sport_label"),
            "phase_label": meta.get("phase_label"),
            "progression_goal": meta.get("progression_goal"),
            "tracked_exercises": _tracked_exercises(user_plan),
            "today_values": {row.exercise_key: row.value for row in today_rows},
        }

    return jsonify({
        "user_plan_id": user_plan.id,
        "plan_type": _plan_type(user_plan),
        "title": user_plan.template.title,
        "goal_text": user_plan.goal_text or user_plan.template.title,
        "direction": user_plan.template.direction.value,
        "day_number": day_number,
        "total_days": user_plan.template.length_days,
        "completion_pct": completion_pct,
        "current_streak": user_plan.current_streak,
        "longest_streak": user_plan.longest_streak,
        "start_date": user_plan.start_date.isoformat(),
        "last_checkin_date": user_plan.last_checkin_date.isoformat(),
        "days_since_checkin": days_since_checkin,
        "days_until_auto_quit": days_until_auto_quit,
        "already_logged_today": already_logged_today,
        "video_checkin_frequency": user_plan.video_checkin_frequency,
        "is_completed": user_plan.is_completed,
        "is_abandoned": user_plan.is_abandoned,
        "heatmap": heatmap,
        "athletic": athletic,
    }), 200


@plans_bp.route("/<user_plan_id>/analytics", methods=["GET"])
@login_required
def get_analytics(user_plan_id):
    """Graph data + coach diagnosis for ANY plan (catalog, custom, athletic).
    ?days=7..180 sets the graph window (default 30)."""
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    window_days = request.args.get("days", default=30, type=int)
    window_days = max(7, min(window_days or 30, 180))

    logs = DailyLog.query.filter_by(user_plan_id=user_plan.id).all()
    status_by_date = {log.log_date: log.status.value for log in logs}

    tracked = _tracked_exercises(user_plan)
    points = {}
    if tracked:
        rows = (
            ExerciseLog.query.filter_by(user_plan_id=user_plan.id)
            .order_by(ExerciseLog.log_date.asc())
            .all()
        )
        for row in rows:
            points.setdefault(row.exercise_key, []).append((row.log_date, row.value))

    data = build_analytics(
        start=user_plan.start_date,
        today=_local_today(user_plan),
        length_days=user_plan.template.length_days,
        status_by_date=status_by_date,
        exercises=tracked,
        points_by_exercise=points,
        window_days=window_days,
        current_streak=user_plan.current_streak,
        longest_streak=user_plan.longest_streak,
    )
    data["user_plan_id"] = user_plan.id
    data["plan_type"] = _plan_type(user_plan)
    data["title"] = user_plan.template.title
    return jsonify(data), 200


@plans_bp.route("/<user_plan_id>/abandon", methods=["POST"])
@login_required
def abandon_plan(user_plan_id):
    """User-initiated exit — distinct from the worker's automatic 15-day
    abandon, but lands in the same is_abandoned flag either way."""
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    if user_plan.is_completed:
        return jsonify({"error": "plan_already_completed"}), 409

    user_plan.is_abandoned = True
    db.session.commit()

    try:
        send_plan_closed_email(
            g.current_user.email, g.current_user.display_name,
            _plan_goal(user_plan), idempotency_key=f"plan-closed:{user_plan.id}",
        )
    except Exception:
        logger.exception("plan-closed email failed")

    return jsonify({"ok": True}), 200


# ---------------------------------------------------------------------------
# Custom plan creation
# ---------------------------------------------------------------------------

def _daily_action(support_style, target):
    if support_style == "gentle":
        return f"Take one small, kind step toward — {target}."
    if support_style == "focused":
        return f"Complete one clear action toward — {target}."
    return f"Pause, notice what you need, and take one step toward — {target}."


@plans_bp.route("/custom", methods=["POST"])
@limiter.limit(CREATE_PLAN_RATE_LIMIT)
@login_required
def create_custom_plan():
    """
    Create a personal coaching plan for ANY goal.

    The generated PlanTemplate stays hidden from the public catalog, while
    UserPlan stores the user's goal, support style, reminders, timezone and
    the optional video check-in frequency. "direction" is legacy and optional
    (defaults to "build") — the app is a personal coach now, not break/build.
    The template title is a short AI-written plan name (free fallback).
    """
    payload = request.get_json(silent=True) or {}

    goal_text = payload.get("goal_text") or ""
    if not isinstance(goal_text, str):
        return jsonify({"error": "invalid_goal_text"}), 400
    goal_text = goal_text.strip()
    if not 3 <= len(goal_text) <= 160:
        return jsonify({"error": "invalid_goal_text"}), 400

    direction = payload.get("direction") or "build"
    if direction not in ("break", "build"):
        return jsonify({"error": "invalid_direction"}), 400

    settings, error = _read_custom_settings(payload)
    if error:
        return jsonify({"error": error}), 400

    if _active_plan_count(g.current_user.id) >= MAX_ACTIVE_PLANS:
        return jsonify({"error": "max_plans_reached", "max": MAX_ACTIVE_PLANS}), 409

    length_days, identity_statement, support_style, reminder_times, reminder_timezone, video_frequency = settings

    if not identity_statement:
        identity_statement = f"I am someone who follows through on: {goal_text}."[:160]

    plan_name = suggest_plan_name("personal", goal_text)

    template = PlanTemplate(
        slug=f"custom-{gen_uuid()[:8]}",
        title=plan_name,
        identity_statement=identity_statement,
        direction=HabitDirection(direction),
        category="custom",
        length_days=length_days,
        description="A flexible custom plan built by the user.",
        is_active=False,
    )
    db.session.add(template)
    db.session.flush()

    _add_plan_days(template, length_days, _daily_action(support_style, goal_text), identity_statement)

    user_plan = UserPlan(
        user_id=g.current_user.id,
        template_id=template.id,
        goal_text=goal_text,
        identity_statement=identity_statement,
        support_style=support_style,
        reminder_times=reminder_times,
        reminder_timezone=reminder_timezone,
        reminders_enabled=bool(reminder_times),
        video_checkin_frequency=video_frequency,
        start_date=_today_in(reminder_timezone),
        last_checkin_date=_today_in(reminder_timezone),
    )
    db.session.add(user_plan)
    db.session.commit()
    _notify_plan_started(user_plan)

    return jsonify({
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
        "video_checkin_frequency": video_frequency,
        "start_date": user_plan.start_date.isoformat(),
    }), 201


@plans_bp.route("/custom-athletic", methods=["POST"])
@limiter.limit(CREATE_PLAN_RATE_LIMIT)
@login_required
def create_athletic_plan():
    """
    Athlete plan: pick a sport, a phase, then up to 8 exercises to track every
    day (catalog moves and/or custom ones). Sport, phase, goal and the tracked
    list live in athletic_metadata (JSONB) rather than bloating UserPlan with
    columns. The template title is a short AI-written plan name (free fallback).
    """
    payload = request.get_json(silent=True) or {}

    athletic_fields, error = _read_athletic_payload(payload)
    if error:
        return jsonify({"error": error}), 400

    settings, error = _read_custom_settings(payload)
    if error:
        return jsonify({"error": error}), 400

    if _active_plan_count(g.current_user.id) >= MAX_ACTIVE_PLANS:
        return jsonify({"error": "max_plans_reached", "max": MAX_ACTIVE_PLANS}), 409

    length_days, identity_statement, support_style, reminder_times, reminder_timezone, video_frequency = settings

    sport_label = athletic_fields["sport_label"]
    progression_goal = athletic_fields["progression_goal"]
    goal_text = f"{sport_label} — {progression_goal}"[:160]

    if not identity_statement:
        identity_statement = f"I am someone who trains in {sport_label} — {progression_goal}."[:160]

    if support_style == "gentle":
        daily_action = f"Train, log your numbers, and take one small, kind step toward — {progression_goal}."
    elif support_style == "focused":
        daily_action = f"Complete your training, log your numbers, and push toward — {progression_goal}."
    else:
        daily_action = f"Notice how your body feels, train, log your numbers, and move toward — {progression_goal}."

    plan_name = suggest_plan_name("athlete", progression_goal, sport_label, athletic_fields.get("phase_label"))
    athletic_fields["plan_name"] = plan_name

    template = PlanTemplate(
        slug=f"athletic-{gen_uuid()[:8]}",
        title=plan_name,
        identity_statement=identity_statement,
        direction=HabitDirection.BUILD,
        category=athletic_fields["sport"],
        length_days=length_days,
        description="A personal athletic training plan built by the user.",
        is_active=False,
    )
    db.session.add(template)
    db.session.flush()

    _add_plan_days(template, length_days, daily_action, identity_statement)

    user_plan = UserPlan(
        user_id=g.current_user.id,
        template_id=template.id,
        goal_text=goal_text,
        identity_statement=identity_statement,
        support_style=support_style,
        reminder_times=reminder_times,
        reminder_timezone=reminder_timezone,
        reminders_enabled=bool(reminder_times),
        video_checkin_frequency=video_frequency,
        start_date=_today_in(reminder_timezone),
        last_checkin_date=_today_in(reminder_timezone),
        athletic_metadata=athletic_fields,
    )
    db.session.add(user_plan)
    db.session.commit()
    _notify_plan_started(user_plan)

    return jsonify({
        "user_plan_id": user_plan.id,
        "template_id": template.id,
        "title": template.title,
        "athletic_metadata": athletic_fields,
        "length_days": length_days,
        "start_date": user_plan.start_date.isoformat(),
    }), 201


# ---------------------------------------------------------------------------
# Progress videos
# ---------------------------------------------------------------------------

@plans_bp.route("/<user_plan_id>/videos", methods=["POST"])
@limiter.limit(HABIT_LOG_RATE_LIMIT)
@login_required
def upload_progress_video_route(user_plan_id):
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    file = request.files.get("video")
    if file is None:
        return jsonify({"error": "no_file"}), 400

    try:
        video_url = upload_progress_video(file.read(), file.mimetype)
    except SupabaseStorageError as e:
        return jsonify({"error": str(e)}), 400

    day_number = _current_day_number(user_plan, _local_today(user_plan))

    video = ProgressVideo(
        user_id=g.current_user.id,
        user_plan_id=user_plan.id,
        video_url=video_url,
        day_number=day_number,
    )
    db.session.add(video)
    db.session.commit()

    return jsonify({
        "id": video.id,
        "video_url": video.video_url,
        "day_number": video.day_number,
        "created_at": video.created_at.isoformat(),
    }), 201


@plans_bp.route("/<user_plan_id>/videos", methods=["GET"])
@login_required
def list_progress_videos(user_plan_id):
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    videos = ProgressVideo.query.filter_by(user_plan_id=user_plan.id).order_by(ProgressVideo.created_at.desc()).all()
    return jsonify([{
        "id": v.id,
        "video_url": v.video_url,
        "day_number": v.day_number,
        "created_at": v.created_at.isoformat(),
    } for v in videos]), 200


@plans_bp.route("/<user_plan_id>/video-frequency", methods=["PATCH"])
@login_required
def set_video_frequency(user_plan_id):
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err

    payload = request.get_json(silent=True) or {}
    frequency = payload.get("frequency")
    if frequency not in VIDEO_FREQUENCIES:
        return jsonify({"error": "invalid_frequency"}), 400

    user_plan.video_checkin_frequency = frequency
    db.session.commit()
    return jsonify({"video_checkin_frequency": frequency}), 200


# ---------------------------------------------------------------------------
# Coach message + weekly tips (dashboard) + one-tap email check-in
# ---------------------------------------------------------------------------

@plans_bp.route("/<user_plan_id>/coach-message", methods=["GET"])
@limiter.limit(COACH_MESSAGE_RATE_LIMIT)
@login_required
def get_coach_message(user_plan_id):
    """Today's personal coach message for this plan. Generated on first call of
    the day (AI when AI_API_KEY is set, templates otherwise) and stored, so the
    reminder email and the dashboard always show the same text."""
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err
    if user_plan.is_completed or user_plan.is_abandoned:
        return jsonify({"message": None}), 200

    today = _local_today(user_plan)
    row = get_or_create_coach_message(user_plan, today)
    return jsonify({"message": row.body, "source": row.source, "date": today.isoformat()}), 200

@plans_bp.route("/<user_plan_id>/blue", methods=["GET"])
@plans_bp.route("/<user_plan_id>/insights", methods=["GET"])   # old path kept so nothing breaks
@limiter.limit(COACH_MESSAGE_RATE_LIMIT)
@login_required
def get_blue_suggestions(user_plan_id):
    """Blue's suggestions (max 3) for this plan, based on the user's inputs and
    real progress. Cached per plan per day + progress state, so most calls
    cost zero AI tokens."""
    user_plan, err = _load_plan(user_plan_id)
    if err:
        return err
    if user_plan.is_completed or user_plan.is_abandoned:
        return jsonify({"tips": []}), 200
 
    row = get_or_create_suggestions(user_plan, _local_today(user_plan))
    return jsonify({"tips": row.tips, "source": row.source}), 200

@plans_bp.route("/email-checkin", methods=["POST"])
@limiter.limit(HABIT_LOG_RATE_LIMIT)
def email_checkin():
    """The 'Yes, I'm on track' button in the reminder email.

    Deliberately POST (not GET): mail scanners and link-preview bots fetch
    links with GET, and that must never mark a day complete. The frontend page
    (checkin.html) reads the signed token from the URL and POSTs it here.
    No session needed — the signed token IS the authorization, and it can only
    complete this one plan for this one day.
    """
    payload = request.get_json(silent=True) or {}
    parsed = read_checkin_token(payload.get("token"))
    if parsed is None:
        return jsonify({"error": "invalid_or_expired_token"}), 400
    user_plan_id, token_date = parsed

    user_plan = db.session.get(UserPlan, user_plan_id)
    if user_plan is None or not user_plan.user.is_active:
        return jsonify({"error": "plan_not_found"}), 404

    today = _local_today(user_plan)
    if token_date > today or (today - token_date).days > 1:
        return jsonify({"error": "invalid_or_expired_token"}), 400

    base = {
        "title": user_plan.goal_text or user_plan.template.title,
        "day_number": _current_day_number(user_plan, token_date),
        "total_days": user_plan.template.length_days,
    }

    if DailyLog.query.filter_by(user_plan_id=user_plan.id, log_date=token_date).first():
        return jsonify({**base, "already_logged": True,
                        "current_streak": user_plan.current_streak,
                        "is_completed": user_plan.is_completed}), 200

    result, error = _record_checkin(user_plan, LogStatus.COMPLETED.value, None, token_date)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({**base, "already_logged": True,
                        "current_streak": user_plan.current_streak,
                        "is_completed": user_plan.is_completed}), 200

    _notify_after_checkin(user_plan, result)
    return jsonify({**base, "already_logged": False,
                    "current_streak": result["current_streak"],
                    "is_completed": result["is_completed"]}), 200