"""
Flask-Talisman configuration — HSTS, CSP, and secure-header hardening.

Everything here is deny-by-default: we explicitly allowlist the exact CDN
hosts the frontend uses (Three.js, GSAP, Lenis, Google Fonts) rather than
using 'unsafe-inline' or wildcard sources. A wildcard or 'unsafe-inline'
script-src would silently defeat the entire point of having a CSP, since it
re-permits the #1 XSS payload vector (inline <script> injection).
"""
import os
from urllib.parse import urlsplit

from flask_talisman import Talisman

# Only the hosts the site really uses (checked against the frontend code):
#   - Three.js is loaded from ONE pinned file path on jsDelivr (site-gl.js). Allowing the whole
#     host would let anyone's npm package run on your pages, so the policy is pinned to that path.
#   - Google Fonts (CSS + font files).
#   - Supabase storage for plan photos and progress videos (the exact project host when
#     SUPABASE_URL is set, otherwise any *.supabase.co).
# unpkg.com, cdnjs.cloudflare.com and downloads.getlayers.ai are no longer referenced anywhere, so they were removed.
# If you add a new CDN dependency it MUST be added here explicitly — this is intentionally not permissive.


def _supabase_origin() -> str:
    host = urlsplit(os.environ.get("SUPABASE_URL", "").strip()).hostname
    return f"https://{host}" if host else "https://*.supabase.co"


def build_csp() -> dict:
    supabase = _supabase_origin()
    return {
        "default-src": "'self'",
        "script-src": [
            "'self'",
            "https://cdn.jsdelivr.net/npm/three@0.160.0/",   # Three.js (site-gl.js), exact version path only
        ],
        "style-src": [
            "'self'",
            "https://fonts.googleapis.com",
            # 'unsafe-inline' limited to style ONLY (not script): the animations write inline style attributes.
            "'unsafe-inline'",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", supabase],
        # blob: is needed for the video check-in review player (URL.createObjectURL of the recording).
        "media-src": ["'self'", "blob:", supabase],
        # fetch()/XHR targets — API only. The two Google Fonts hosts are here ONLY because the
        # service worker (sw.js) fetches fonts to cache them for offline use.
        "connect-src": ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        "worker-src": ["'self'", "blob:"],
        "manifest-src": "'self'",
        "frame-src": "'none'",
        "object-src": "'none'",
        "base-uri": "'self'",
        "frame-ancestors": "'none'",
        "form-action": "'self'",
    }


def init_security_headers(app, force_https=True):
    """Wire Flask-Talisman onto the app. Call this once from create_app()."""
    Talisman(
        app,
        content_security_policy=build_csp(),
        content_security_policy_nonce_in=["script-src"],
        force_https=force_https,
        strict_transport_security=force_https,
        strict_transport_security_max_age=31536000,
        strict_transport_security_include_subdomains=True,
        session_cookie_secure=force_https,
        session_cookie_http_only=True,
        session_cookie_samesite="Lax",
        x_content_type_options=True,
        referrer_policy="strict-origin-when-cross-origin",
        # Old "Feature-Policy" header removed: it told Safari the camera and microphone were forbidden,
        # but the 10-second video check-in needs them. Permissions-Policy is the modern replacement.
        feature_policy={},
        permissions_policy={
            "camera": "(self)",
            "microphone": "(self)",
            "geolocation": "()",
            "payment": "()",
            "usb": "()",
            "browsing-topics": "()",
        },
    )