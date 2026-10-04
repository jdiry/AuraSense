import pytest
from fastapi.testclient import TestClient

from backend.main import app, event_log, _event_lock


@pytest.fixture(autouse=True)
def clear_event_log():
    """Clear in-memory event log before each test."""
    with _event_lock:
        event_log.clear()
    yield
    with _event_lock:
        event_log.clear()


@pytest.fixture
def client():
    return TestClient(app)


def test_health_check(client):
    """GET /health should return status ok."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_catch_panic_webhook_from_vision(client):
    """POST /api/panic should accept the exact payload emitted by the vision module."""
    payload = {
        "event": "panic_attack",
        "trigger_source": "heart_rate",
        "heart_rate": 118,
        "respiration": 26,
        "timestamp": "2026-10-03T21:14:05.000Z",
    }
    response = client.post("/api/panic", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "success"
    assert data["message"] == "Intervention triggered"
    assert "event_id" in data

    # Verify event was captured in event log
    events_res = client.get("/events")
    assert events_res.status_code == 200
    events = events_res.json()
    assert len(events) == 1
    assert events[0]["id"] == data["event_id"]
    assert events[0]["event"] == "panic_attack"
    assert events[0]["trigger_source"] == "heart_rate"
    assert events[0]["heart_rate"] == 118
    assert events[0]["respiration"] == 26
    assert events[0]["hardware_status"] == "not_configured"


def test_catch_respiration_panic_webhook(client):
    """POST /api/panic should accept respiration-triggered panic attacks."""
    payload = {
        "event": "panic_attack",
        "trigger_source": "respiration",
        "heart_rate": 84,
        "respiration": 29,
        "timestamp": "2026-10-03T21:15:00.000Z",
    }
    response = client.post("/api/panic", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"

    events = client.get("/events").json()
    assert len(events) == 1
    assert events[0]["trigger_source"] == "respiration"
    assert events[0]["respiration"] == 29


def test_post_events_contract_endpoint(client):
    """POST /events should also accept the webhook payload per the root README contract."""
    payload = {
        "event": "panic_attack",
        "trigger_source": "heart_rate",
        "heart_rate": 125,
        "respiration": 22,
    }
    response = client.post("/events", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_catch_anomaly_endpoint(client):
    """POST /api/anomaly should accept anomaly payloads."""
    payload = {
        "event": "stress_spike",
        "heart_rate": 105,
        "stress_score": 85,
    }
    response = client.post("/api/anomaly", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_invalid_payload_rejected(client):
    """POST /api/panic without required heart_rate should return 422 Unprocessable Entity."""
    response = client.post("/api/panic", json={"event": "panic_attack"})
    assert response.status_code == 422


def test_dashboard_returns_html(client):
    """GET /dashboard should render the HTML dashboard."""
    response = client.get("/dashboard")
    assert response.status_code == 200
    assert "<!doctype html>" in response.text.lower()
    assert "Aegis Intervention Dashboard" in response.text
