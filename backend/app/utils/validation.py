"""
Centralized input validation. Keeping these as pure functions (no DB access)
means every route calls the SAME validator, so a fix here fixes every route
at once instead of drifting into inconsistent per-route regexes.
"""
import re
import unicodedata
import uuid
from urllib.parse import urlsplit

_EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# Characters that have no business in a person's display name. Output is also
# HTML-escaped on every page; this is the second layer.
_NAME_FORBIDDEN = set('<>&"`\\{}[]|^~')


def has_control_chars(value: str) -> bool:
    return any(unicodedata.category(ch).startswith("C") for ch in value)


def validate_email_format(email) -> bool:
    return (
        isinstance(email, str)
        and 3 <= len(email) <= 255
        and bool(_EMAIL_RE.match(email))
    )


def validate_password_strength(password) -> bool:
    if not isinstance(password, str):
        return False
    if len(password) < 10 or len(password) > 128:
        return False
    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    return has_letter and has_digit


def validate_display_name(name) -> bool:
    return (
        isinstance(name, str)
        and 2 <= len(name) <= 40
        and not has_control_chars(name)
        and not (set(name) & _NAME_FORBIDDEN)
    )


def validate_slug(slug) -> bool:
    return isinstance(slug, str) and 1 <= len(slug) <= 80 and bool(_SLUG_RE.match(slug))


def validate_public_https_url(url, allowed_hosts=None, max_len=500) -> bool:
    """https only, no credentials, no quotes/whitespace/parentheses (so the URL can never
    break out of an HTML attribute or a CSS url(...)), and optionally a host allow-list."""
    if not isinstance(url, str) or not url or len(url) > max_len:
        return False
    if re.search(r"[\s\"'`<>()\\]", url) or has_control_chars(url):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return False
    if allowed_hosts is not None:
        host = parts.hostname.lower()
        if not any(host == h or (h.startswith("*.") and host.endswith(h[1:])) for h in allowed_hosts):
            return False
    return True


def validate_uuid_param(value) -> bool:
    """Defense in depth for path params that should be UUIDs — even though
    the ORM query itself is injection-safe regardless, rejecting obviously
    malformed IDs early avoids wasting a DB round trip and keeps error
    responses uniform (400, not a 500 from a failed cast). Only the canonical
    8-4-4-4-12 form is accepted."""
    if not isinstance(value, str):
        return False
    try:
        return str(uuid.UUID(value)) == value.lower()
    except (ValueError, AttributeError, TypeError):
        return False