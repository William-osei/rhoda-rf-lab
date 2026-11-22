"""Shared local API boundaries; session IDs are identifiers, not authentication."""

import os
import re


def valid_session_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) is not None


def allowed_origins():
    defaults = (
        "http://127.0.0.1:8081,http://localhost:8081,"
        "http://127.0.0.1:4173,http://localhost:4173,"
        "http://127.0.0.1:5173,http://localhost:5173"
    )
    return [origin.strip() for origin in os.environ.get("RHODA_ALLOWED_ORIGINS", defaults).split(",") if origin.strip()]
