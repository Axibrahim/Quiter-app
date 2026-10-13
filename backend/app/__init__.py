"""
Quiter — Application Factory

Uses the app-factory pattern (create_app) rather than a bare module-level
`app = Flask(__name__)` so the app can be instantiated multiple times with
different configs — one real instance for production/dev, and a separate
throwaway instance per test with an isolated test database. This is what
makes the test suite safe to run without ever touching real user data.
"""
import os
import re
import logging

from flask import Flask, Response, abort, jsonify, request, send_from_directory
from flask_cors import CORS

from app.models.models import db
from app.security.headers import init_security_headers
from app.security.limiter import limiter
from app.routes.auth import auth_bp
from app.routes.plans import plans_bp
from app.routes.admin import admin_bp

def create_app(config_name: str = "production") -> Flask:
    app = Flask(__name__)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if config_name == "production":
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # --- Core config -------------------------------------------------
    # SECRET_KEY signs the session cookie. It MUST come from the environment
    # in every real deployment — a hardcoded fallback here would mean anyone
    # reading this source file could forge session cookies for any user.
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    app.config["SECRET_KEY"] = os.environ["FLASK_SECRET_KEY"]
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ["DATABASE_URL"]
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    # Supabase's connection string comes in two flavors: a direct connection
    # (port 5432) and a transaction-mode pgbouncer pooler (port 6543). The
    # pooler does its own connection pooling in front of Postgres, so
    # layering SQLAlchemy's own pool on top of it causes hard-to-debug
    # "prepared statement does not exist" errors under load. Detect the
    # pooler by port and switch to NullPool (no app-side pooling — let
    # pgbouncer own it) automatically, rather than requiring a manual code
    # edit depending on which connection string you paste in.
    using_supabase_pooler = ":6543" in app.config["SQLALCHEMY_DATABASE_URI"]
    if using_supabase_pooler:
        from sqlalchemy.pool import NullPool
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
            "poolclass": NullPool,
            "connect_args": {"sslmode": "require"},
        }
    else:
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
            "pool_pre_ping": True,   # avoids "server closed the connection" errors after DB idle timeouts
            "pool_recycle": 280,
        }
    # How long a "Remember me" session lasts (renews while the user keeps using the site).
    # Sessions without "Remember me" are browser-session cookies (see security/session_auth.py).
    app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 24 * int(os.environ.get("SESSION_REMEMBER_DAYS", "30"))

    if config_name == "testing":
        app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
            "TEST_DATABASE_URL", "postgresql://localhost/quiter_test"
        )
        app.config["TESTING"] = True

    # --- Fail loudly on missing secrets in production -----------------
    if config_name == "production" and app.config["SECRET_KEY"] in (None, "", "dev"):
        raise RuntimeError("FLASK_SECRET_KEY must be a strong, unique value in production.")

    if config_name == "production" and "memory://" in os.environ.get("REDIS_URL", "memory://"):
        # Loud warning, not a crash: memory:// still works for a single
        # worker, but silently weakens the rate limit under gunicorn with
        # >1 worker (see security/limiter.py docstring). Make it visible.
        logging.getLogger("quiter.security").warning(
            "Flask-Limiter is using in-memory storage in production. "
            "Set REDIS_URL so rate limits are shared across all workers."
        )

    # --- Extensions ----------------------------------------------------
    db.init_app(app)
    limiter.init_app(app)
    init_security_headers(app, force_https=(config_name == "production"))

    # CORS: the frontend (localhost:8080 in dev) and backend (localhost:5000)
    # are different origins, so the browser blocks the session cookie from
    # being sent/received on cross-origin fetch() calls unless CORS
    # explicitly allows it. supports_credentials=True is required for the
    # cookie to travel at all; origins is an explicit allowlist (never "*"
    # when credentials are allowed — browsers reject that combination
    # anyway, and it would be a wide-open CSRF surface if they didn't).
    allowed_origins = [
        o.strip().rstrip("/")
        for o in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080").split(",")
        if o.strip()
    ]
    if config_name == "production" and "*" in allowed_origins:
        raise RuntimeError("CORS_ALLOWED_ORIGINS must list exact origins in production, never '*'.")
    CORS(
        app,
        supports_credentials=True,
        origins=allowed_origins,
        methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Quiter-Client"],
        max_age=600,
    )

    # Origins that may send state-changing requests with the session cookie: the CORS list,
    # the public frontend URL used in emails, and this server's own origin.
    trusted_origins = set(allowed_origins)
    app_base = os.environ.get("APP_BASE_URL", "").strip().rstrip("/")
    if app_base:
        trusted_origins.add(app_base)
    if config_name == "production" and (not app_base or "localhost" in app_base or "127.0.0.1" in app_base):
        logging.getLogger("quiter.security").warning(
            "APP_BASE_URL is not set to your public https URL: email links (verify, reset, check-in) will be broken."
        )

    JSON_BODY_LIMIT = 1 * 1024 * 1024   # only the two upload routes may be bigger (photos / videos)

    @app.before_request
    def guard_api_requests():
        """Extra CSRF + abuse protection on top of SameSite cookies and the X-Quiter-Client header."""
        if not request.path.startswith("/api/"):
            return None
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("Origin")
            if origin and origin.rstrip("/") not in trusted_origins and origin.rstrip("/") != request.host_url.rstrip("/"):
                return jsonify({"error": "bad_origin"}), 403
            is_upload = request.path.endswith("/videos") or request.path.endswith("/upload-photo")
            if not is_upload and (request.content_length or 0) > JSON_BODY_LIMIT:
                return jsonify({"error": "payload_too_large"}), 413
        return None

    @app.after_request
    def api_cache_headers(resp):
        # Private API answers must never be stored by browsers, proxies or the CDN.
        # The two public catalog endpoints can be cached briefly.
        if request.path.startswith("/api/") and "Cache-Control" not in resp.headers:
            public = request.method == "GET" and request.path in (
                "/api/v1/plans/templates", "/api/v1/plans/exercise-catalog", "/api/v1/health",
            )
            resp.headers["Cache-Control"] = "public, max-age=60" if public else "no-store"
        return resp

    # --- Blueprints ------------------------------------------------------
    app.register_blueprint(auth_bp)
    app.register_blueprint(plans_bp)
    app.register_blueprint(admin_bp)

        # --- Frontend (static HTML/JS served by Flask, same origin as the API) ---
    frontend_dir = os.path.abspath(os.path.join(app.root_path, "..", "..", "frontend"))
    inline_script = re.compile(r"<script(?![^>]*\bsrc=)", re.IGNORECASE)

    def serve_html(name):
        path = os.path.join(frontend_dir, name)
        with open(path, encoding="utf-8") as fh:
            html = fh.read()
        html = inline_script.sub('<script nonce="%s"' % request.csp_nonce, html)
        resp = Response(html, mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.route("/", methods=["GET"])
    def index():
        return serve_html("index.html")

    @app.route("/<path:path>", methods=["GET"])
    def frontend(path):
        if path.startswith("api/"):
            abort(404)
        full = os.path.normpath(os.path.join(frontend_dir, path))
        if not full.startswith(frontend_dir + os.sep) or not os.path.isfile(full):
            abort(404)
        if any(part.startswith(".") for part in path.split("/")) or path.endswith((".py", ".pyc", ".env", ".map")):
            abort(404)
        if path.endswith(".html"):
            return serve_html(path)
        resp = send_from_directory(frontend_dir, path)
        if path == "sw.js":
            resp.headers["Cache-Control"] = "no-cache"
            resp.headers["Service-Worker-Allowed"] = "/"
        return resp
    
    # --- Global error handlers -------------------------------------------
    # Deliberately generic messages on 500 — a stack trace or DB error string
    # returned to the client is an information-disclosure bug (it can reveal
    # table names, ORM internals, or file paths). Full detail still goes to
    # the server-side logger for debugging.
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "not_found"}), 404

    # Clean JSON instead of Flask's default HTML error pages (which also reveal the framework).
    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": "bad_request"}), 400

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"error": "method_not_allowed"}), 405

    @app.errorhandler(413)
    def too_large(e):
        return jsonify({"error": "payload_too_large"}), 413

    @app.errorhandler(415)
    def unsupported(e):
        return jsonify({"error": "unsupported_media_type"}), 415

    @app.errorhandler(429)
    def rate_limited(e):
        return jsonify({"error": "rate_limited", "detail": str(e.description)}), 429

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error")
        return jsonify({"error": "internal_error"}), 500

    @app.route("/api/v1/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"}), 200

    return app