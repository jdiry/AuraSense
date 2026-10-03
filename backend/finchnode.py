"""
finchnode.py
Healthcare / FHIR integration module for Aegis.

Exposes a single helper, `log_health_anomaly`, which builds a minimal but
valid FHIR Observation resource from the supplied heart rate and stress score,
then POSTs it to the configured FinchNode API endpoint.
"""

import os
from datetime import datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv

# Load environment variables from a .env file if one exists.
load_dotenv()

FINCHNODE_API_URL = os.getenv(
    "FINCHNODE_API_URL", "https://api.finchnode.com/v1/Observation"
)


def _build_fhir_observation(heart_rate: int, stress_score: int) -> dict[str, Any]:
    """Construct a FHIR R4 Observation resource with the vital-sign data."""
    now = datetime.now(timezone.utc).isoformat()

    return {
        "resourceType": "Observation",
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "vital-signs",
                        "display": "Vital Signs",
                    }
                ],
                "text": "Vital Signs",
            }
        ],
        "code": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": "8867-4",
                    "display": "Heart rate",
                }
            ],
            "text": "Heart rate and stress observation",
        },
        "effectiveDateTime": now,
        "component": [
            {
                "code": {
                    "coding": [
                        {
                            "system": "http://loinc.org",
                            "code": "8867-4",
                            "display": "Heart rate",
                        }
                    ],
                    "text": "Heart rate",
                },
                "valueQuantity": {
                    "value": heart_rate,
                    "unit": "beats/minute",
                    "system": "http://unitsofmeasure.org",
                    "code": "/min",
                },
            },
            {
                "code": {
                    "text": "Stress score",
                },
                "valueQuantity": {
                    "value": stress_score,
                    "unit": "score",
                    "system": "http://unitsofmeasure.org",
                    "code": "1",
                },
            },
        ],
    }


def log_health_anomaly(heart_rate: int, stress_score: int) -> None:
    """
    Forward a health anomaly to the synthetic medical record via FinchNode.

    The function is intentionally fire-and-forget: any network or API failure
    is caught and logged so the main routing backend remains stable.
    """
    payload = _build_fhir_observation(heart_rate, stress_score)

    try:
        response = requests.post(
            FINCHNODE_API_URL,
            json=payload,
            timeout=5,
            headers={"Content-Type": "application/fhir+json"},
        )
        response.raise_for_status()
        print(f"[FinchNode] Logged anomaly: {response.status_code}")
    except requests.exceptions.RequestException as exc:
        # Do not propagate the error; the backend must survive an external API outage.
        print(f"[FinchNode] Failed to log anomaly: {exc}")
