"""
Quiter — the ONE place every AI call goes through.

Why a shared client: coach messages, dashboard tips and plan names all need the
same safety rails, so they live here once:
  * provider switch (Gemini default, Anthropic / OpenAI-compatible still work)
  * circuit breaker  — 3 failures in a row pause AI for 5 minutes
  * daily call cap   — AI_DAILY_CALL_LIMIT, shared by every feature (DB-backed,
                       so it is correct even with several gunicorn workers)
  * token logging    — grep "ai usage" in your logs to see real cost
  * never raises     — callers get None and use their free fallback

Environment
-----------
AI_API_KEY            provider key. Empty = every feature uses its free fallback.
AI_PROVIDER           "gemini" (default) | "anthropic" | "openai"
AI_MODEL              Gemini default: gemini-2.5-flash-lite  (check AI Studio for the
                      current model id and set it here if Google has renamed it)
AI_BASE_URL           only for OpenAI-compatible hosts other than OpenAI
AI_MODE               "milestones" (default) | "daily" | "off"   (off = no AI anywhere)
AI_DAILY_CALL_LIMIT   max AI calls per UTC day, whole app (default 300)
AI_TIMEOUT_SECONDS    default 8
AI_THINKING_LEVEL     optional, Gemini 3.x only (e.g. "minimal"); Gemini 2.5 uses a budget of 0
"""
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

import requests

logger = logging.getLogger("quiter.ai")


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _api_key() -> str:
    return os.environ.get("AI_API_KEY", "").strip()


def provider() -> str:
    return (os.environ.get("AI_PROVIDER") or "gemini").lower()


def enabled() -> bool:
    mode = (os.environ.get("AI_MODE") or "milestones").lower()
    return bool(_api_key()) and mode != "off"


def _timeout() -> float:
    return float(os.environ.get("AI_TIMEOUT_SECONDS", "8"))


# ---------------------------------------------------------------------------
# Circuit breaker (per process)
# ---------------------------------------------------------------------------
_fail_count = 0
_open_until = 0.0


def breaker_open() -> bool:
    return time.time() < _open_until


def _record_result(ok: bool) -> None:
    global _fail_count, _open_until
    if ok:
        _fail_count = 0
        return
    _fail_count += 1
    if _fail_count >= 3:
        _open_until = time.time() + 300
        _fail_count = 0
        logger.warning("ai: 3 failures in a row, pausing AI for 5 minutes")


# ---------------------------------------------------------------------------
# Daily budget (counts stored AI results from every feature)
# ---------------------------------------------------------------------------

def under_daily_budget() -> bool:
    from app.models.models import CoachMessage, PlanInsight   # local import: avoids cycles

    limit = int(os.environ.get("AI_DAILY_CALL_LIMIT", "300"))
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    used = (
        CoachMessage.query.filter(CoachMessage.source == "ai", CoachMessage.created_at >= start).count()
        + PlanInsight.query.filter(PlanInsight.source == "ai", PlanInsight.created_at >= start).count()
    )
    return used < limit


def can_use_ai() -> bool:
    """Cheap checks first, DB count last."""
    return enabled() and not breaker_open() and under_daily_budget()


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

def _gemini(system: str, user: str, max_tokens: int, json_mode: bool, t: float) -> str:
    model = os.environ.get("AI_MODEL") or "gemini-2.5-flash-lite"
    cfg = {"maxOutputTokens": max_tokens, "temperature": 0.8}
    if json_mode:
        cfg["responseMimeType"] = "application/json"

    # Thinking tokens are billed like output tokens and would eat a tiny max_tokens
    # budget, so switch them off wherever the model allows it.
    level = os.environ.get("AI_THINKING_LEVEL", "").strip()
    if level:
        cfg["thinkingConfig"] = {"thinkingLevel": level}          # Gemini 3.x
    elif "2.5" in model and "pro" not in model:
        cfg["thinkingConfig"] = {"thinkingBudget": 0}             # Gemini 2.5 Flash / Flash-Lite

    resp = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": _api_key(), "Content-Type": "application/json"},   # key in header, never in the URL/logs
        json={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": cfg,
        },
        timeout=t,
    )
    resp.raise_for_status()
    body = resp.json()
    usage = body.get("usageMetadata") or {}
    logger.info("ai usage provider=gemini in=%s out=%s thoughts=%s",
                usage.get("promptTokenCount"), usage.get("candidatesTokenCount"), usage.get("thoughtsTokenCount"))
    parts = (((body.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    return "".join(p.get("text", "") for p in parts)


def _anthropic(system: str, user: str, max_tokens: int, json_mode: bool, t: float) -> str:
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": _api_key(), "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": os.environ.get("AI_MODEL") or "claude-haiku-4-5-20251001", "max_tokens": max_tokens,
              "system": system, "messages": [{"role": "user", "content": user}]},
        timeout=t,
    )
    resp.raise_for_status()
    body = resp.json()
    usage = body.get("usage") or {}
    logger.info("ai usage provider=anthropic in=%s out=%s", usage.get("input_tokens"), usage.get("output_tokens"))
    return "".join(b.get("text", "") for b in body.get("content") or [] if b.get("type") == "text")


def _openai(system: str, user: str, max_tokens: int, json_mode: bool, t: float) -> str:
    base = (os.environ.get("AI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    resp = requests.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"},
        json={"model": os.environ.get("AI_MODEL") or "gpt-4o-mini", "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        timeout=t,
    )
    resp.raise_for_status()
    body = resp.json()
    usage = body.get("usage") or {}
    logger.info("ai usage provider=openai in=%s out=%s", usage.get("prompt_tokens"), usage.get("completion_tokens"))
    return body["choices"][0]["message"]["content"]


_PROVIDERS = {"gemini": _gemini, "anthropic": _anthropic, "openai": _openai}


def complete(system: str, user: str, max_tokens: int = 80, json_mode: bool = False, timeout_s: float | None = None):
    """Return the model's text, or None on ANY problem. Never raises.
    Callers decide whether AI is allowed (can_use_ai()) before calling."""
    if not enabled() or breaker_open():
        return None
    call = _PROVIDERS.get(provider(), _gemini)
    try:
        raw = call(system, user, max_tokens, json_mode, timeout_s or _timeout())
        ok = bool(raw and raw.strip())
        _record_result(ok)
        return raw if ok else None
    except Exception:
        _record_result(False)
        logger.exception("ai: provider call failed; caller will use its fallback")
        return None


def parse_json(text):
    """Best-effort JSON from a model reply (handles ```json fences and chatter)."""
    if not isinstance(text, str) or not text.strip():
        return None
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    try:
        return json.loads(cleaned)
    except ValueError:
        match = re.search(r"(\[.*\]|\{.*\})", cleaned, re.S)
        if match:
            try:
                return json.loads(match.group(1))
            except ValueError:
                return None
    return None