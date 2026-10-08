"""
Session-based authentication via Flask's signed, HTTP-only cookie session —
deliberately NOT a JWT stored in localStorage/sessionStorage.

Why cookie session over JWT-in-localStorage: localStorage is readable by any
JS running on the page, so a single XSS hole anywhere (a compromised CDN
dependency, a stray innerHTML) means instant, silent session theft. An
HTTP-only cookie is invisible to JavaScript entirely — the CSP + Talisman
headers in headers.py plus this cookie flag combination is the standard
OWASP-recommended defense-in-depth pairing.

CSRF is mitigated by SameSite=Lax (set in headers.py) plus a custom header
check below, since SameSite alone doesn't cover older browsers or
same-site-subdomain edge cases.
"""
import functools
import time
from flask import session, request, jsonify, g

from app.models.models import db, User


# Sessions WITHOUT "Remember me" also stop working on the server after this
# long, so a browser that restores session cookies can't keep one alive forever.
SHORT_SESSION_SECONDS = 12 * 60 * 60


def login_user(user: User, remember: bool = True) -> None:
    """Establish the session. Flask signs this cookie with SECRET_KEY, so
    tampering with the cookie invalidates the signature — the session id
    itself is never trusted without that signature check, which Flask
    performs automatically on every request.

    remember=True  -> persistent cookie that lasts PERMANENT_SESSION_LIFETIME
                      (see app/__init__.py) and renews while you keep using the site.
    remember=False -> browser-session cookie (gone when the browser closes) that
                      is also rejected server-side after SHORT_SESSION_SECONDS."""
    session.clear()               # prevent session fixation across logins
    session["user_id"] = user.id
    session["remember"] = bool(remember)
    session["iat"] = int(time.time())
    session.permanent = bool(remember)


def logout_user() -> None:
    session.clear()


def login_required(view):
    """Route decorator: rejects unauthenticated requests before the view
    body runs, and rejects state-changing requests missing our custom
    anti-CSRF header."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "authentication_required"}), 401

        # Sessions created before "Remember me" existed have no flag and are
        # treated as remembered, so nobody gets logged out by this update.
        if not session.get("remember", True):
            if time.time() - session.get("iat", 0) > SHORT_SESSION_SECONDS:
                session.clear()
                return jsonify({"error": "authentication_required"}), 401

        # Belt-and-suspenders CSRF check: browsers will not let a
        # cross-site form or fetch() call set an arbitrary custom header,
        # so requiring this header on every mutating request blocks classic
        # CSRF even in browsers that ignore SameSite.
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.headers.get("X-Quiter-Client") != "web":
                return jsonify({"error": "csrf_check_failed"}), 403

        user = db.session.get(User, user_id)   # ORM lookup — parameterized, injection-safe
        if user is None or not user.is_active:
            session.clear()
            return jsonify({"error": "account_unavailable"}), 401

        g.current_user = user   # stash for the route body to use
        return view(*args, **kwargs)

    return wrapped
