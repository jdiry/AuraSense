# SYSTEM CONTEXT & PROJECT OVERVIEW
You are an expert Python backend developer competing in MHacks. We have 24-48 hours to complete a working prototype for a project called "Aegis" (targeting hardware, healthcare, and AI tracks).

**Project Aegis** is an autonomous, desktop-based health companion designed to detect and physically intervene during panic or anxiety attacks. 
1. A separate Data Science script uses computer vision (Presage SDK) to monitor a user's heart rate and stress. 
2. When an anomaly is detected (e.g., HR > 110, Stress > 80), it sends a JSON webhook to our backend.
3. Our backend (which you will build) acts as the central router. It must immediately:
   - Forward the health event to a synthetic medical record via the FinchNode API using FHIR standards.
   - Send an HTTP request to wake up a local hardware device (FREE-WILi board) which will execute a physical intervention (lights, breathing UI).

**Note:** The voice/audio AI integration (`comms.py`) has been rescoped and is NOT required for this sprint.

# DIRECTORY STRUCTURE
We are working exclusively within the `backend/` directory. 
```text
backend/                  
├── requirements.txt      
├── main.py               
└── finchnode.py          
```

# YOUR TASK
Please generate the complete, production-ready code for the following three files. Ensure the code is robust, uses async best practices (to avoid blocking the hackathon demo), and includes helpful inline comments.

### 1. `requirements.txt`
Generate a standard requirements file containing the following dependencies:
- `fastapi`
- `uvicorn`
- `requests`
- `pydantic`
- `python-dotenv` (for API keys/IP addresses)

### 2. `finchnode.py`
This module handles our Healthcare (FHIR) integration.
- Create a function `log_health_anomaly(heart_rate: int, stress_score: int)`.
- Inside the function, construct a valid FHIR "Observation" JSON resource payload containing the heart rate and stress score. 
- Use the `requests` library to send a POST request to a placeholder FinchNode API URL (e.g., loaded from an environment variable `FINCHNODE_API_URL`, defaulting to `https://api.finchnode.com/v1/Observation`).
- Include basic error handling (try/except) so that if the external API fails, it doesn't crash our backend router.

### 3. `main.py`
This is the core FastAPI server and routing hub.
- Initialize the FastAPI app.
- Define a Pydantic model `AnomalyPayload` that expects `heart_rate` (int) and `stress_score` (int).
- Create a POST endpoint `/api/anomaly`.
- When `/api/anomaly` receives a payload, it must asynchronously perform two tasks:
  1. Call `log_health_anomaly` from `finchnode.py` to log the data. (Use `FastAPI`'s `BackgroundTasks` to do this so it doesn't block the hardware response).
  2. Send a quick HTTP GET or POST request to the FREE-WILi hardware board (URL loaded from `HARDWARE_IP_URL`, defaulting to `http://192.168.1.100/trigger`) to wake up the physical device.
- Return a simple `{"status": "success", "message": "Intervention triggered"}` response to the Vision script.

Please provide the raw code for these three files.