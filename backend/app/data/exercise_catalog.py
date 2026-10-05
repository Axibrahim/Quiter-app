"""
Quiter — Exercise catalog

sport -> (label, [(exercise label, metric), ...])

Metric decides what the user types in each day and how the graph is labelled.
HIGHER IS ALWAYS BETTER for every metric (so trend/PR logic stays simple):
    reps          -> total reps done
    weight_kg     -> heaviest weight lifted
    duration_min  -> minutes spent / held
    distance_km   -> kilometres covered
    rounds        -> rounds / sets completed
    count         -> generic count (shots made, goals, tackles, ...)
"""
import re

METRICS = {
    "reps": "reps",
    "weight_kg": "kg",
    "duration_min": "min",
    "distance_km": "km",
    "rounds": "rounds",
    "count": "count",
}

MAX_TRACKED_EXERCISES = 8

_RAW = {
    "weightlifting": ("Weightlifting / Gym", [
        ("Back squat", "weight_kg"), ("Front squat", "weight_kg"), ("Bench press", "weight_kg"),
        ("Incline bench press", "weight_kg"), ("Deadlift", "weight_kg"), ("Romanian deadlift", "weight_kg"),
        ("Overhead press", "weight_kg"), ("Barbell row", "weight_kg"), ("Dumbbell row", "weight_kg"),
        ("Lat pulldown", "weight_kg"), ("Seated cable row", "weight_kg"), ("Leg press", "weight_kg"),
        ("Hip thrust", "weight_kg"), ("Bulgarian split squat", "weight_kg"), ("Lunges", "reps"),
        ("Bicep curl", "weight_kg"), ("Tricep pushdown", "weight_kg"), ("Lateral raise", "weight_kg"),
        ("Face pull", "weight_kg"), ("Leg curl", "weight_kg"), ("Leg extension", "weight_kg"),
        ("Calf raise", "reps"), ("Dips", "reps"), ("Pull-ups", "reps"), ("Cable crunch", "reps"),
        ("Farmer's carry", "duration_min"), ("Snatch", "weight_kg"), ("Clean and jerk", "weight_kg"),
    ]),
    "calisthenics": ("Calisthenics", [
        ("Push-ups", "reps"), ("Diamond push-ups", "reps"), ("Pike push-ups", "reps"),
        ("Handstand push-ups", "reps"), ("Pull-ups", "reps"), ("Chin-ups", "reps"),
        ("Muscle-ups", "reps"), ("Dips", "reps"), ("Bodyweight squats", "reps"),
        ("Pistol squats", "reps"), ("Lunges", "reps"), ("Burpees", "reps"), ("Sit-ups", "reps"),
        ("Leg raises", "reps"), ("Hanging knee raises", "reps"), ("Plank hold", "duration_min"),
        ("Side plank hold", "duration_min"), ("L-sit hold", "duration_min"),
        ("Handstand hold", "duration_min"), ("Front lever hold", "duration_min"),
        ("Dead hang", "duration_min"), ("Australian rows", "reps"), ("Box jumps", "reps"),
        ("Mountain climbers", "reps"), ("Glute bridges", "reps"),
    ]),
    "running": ("Running / Athletics", [
        ("Easy run", "distance_km"), ("Long run", "distance_km"), ("Tempo run", "distance_km"),
        ("Interval sprints", "rounds"), ("Hill repeats", "rounds"), ("Fartlek", "duration_min"),
        ("Recovery jog", "distance_km"), ("Track 400m repeats", "rounds"), ("Strides", "rounds"),
        ("Treadmill run", "distance_km"), ("Trail run", "distance_km"), ("Sprint drills", "rounds"),
        ("Jump rope", "duration_min"), ("Plyometric jumps", "reps"), ("Single-leg hops", "reps"),
        ("Calf raises", "reps"), ("Core circuit", "duration_min"), ("Mobility routine", "duration_min"),
        ("Stair climbs", "rounds"), ("Walking", "distance_km"),
    ]),
    "swimming": ("Swimming", [
        ("Freestyle", "distance_km"), ("Breaststroke", "distance_km"), ("Backstroke", "distance_km"),
        ("Butterfly", "distance_km"), ("Individual medley", "distance_km"), ("Kick set with board", "distance_km"),
        ("Pull buoy set", "distance_km"), ("Sprint 25m repeats", "rounds"), ("Sprint 50m repeats", "rounds"),
        ("Endurance swim", "duration_min"), ("Open water swim", "distance_km"), ("Treading water", "duration_min"),
        ("Underwater breath hold", "duration_min"), ("Flip turns practice", "reps"), ("Catch-up drill", "rounds"),
        ("Fingertip drag drill", "rounds"), ("Dryland pull-ups", "reps"), ("Dryland core circuit", "duration_min"),
        ("Shoulder band work", "reps"), ("Aqua jogging", "duration_min"),
    ]),
    "cycling": ("Cycling", [
        ("Endurance ride", "distance_km"), ("Tempo ride", "distance_km"), ("Interval ride", "rounds"),
        ("Hill climb", "rounds"), ("Sprint efforts", "rounds"), ("Recovery spin", "duration_min"),
        ("Long ride", "distance_km"), ("Indoor trainer session", "duration_min"), ("Cadence drills", "rounds"),
        ("Mountain bike trail", "distance_km"), ("Commute ride", "distance_km"), ("Time trial effort", "duration_min"),
        ("Single-leg pedal drill", "duration_min"), ("Squats (off-bike)", "weight_kg"), ("Core stability", "duration_min"),
        ("Hip mobility", "duration_min"),
    ]),
    "boxing": ("Boxing", [
        ("Shadow boxing", "rounds"), ("Heavy bag", "rounds"), ("Speed bag", "rounds"),
        ("Double-end bag", "rounds"), ("Focus mitts", "rounds"), ("Sparring", "rounds"),
        ("Jab-cross combos", "reps"), ("Hooks and uppercuts", "reps"), ("Slip and roll drills", "rounds"),
        ("Footwork ladder", "rounds"), ("Jump rope", "duration_min"), ("Road work run", "distance_km"),
        ("Push-ups", "reps"), ("Burpees", "reps"), ("Medicine ball slams", "reps"),
        ("Neck strengthening", "reps"), ("Core circuit", "duration_min"), ("Sit-ups", "reps"),
        ("Pull-ups", "reps"), ("Defense drills", "rounds"),
    ]),
    "martial_arts": ("Martial Arts (MMA / BJJ / Judo / Karate)", [
        ("Technique drilling", "duration_min"), ("Live sparring", "rounds"), ("Grappling rolls", "rounds"),
        ("Takedown entries", "reps"), ("Guard passing drills", "rounds"), ("Submission drilling", "reps"),
        ("Kicks (roundhouse)", "reps"), ("Kicks (front / side)", "reps"), ("Punch combinations", "reps"),
        ("Kata / forms", "rounds"), ("Pad work", "rounds"), ("Clinch work", "rounds"),
        ("Shrimping / hip escapes", "reps"), ("Bridging", "reps"), ("Stretching routine", "duration_min"),
        ("Grip strength training", "duration_min"), ("Rope climbs", "reps"), ("Sprawls", "reps"),
        ("Conditioning circuit", "rounds"), ("Wall sit", "duration_min"),
    ]),
    "football": ("Football / Soccer", [
        ("Passing drills", "count"), ("Shooting drills (on target)", "count"), ("Free kicks (scored)", "count"),
        ("Penalty practice (scored)", "count"), ("Dribbling cones", "rounds"), ("Juggling", "count"),
        ("First touch wall passes", "count"), ("Crossing practice", "count"), ("Heading practice", "count"),
        ("Small-sided game", "duration_min"), ("Full match", "duration_min"), ("Sprint repeats", "rounds"),
        ("Shuttle runs", "rounds"), ("Agility ladder", "rounds"), ("Long-distance run", "distance_km"),
        ("Squats", "weight_kg"), ("Nordic hamstring curls", "reps"), ("Single-leg balance", "duration_min"),
        ("Core circuit", "duration_min"), ("Goalkeeper dives", "reps"),
    ]),
    "basketball": ("Basketball", [
        ("Free throws (made)", "count"), ("Three-pointers (made)", "count"), ("Mid-range shots (made)", "count"),
        ("Layups (made)", "count"), ("Dribbling drills", "rounds"), ("Crossover drills", "reps"),
        ("Passing drills", "count"), ("Defensive slides", "rounds"), ("Rebounding drills", "count"),
        ("Pickup game", "duration_min"), ("Full-court sprints", "rounds"), ("Vertical jumps", "reps"),
        ("Box jumps", "reps"), ("Squats", "weight_kg"), ("Jump rope", "duration_min"),
        ("Ball-handling circuit", "duration_min"), ("Core circuit", "duration_min"), ("Ankle stability work", "reps"),
    ]),
    "tennis": ("Tennis / Padel / Badminton", [
        ("Forehand drills", "count"), ("Backhand drills", "count"), ("Serve practice (in)", "count"),
        ("Volley drills", "count"), ("Overhead smashes", "count"), ("Rally practice", "duration_min"),
        ("Match play", "duration_min"), ("Footwork ladder", "rounds"), ("Split-step drills", "reps"),
        ("Court sprints", "rounds"), ("Wall practice", "duration_min"), ("Return of serve drills", "count"),
        ("Rotational medicine ball throws", "reps"), ("Shoulder band work", "reps"), ("Lunges", "reps"),
        ("Core circuit", "duration_min"),
    ]),
    "climbing": ("Climbing / Bouldering", [
        ("Boulder problems sent", "count"), ("Route climbs sent", "count"), ("Warm-up climbs", "count"),
        ("Hangboard hangs", "duration_min"), ("Campus board", "reps"), ("Pull-ups", "reps"),
        ("Weighted pull-ups", "weight_kg"), ("Lock-offs", "duration_min"), ("Toes-to-bar", "reps"),
        ("Core circuit", "duration_min"), ("Antagonist push-ups", "reps"), ("Finger strength block", "duration_min"),
        ("Footwork drills", "rounds"), ("Traverse laps", "rounds"), ("Flexibility / hip mobility", "duration_min"),
        ("4x4 boulder circuit", "rounds"),
    ]),
    "yoga": ("Yoga / Pilates / Mobility", [
        ("Sun salutations", "rounds"), ("Vinyasa flow", "duration_min"), ("Hatha practice", "duration_min"),
        ("Yin yoga", "duration_min"), ("Pilates mat session", "duration_min"), ("Hundred (Pilates)", "rounds"),
        ("Plank variations", "duration_min"), ("Boat pose hold", "duration_min"), ("Warrior holds", "duration_min"),
        ("Downward dog hold", "duration_min"), ("Pigeon pose hold", "duration_min"), ("Hamstring stretch", "duration_min"),
        ("Hip opener sequence", "duration_min"), ("Spine mobility flow", "duration_min"), ("Shoulder mobility", "duration_min"),
        ("Balance poses", "duration_min"), ("Breathwork", "duration_min"), ("Meditation", "duration_min"),
    ]),
    "crossfit": ("CrossFit / HIIT", [
        ("WOD (rounds completed)", "rounds"), ("AMRAP", "rounds"), ("EMOM", "rounds"),
        ("Burpees", "reps"), ("Thrusters", "weight_kg"), ("Wall balls", "reps"),
        ("Kettlebell swings", "reps"), ("Box jumps", "reps"), ("Double-unders", "reps"),
        ("Rope climbs", "reps"), ("Toes-to-bar", "reps"), ("Muscle-ups", "reps"),
        ("Power clean", "weight_kg"), ("Snatch", "weight_kg"), ("Deadlift", "weight_kg"),
        ("Back squat", "weight_kg"), ("Overhead press", "weight_kg"), ("Rowing machine", "distance_km"),
        ("Assault bike", "duration_min"), ("Handstand push-ups", "reps"), ("Sled push", "rounds"),
    ]),
    "rowing": ("Rowing / Kayak", [
        ("Steady-state row", "distance_km"), ("Interval rows", "rounds"), ("2k erg effort", "duration_min"),
        ("Technique drills", "duration_min"), ("On-water session", "distance_km"), ("Power strokes", "reps"),
        ("Deadlift", "weight_kg"), ("Back squat", "weight_kg"), ("Pull-ups", "reps"),
        ("Bent-over row", "weight_kg"), ("Core circuit", "duration_min"), ("Hip mobility", "duration_min"),
        ("Kayak paddle session", "distance_km"), ("Rotational core work", "reps"),
    ]),
    "volleyball": ("Volleyball / Handball", [
        ("Serves (in)", "count"), ("Spikes / shots (on target)", "count"), ("Passing drills", "count"),
        ("Setting drills", "count"), ("Blocking drills", "reps"), ("Dig drills", "count"),
        ("Match play", "duration_min"), ("Vertical jumps", "reps"), ("Approach jumps", "reps"),
        ("Shoulder band work", "reps"), ("Squats", "weight_kg"), ("Lateral shuffles", "rounds"),
        ("Core circuit", "duration_min"), ("Ankle stability work", "reps"),
    ]),
    "general": ("General Fitness", [
        ("Walking", "distance_km"), ("Jogging", "distance_km"), ("Push-ups", "reps"),
        ("Squats", "reps"), ("Plank hold", "duration_min"), ("Sit-ups", "reps"),
        ("Lunges", "reps"), ("Jumping jacks", "reps"), ("Burpees", "reps"),
        ("Stretching", "duration_min"), ("Stair climbing", "rounds"), ("Dumbbell workout", "duration_min"),
        ("Cycling", "distance_km"), ("Swimming laps", "rounds"), ("Dance workout", "duration_min"),
        ("Bodyweight circuit", "rounds"), ("Foam rolling", "duration_min"), ("Yoga flow", "duration_min"),
    ]),
}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48]


def _build():
    catalog = {}
    for sport_key, (label, items) in _RAW.items():
        seen = set()
        exercises = []
        for ex_label, metric in items:
            key = _slug(ex_label)
            if key in seen:
                continue
            seen.add(key)
            exercises.append({
                "key": key,
                "label": ex_label,
                "metric": metric,
                "unit": METRICS[metric],
            })
        catalog[sport_key] = {"label": label, "exercises": exercises}
    return catalog


CATALOG = _build()


def sport_exists(sport_key) -> bool:
    return isinstance(sport_key, str) and sport_key in CATALOG


def find_exercise(sport_key, exercise_key):
    """Return the catalog entry for exercise_key within sport_key, or None."""
    sport = CATALOG.get(sport_key)
    if not sport:
        return None
    for ex in sport["exercises"]:
        if ex["key"] == exercise_key:
            return ex
    return None


def custom_exercise_key(label: str) -> str:
    return f"custom-{_slug(label)}"[:60]