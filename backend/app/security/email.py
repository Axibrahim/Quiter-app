"""
Email delivery via Resend — verification links and password-reset links.

SECURITY NOTE ON TOKENS: both verification_token and reset_token are
generated with secrets.token_urlsafe (CSPRNG, not random.choice or uuid4
truncation) and are single-use — every route that consumes a token clears
it from the row immediately after success, so a leaked/guessed old token
can't be replayed. Reset tokens additionally expire after a short window
(see PASSWORD_RESET_TOKEN_TTL) to bound the damage from an intercepted
email.

Failure mode by design: if RESEND_API_KEY is missing or the Resend API
call fails, we log the error but do NOT raise — a transient email outage
should never block registration/login itself. The token is still stored
on the user row either way, so a "resend verification email" retry
endpoint (or the person just asking support) can still recover.
"""
import os
import logging
from datetime import timedelta

import resend

logger = logging.getLogger("quiter.email")

VERIFICATION_TOKEN_TTL = timedelta(hours=48)
PASSWORD_RESET_TOKEN_TTL = timedelta(minutes=30)

_FROM_ADDRESS = os.environ.get("RESEND_FROM_ADDRESS", "Quiter <onboarding@resend.dev>")
_APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:8080")


def _send(to_email: str, subject: str, html: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")

    if not api_key:
        logger.warning(
            "RESEND_API_KEY not set — skipping email send. Subject: %s",
            subject,
        )
        return False

    resend.api_key = api_key

    try:
        resend.Emails.send(
            {
                "from": _FROM_ADDRESS,
                "to": [to_email],
                "subject": subject,
                "html": html,
            }
        )
        return True
    except Exception:
        logger.exception("Resend send failed for %s", to_email)
        return False

def send_verification_email(email: str, display_name: str, token: str) -> None:
    link = f"{_APP_BASE_URL}/verify.html?token={token}"
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Welcome to Quiter, {display_name}.</h2>
      <p>Confirm your email to activate your account:</p>
      <p><a href="{link}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;
        border-radius:999px;text-decoration:none;">Verify my email</a></p>
      <p style="color:#888;font-size:13px;">This link expires in 48 hours. If you didn't create a
        Quiter account, you can safely ignore this email.</p>
    </div>
    """
    _send(email, "Verify your Quiter account", html)


def send_password_reset_email(email: str, display_name: str, token: str) -> None:
    link = f"{_APP_BASE_URL}/reset-password.html?token={token}"
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Reset your Quiter password</h2>
      <p>Hi {display_name}, click below to set a new password:</p>
      <p><a href="{link}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;
        border-radius:999px;text-decoration:none;">Reset password</a></p>
      <p style="color:#888;font-size:13px;">This link expires in 30 minutes. If you didn't request
        this, you can safely ignore this email — your password will not change.</p>
    </div>
    """
    _send(email, "Reset your Quiter password", html)

def send_reminder_email(email: str, display_name: str, goal_title: str, identity_statement: str, personal_note: str | None = None) -> None:
    note_html = f'<p style="color:#555;font-style:italic;">"{personal_note}"</p>' if personal_note else ""
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>{display_name}, today's the day.</h2>
      <p style="font-size:15px;">{identity_statement}</p>
      {note_html}
      <p><a href="{_APP_BASE_URL}/dashboard.html" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;
        border-radius:999px;text-decoration:none;">Check in on {goal_title}</a></p>
      <p style="color:#888;font-size:13px;">You're getting this because you turned on daily reminders for this plan.
        You can turn them off anytime from your dashboard.</p>
    </div>
    """
    _send(email, f"Reminder: {goal_title}", html)