import os
import socket
import subprocess
import threading
import time
import requests
import pytest
import uvicorn

from backend.main import app


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def live_server():
    port = get_free_port()
    config = uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config=config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"

    # Wait for server to become responsive
    timeout = 5.0
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            res = requests.get(f"{base_url}/health", timeout=0.5)
            if res.status_code == 200:
                break
        except requests.RequestException:
            pass
        time.sleep(0.05)
    else:
        raise RuntimeError(f"Server did not start within {timeout}s on port {port}")

    yield base_url

    server.should_exit = True
    thread.join(timeout=2)


def test_vision_node_webhook_to_backend_e2e(live_server):
    """
    End-to-end integration test:
    Executes the Node.js VitalsTrigger code to process vitals and fire the panic webhook
    to the live running FastAPI backend server, then verifies that FastAPI caught and stored it.
    """
    backend_url = f"{live_server}/api/panic"

    # Node script that uses the vision VitalsTrigger to ingest vitals and dispatch webhook
    node_script = f"""
    import {{ VitalsTrigger }} from './vision/utils/trigger.js';

    async function run() {{
      const trigger = new VitalsTrigger({{
        bufferSize: 3,
        hrThreshold: 100,
        rrThreshold: 25,
        cooldownMs: 5000,
        webhookUrl: '{backend_url}'
      }});

      // Push readings that spike heart rate past 100 BPM
      await trigger.checkAndDispatch({{ heartRate: 110, respirationRate: 18 }});
      await trigger.checkAndDispatch({{ heartRate: 115, respirationRate: 18 }});
      const result = await trigger.checkAndDispatch({{ heartRate: 120, respirationRate: 18 }});

      if (!result.triggered) {{
        console.error('FAILED: Trigger did not fire', result);
        process.exit(1);
      }}

      if (!result.delivered || result.status !== 200) {{
        console.error('FAILED: Webhook was not delivered successfully', result);
        process.exit(2);
      }}

      console.log('SUCCESS: Webhook delivered to FastAPI', JSON.stringify(result.response));
      process.exit(0);
    }}

    run().catch(err => {{
      console.error(err);
      process.exit(3);
    }});
    """

    res = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        capture_output=True,
        text=True,
        cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")),
    )

    assert res.returncode == 0, f"Node script failed:\nSTDOUT: {res.stdout}\nSTDERR: {res.stderr}"
    assert "SUCCESS: Webhook delivered to FastAPI" in res.stdout

    # Verify that the FastAPI backend caught and recorded the event
    events_res = requests.get(f"{live_server}/events")
    assert events_res.status_code == 200
    events = events_res.json()

    assert len(events) >= 1
    latest_event = events[-1]
    assert latest_event["event"] == "panic_attack"
    assert latest_event["trigger_source"] == "heart_rate"
    # Average of 110, 115, 120 is 115
    assert latest_event["heart_rate"] == 115
    assert latest_event["respiration"] == 18
    assert latest_event["hardware_status"] == "not_configured"
