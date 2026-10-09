"""
Athlete off days (rest days), stored in UserPlan.athletic_metadata["off_day"]:
  {"mode": "blue"|"manual", "weekday": 0-6|None (Mon=0), "reason": str|None,
   "dates": ["YYYY-MM-DD"],        # extra off days added from the dashboard
   "train_dates": ["YYYY-MM-DD"]}  # weekly off days the user trained on anyway
Pure functions so routes, analytics and the reminder worker share one definition.
"""
from datetime import timedelta

from app.data.exercise_catalog import find_phase

MAX_OFF_DAYS_PER_WEEK = 2
MAX_STORED_DATES = 60
TEAM_SPORTS = {"football", "basketball", "tennis", "volleyball"}


def default_config(mode="manual", weekday=None, reason=None):
    return {"mode": mode, "weekday": weekday, "reason": reason, "dates": [], "train_dates": []}


def off_config(meta):
    cfg = (meta or {}).get("off_day")
    return cfg if isinstance(cfg, dict) else {}


def is_off_day(meta, start, length_days, day):
    cfg = off_config(meta)
    if not cfg:
        return False
    iso = day.isoformat()
    if iso in (cfg.get("train_dates") or []):
        return False
    if iso in (cfg.get("dates") or []):
        return True
    weekday = cfg.get("weekday")
    last_day = start + timedelta(days=length_days - 1)
    return isinstance(weekday, int) and start < day < last_day and day.weekday() == weekday


def off_days_in_week(meta, start, length_days, today):
    return sum(1 for i in range(7) if is_off_day(meta, start, length_days, today - timedelta(days=i)))


def suggest_off_day(sport, phase_key, exercises):
    """Blue's pick -> (weekday, reason). Rule-based on purpose: instant, free, no AI tokens."""
    phase = find_phase(sport, phase_key) or {}
    if sport in TEAM_SPORTS and phase_key in {"pre_season", "in_season"}:
        return 0, "Matches usually fall on weekends, so Monday is your recovery day."
    if sport in {"boxing", "martial_arts"} and phase_key in {"fight_camp", "competition_prep"}:
        return 6, "Camps are hard on the body. Sunday gives you a full reset before the week."
    heavy = sum(1 for ex in exercises if ex.get("metric") == "weight_kg")
    if heavy >= 3 or phase.get("intent") == "gain":
        return 6, "Heavy training pays off while you rest. Sunday keeps the rest of the week free to lift."
    if phase.get("intent") == "recover":
        return 2, "You're easing back in, so a mid-week break on Wednesday keeps the load gentle."
    return 6, "One full rest day a week keeps you consistent, and Sunday sets up a fresh Monday."