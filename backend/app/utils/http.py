"""Small request helpers shared by every route.

Why this exists: `request.get_json(silent=True) or {}` returns whatever JSON the
client sent. If someone posts a list (`[1,2]`), a string or a number, the next
`.get()` call crashes with a 500. `json_body()` always gives routes a dict.
"""
from flask import request


def json_body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def as_str(value, default: str = "") -> str:
    """The value if it is a string, else `default` (never raises)."""
    return value if isinstance(value, str) else default