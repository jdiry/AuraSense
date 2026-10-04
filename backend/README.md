# Aura Sense: Backend Module (FastAPI Router)

This module serves as the central router and event orchestration hub for Aura Sense. It listens for real-time biometric anomaly webhooks from the computer vision pipeline (`vision/`), records events in an in-memory event log, displays live events on a built-in web dashboard, and coordinates downstream interventions (messaging a loved one and triggering the FREE-WILi guided breathing device).

---

## Webhook Ingestion & Event Schema

When the vision layer detects an acute stress or panic attack, it sends an HTTP POST request to the backend.

### Primary Endpoint: `POST http://127.0.0.1:8000/api/panic`
(Aliases supported: `/api/anomaly` and `/events`)

### Request Payload:
```json
{
  "event": "panic_attack",
  "trigger_source": "heart_rate",
  "heart_rate": 118,
  "respiration": 26,
  "timestamp": "2026-10-03T21:14:05.000Z"
}
```

- `event`: Name of the detected event (`"panic_attack"` or `"anomaly"`).
- `trigger_source`: Which biometric metric crossed threshold (`"heart_rate"` or `"respiration"`).
- `heart_rate`: Smoothed heart rate in BPM.
- `respiration`: Smoothed breathing rate in breaths/min.
- `timestamp`: ISO-8601 UTC timestamp.

### Response:
```json
{
  "status": "success",
  "message": "Intervention triggered",
  "event_id": "a9d5e30b-93bf-4f6b-88a2-a9b0c8ef2829"
}
```

---

## Endpoints Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/panic` | Webhook receiver for acute panic episodes from `vision/` |
| `POST` | `/api/anomaly` | General/legacy biometric anomaly webhook |
| `POST` | `/events` | Event webhook matching contract specification |
| `GET` | `/events` | Returns recent in-memory event history (up to 50 events) |
| `GET` | `/health` | Server liveness check (`{"status": "ok"}`) |
| `GET` | `/dashboard` | Interactive HTML dashboard for monitoring and manual simulation |

---

## Live Dashboard

The backend includes a lightweight real-time dashboard accessible in your web browser:

👉 **[http://localhost:8000/dashboard](http://localhost:8000/dashboard)**

Features:
- **Live Event Feed:** Automatically polls `/events` every 2 seconds to display timestamp, event type, trigger source, heart rate, respiration, and hardware intervention status.
- **Manual Trigger Button:** Click **"Trigger Test Panic Webhook"** during hackathon judging or testing to fire a synthetic panic event directly without needing the webcam running.

---

## Setup Instructions

### 1. Prerequisites
- **Python**: Version 3.10 or higher.
- **Virtual Environment**: Recommended to use a dedicated venv.

### 2. Environment Variables
Create or edit `.env` in the repository root or in this `backend/` directory:

```plaintext
# Port the FastAPI backend listens on (default: 8000)
PORT=8000

# URL to trigger the FREE-WILi hardware device (optional / leave blank if unattached)
HARDWARE_IP_URL=
```

### 3. Installation
Activate your virtual environment and install the dependencies:

```bash
# From the repository root (or inside backend/)
pip install -r backend/requirements.txt
```

### 4. Running the Server

Start the FastAPI application using `uvicorn`:

```bash
# Option A: From inside the backend/ directory
cd backend
uvicorn main:app --port 8000 --reload

# Option B: Directly with python
python main.py
```

The server will start on `http://127.0.0.1:8000`.

---

## Running Tests

Automated test suites verify endpoint handling, payload validation, hardware failure isolation, and live end-to-end integration with the Node.js vision trigger.

Make sure your virtual environment is activated before running pytest:

**If you are in the project root directory:**
```bash
source backend/.venv/bin/activate
pytest
```
*Or run directly without activating:*
```bash
./backend/.venv/bin/pytest
```

**If you are inside the `backend/` directory:**
```bash
source .venv/bin/activate
pytest
```
*Or run directly without activating:*
```bash
.venv/bin/pytest
```

---

## Troubleshooting

### Error: `Address already in use` (Port 8000)
**Cause:** Another process or previous server instance is already running on port 8000.  
**Fix:** Find and terminate the process or change the port:
```bash
# Free port 8000 on Linux/macOS
fuser -k 8000/tcp
```
Or start on another port:
```bash
uvicorn main:app --port 8001
```
*(Remember to update `BACKEND_URL` in `vision/.env` if you change the port).*

### Error: `Could not reach FREE-WILi board` in console
**Cause:** The hardware URL is either unreachable or the board is not plugged in.  
**Fix:** This is non-blocking. The backend is designed with failure isolation so hardware timeouts do not crash or stall the server. To silence it, leave `HARDWARE_IP_URL` blank in `.env`.

### Issue: Vision Webhook returns 422 Unprocessable Entity
**Cause:** Missing required field `heart_rate` in the JSON request body.  
**Fix:** Verify that the incoming JSON payload contains `{"heart_rate": <number>}`.

### Error: `ModuleNotFoundError: No module named 'fastapi'` when running pytest
**Cause:** Your shell is running the system's global `/usr/bin/pytest` instead of the project's virtual environment (`backend/.venv`) where packages were installed.  
**Fix:**
If you are in the project root:
```bash
source backend/.venv/bin/activate
pytest
```
If you are inside `backend/`:
```bash
source .venv/bin/activate
pytest
```
Or run directly via path without activating:
```bash
./backend/.venv/bin/pytest
```
