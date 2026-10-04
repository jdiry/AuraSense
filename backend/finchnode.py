"""
finchnode.py
FinchNode sandbox integration for Aegis.

When the vision pipeline detects a panic/anxiety anomaly, this module writes a
sandbox lifecycle event to FinchNode so the synthetic patient’s record can
advance and reflect the latest state.

Real FinchNode fields used:
- Authorization: Bearer <FINCHNODE_API_KEY>
- POST /api/v1/sandbox/subjects/{subject}/events
- Body fields: type, source (optional)

Environment variables are read from a .env file via python-dotenv.
"""

import os
from pathlib import Path

import requests
from dotenv import load_dotenv


def _env(key: str, default: str | None = None) -> str | None:
    """Read an env var, stripping whitespace and surrounding quotes."""
    value = os.getenv(key)
    if value is None:
        return default
    value = value.strip().strip('"').strip("'")
    return value if value else default


# Load the root .env (the file in the project root, next to backend/).
project_root = Path(__file__).resolve().parent.parent
load_dotenv(project_root / ".env")

FINCHNODE_API_URL = _env(
    "FINCHNODE_API_URL", "https://api.finchnode.com/api/v1"
)
# The hackathon starter .env uses FINCH_API_KEY, so accept that as a fallback.
FINCHNODE_API_KEY = _env("FINCHNODE_API_KEY") or _env("FINCH_API_KEY")
FINCHNODE_SUBJECT = _env("FINCHNODE_SUBJECT") or _env("FINCH_SUBJECT")
FINCHNODE_SANDBOX_SOURCE = _env("FINCHNODE_SANDBOX_SOURCE")


def log_health_anomaly(
    heart_rate: int | float, stress_score: int | float
) -> str:
    """
    Trigger a FinchNode sandbox event for the synthetic patient.

    The public sandbox API only accepts lifecycle controls, so this sends a
    ``records.advance`` event. The heart_rate and stress_score are logged
    locally for audit but are not accepted as request body fields by FinchNode.

    Returns a short status string for the dashboard (e.g. "ok (202)" or
    "error: ...").
    """
    if not FINCHNODE_SUBJECT:
        msg = "FINCHNODE_SUBJECT is not set; cannot write to sandbox."
        print(f"[FinchNode] {msg}")
        return f"error: {msg}"

    url = f"{FINCHNODE_API_URL.rstrip('/')}/sandbox/subjects/{FINCHNODE_SUBJECT}/events"

    # Real FinchNode sandbox event body fields.
    body: dict[str, str] = {"type": "records.advance"}
    if FINCHNODE_SANDBOX_SOURCE:
        body["source"] = FINCHNODE_SANDBOX_SOURCE

    headers = {"Content-Type": "application/json"}
    if FINCHNODE_API_KEY:
        headers["Authorization"] = f"Bearer {FINCHNODE_API_KEY}"

    try:
        response = requests.post(url, json=body, headers=headers, timeout=5)
        response.raise_for_status()
        status = f"ok ({response.status_code})"
        print(
            f"[FinchNode] Advanced synthetic records for subject {FINCHNODE_SUBJECT}: "
            f"{response.status_code} (HR={heart_rate}, Stress={stress_score})"
        )
        return status
    except requests.exceptions.RequestException as exc:
        # Keep the backend stable even if the sandbox call fails.
        status = f"error: {exc}"
        print(f"[FinchNode] Failed to advance sandbox records: {exc}")
        return status
