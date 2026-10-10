"""
Flask-Talisman configuration — HSTS, CSP, and secure-header hardening.

Everything here is deny-by-default: we explicitly allowlist the exact CDN
hosts the frontend uses (Three.js, GSAP, Lenis, Google Fonts) rather than
using 'unsafe-inline' or wildcard sources. A wildcard or 'unsafe-inline'
script-src would silently defeat the entire point of having a CSP, since it
re-permits the #1 XSS payload vector (inline <script> injection).
"""
from flask_talisman import Talisman

# Pin to the exact CDNs used in index.html. If you add a new CDN dependency,
# it MUST be added here explicitly — this is intentionally not permissive.
CONTENT_SECURITY_POLICY = {
    "default-src": "'self'",
    "script-src": [
        "'self'",
        "https://cdnjs.cloudflare.com",       # Three.js, GSAP, ScrollTrigger
        "https://unpkg.com",                  # Lenis
        "https://cdn.jsdelivr.net",           # Three.js module (home-plans-3d.js)
    ],
    "style-src": [
        "'self'",
        "https://fonts.googleapis.com",
        # 'unsafe-inline' limited to style ONLY (not script) because GSAP
        # writes transform/opacity as inline style attributes during
        # animation — this is a scoped, standard tradeoff, never applied to
        # script-src.
        "'unsafe-inline'",
    ],
    "font-src": [
        "'self'",
        "https://fonts.gstatic.com",
    ],
    "img-src": ["'self'", "data:", "https://downloads.getlayers.ai", "https://*.supabase.co"],
    "media-src": ["'self'", "https://downloads.getlayers.ai", "https://*.supabase.co"],  # background video + Supabase videos
    "connect-src": ["'self'"],           # fetch()/XHR targets — API only, no exfil to third parties
    "worker-src": ["'self'", "blob:"],   # Three.js may spin workers for decoding
    "object-src": "'none'",              # blocks Flash/legacy plugin vectors entirely
    "base-uri": "'self'",                # blocks <base> tag hijack of relative URLs
    "frame-ancestors": "'none'",         # equivalent to X-Frame-Options: DENY, blocks clickjacking
    "form-action": "'self'",
}


def init_security_headers(app, force_https=True):
    """Wire Flask-Talisman onto the app. Call this once from create_app()."""
    Talisman(
        app,
        content_security_policy=CONTENT_SECURITY_POLICY,
        content_security_policy_nonce_in=["script-src"],
        force_https=force_https,
        strict_transport_security=force_https,
        strict_transport_security_max_age=31536000,   # 1 year, per HSTS preload requirements
        strict_transport_security_include_subdomains=True,
        # Only require HTTPS for the cookie when we're actually serving
        # over HTTPS (production). Hardcoding this True breaks every local
        # dev login: the browser silently discards a Secure-flagged cookie
        # on a plain http:// connection, so login POSTs return 200 but the
        # session never actually persists — GET /auth/me immediately 401s
        # again on the very next request.
        session_cookie_secure=force_https,
        session_cookie_http_only=True,    # cookie invisible to JS — blocks XSS-driven session theft
        # SameSite=Lax stops cross-site POST-based CSRF from ever attaching
        # the session cookie, while still allowing normal top-level nav.
        session_cookie_samesite="Lax",
        x_content_type_options=True,      # blocks MIME-sniffing based XSS
        referrer_policy="strict-origin-when-cross-origin",
        feature_policy={
            "geolocation": "'none'",
            "camera": "'none'",
            "microphone": "'none'",
            "payment": "'none'",
        },
    )