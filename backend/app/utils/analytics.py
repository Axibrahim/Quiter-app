"""
Quiter — plan analytics + rules-based coach diagnosis.

Pure functions only (no DB, no Flask) so every rule is unit-testable.
The route layer loads rows, hands plain dicts/lists in, and jsonifies the
result. Nothing here talks to an LLM — the "diagnosis" is deterministic rules
written in a coach tone, so it is free, instant and explainable.

Conventions
  * "valid day"  = a calendar day between plan start and min(today, plan end)
  * done         = DailyLog.status == "completed"
  * every exercise metric is higher-is-better (see data/exercise_catalog.py)
"""
from datetime import date, timedelta

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _fmt(n):
    n = round(float(n), 2)
    return str(int(n)) if n == int(n) else str(n)


def _pct(done, possible):
    return round(done / possible * 100) if possible else 0


def _effective_today(start, today, length_days):
    end = start + timedelta(days=length_days - 1)
    return min(today, end)


def _count_window(status_by_date, start, lo, hi):
    """(completed, possible) for valid days in [lo, hi]."""
    lo = max(lo, start)
    if hi < lo:
        return 0, 0
    possible = (hi - lo).days + 1
    done = sum(
        1 for i in range(possible)
        if status_by_date.get(lo + timedelta(days=i)) == "completed"
    )
    return done, possible


def build_daily_series(status_by_date, start, eff_today, window_days):
    first = max(start, eff_today - timedelta(days=window_days - 1))
    out = []
    d = first
    while d <= eff_today:
        status = status_by_date.get(d, "none")
        out.append({"date": d.isoformat(), "status": status, "done": 1 if status == "completed" else 0})
        d += timedelta(days=1)
    return out


def build_rolling_7(status_by_date, start, eff_today, window_days):
    first = max(start, eff_today - timedelta(days=window_days - 1))
    out = []
    d = first
    while d <= eff_today:
        done, possible = _count_window(status_by_date, start, d - timedelta(days=6), d)
        out.append({"date": d.isoformat(), "pct": _pct(done, possible)})
        d += timedelta(days=1)
    return out


def build_weekly(status_by_date, start, eff_today, max_blocks=8):
    blocks = []
    for i in range(max_blocks):
        hi = eff_today - timedelta(days=7 * i)
        lo = hi - timedelta(days=6)
        if hi < start:
            break
        done, possible = _count_window(status_by_date, start, lo, hi)
        blocks.append({
            "start": max(lo, start).isoformat(),
            "end": hi.isoformat(),
            "completed": done,
            "possible": possible,
            "pct": _pct(done, possible),
        })
    blocks.reverse()
    return blocks


def weekday_breakdown(status_by_date, start, eff_today):
    totals = [[0, 0] for _ in range(7)]  # [done, possible]
    d = start
    while d <= eff_today:
        totals[d.weekday()][1] += 1
        if status_by_date.get(d) == "completed":
            totals[d.weekday()][0] += 1
        d += timedelta(days=1)
    return [
        {"weekday": WEEKDAYS[i], "completed": t[0], "possible": t[1], "pct": _pct(t[0], t[1])}
        for i, t in enumerate(totals)
    ]


def exercise_stats(exercise, points, eff_today):
    """points: list of (date, value) sorted ascending."""
    out = {
        "key": exercise["key"],
        "label": exercise["label"],
        "metric": exercise["metric"],
        "unit": exercise["unit"],
        "points": [{"date": d.isoformat(), "value": v} for d, v in points],
        "logged_days": len(points),
        "latest": None, "best": None, "best_date": None, "first": None,
        "change_pct": None, "trend": "insufficient", "plateau": False, "new_pr": False,
    }
    if not points:
        return out

    out["latest"] = points[-1][1]
    out["first"] = points[0][1]
    best_date, best = max(points, key=lambda p: (p[1], p[0]))
    out["best"], out["best_date"] = best, best_date.isoformat()
    if out["first"] > 0:
        out["change_pct"] = round((out["latest"] - out["first"]) / out["first"] * 100)

    recent_lo = eff_today - timedelta(days=6)
    prior_lo, prior_hi = eff_today - timedelta(days=13), eff_today - timedelta(days=7)
    recent = [v for d, v in points if recent_lo <= d <= eff_today]
    prior = [v for d, v in points if prior_lo <= d <= prior_hi]

    if recent and prior:
        r_avg, p_avg = sum(recent) / len(recent), sum(prior) / len(prior)
        if p_avg > 0:
            change = (r_avg - p_avg) / p_avg
            out["trend"] = "up" if change >= 0.02 else "down" if change <= -0.05 else "flat"

    before_recent = [v for d, v in points if d < recent_lo]
    if recent and before_recent and max(recent) > max(before_recent):
        out["new_pr"] = True

    last14 = [v for d, v in points if d >= eff_today - timedelta(days=13)]
    earlier = [v for d, v in points if d < eff_today - timedelta(days=13)]
    if len(last14) >= 4 and len(earlier) >= 3 and max(last14) <= max(earlier) and out["trend"] == "flat":
        out["plateau"] = True
    return out


def build_diagnosis(summary, weekdays, exercises, days_since_completed):
    """Ordered coach notes. Each: {level: good|warn|info, code, text}."""
    notes = []

    def add(level, code, text):
        notes.append({"level": level, "code": code, "text": text})

    elapsed = summary["days_elapsed"]
    if elapsed < 3:
        add("info", "too_early", "Too early to diagnose anything — log the first few days and I'll start spotting patterns.")
        return notes

    last7, prev7 = summary["last7_pct"], summary["prev7_pct"]

    if days_since_completed is not None and days_since_completed >= 3 and not summary["is_finished"]:
        add("warn", "gap", f"{days_since_completed} days since your last completed day. Don't aim for perfect — do the smallest version of today's goal and get back on the board.")

    if elapsed >= 7:
        if last7 >= 85:
            add("good", "locked_in", f"You completed {last7}% of the last 7 days. This is what consistency looks like — protect it.")
        elif last7 < 40:
            add("warn", "low_adherence", f"Only {last7}% of the last 7 days completed. Consider shrinking the daily goal for a week — a small win every day beats a big plan you skip.")

    if elapsed >= 10 and prev7 is not None:
        diff = last7 - prev7
        if diff >= 15:
            add("good", "adherence_up", f"Consistency is up {diff} points versus the week before. Momentum is building.")
        elif diff <= -15:
            add("warn", "adherence_down", f"Consistency dropped {abs(diff)} points versus the week before. What changed? Name it, then adjust the plan around it.")

    done_total = summary["completed_total"]
    if done_total >= 6:
        rated = [w for w in weekdays if w["possible"] >= 2]
        if rated:
            best = max(rated, key=lambda w: (w["pct"], w["completed"]))
            worst = min(rated, key=lambda w: (w["pct"], -w["completed"]))
            if best["weekday"] != worst["weekday"] and best["pct"] - worst["pct"] >= 30:
                add("info", "weekday_pattern", f"{best['weekday']} is your strongest day ({best['pct']}%), {worst['weekday']} your weakest ({worst['pct']}%). Put your hardest session on {best['weekday']} and keep {worst['weekday']} light.")

    for ex in exercises:
        label, unit = ex["label"], ex["unit"]
        if ex["new_pr"]:
            add("good", f"pr:{ex['key']}", f"New personal best on {label}: {_fmt(ex['best'])} {unit}.")
        elif ex["plateau"]:
            add("info", f"plateau:{ex['key']}", f"{label} has been flat for two weeks (best {_fmt(ex['best'])} {unit}). Try changing the rep range, tempo or rest to break through.")
        elif ex["trend"] == "down":
            add("warn", f"decline:{ex['key']}", f"{label} is trending down versus last week. Check sleep, recovery and volume before pushing harder.")
        elif ex["trend"] == "up":
            add("good", f"trend_up:{ex['key']}", f"{label} is trending up week over week. Keep the progression going.")

    order = {"warn": 0, "good": 1, "info": 2}
    notes.sort(key=lambda n: order[n["level"]])
    return notes[:8]


def build_analytics(*, start, today, length_days, status_by_date, exercises,
                    points_by_exercise, window_days=30, current_streak=0, longest_streak=0):
    eff_today = _effective_today(start, today, length_days)
    days_elapsed = max(1, (eff_today - start).days + 1)

    completed_total = sum(
        1 for d, s in status_by_date.items() if s == "completed" and start <= d <= eff_today
    )
    l_done, l_poss = _count_window(status_by_date, start, eff_today - timedelta(days=6), eff_today)
    p_done, p_poss = _count_window(status_by_date, start, eff_today - timedelta(days=13), eff_today - timedelta(days=7))

    completed_dates = [d for d, s in status_by_date.items() if s == "completed" and d <= eff_today]
    days_since_completed = (today - max(completed_dates)).days if completed_dates else (today - start).days + 1

    summary = {
        "days_elapsed": days_elapsed,
        "total_days": length_days,
        "completed_total": completed_total,
        "adherence_pct": _pct(completed_total, days_elapsed),
        "last7_pct": _pct(l_done, l_poss),
        "prev7_pct": _pct(p_done, p_poss) if p_poss >= 3 else None,
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "days_since_completed": days_since_completed,
        "is_finished": today > start + timedelta(days=length_days - 1),
    }

    weekdays = weekday_breakdown(status_by_date, start, eff_today)
    ex_out = [
        exercise_stats(ex, sorted(points_by_exercise.get(ex["key"], []), key=lambda p: p[0]), eff_today)
        for ex in exercises
    ]

    return {
        "window_days": window_days,
        "summary": summary,
        "daily": build_daily_series(status_by_date, start, eff_today, window_days),
        "rolling_7": build_rolling_7(status_by_date, start, eff_today, window_days),
        "weekly": build_weekly(status_by_date, start, eff_today),
        "weekdays": weekdays,
        "exercises": ex_out,
        "diagnosis": build_diagnosis(summary, weekdays, ex_out, days_since_completed),
    }