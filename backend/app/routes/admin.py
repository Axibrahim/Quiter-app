"""
Admin routes — /api/v1/admin/*

Every route requires BOTH a valid session (login_required) AND the
is_admin flag (admin_required) — a regular logged-in user gets a clean
403, never access to these endpoints.

Admins manage ONLY the default (ready-made) plans shown on the site, at most
MAX_DEFAULT_PLANS of them. Plans that users build for themselves (custom and
athlete plans) are stored as hidden templates too, but they are never listed,
read, edited or deleted from here: they stay private to their owner.
"""
from flask import Blueprint, request, jsonify

from app.models.models import db, PlanTemplate, PlanDay, UserPlan, gen_uuid
from app.security.session_auth import login_required
from app.security.admin_auth import admin_required
from app.utils.validation import validate_uuid_param
from app.utils.supabase_storage import upload_plan_photo, SupabaseStorageError

admin_bp = Blueprint("admin", __name__, url_prefix="/api/v1/admin")

VALID_DIRECTIONS = {"break", "build"}
MAX_DEFAULT_PLANS = 6

# plans.py creates a hidden template for every user-built plan with one of these
# slug prefixes. They belong to users, so admins can't see or touch them, and an
# admin can't create a default plan whose slug looks like one.
USER_SLUG_PREFIXES = ("custom-", "athletic-")


def _default_templates_query():
    """Active, admin-managed default plans (everything the site shows publicly)."""
    query = PlanTemplate.query.filter(PlanTemplate.is_active.is_(True))
    for prefix in USER_SLUG_PREFIXES:
        query = query.filter(~PlanTemplate.slug.startswith(prefix))
    return query


def _get_default_template(template_id):
    """The template, or None if it doesn't exist or isn't an admin-managed default plan."""
    template = db.session.get(PlanTemplate, template_id)
    if template is None or not template.is_active or template.slug.startswith(USER_SLUG_PREFIXES):
        return None
    return template


def _serialize_template(t):
    return {
        "id": t.id,
        "slug": t.slug,
        "title": t.title,
        "identity_statement": t.identity_statement,
        "direction": t.direction.value,
        "category": t.category,
        "length_days": t.length_days,
        "description": t.description,
        "photo_url": t.photo_url,
        "price_cents": t.price_cents,
        "trial_days": t.trial_days,
        "tagline": t.tagline,
        "cta_text": t.cta_text,
        "age_rating": t.age_rating,
        "is_included": t.is_included,
        "is_active": t.is_active,
    }


def _read_template_payload(payload, partial=False):
    fields = {}

    if "title" in payload or not partial:
        title = (payload.get("title") or "").strip()
        if not 3 <= len(title) <= 120:
            return None, "invalid_title"
        fields["title"] = title

    if "slug" in payload or not partial:
        slug = (payload.get("slug") or "").strip().lower()
        if not slug or len(slug) > 80 or not all(c.isalnum() or c == "-" for c in slug):
            return None, "invalid_slug"
        if slug.startswith(USER_SLUG_PREFIXES):
            return None, "reserved_slug"
        fields["slug"] = slug

    if "identity_statement" in payload or not partial:
        identity = (payload.get("identity_statement") or "").strip()
        if not 3 <= len(identity) <= 160:
            return None, "invalid_identity_statement"
        fields["identity_statement"] = identity

    if "direction" in payload or not partial:
        direction = payload.get("direction")
        if direction not in VALID_DIRECTIONS:
            return None, "invalid_direction"
        fields["direction"] = direction

    if "category" in payload or not partial:
        category = (payload.get("category") or "").strip()
        if not 1 <= len(category) <= 60:
            return None, "invalid_category"
        fields["category"] = category

    if "length_days" in payload or not partial:
        length_days = payload.get("length_days")
        if not isinstance(length_days, int) or isinstance(length_days, bool) or not 3 <= length_days <= 365:
            return None, "invalid_length_days"
        fields["length_days"] = length_days

    if "description" in payload:
        description = payload.get("description")
        if description is not None and not isinstance(description, str):
            return None, "invalid_description"
        fields["description"] = (description or "").strip()[:2000] or None

    if "photo_url" in payload:
        photo_url = payload.get("photo_url")
        if photo_url is not None:
            if not isinstance(photo_url, str) or len(photo_url) > 500:
                return None, "invalid_photo_url"
            photo_url = photo_url.strip() or None
        fields["photo_url"] = photo_url

    if "price_cents" in payload:
        price_cents = payload.get("price_cents")
        if price_cents is not None:
            if not isinstance(price_cents, int) or isinstance(price_cents, bool) or price_cents < 0:
                return None, "invalid_price_cents"
        fields["price_cents"] = price_cents

    if "trial_days" in payload:
        trial_days = payload.get("trial_days")
        if trial_days is not None:
            if not isinstance(trial_days, int) or isinstance(trial_days, bool) or not 0 <= trial_days <= 90:
                return None, "invalid_trial_days"
        fields["trial_days"] = trial_days

    if "tagline" in payload:
        tagline = payload.get("tagline")
        if tagline is not None:
            if not isinstance(tagline, str) or len(tagline) > 120:
                return None, "invalid_tagline"
            tagline = tagline.strip() or None
        fields["tagline"] = tagline

    if "cta_text" in payload:
        cta_text = payload.get("cta_text")
        if cta_text is not None:
            if not isinstance(cta_text, str) or len(cta_text) > 40:
                return None, "invalid_cta_text"
            cta_text = cta_text.strip() or None
        fields["cta_text"] = cta_text

    if "age_rating" in payload:
        age_rating = payload.get("age_rating")
        if age_rating is not None:
            if not isinstance(age_rating, str) or len(age_rating) > 10:
                return None, "invalid_age_rating"
            age_rating = age_rating.strip() or None
        fields["age_rating"] = age_rating

    if "is_included" in payload:
        is_included = payload.get("is_included")
        if not isinstance(is_included, bool):
            return None, "invalid_is_included"
        fields["is_included"] = is_included

    # is_active is intentionally NOT read from the payload: a default plan is either
    # live (it exists) or deleted (DELETE below). There is no "hidden draft" state.

    return fields, None


@admin_bp.route("/templates", methods=["GET"])
@login_required
@admin_required
def list_all_templates():
    """The default plans shown on the site (max 6). Users' own plans are never
    included, even though they live in the same table."""
    templates = _default_templates_query().order_by(PlanTemplate.created_at.asc()).all()
    return jsonify([_serialize_template(t) for t in templates]), 200


@admin_bp.route("/templates", methods=["POST"])
@login_required
@admin_required
def create_template():
    payload = request.get_json(silent=True) or {}
    fields, error = _read_template_payload(payload, partial=False)
    if error:
        return jsonify({"error": error}), 400

    if _default_templates_query().count() >= MAX_DEFAULT_PLANS:
        return jsonify({"error": "max_default_plans", "max": MAX_DEFAULT_PLANS}), 409

    if PlanTemplate.query.filter_by(slug=fields["slug"]).first():
        return jsonify({"error": "slug_already_exists"}), 409

    fields["is_active"] = True
    template = PlanTemplate(**fields)
    db.session.add(template)
    db.session.commit()
    return jsonify(_serialize_template(template)), 201


@admin_bp.route("/templates/<template_id>", methods=["PATCH"])
@login_required
@admin_required
def update_template(template_id):
    if not validate_uuid_param(template_id):
        return jsonify({"error": "invalid_id"}), 400

    template = _get_default_template(template_id)
    if template is None:
        return jsonify({"error": "template_not_found"}), 404

    payload = request.get_json(silent=True) or {}
    fields, error = _read_template_payload(payload, partial=True)
    if error:
        return jsonify({"error": error}), 400

    if "slug" in fields and fields["slug"] != template.slug:
        if PlanTemplate.query.filter_by(slug=fields["slug"]).first():
            return jsonify({"error": "slug_already_exists"}), 409

    for key, value in fields.items():
        setattr(template, key, value)

    db.session.commit()
    return jsonify(_serialize_template(template)), 200


@admin_bp.route("/templates/<template_id>", methods=["DELETE"])
@login_required
@admin_required
def delete_template(template_id):
    """Delete a default plan so it disappears from the site and frees a slot.

    If nobody has ever started it, the row is removed completely. If users
    already started it, the row is retired instead (inactive, slug freed) so
    their own plans and history keep working."""
    if not validate_uuid_param(template_id):
        return jsonify({"error": "invalid_id"}), 400

    template = _get_default_template(template_id)
    if template is None:
        return jsonify({"error": "template_not_found"}), 404

    in_use = UserPlan.query.filter_by(template_id=template.id).first() is not None
    if in_use:
        template.is_active = False
        template.slug = f"deleted-{gen_uuid()[:8]}"
    else:
        PlanDay.query.filter_by(template_id=template.id).delete()
        db.session.delete(template)

    db.session.commit()
    return jsonify({"ok": True}), 200


@admin_bp.route("/upload-photo", methods=["POST"])
@login_required
@admin_required
def upload_photo():
    file = request.files.get("photo")
    if file is None:
        return jsonify({"error": "no_file"}), 400

    try:
        url = upload_plan_photo(file.read(), file.mimetype)
    except SupabaseStorageError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify({"photo_url": url}), 200