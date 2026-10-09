"""
Quiter — goal forecast (pure functions: no DB, no Flask, no AI).

consistency_forecast(): the marked-days graph. Cumulative marked days, the
  perfect-attendance line and a projection to the last day of the plan.
exercise_forecasts(): athlete numbers. A damped linear trend per tracked exercise,
  projected to the plan's last day, plus an ETA to the number in the goal text.
Blue only words these results (see blue_forecast.py).
"""
import math
import re
from datetime import timedelta

PRIOR_RATE = 0.7     # early rates are pulled toward "70% of days"
PRIOR_DAYS = 3
TARGET_PCT = 80      # a "good finish" = marking 80% of the days you can train
Z80 = 1.28           # 80% confidence band

UNIT_ALIASES = {"kg": "kg", "kgs": "kg", "km": "km", "k": "km", "min": "min", "mins": "min",
                "minutes": "min", "rep": "reps", "reps": "reps", "round": "rounds", "rounds": "rounds"}
GOAL_NUM = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kgs?|km|k|mins?|minutes|reps?|rounds?)\b", re.I)


def consistency_forecast(start, today, length_days, status_by_date, is_off, is_completed=False):
    n = length_days
    dates = [start + timedelta(days=i) for i in range(n)]
    finished = bool(is_completed) or today > dates[-1]
    today_i = n - 1 if finished else max(0, (today - start).days)

    days, cum, ideal = [], [], []
    done = poss = 0
    for i, d in enumerate(dates):
        raw = status_by_date.get(d)
        off = is_off(d)
        if raw == "completed":
            st = "done"
        elif raw in ("missed", "relapsed"):
            st = "missed"
        elif raw == "partial":
            st = "partial"
        elif off:
            st = "off"
        elif i > today_i:
            st = "future"
        elif i == today_i and not finished:
            st = "today"
        else:
            st = "none"          # a past day with no check-in
        done += st == "done"
        poss += (not off) or st == "done"
        cum.append(done)
        ideal.append(poss)
        days.append({"d": i + 1, "date": d.isoformat(), "s": st})

    pending_today = (not finished) and days[today_i]["s"] == "today"
    base_i = today_i - 1 if pending_today else today_i      # last settled day (-1 on day 1)
    done_base = cum[base_i] if base_i >= 0 else 0
    ideal_base = ideal[base_i] if base_i >= 0 else 0
    total_possible = ideal[-1] or 1

    r_done = r_n = 0                                         # last 7 trainable days
    for i in range(base_i, -1, -1):
        if r_n >= 7:
            break
        if days[i]["s"] == "off":
            continue
        r_n += 1
        r_done += days[i]["s"] == "done"

    prior = PRIOR_RATE * PRIOR_DAYS
    overall = (done_base + prior) / (ideal_base + PRIOR_DAYS)
    recent = (r_done + prior) / (r_n + PRIOR_DAYS)
    rate = overall if ideal_base < 7 else 0.4 * overall + 0.6 * recent
    se = math.sqrt(rate * (1 - rate) / (ideal_base + PRIOR_DAYS))
    lo_r, hi_r = max(0.0, rate - Z80 * se), min(1.0, rate + Z80 * se)
    remaining = total_possible - ideal_base if not finished else 0

    projection = None
    if remaining > 0:
        a = base_i + 1                                       # anchor day (0 = before day 1)
        mid, low, high = ([[a, done_base]] for _ in range(3))
        for i in range(base_i + 1, n):
            step = ideal[i] - ideal_base
            mid.append([i + 1, round(done_base + rate * step, 2)])
            low.append([i + 1, round(done_base + lo_r * step, 2)])
            high.append([i + 1, round(done_base + hi_r * step, 2)])
        projection = {"mid": mid, "low": low, "high": high}

    final = done_base + rate * remaining
    pct = final / total_possible * 100
    if finished:
        status = "finished"
    elif ideal_base < 3:
        status = "early"
    else:
        status = "ahead" if pct >= 90 else "on_track" if pct >= TARGET_PCT else "behind" if pct >= 60 else "at_risk"

    target_days = math.ceil(TARGET_PCT / 100 * total_possible)
    return {
        "total_days": n,
        "day": today_i + 1,
        "finished": finished,
        "status": status,
        "possible_total": ideal[-1],
        "marked": done_base,
        "remaining": remaining,
        "days": days,
        "ideal": [[0, 0]] + [[i + 1, v] for i, v in enumerate(ideal)],
        "actual": [[0, 0]] + [[i + 1, cum[i]] for i in range(base_i + 1)],
        "projection": projection,
        "final": round(final, 1),
        "final_low": round(done_base + lo_r * remaining, 1),
        "final_high": round(done_base + hi_r * remaining, 1),
        "pace": {"rate": round(rate, 2), "overall": round(overall, 2), "recent": round(recent, 2),
                 "elapsed": ideal_base, "reliable": ideal_base >= 7},
        "goal": {"target_pct": TARGET_PCT, "target_days": target_days, "need_more": max(0, target_days - done_base)},
    }


# ---------------------------------------------------------------------------
# Athlete numbers
# ---------------------------------------------------------------------------

def _pick_target(exercises, points_by_exercise, goal_text):
    """Find a number+unit in the goal text and the tracked exercise it most likely belongs to."""
    text = goal_text or ""
    words = set(re.findall(r"[a-z]{4,}", text.lower()))
    for m in GOAL_NUM.finditer(text):
        value = float(m.group(1).replace(",", "."))
        unit = UNIT_ALIASES.get(m.group(2).lower())
        cands = [e for e in exercises if e["unit"] == unit]
        if value <= 0 or not cands:
            continue

        def score(e):
            overlap = len(words & set(re.findall(r"[a-z]{4,}", e["label"].lower())))
            return (-overlap, -len(points_by_exercise.get(e["key"], [])))

        return sorted(cands, key=score)[0], value
    return None, None


def _fit(points, start, length_days):
    """Least-squares trend over the last 28 logged days, damped while there are few points."""
    pts = [((d - start).days, v) for d, v in points][-28:]
    if len(pts) < 3:
        return None
    xs = [p[0] for p in pts]
    if max(xs) - min(xs) < 4:
        return None
    n = len(pts)
    mx, my = sum(xs) / n, sum(p[1] for p in pts) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in pts) / sxx * min(1.0, n / 6)

    def at(x):
        return max(0.0, my + slope * (x - mx))

    x_first, x_last = min(xs), max(xs)
    x_end = max(length_days - 1, x_last)
    public = {
        "slope_week": round(slope * 7, 2),
        "first": [x_first + 1, round(at(x_first), 2)],
        "last": [x_last + 1, round(at(x_last), 2)],
        "end": [x_end + 1, round(at(x_end), 2)],
    }
    return public, slope, x_last, at(x_last)


def exercise_forecasts(start, length_days, exercises, points_by_exercise, goal_text):
    target_ex, target_val = _pick_target(exercises, points_by_exercise, goal_text)
    items = []
    for ex in exercises:
        pts = sorted(points_by_exercise.get(ex["key"], []), key=lambda p: p[0])
        item = {
            "key": ex["key"], "label": ex["label"], "unit": ex["unit"],
            "points": [[(d - start).days + 1, v] for d, v in pts],
            "latest": pts[-1][1] if pts else None,
            "best": max((v for _, v in pts), default=None),
            "fit": None, "target": None, "reached": False, "eta_day": None,
        }
        fit = _fit(pts, start, length_days)
        if fit:
            item["fit"] = fit[0]
        if target_ex is not None and ex["key"] == target_ex["key"]:
            item["target"] = target_val
            if item["best"] is not None and item["best"] >= target_val:
                item["reached"] = True
            elif fit and fit[1] > 0:
                days_needed = (target_val - fit[3]) / fit[1]
                if days_needed <= 365:
                    item["eta_day"] = fit[2] + math.ceil(days_needed) + 1
        items.append(item)

    with_points = [i for i in items if i["points"]]
    primary = next((i["key"] for i in items if i["target"] is not None), None)
    if primary is None and with_points:
        primary = max(with_points, key=lambda i: len(i["points"]))["key"]
    return {"primary": primary, "items": items}