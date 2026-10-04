import requests
import logging
import os

MESSAGING_SERVICE_URL = os.getenv("MESSAGING_SERVICE_URL", "http://localhost:3001/api/alert")

def dispatch_guardian_alert(patient_name: str, vital: str, value: float, threshold: float, notes: str = "") -> bool:
    """
    Triggers the Node/Bun messaging agent to send an iMessage to the guardian.
    """
    payload = {
        "patientName": patient_name,
        "vital": vital,
        "value": value,
        "threshold": threshold,
        "notes": notes
    }

    try:
        response = requests.post(MESSAGING_SERVICE_URL, json=payload, timeout=5)
        response.raise_for_status()
        logging.info(f"Guardian alert successfully dispatched for {vital} ({value}).")
        return True

    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to dispatch guardian alert to messaging service: {e}")
        return False