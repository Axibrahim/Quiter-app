"""
Email delivery via Resend — verification, password reset, and the daily
coach reminder (with the one-tap "Yes, I'm on track" button).

SECURITY NOTE ON TOKENS: verification_token and reset_token are generated
with secrets.token_urlsafe (CSPRNG) and are single-use — every route that
consumes a token clears it immediately after success. Reset tokens also
expire quickly (PASSWORD_RESET_TOKEN_TTL). The daily check-in button uses a
separate signed token (see security/checkin_tokens.py).

Failure mode by design: if RESEND_API_KEY is missing or the Resend call
fails we log the error but do NOT raise — an email outage must never block
registration, login or the reminder worker's loop.

All user-provided text (display name, goal) is HTML-escaped before it goes
into a template.
"""
import os
import logging
from html import escape
from datetime import timedelta

import resend

logger = logging.getLogger("quiter.email")

VERIFICATION_TOKEN_TTL = timedelta(hours=48)
PASSWORD_RESET_TOKEN_TTL = timedelta(minutes=30)

_FROM_ADDRESS = os.environ.get("RESEND_FROM_ADDRESS", "Quiter <onboarding@resend.dev>")
_APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5500").rstrip("/")


def _send(to_email: str, subject: str, html: str, text: str | None = None) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set — skipping email send. Subject: %s", subject)
        return False

    resend.api_key = api_key
    payload = {
        "from": _FROM_ADDRESS,
        "to": [to_email],
        "subject": " ".join(subject.split())[:200],   # no newlines in headers
        "html": html,
    }
    if text:
        payload["text"] = text

    try:
        resend.Emails.send(payload)
        return True
    except Exception:
        logger.exception("Resend send failed for %s", to_email)
        return False


# ---------------------------------------------------------------------------
# Shared layout (inline CSS + tables: the only thing every mail client agrees on)
# ---------------------------------------------------------------------------

def _button(url: str, label: str) -> str:
    return (
        f'<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td '
        f'style="border-radius:999px;background:#ffffff;">'
        f'<a href="{escape(url, quote=True)}" style="display:inline-block;padding:15px 30px;'
        f'font:600 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#000000;'
        f'text-decoration:none;border-radius:999px;">{escape(label)}</a></td></tr></table>'
    )


def _shell(inner_html: str, footer: str) -> str:
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#07070b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07070b;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">
    <tr><td style="padding:0 0 18px 4px;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:.02em;">Quiter</td></tr>
    <tr><td style="background:#12121a;border:1px solid #26263a;border-radius:24px;padding:32px 28px;
        font:400 16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e9e9f2;">
      {inner_html}
    </td></tr>
    <tr><td style="padding:18px 6px 0 6px;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#7d7d92;">{footer}</td></tr>
  </table>
</td></tr></table></body></html>"""


# ---------------------------------------------------------------------------
# Account emails
# ---------------------------------------------------------------------------

def send_verification_email(email: str, display_name: str, token: str) -> None:
    link = f"{_APP_BASE_URL}/verify.html?token={token}"
    html = _shell(
        f"""<h2 style="margin:0 0 10px;font-size:22px;color:#ffffff;">Welcome to Quiter, {escape(display_name)}.</h2>
        <p style="margin:0 0 22px;color:#b9b9cc;">Confirm your email to activate your account.</p>
        {_button(link, "Verify my email")}""",
        "This link expires in 48 hours. If you didn't create a Quiter account, ignore this email.",
    )
    _send(email, "Verify your Quiter account", html,
          f"Welcome to Quiter, {display_name}. Verify your email: {link}")


def send_password_reset_email(email: str, display_name: str, token: str) -> None:
    link = f"{_APP_BASE_URL}/reset-password.html?token={token}"
    html = _shell(
        f"""<h2 style="margin:0 0 10px;font-size:22px;color:#ffffff;">Reset your password</h2>
        <p style="margin:0 0 22px;color:#b9b9cc;">Hi {escape(display_name)}, tap below to choose a new password.</p>
        {_button(link, "Reset password")}""",
        "This link expires in 30 minutes. If you didn't ask for this, ignore this email — your password won't change.",
    )
    _send(email, "Reset your Quiter password", html,
          f"Reset your Quiter password (valid 30 minutes): {link}")


# ---------------------------------------------------------------------------
# Daily coach reminder
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
) -> bool:
    """The daily coach email. `checkin_url` is the one-tap 'Yes, I'm on track'
    link (frontend checkin.html with a signed token)."""
    dashboard_url = f"{_APP_BASE_URL}/dashboard.html"
    progress_note = f"{streak}-day streak" if streak > 0 else "Your streak starts today"

    message_block = (
        f'<p style="margin:0 0 24px;font-size:17px;line-height:1.55;color:#ffffff;">{escape(coach_message)}</p>'
        if coach_message else ""
    )
    video_block = (
        '<p style="margin:22px 0 0;padding:14px 16px;border-radius:14px;background:#1a1a26;color:#b9b9cc;font-size:14px;">'
        f'It\'s a video check-in day — optional, takes 10 seconds. '
        f'<a href="{escape(dashboard_url, quote=True)}" style="color:#ffffff;">Open your dashboard</a>.</p>'
        if video_due else ""
    )
    main_button = _button(checkin_url, "Yes, I'm on track") if checkin_url else _button(dashboard_url, "Open my dashboard")

    html = _shell(
        f"""<p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8d7cff;">
              Day {int(day_number)} of {int(total_days)} · {escape(progress_note)}</p>
        <h2 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#ffffff;">{escape(display_name)}, how's {escape(goal_text)} going today?</h2>
        {message_block}
        {main_button}
        <p style="margin:16px 0 0;font-size:13px;color:#7d7d92;">One tap marks today as done. Didn't happen today? Just ignore this — no pressure.</p>
        {video_block}""",
        f'You get this because you turned on reminders for this plan. '
        f'<a href="{escape(dashboard_url, quote=True)}" style="color:#7d7d92;">Manage reminders</a>.',
    )

    text = (
        f"Day {day_number} of {total_days} — {goal_text}\n\n"
        f"{coach_message + chr(10) + chr(10) if coach_message else ''}"
        f"{'Mark today done: ' + checkin_url if checkin_url else 'Open your dashboard: ' + dashboard_url}"
    )
    return _send(email, f"Day {day_number} of {total_days}: {goal_text[:60]}", html, text)