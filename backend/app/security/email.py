"""
Email delivery via Resend templates.

Verification, password reset, and daily reminder function signatures are
kept compatible with their current callers. Helpers are also provided for the
other published Quiter templates so account and plan routes can call them.

SECURITY:
- Verification and reset URLs contain single-use tokens.
- Resend API calls remain server-side.
- Template variables use triple braces in Resend, so user-provided text is
  HTML-escaped before it is sent.
- API keys, recipients, tokens, and email bodies are not written to logs.

Failure behavior: email failures return False and do not raise, so an email
outage does not block registration, login, plan creation, or a worker loop.
"""
import hashlib
import logging
import os
from datetime import timedelta
from html import escape

import requests
import resend


logger = logging.getLogger("quiter.email")

VERIFICATION_TOKEN_TTL = timedelta(hours=48)
PASSWORD_RESET_TOKEN_TTL = timedelta(minutes=30)

_FROM_ADDRESS = os.environ.get(
    "RESEND_FROM_ADDRESS",
    "Quiter <onboarding@resend.dev>",
)
_APP_BASE_URL = os.environ.get(
    "APP_BASE_URL",
    "http://localhost:5500",
).rstrip("/")

_RESEND_EMAILS_URL = "https://api.resend.com/emails"
_RESEND_TIMEOUT = (3.05, 12)


# These aliases were read from the connected Resend account.
_TEMPLATE_ALIASES = {
    "verify": "quiter-verify-email",
    "welcome": "quiter-welcome",
    "password_reset": "quiter-password-reset",
    "password_changed": "quiter-password-changed",
    "email_changed": "quiter-email-changed",
    "daily_reminder": "quiter-daily-reminder",
    "plan_started": "quiter-plan-started",
    "plan_completed": "quiter-plan-completed",
    "plan_closed": "quiter-plan-closed",
    "streak_milestone": "quiter-streak-milestone",
    "comeback": "quiter-comeback",
}


def _template_text(value) -> str:
    """Escape text inserted into Resend's triple-brace HTML variables."""
    return escape(str(value or ""), quote=True)


def _send_template(
    to_email: str,
    template_key: str,
    variables: dict,
    idempotency_key: str | None = None,
) -> bool:
    """Send a published Resend template by alias; never raises."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    template_alias = _TEMPLATE_ALIASES.get(template_key)

    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping template %s.", template_key)
        return False

    if not template_alias:
        logger.error("Unknown Resend template key: %s", template_key)
        return False

    if (
        os.environ.get("QUITER_ENV") == "production"
        and "@resend.dev" in _FROM_ADDRESS.lower()
    ):
        logger.error(
            "Production email sending requires RESEND_FROM_ADDRESS "
            "to use a verified sending domain."
        )
        return False

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = str(idempotency_key)[:256]

    payload = {
        "from": _FROM_ADDRESS,
        "to": [to_email],
        "template": {
            "id": template_alias,
            "variables": variables,
        },
    }

    try:
        response = requests.post(
            _RESEND_EMAILS_URL,
            headers=headers,
            json=payload,
            timeout=_RESEND_TIMEOUT,
        )
        response.raise_for_status()
        return True
    except requests.RequestException:
        # Do not log response bodies: provider errors can contain message data.
        logger.exception("Resend template send failed for %s.", template_alias)
        return False


def _send(to_email: str, subject: str, html: str, text: str | None = None) -> bool:
    """
    Keep the existing inline-email helper for compatibility with any other
    callers. The Quiter transactional functions below use Resend templates.
    """
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping inline email.")
        return False

    resend.api_key = api_key
    payload = {
        "from": _FROM_ADDRESS,
        "to": [to_email],
        "subject": " ".join(subject.split())[:200],
        "html": html,
    }
    if text:
        payload["text"] = text

    try:
        resend.Emails.send(payload)
        return True
    except Exception:
        logger.exception("Resend inline email send failed.")
        return False


# ---------------------------------------------------------------------------
# Existing account email functions
# ---------------------------------------------------------------------------

def send_verification_email(
    email: str,
    display_name: str,
    token: str,
) -> bool:
    verify_url = f"{_APP_BASE_URL}/verify.html?token={token}"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    return _send_template(
        email,
        "verify",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "VERIFY_URL": escape(verify_url, quote=True),
        },
        idempotency_key=f"verify:{token_hash}",
    )


def send_password_reset_email(
    email: str,
    display_name: str,
    token: str,
) -> bool:
    reset_url = f"{_APP_BASE_URL}/reset-password.html?token={token}"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    return _send_template(
        email,
        "password_reset",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "RESET_URL": escape(reset_url, quote=True),
        },
        idempotency_key=f"password-reset:{token_hash}",
    )


def send_welcome_email(email: str, display_name: str) -> bool:
    return _send_template(
        email,
        "welcome",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "PLANS_URL": escape(f"{_APP_BASE_URL}/plans.html", quote=True),
        },
    )


def send_password_changed_email(email: str, display_name: str) -> bool:
    return _send_template(
        email,
        "password_changed",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "APP_URL": escape(f"{_APP_BASE_URL}/profile.html", quote=True),
        },
    )


def send_email_changed_email(
    old_email: str,
    display_name: str,
    new_email: str,
) -> bool:
    return _send_template(
        old_email,
        "email_changed",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "NEW_EMAIL": _template_text(new_email),
        },
    )


# ---------------------------------------------------------------------------
# Existing daily coach reminder function
# ---------------------------------------------------------------------------

def send_goal_reminder_email(
    email: str,
    display_name: str,
    goal_text: str,
    day_number: int,
    total_days: int,
    support_style: str = "gentle",
    checkin_url: str | None = None,
    coach_message: str | None = None,
    streak: int = 0,
    video_due: bool = False,
    idempotency_key: str | None = None,
) -> bool:
    """
    Send the existing daily reminder template. The signed check-in URL remains
    generated by the reminder worker, not by the frontend.
    """
    dashboard_url = f"{_APP_BASE_URL}/dashboard.html"

    if checkin_url:
        safe_checkin_url = escape(checkin_url, quote=True)
    else:
        safe_checkin_url = escape(dashboard_url, quote=True)

    video_block_html = ""
    if video_due:
        safe_dashboard_url = escape(dashboard_url, quote=True)
        video_block_html = (
            '<p style="margin:22px 0 0;padding:14px 16px;border-radius:14px;'
            'background:#1a1a26;color:#b9b9cc;font-size:14px;">'
            "It's a video check-in day — optional, takes 10 seconds. "
            f'<a href="{safe_dashboard_url}" style="color:#ffffff;">'
            "Open your dashboard</a>.</p>"
        )

    progress_note = (
        f"{int(streak)}-day streak"
        if int(streak) > 0
        else "Your streak starts today"
    )

    return _send_template(
        email,
        "daily_reminder",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "GOAL_TEXT": _template_text(goal_text),
            "DAY_NUMBER": int(day_number),
            "TOTAL_DAYS": int(total_days),
            "STREAK_NOTE": _template_text(progress_note),
            "COACH_MESSAGE": _template_text(
                coach_message
                or "One small step today is all it takes. You've got this."
            ),
            "CHECKIN_URL": safe_checkin_url,
            "DASHBOARD_URL": escape(dashboard_url, quote=True),
            # This value is fixed markup assembled here. Its URL is escaped.
            "VIDEO_BLOCK_HTML": video_block_html,
        },
        idempotency_key=idempotency_key,
    )


# ---------------------------------------------------------------------------
# Plan lifecycle template functions
# ---------------------------------------------------------------------------

def send_plan_started_email(
    email: str,
    display_name: str,
    goal_text: str,
    total_days: int,
    reminder_times_text: str,
    idempotency_key: str,
) -> bool:
    return _send_template(
        email,
        "plan_started",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "GOAL_TEXT": _template_text(goal_text),
            "TOTAL_DAYS": int(total_days),
            "REMINDER_TIMES_TEXT": _template_text(reminder_times_text),
            "DASHBOARD_URL": escape(
                f"{_APP_BASE_URL}/dashboard.html",
                quote=True,
            ),
        },
        idempotency_key=idempotency_key,
    )


def send_plan_completed_email(
    email: str,
    display_name: str,
    goal_text: str,
    total_days: int,
    days_logged: int,
    longest_streak: int,
    idempotency_key: str,
) -> bool:
    return _send_template(
        email,
        "plan_completed",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "GOAL_TEXT": _template_text(goal_text),
            "TOTAL_DAYS": int(total_days),
            "DAYS_LOGGED": int(days_logged),
            "LONGEST_STREAK": int(longest_streak),
            "PLANS_URL": escape(f"{_APP_BASE_URL}/plans.html", quote=True),
        },
        idempotency_key=idempotency_key,
    )


def send_plan_closed_email(
    email: str,
    display_name: str,
    goal_text: str,
    idempotency_key: str,
) -> bool:
    return _send_template(
        email,
        "plan_closed",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "GOAL_TEXT": _template_text(goal_text),
            "PLANS_URL": escape(f"{_APP_BASE_URL}/plans.html", quote=True),
        },
        idempotency_key=idempotency_key,
    )


def send_streak_milestone_email(
    email: str,
    display_name: str,
    goal_text: str,
    streak: int,
    idempotency_key: str,
) -> bool:
    milestones = {
        7: (
            "A full week",
            "Seven straight days. This is real momentum, keep it rolling.",
        ),
        14: (
            "Two weeks strong",
            "Fourteen straight days of showing up. Keep building at your pace.",
        ),
        30: (
            "Thirty days",
            "A month of steady effort. Take a moment to recognize what you built.",
        ),
        60: (
            "Sixty days",
            "Your consistency has carried you a long way. Keep going one day at a time.",
        ),
        100: (
            "One hundred days",
            "One hundred days of follow-through. That progress belongs to you.",
        ),
    }

    milestone = milestones.get(int(streak))
    if milestone is None:
        logger.warning("No Resend streak template copy configured for milestone %s.", streak)
        return False

    title, body = milestone
    return _send_template(
        email,
        "streak_milestone",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "GOAL_TEXT": _template_text(goal_text),
            "STREAK": int(streak),
            "MILESTONE_TITLE": _template_text(title),
            "MILESTONE_BODY": _template_text(body),
            "DASHBOARD_URL": escape(
                f"{_APP_BASE_URL}/dashboard.html",
                quote=True,
            ),
        },
        idempotency_key=idempotency_key,
    )


def send_comeback_email(
    email: str,
    display_name: str,
    goal_text: str,
    days_missed: int,
    days_left: int,
    idempotency_key: str,
) -> bool:
    return _send_template(
        email,
        "comeback",
        {
            "DISPLAY_NAME": _template_text(display_name),
            "GOAL_TEXT": _template_text(goal_text),
            "DAYS_MISSED": int(days_missed),
            "DAYS_LEFT": int(days_left),
            "DASHBOARD_URL": escape(
                f"{_APP_BASE_URL}/dashboard.html",
                quote=True,
            ),
        },
        idempotency_key=idempotency_key,
    )