"""
Authentication routes — /api/v1/auth/*
"""
import hashlib
import re
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, g, session
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from app.models.models import db, User
from app.security.passwords import hash_password, verify_password, needs_rehash
from app.security.limiter import limiter, AUTH_RATE_LIMIT
from app.security.session_auth import login_user, logout_user, login_required
from app.security.email import (
    send_verification_email,
    send_password_reset_email,
    send_welcome_email,
    send_email_changed_email,
    send_password_changed_email,
    VERIFICATION_TOKEN_TTL,
    PASSWORD_RESET_TOKEN_TTL,
)
from app.utils.http import json_body
from app.utils.validation import (
    validate_email_format, validate_password_strength, validate_display_name,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")

LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION = timedelta(minutes=15)
PROFILE_RATE_LIMIT = "5 per minute"
_SHA256_HEX = re.compile(r"^[0-9a-fA-F]{64}$")


def _hash_token(token: str) -> str:
    """Verification / reset tokens are stored as SHA-256 hashes. If the database ever leaks,
    the attacker gets hashes that cannot be used as links. The raw token only exists in the email."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _user_by_token(column_name: str, token):
    """Find a user by a raw token. Also matches rows saved in the old plaintext format, so links
    sent before this update keep working until they expire (<= 48h). Remove the fallback after that."""
    if not isinstance(token, str) or not 20 <= len(token) <= 128:
        return None
    column = getattr(User, column_name)
    conditions = [column == _hash_token(token)]
    # A stored hash must NEVER be accepted as a token (that would let someone who can read the
    # database use the hash as a link). Real tokens are 43 characters; hashes are 64 hex characters.
    if not _SHA256_HEX.match(token):
        conditions.append(column == token)
    return User.query.filter(or_(*conditions)).first()


def _public_user(user: User) -> dict:
    """Return only fields that are safe to expose to the client."""
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "is_verified": user.is_verified,
        "is_admin": user.is_admin,
        "about_me": user.about_me or "",
    }


@auth_bp.route("/register", methods=["POST"])
@limiter.limit(AUTH_RATE_LIMIT)
def register():
    payload = json_body()
    raw_email, password, raw_name = payload.get("email"), payload.get("password"), payload.get("display_name")
    if not all(isinstance(v, str) for v in (raw_email, password, raw_name)):
        return jsonify({"error": "invalid_email"}), 400
    email = raw_email.strip().lower()
    display_name = " ".join(raw_name.split())

    if not validate_email_format(email):
        return jsonify({"error": "invalid_email"}), 400

    if not validate_password_strength(password):
        return jsonify({
            "error": "weak_password",
            "detail": "Min 10 chars, include a number and a letter.",
        }), 400

    if not validate_display_name(display_name):
        return jsonify({"error": "invalid_display_name"}), 400

    verification_token = secrets.token_urlsafe(32)
    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=display_name,
        verification_token=_hash_token(verification_token),
        verification_token_expires_at=(
            datetime.utcnow() + VERIFICATION_TOKEN_TTL
        ),
    )
    db.session.add(user)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "email_already_registered"}), 409

    send_verification_email(
        user.email,
        user.display_name,
        verification_token,
    )

    login_user(user)
    return jsonify(_public_user(user)), 201


@auth_bp.route("/login", methods=["POST"])
@limiter.limit(AUTH_RATE_LIMIT)
def login():
    payload = json_body()
    raw_email, password = payload.get("email"), payload.get("password")
    generic_failure = (jsonify({"error": "invalid_credentials"}), 401)
    if not isinstance(raw_email, str) or not isinstance(password, str) or len(password) > 128 or len(raw_email) > 255:
        return generic_failure
    email = raw_email.strip().lower()

    user = User.query.filter_by(email=email).first()

    if user is None:
        # Perform a password hash check even when the account does not exist,
        # reducing the timing difference between known and unknown addresses.
        verify_password(
            password,
            "$argon2id$v=19$m=65536,t=3,p=2$"
            + "0" * 22
            + "$"
            + "0" * 43,
        )
        return generic_failure

    if user.locked_until and user.locked_until > datetime.utcnow():
        return jsonify({
            "error": "account_locked",
            "retry_after_seconds": int(
                (user.locked_until - datetime.utcnow()).total_seconds()
            ),
        }), 423

    if not verify_password(password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= LOCKOUT_THRESHOLD:
            user.locked_until = datetime.utcnow() + LOCKOUT_DURATION
        db.session.commit()
        return generic_failure

    user.failed_login_attempts = 0
    user.locked_until = None

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    db.session.commit()

    # "Remember me": absent -> True, so older clients keep their old behaviour.
    remember = payload.get("remember_me") is not False
    login_user(user, remember=remember)
    return jsonify(_public_user(user)), 200


@auth_bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return jsonify({"ok": True}), 200


@auth_bp.route("/me", methods=["GET"])
@login_required
def me():
    """Return the current session's public user data."""
    return jsonify(_public_user(g.current_user)), 200


@auth_bp.route("/profile", methods=["PATCH"])
@limiter.limit(PROFILE_RATE_LIMIT)
@login_required
def update_profile():
    """Update the current user's email and/or password.

    Changing either requires the current password to be re-confirmed.
    """
    payload = json_body()
    current_password = payload.get("current_password")
    requested_email = payload.get("email")
    new_password = payload.get("password")

    if not (requested_email or new_password):
        return jsonify({"error": "nothing_to_update"}), 400

    user = g.current_user
    if not isinstance(current_password, str) or len(current_password) > 128 or not verify_password(current_password, user.password_hash):
        return jsonify({"error": "invalid_credentials"}), 401

    old_email = user.email
    email_changed = False
    verification_token = None

    if requested_email:
        if not isinstance(requested_email, str):
            return jsonify({"error": "invalid_email"}), 400

        requested_email = requested_email.strip().lower()
        if not validate_email_format(requested_email):
            return jsonify({"error": "invalid_email"}), 400

        email_changed = requested_email != old_email

    if new_password:
        if not isinstance(new_password, str):
            return jsonify({
                "error": "weak_password",
                "detail": "Min 10 chars, include a number and a letter.",
            }), 400

        if not validate_password_strength(new_password):
            return jsonify({
                "error": "weak_password",
                "detail": "Min 10 chars, include a number and a letter.",
            }), 400

    if email_changed:
        user.email = requested_email
        user.is_verified = False
        verification_token = secrets.token_urlsafe(32)
        user.verification_token = _hash_token(verification_token)
        user.verification_token_expires_at = (
            datetime.utcnow() + VERIFICATION_TOKEN_TTL
        )

    if new_password:
        user.password_hash = hash_password(new_password)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "email_already_registered"}), 409

    if email_changed or new_password:
        # Keep THIS browser logged in, but every other session of this account is now invalid.
        login_user(user, remember=bool(session.get("remember", True)))

    # Send notifications only after the profile changes have committed.
    if email_changed:
        send_verification_email(
            user.email,
            user.display_name,
            verification_token,
        )
        send_email_changed_email(
            old_email,
            user.display_name,
            user.email,
        )

    if new_password:
        send_password_changed_email(
            user.email,
            user.display_name,
        )

    return jsonify(_public_user(user)), 200


@auth_bp.route("/verify/confirm", methods=["POST"])
@limiter.limit(AUTH_RATE_LIMIT)
def verify_confirm():
    payload = json_body()
    user = _user_by_token("verification_token", payload.get("token"))
    if (
        user is None
        or user.verification_token_expires_at is None
        or user.verification_token_expires_at < datetime.utcnow()
    ):
        return jsonify({"error": "invalid_or_expired_token"}), 400

    user.is_verified = True
    user.verification_token = None
    user.verification_token_expires_at = None
    db.session.commit()

    send_welcome_email(user.email, user.display_name)
    return jsonify({"ok": True}), 200


@auth_bp.route("/about", methods=["PATCH"])
@login_required
def update_about():
    """Save the optional 'about you' text (max 200 chars). No password needed."""
    payload = json_body()
    about = payload.get("about_me")
    if about is None:
        about = ""
    if not isinstance(about, str):
        return jsonify({"error": "invalid_about"}), 400

    about = " ".join(about.split())                      # collapse newlines / spaces
    about = "".join(ch for ch in about if ch.isprintable())
    if len(about) > 200:
        return jsonify({"error": "about_too_long"}), 400

    g.current_user.about_me = about or None
    db.session.commit()
    return jsonify(_public_user(g.current_user)), 200


@auth_bp.route("/verify/resend", methods=["POST"])
@limiter.limit(AUTH_RATE_LIMIT)
@login_required
def verify_resend():
    user = g.current_user
    if user.is_verified:
        return jsonify({"ok": True, "already_verified": True}), 200

    token = secrets.token_urlsafe(32)
    user.verification_token = _hash_token(token)
    user.verification_token_expires_at = (
        datetime.utcnow() + VERIFICATION_TOKEN_TTL
    )
    db.session.commit()

    send_verification_email(user.email, user.display_name, token)
    return jsonify({"ok": True}), 200


@auth_bp.route("/password/forgot", methods=["POST"])
@limiter.limit(AUTH_RATE_LIMIT)
def password_forgot():
    payload = json_body()
    raw_email = payload.get("email")
    email = raw_email.strip().lower() if isinstance(raw_email, str) and len(raw_email) <= 255 else ""

    user = User.query.filter_by(email=email).first() if email else None

    # Keep the response identical whether or not the address is registered,
    # so this endpoint cannot be used to enumerate accounts.
    if user is not None:
        token = secrets.token_urlsafe(32)
        user.reset_token = _hash_token(token)
        user.reset_token_expires_at = (
            datetime.utcnow() + PASSWORD_RESET_TOKEN_TTL
        )
        db.session.commit()

        send_password_reset_email(
            user.email,
            user.display_name,
            token,
        )

    return jsonify({"ok": True}), 200


@auth_bp.route("/password/reset", methods=["POST"])
@limiter.limit(AUTH_RATE_LIMIT)
def password_reset():
    payload = json_body()
    new_password = payload.get("password")

    if not validate_password_strength(new_password):
        return jsonify({
            "error": "weak_password",
            "detail": "Min 10 chars, include a number and a letter.",
        }), 400

    user = _user_by_token("reset_token", payload.get("token"))
    if (
        user is None
        or user.reset_token_expires_at is None
        or user.reset_token_expires_at < datetime.utcnow()
    ):
        return jsonify({"error": "invalid_or_expired_token"}), 400

    user.password_hash = hash_password(new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    user.failed_login_attempts = 0
    user.locked_until = None
    db.session.commit()

    send_password_changed_email(user.email, user.display_name)
    return jsonify({"ok": True}), 200