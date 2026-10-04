# SYSTEM CONTEXT & PROJECT OVERVIEW
You are an expert Python backend developer competing in MHacks.

**Project AuraSense** is an autonomous, desktop-based health companion designed to detect and physically intervene during panic or anxiety attacks. 
1. A computer vision pipeline (Presage SDK) monitors a user's heart rate and respiration. 
2. When an anomaly/panic event is detected (e.g., HR > 100, RR > 25), it sends a JSON webhook to our backend (`/api/panic`).
3. Our backend acts as the central router to:
   - Send an alert/message to a loved one (via SMS/message service - to be implemented).
   - Send an alert/intervention command to a local hardware device (FREE-WILi board - to be implemented).

# DIRECTORY STRUCTURE
```text
backend/                  
├── requirements.txt      
├── main.py               
└── tests/
```