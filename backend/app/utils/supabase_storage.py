"""
Minimal Supabase Storage client — a thin REST wrapper rather than pulling
in the full supabase-py SDK, since uploading a plan photo is the only
Storage operation this app needs. Uploads always go through the server
using the service-role key; it is never exposed to the frontend.
"""
import logging
import os
import uuid
import requests

logger = logging.getLogger("quiter.storage")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
PLAN_PHOTOS_BUCKET = os.environ.get("SUPABASE_PLAN_PHOTOS_BUCKET", "plan-photos")

ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5MB

PROGRESS_VIDEOS_BUCKET = os.environ.get("SUPABASE_PROGRESS_VIDEOS_BUCKET", "progress-videos")
ALLOWED_VIDEO_CONTENT_TYPES = {
    "video/webm": "webm",
    "video/mp4": "mp4",
}
MAX_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB — generous for a 10-second clip


def _looks_like(content_type: str, data: bytes) -> bool:
    """The browser-supplied Content-Type is only a claim. Check the real file signature too,
    so a script or HTML file can't be uploaded to your public bucket with an image/video label."""
    if content_type == "image/jpeg":
        return data[:3] == b"\xff\xd8\xff"
    if content_type == "image/png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if content_type == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if content_type == "video/webm":
        return data[:4] == b"\x1a\x45\xdf\xa3"
    if content_type == "video/mp4":
        return data[4:8] == b"ftyp"
    return False


class SupabaseStorageError(Exception):
    pass


def upload_plan_photo(file_bytes: bytes, content_type: str) -> str:
    """Uploads a plan photo to the public plan-photos bucket and returns
    its public URL. Raises SupabaseStorageError on any failure — callers
    turn that into a clean 4xx JSON response, never a raw traceback."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise SupabaseStorageError("supabase_not_configured")

    ext = ALLOWED_CONTENT_TYPES.get(content_type)
    if not ext:
        raise SupabaseStorageError("invalid_content_type")

    if not file_bytes or len(file_bytes) > MAX_UPLOAD_BYTES:
        raise SupabaseStorageError("file_too_large")
    if not _looks_like(content_type, file_bytes):
        raise SupabaseStorageError("invalid_content_type")

    object_path = f"{uuid.uuid4().hex}.{ext}"
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{PLAN_PHOTOS_BUCKET}/{object_path}"

    resp = requests.post(
        upload_url,
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": content_type,
            "x-upsert": "false",
        },
        data=file_bytes,
        timeout=15,
    )

    if resp.status_code not in (200, 201):
        # Surface Supabase's actual error so we can diagnose config issues
        # (bad key, wrong bucket name, etc.) instead of a generic failure.
        # Provider details go to the server log only; the client just gets a short code.
        logger.error("supabase upload failed: %s %s", resp.status_code, resp.text[:300])
        raise SupabaseStorageError("upload_failed")
    return f"{SUPABASE_URL}/storage/v1/object/public/{PLAN_PHOTOS_BUCKET}/{object_path}"



def upload_progress_video(file_bytes: bytes, content_type: str) -> str:
    """Uploads a user's 10-second check-in video to the public
    progress-videos bucket and returns its public URL."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise SupabaseStorageError("supabase_not_configured")

    ext = ALLOWED_VIDEO_CONTENT_TYPES.get(content_type)
    if not ext:
        raise SupabaseStorageError("invalid_content_type")

    if not file_bytes or len(file_bytes) > MAX_VIDEO_UPLOAD_BYTES:
        raise SupabaseStorageError("file_too_large")
    if not _looks_like(content_type, file_bytes):
        raise SupabaseStorageError("invalid_content_type")

    object_path = f"{uuid.uuid4().hex}.{ext}"
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{PROGRESS_VIDEOS_BUCKET}/{object_path}"

    resp = requests.post(
        upload_url,
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": content_type,
            "x-upsert": "false",
        },
        data=file_bytes,
        timeout=30,
    )

    if resp.status_code not in (200, 201):
        # Provider details go to the server log only; the client just gets a short code.
        logger.error("supabase upload failed: %s %s", resp.status_code, resp.text[:300])
        raise SupabaseStorageError("upload_failed")
    return f"{SUPABASE_URL}/storage/v1/object/public/{PROGRESS_VIDEOS_BUCKET}/{object_path}"