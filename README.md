# Quiter — Your Personal Coach

Quiter keeps you tracked and motivated. Pick a plan, check in every day, and get
short coaching messages and a smart assistant (**Blue**) that reads your real
progress and tells you what to do next.

Two kinds of plans:

- **Athlete plan** – sport, phase, level and food style, with per-exercise
  logging, PR / plateau detection and rest (off) days.
- **Custom personal plan** – your own goal and identity statement, with a daily
  action you mark as done.

Built with a **Flask + PostgreSQL** backend and a **vanilla JS** frontend
(installable as a PWA), with a WebGL star layer and a scroll-driven glass-flower
background video.

---

## Features

| Area | What it does |
|---|---|
| **Plans** | Catalog templates (Smoke-Free, Sober, Athlete), custom plans, custom athletic plans, admin-created plans shown on `plans.html` |
| **Daily check-in** | Mark the day complete from the dashboard, or in one tap from the reminder email ("Yes, I'm on track") |
| **Coach messages** | One short message per plan per day, shown on the dashboard **and** in the email (same words, paid for once) |
| **Blue (AI assistant)** | Up to 3 practical tips per plan, grounded in streaks, adherence, slips and exercise trends; free rule engine as fallback |
| **Forecast** | Marked-days graph with a projection to the last day; athlete numbers projected per exercise, worded by Blue |
| **Athletes** | Exercise logging, analytics, off-day (rest day) rules |
| **Progress videos** | Optional 10-second video check-in (weekly / monthly / off), stored in Supabase |
| **Emails (Resend)** | Verify, welcome, reset / changed password, changed email, daily reminder, plan started / completed / closed, streak milestones, comeback |
| **Reminders** | Up to 3 times a day per plan, in the plan's own timezone, sent by a separate worker |
| **Auto-close** | Plans with no check-in for 15+ days are closed automatically |
| **Admin** | Create / edit / delete plan templates and upload plan photos (`admin.html`) |
| **UI** | Dark + light theme, glassmorphism, stacked-sheet homepage, PWA with offline page and iOS splash screens |

---

## Project structure

```
Quiter-app/
├── Procfile                     # web: gunicorn (workers run as separate services)
├── requirements.txt             # same as backend/requirements.txt (used by the host)
├── backend/
│   ├── run.py                   # entrypoint (dev server / gunicorn target run:app)
│   ├── reminder_worker.py       # daily coach emails (own process)
│   ├── plan_abandon_worker.py   # auto-closes inactive plans (own process)
│   ├── seed_templates.py        # one-time catalog seed
│   ├── .env.example
│   └── app/
│       ├── __init__.py          # app factory: config, CORS, CSRF/origin guard, static frontend
│       ├── data/
│       │   └── exercise_catalog.py   # sports, phases, levels, diet styles, exercises
│       ├── models/models.py     # SQLAlchemy schema
│       ├── routes/
│       │   ├── auth.py          # /api/v1/auth/*
│       │   ├── plans.py         # /api/v1/plans/*
│       │   └── admin.py         # /api/v1/admin/*
│       ├── security/
│       │   ├── passwords.py     # Argon2id + HMAC pepper
│       │   ├── session_auth.py  # HTTP-only cookie session
│       │   ├── headers.py       # Talisman: CSP (nonce), HSTS, Permissions-Policy
│       │   ├── limiter.py       # Flask-Limiter
│       │   ├── checkin_tokens.py# signed tokens for the email button
│       │   ├── admin_auth.py    # @admin_required
│       │   └── email.py         # all Resend emails
│       └── utils/
│           ├── ai_client.py     # the ONE place every AI call goes through
│           ├── coach_ai.py      # daily coach message
│           ├── blue_ai.py       # Blue's dashboard tips
│           ├── blue_forecast.py # Blue's wording of the forecast
│           ├── plan_ai.py       # short plan names + plan-aware tips
│           ├── forecast.py      # pure forecast maths
│           ├── analytics.py     # pure analytics + rule-based diagnosis
│           ├── off_day.py       # athlete rest-day rules
│           ├── supabase_storage.py  # photo / video uploads
│           ├── validation.py
│           └── http.py
├── frontend/                    # static, served by Flask (same origin as the API)
│   ├── index.html  plans.html  dashboard.html  progress.html
│   ├── custom-plan.html  custom-plan-athletics.html
│   ├── profile.html  checkin.html  verify.html  reset-password.html
│   ├── admin.html  offline.html
│   ├── sw.js  manifest.webmanifest  _headers
│   └── assets/
│       ├── css/   tokens.css  layout.css  home-stack.css  theme-light.css
│       ├── js/    dashboard.js  progress.js  plans.js  profile.js  admin.js
│       │          home-cards.js  home-plans.js  home-stack.js
│       │          site-gl.js (three.js stars)  bg-video.js (scroll video)
│       │          theme.js  theme-boot.js  pwa.js  config.js ...
│       │   └── modules/   api-client.js  auth-modal.js  auth-state.js  plan-form.js  shell.js
│       ├── media/ glass-flower videos (desktop / mobile, dark / light) + posters
│       └── pwa/   icons + iOS splash screens
└── tools/
    ├── pwa_build.py             # PWA head block + service-worker precache (run before every deploy)
    └── theme_codemod.py         # one-time light/dark theming codemod
```

---

## Data model

`users` · `plan_templates` · `plan_days` · `user_plans` · `daily_logs` ·
`exercise_logs` · `progress_videos` · `reminder_deliveries` · `coach_messages` ·
`plan_insights`

All primary keys are UUIDs. `reminder_deliveries` has a unique
(plan, local date, time) constraint so a reminder is never sent twice, even with
more than one worker. `coach_messages` and `plan_insights` cache AI results so a
page refresh never calls the model again.

---

## Run it locally

Requires Python 3.9+ and a PostgreSQL database (a Supabase project works).

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# fill in at least: FLASK_SECRET_KEY, PASSWORD_PEPPER, DATABASE_URL
```

Create the tables and seed the catalog (once):

```bash
python3 -c "from dotenv import load_dotenv; load_dotenv(); \
from app import create_app; from app.models.models import db; \
app = create_app('development'); app.app_context().push(); db.create_all()"

python3 -c "from dotenv import load_dotenv; load_dotenv(); from seed_templates import run; run()"
```

Start the server:

```bash
python3 run.py      # http://127.0.0.1:5000
```

Flask serves the frontend too, so just open `http://127.0.0.1:5000`. On
`localhost` / `127.0.0.1`, `assets/js/config.js` automatically points at the
local API.

To make yourself an admin, set `is_admin = true` on your row in `users`.

> `db.create_all()` only creates missing tables — it does not alter existing
> ones. If you add a column to a model, add it to your database by hand.

### Workers (optional locally, required in production)

```bash
cd backend
python3 reminder_worker.py        # sends the daily coach emails
python3 plan_abandon_worker.py    # closes plans with 15+ days without a check-in
```

---

## Environment variables

See `backend/.env.example` for the full list.

| Variable | Purpose |
|---|---|
| `QUITER_ENV` | `development` or `production` |
| `FLASK_SECRET_KEY` | Signs sessions and email check-in tokens (required) |
| `PASSWORD_PEPPER` | HMAC pepper for password hashing (required) |
| `DATABASE_URL` | PostgreSQL URL; the Supabase pooler (port 6543) is detected automatically |
| `REDIS_URL` | Shared rate-limit storage (`memory://` is fine for one worker only) |
| `CORS_ALLOWED_ORIGINS` | Exact frontend origins (never `*` in production) |
| `APP_BASE_URL` | Public URL used in email links (verify, reset, check-in) |
| `SESSION_REMEMBER_DAYS` | "Remember me" session length (default 30) |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | Email; the from-address must be on a domain verified in Resend |
| `REMINDER_POLL_SECONDS` | Reminder worker poll interval (default 60) |
| `AI_API_KEY`, `AI_PROVIDER`, `AI_MODEL` | AI provider (`gemini` default, `anthropic` and `openai` also work). Empty key = free templates only |
| `AI_MODE` | `milestones` (default), `daily`, or `off` |
| `AI_STEADY_EVERY` | In milestones mode, also use AI every N-th ordinary day (0 = never) |
| `AI_DAILY_CALL_LIMIT` | Hard cap of AI calls per UTC day for the whole app |
| `AI_TIMEOUT_SECONDS` | Per-call timeout |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage for plan photos and progress videos |
| `SUPABASE_PLAN_PHOTOS_BUCKET`, `SUPABASE_PROGRESS_VIDEOS_BUCKET` | Bucket names |

---

## AI: how it stays cheap and safe

All AI calls go through `utils/ai_client.py`.

- **Tiered.** Coach messages use AI only on days that matter (day 1, comeback,
  halfway, final stretch, streak milestones, and every `AI_STEADY_EVERY`-th day).
  Every other day uses a template bank at zero cost.
- **One call at most** per plan per day for Blue's tips and forecast text;
  results are stored and reused.
- **Tiny prompts**, small `max_tokens`, and user text treated as data.
- **Daily cap** (`AI_DAILY_CALL_LIMIT`), stored in the database so it is correct
  with several gunicorn workers.
- **Circuit breaker.** After 3 provider failures in a row, AI is skipped for 5
  minutes.
- **Ghost plans** (no check-in for 7+ days) never use AI.
- **Validated output.** JSON only, length-capped; tips with calorie / macro / dose
  numbers, supplements or diagnoses are dropped, and forecast text with a number
  that was not in the data is rejected.
- **Never raises.** Callers get `None` and use their free fallback.
- **Cost visibility.** Every call logs token usage; search your logs for
  `ai usage`.

---

## Email check-in

The reminder email contains a one-tap **"Yes, I'm on track"** button.

- The link carries a signed, expiring token (36 hours) that can mark **one plan
  for one day** complete, and nothing else.
- The link opens `checkin.html`, which **POSTs** the token to
  `/api/v1/plans/email-checkin`. It is deliberately not a GET, so mail scanners
  and link-preview bots can never mark a day complete.

---

## Deployment

The app is built for Railway-style hosting.

- **Web service:** `Procfile` runs
  `gunicorn --chdir backend run:app --bind 0.0.0.0:$PORT --workers 2`.
  Flask serves both the API and the static frontend on one origin, so the session
  cookie works without extra CORS setup.
- **Worker services:** run `reminder_worker.py` and `plan_abandon_worker.py` as
  two more services with the same environment variables
  (`cd backend && python reminder_worker.py`).
- **Before every deploy**, from the repo root:

  ```bash
  python tools/pwa_build.py            # apply
  python tools/pwa_build.py --check    # verify only (exit 1 if something is off, good for CI)
  ```

  This refreshes the PWA tags and regenerates the service-worker precache list and
  cache version, so users never get stuck on an old build.
- Set `REDIS_URL`, `APP_BASE_URL` and `CORS_ALLOWED_ORIGINS` in production. The
  app logs a warning if rate limiting is in-memory or `APP_BASE_URL` is not a
  public https URL.
- If you host the static files separately (Netlify / Cloudflare Pages),
  `frontend/_headers` carries the cache rules; set `PROD_API_BASE` in
  `assets/js/config.js` to the backend URL.
- Health check: `GET /api/v1/health`.

---

## Security

| Control | Where | Detail |
|---|---|---|
| Password storage | `security/passwords.py` | Argon2id plus an HMAC pepper kept out of the database |
| Sessions | `security/session_auth.py`, `security/headers.py` | HTTP-only, Secure, SameSite=Lax cookie, never exposed to JS. Without "Remember me" a session also expires server-side after 12 hours |
| CSRF / origin | `security/session_auth.py`, `app/__init__.py` | SameSite=Lax, a custom `X-Quiter-Client` header, and an `Origin` allowlist check on every state-changing `/api/` request |
| Brute force | `security/limiter.py`, `routes/auth.py` | 5 per minute per IP on `/auth/*`, plus a 5-strike, 15-minute per-account lockout; 60 per minute default on the rest of the API |
| Email verification and reset | `routes/auth.py` | Expiring tokens; confirmation emails when the password or email changes |
| XSS | `security/headers.py`, `app/__init__.py` | CSP with per-request nonces; `script-src` allows only `self` and one pinned three.js path, no `'unsafe-inline'` for scripts |
| Clickjacking / framing | `security/headers.py` | `frame-ancestors 'none'` |
| Browser features | `security/headers.py` | Permissions-Policy allows camera and microphone for the video check-in only |
| IDOR | `routes/plans.py` | Plan queries filter by id **and** owner |
| ID enumeration | `models/models.py` | UUID primary keys |
| Admin | `security/admin_auth.py` | `@login_required` plus `@admin_required` |
| Request limits | `app/__init__.py` | 1 MB JSON body limit; 25 MB only for photo / video uploads |
| Caching | `app/__init__.py` | Private API responses are `no-store`; only the public catalog endpoints are cached briefly |
| Error handling | `app/__init__.py` | Generic JSON errors, details only in server logs |
| Secrets | `security/supabase_storage.py` | The Supabase service-role key stays on the server and is never sent to the browser |

---

## API overview

All routes are under `/api/v1`.

**Auth** (`/auth`): `register`, `login`, `logout`, `me`, `profile`, `about`,
`verify/confirm`, `verify/resend`, `password/forgot`, `password/reset`

**Plans** (`/plans`): `templates`, `exercise-catalog`, `mine`, `adopt`, `custom`,
`custom-athletic`, `goal-placeholder`, `off-day-suggestion`, `email-checkin`, and
per plan `/<id>/today`, `checkin`, `exercise-log`, `progress`, `analytics`,
`forecast`, `coach-message`, `blue`, `off-day`, `videos` (GET / POST),
`video-frequency`, `abandon`

**Admin** (`/admin`): `templates` (GET / POST / PATCH / DELETE), `upload-photo`

---

## Design

Glassmorphism over a scroll-driven glass-flower video: every surface is
translucent and blurred, in dark and light themes. A site-wide three.js star
layer follows your finger or mouse and pulses on taps. The homepage sections stack
like sheets scrolling over the hero. Design tokens live in
`assets/css/tokens.css`; light mode overrides live in `assets/css/theme-light.css`.
