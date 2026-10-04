"""
main.py
FastAPI core router + live dashboard for AuraSense.

Receives anomaly webhooks from the vision pipeline and coordinates responses.
A small in-memory event log and HTML dashboard let you monitor the process in real time.
"""

import asyncio
import os
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel


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

# The FREE-WILi display CPU, over USB serial (backend/device.py). Blank = no
# board connected; "auto" = find it by USB ID; or a port such as COM4. The
# board's COM ports are only visible to Windows Python, not to WSL.
DEVICE_ADDRESS = _env("DEVICE_ADDRESS")
INTERVENE_DURATION_S = int(_env("INTERVENE_DURATION_S", "120"))
PORT = int(_env("PORT", "8000"))
MAX_EVENTS = 50


class AnomalyPayload(BaseModel):
    """Payload received from the computer-vision / stress-detection script."""

    event: str = "anomaly"
    trigger_source: str | None = None
    heart_rate: int | float
    respiration: int | float = 0
    stress_score: int | float = 0
    timestamp: str | None = None


# In-memory event log + lock so the dashboard stays consistent.
event_log: list[dict[str, Any]] = []
_event_lock = threading.Lock()


def _add_event(event: dict[str, Any]) -> None:
    with _event_lock:
        event_log.append(event)
        if len(event_log) > MAX_EVENTS:
            event_log.pop(0)


def _update_event(event_id: str, **kwargs: Any) -> None:
    with _event_lock:
        for event in event_log:
            if event.get("id") == event_id:
                event.update(kwargs)
                break


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan hook for startup/shutdown logic."""
    print("[AuraSense Backend] Starting up...")
    yield
    print("[AuraSense Backend] Shutting down...")


app = FastAPI(title="AuraSense Backend Router", lifespan=lifespan)


# One serial port, one user at a time: overlapping webhooks would otherwise
# race to open it and the second would fail with "access denied".
_device_lock = threading.Lock()


def _device_command(name: str, **kwargs: Any) -> dict[str, Any]:
    """Open the board, send one command (ping/idle/intervene), close it."""
    try:
        from backend import device   # imported as a package (pytest)
    except ImportError:
        import device                # run as a script: python backend/main.py
    port = None if DEVICE_ADDRESS.lower() == "auto" else DEVICE_ADDRESS
    with _device_lock, device.Device(port=port) as dev:
        return getattr(dev, name)(**kwargs)


def _reply_status(reply: dict[str, Any]) -> str:
    if reply.get("ok"):
        return f"ok ({reply.get('state')})"
    return f"error: {reply.get('error', 'rejected')}"


async def _trigger_hardware(event_id: str) -> str:
    """
    Start a breathing session on the FREE-WILi board.

    The serial round trip runs in a thread pool so the event loop is not
    blocked during the hackathon demo.
    """
    try:
        reply = await asyncio.to_thread(
            _device_command, "intervene", duration_s=INTERVENE_DURATION_S)
        status = _reply_status(reply)
        print(f"[Hardware] Device replied: {reply}")
    except Exception as exc:  # unplugged, port busy, no reply: never fail the webhook
        status = f"error: {exc}"
        print(f"[Hardware] Could not reach the FREE-WILi board: {exc}")

    _update_event(event_id, hardware_status=status)
    return status


async def _process_anomaly(payload: AnomalyPayload) -> dict[str, str]:
    """
    Shared handler for anomaly webhooks.

    Records the event and triggers hardware intervention if configured.
    """
    event_id = str(uuid.uuid4())
    event = {
        "id": event_id,
        "event": payload.event,
        "trigger_source": payload.trigger_source,
        "timestamp": payload.timestamp or datetime.now(timezone.utc).isoformat(),
        "heart_rate": payload.heart_rate,
        "respiration": payload.respiration,
        "stress_score": payload.stress_score,
        "hardware_status": "pending",
    }
    _add_event(event)

    # Trigger physical intervention if configured, otherwise mark as not configured.
    if DEVICE_ADDRESS:
        await _trigger_hardware(event_id)
    else:
        _update_event(event_id, hardware_status="not_configured")

    return {
        "status": "success",
        "message": "Intervention triggered",
        "event_id": event_id,
    }


@app.post("/api/anomaly")
async def receive_anomaly(payload: AnomalyPayload) -> dict[str, str]:
    """Legacy/general anomaly endpoint."""
    return await _process_anomaly(payload)


@app.post("/api/panic")
async def receive_panic(payload: AnomalyPayload) -> dict[str, str]:
    """Webhook endpoint used by the vision layer when panic threshold is met."""
    return await _process_anomaly(payload)


@app.post("/events")
async def receive_event(payload: AnomalyPayload) -> dict[str, str]:
    """Webhook endpoint matching root contract POST /events."""
    return await _process_anomaly(payload)


@app.post("/simulate")
async def simulate() -> dict[str, str]:
    """Fire a fake high-stress event through the real pipeline (the demo trigger)."""
    return await _process_anomaly(AnomalyPayload(
        event="panic_attack",
        trigger_source="simulate",
        heart_rate=118,
        respiration=26,
    ))


@app.post("/device/idle")
async def device_idle() -> dict[str, str]:
    """End a running breathing session on the board."""
    if not DEVICE_ADDRESS:
        return {"status": "not_configured"}
    try:
        reply = await asyncio.to_thread(_device_command, "idle")
        return {"status": _reply_status(reply)}
    except Exception as exc:
        return {"status": f"error: {exc}"}


@app.get("/events")
async def get_events() -> list[dict[str, Any]]:
    """Return the recent anomaly event log for the dashboard."""
    with _event_lock:
        return list(event_log)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Simple liveness endpoint for demo / monitoring."""
    return {"status": "ok"}


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard() -> str:
    """A web UI to trigger and monitor the AuraSense pipeline."""
    return """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AuraSense Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    button { padding: 0.6rem 1rem; font-size: 1rem; cursor: pointer; border-radius: 6px; border: 1px solid #ccc; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
    th { background: #f4f4f4; }
    .ok { color: green; }
    .err { color: red; }
    .pending { color: orange; }
    #status { margin-top: 0.5rem; font-weight: bold; }
  </style>
</head>
<body>
  <h1>AuraSense Intervention Dashboard</h1>
  <p>
    <button id="trigger">Trigger Test Panic Webhook</button>
    <span id="status"></span>
  </p>
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Event</th>
        <th>Trigger</th>
        <th>Heart Rate</th>
        <th>Respiration</th>
        <th>Hardware</th>
      </tr>
    </thead>
    <tbody id="log">
      <tr><td colspan="6">Loading…</td></tr>
    </tbody>
  </table>

  <script>
    const statusEl = document.getElementById('status');
    const logEl = document.getElementById('log');

    async function loadEvents() {
      try {
        const res = await fetch('/events');
        const events = await res.json();
        if (events.length === 0) {
          logEl.innerHTML = '<tr><td colspan="6">No events yet.</td></tr>';
          return;
        }
        logEl.innerHTML = events.slice().reverse().map(e => `
          <tr>
            <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
            <td>${e.event || '-'}</td>
            <td>${e.trigger_source || '-'}</td>
            <td>${e.heart_rate}</td>
            <td>${e.respiration}</td>
            <td class="${e.hardware_status.startsWith('ok') ? 'ok' : e.hardware_status === 'pending' ? 'pending' : 'err'}">${e.hardware_status}</td>
          </tr>
        `).join('');
      } catch (err) {
        logEl.innerHTML = `<tr><td colspan="6" class="err">Could not load events: ${err}</td></tr>`;
      }
    }

    document.getElementById('trigger').addEventListener('click', async () => {
      statusEl.textContent = 'Sending…';
      try {
        const res = await fetch('/api/panic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'panic_attack',
            trigger_source: 'heart_rate',
            heart_rate: 120,
            respiration: 18,
            timestamp: new Date().toISOString()
          })
        });
        const data = await res.json();
        statusEl.textContent = `${data.status}: ${data.message}`;
        setTimeout(loadEvents, 500);
      } catch (err) {
        statusEl.textContent = `Error: ${err}`;
        statusEl.className = 'err';
      }
    });

    loadEvents();
    setInterval(loadEvents, 2000);
  </script>
</body>
</html>
"""


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
