"""
main.py
FastAPI core router for Aegis.

Receives anomaly webhooks from the vision/DS pipeline, immediately wakes the
local FREE-WILi hardware, and logs the event to the synthetic FHIR record in
the background.
"""

import asyncio
import os
from contextlib import asynccontextmanager

import requests
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

from finchnode import log_health_anomaly

# Make environment variables available before the app starts.
load_dotenv()

HARDWARE_IP_URL = os.getenv(
    "HARDWARE_IP_URL", "http://192.168.1.100/trigger"
)


class AnomalyPayload(BaseModel):
    """Payload received from the computer-vision / stress-detection script."""

    heart_rate: int
    stress_score: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan hook for any startup/shutdown logic."""
    print("[Aegis Backend] Starting up...")
    yield
    print("[Aegis Backend] Shutting down...")


app = FastAPI(title="Aegis Backend Router", lifespan=lifespan)


async def _trigger_hardware(url: str) -> None:
    """
    Wake the FREE-WILi board with an HTTP request.

    Runs the synchronous `requests` call in a thread pool so the event loop
    is not blocked during the hackathon demo.
    """
    try:
        response = await asyncio.to_thread(
            requests.post, url, timeout=2
        )
        response.raise_for_status()
        print(f"[Hardware] Device triggered: {response.status_code}")
    except requests.exceptions.RequestException as exc:
        # The hardware may be offline; log and continue so the user still gets
        # a fast HTTP response and the FHIR logging attempt still happens.
        print(f"[Hardware] Could not reach FREE-WILi board at {url}: {exc}")


@app.post("/api/anomaly")
async def receive_anomaly(
    payload: AnomalyPayload,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """
    Central routing endpoint for a detected panic / anxiety anomaly.

    1. Queues the FHIR logging on a background task so it does not delay the
       physical intervention response.
    2. Immediately triggers the FREE-WILi hardware intervention.
    3. Returns a lightweight success acknowledgement to the vision script.
    """
    # Offload the synthetic medical-record write to the background.
    background_tasks.add_task(
        log_health_anomaly,
        payload.heart_rate,
        payload.stress_score,
    )

    # Trigger the physical intervention without blocking the event loop.
    await _trigger_hardware(HARDWARE_IP_URL)

    return {
        "status": "success",
        "message": "Intervention triggered",
    }


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Simple liveness endpoint for the hackathon demo / monitoring."""
    return {"status": "ok"}


if __name__ == "__main__":
    # Run with: python main.py
    uvicorn.run(app, host="0.0.0.0", port=8000)
