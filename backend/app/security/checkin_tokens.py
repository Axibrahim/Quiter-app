"""
Signed, expiring tokens for the "Yes, I'm on track" button in reminder emails.

The token carries (user_plan_id, local_date) and is signed with SECRET_KEY, so
nothing is stored in the database and nobody can forge a token for another
plan or another day. It is only an authorization to mark THAT plan complete
for THAT day — it can't read data, log in, or do anything else.

Tokens expire after CHECKIN_TOKEN_MAX_AGE_SECONDS so an old email can't be
used to back-fill days weeks later.
"""
from datetime import date

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

CHECKIN_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 36   # 36h: covers late-night taps across timezones
_SALT = "quiter-email-checkin-v1"


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_SALT)


def make_checkin_token(user_plan_id: str, local_date: date) -> str:
    return _serializer().dumps({"p": str(user_plan_id), "d": local_date.isoformat()})


def read_checkin_token(token: str):
    """Return (user_plan_id, date) or None when invalid/expired/tampered."""
    if not token or not isinstance(token, str) or len(token) > 512:
        return None
    try:
        data = _serializer().loads(token, max_age=CHECKIN_TOKEN_MAX_AGE_SECONDS)
        return str(data["p"]), date.fromisoformat(data["d"])
    except (BadSignature, SignatureExpired, KeyError, ValueError, TypeError):
        return None