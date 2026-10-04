"""Backend -> FREE-WILi board wiring, with the serial link faked.

No board needed: _device_command is replaced, so these run anywhere.
"""
import pytest
from fastapi.testclient import TestClient

import backend.main as main
from backend.main import app, event_log, _event_lock


@pytest.fixture(autouse=True)
def clear_event_log():
    with _event_lock:
        event_log.clear()
    yield
    with _event_lock:
        event_log.clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def board(monkeypatch):
    """A fake board: records commands, answers like the firmware does."""
    calls = []

    def fake(name, **kwargs):
        calls.append((name, kwargs))
        return {"ok": True, "state": "intervening" if name == "intervene" else "idle"}

    monkeypatch.setattr(main, "DEVICE_ADDRESS", "auto")
    monkeypatch.setattr(main, "_device_command", fake)
    return calls


def test_simulate_without_board_is_not_configured(client):
    data = client.post("/simulate").json()
    assert data["status"] == "success"
    events = client.get("/events").json()
    assert events[0]["trigger_source"] == "simulate"
    assert events[0]["hardware_status"] == "not_configured"


def test_panic_starts_a_session_on_the_board(client, board):
    client.post("/api/panic", json={"event": "panic_attack", "heart_rate": 118})
    assert board == [("intervene", {"duration_s": main.INTERVENE_DURATION_S})]
    assert client.get("/events").json()[0]["hardware_status"] == "ok (intervening)"


def test_simulate_drives_the_board(client, board):
    client.post("/simulate")
    assert board[0][0] == "intervene"


def test_unreachable_board_does_not_fail_the_webhook(client, monkeypatch):
    def unplugged(name, **kwargs):
        raise RuntimeError("no reply within 1.0s on COM4")

    monkeypatch.setattr(main, "DEVICE_ADDRESS", "auto")
    monkeypatch.setattr(main, "_device_command", unplugged)
    res = client.post("/api/panic", json={"heart_rate": 118})
    assert res.status_code == 200
    assert client.get("/events").json()[0]["hardware_status"] == "error: no reply within 1.0s on COM4"


def test_device_idle(client, board):
    assert client.post("/device/idle").json() == {"status": "ok (idle)"}
    assert board == [("idle", {})]


def test_device_idle_without_board(client):
    assert client.post("/device/idle").json() == {"status": "not_configured"}
