import time
import requests
import sys

def run_live_test():
    print("======================================================")
    print("    AuraSense Live E2E Webhook Test")
    print("======================================================")
    print("This test will monitor your running backend to verify")
    print("that it successfully receives a webhook from the vision app.\n")
    
    backend_url = "http://127.0.0.1:8000/events"
    
    print(f"1. Checking if the backend is running at {backend_url}...")
    try:
        response = requests.get(backend_url)
        response.raise_for_status()
        baseline_events = len(response.json())
        print(f"   [OK] Backend is reachable. Currently has {baseline_events} events logged.")
    except Exception as e:
        print(f"\n[ERROR] Could not connect to the backend.")
        print("Please make sure you have started the backend in another terminal:")
        print("   cd backend && source .venv/bin/activate && uvicorn main:app --reload")
        sys.exit(1)

    print("\n2. Now, go ahead and trigger the Vision app!")
    print("   Run the vision app in another terminal (npm start in the vision folder).")
    print("   Wait for it to detect a high heart rate/respiration and fire the webhook.")
    print("   (Or you can use the 'Trigger Test Panic Webhook' button on http://localhost:8000/dashboard)")
    
    print("\nPolling backend for new events (Press Ctrl+C to cancel)...")
    
    timeout_seconds = 300 # Wait up to 5 minutes
    start_time = time.time()
    
    while time.time() - start_time < timeout_seconds:
        try:
            response = requests.get(backend_url)
            if response.status_code == 200:
                current_events = response.json()
                if len(current_events) > baseline_events:
                    latest_event = current_events[-1]
                    print("\n\n🎉 [PASS] LIVE WEBHOOK RECEIVED SUCCESSFULLY! 🎉")
                    print("The backend successfully caught the information from the vision app.")
                    print("-" * 40)
                    print("Event Details:")
                    print(f"  ID: {latest_event.get('id')}")
                    print(f"  Event Type: {latest_event.get('event')}")
                    print(f"  Trigger Source: {latest_event.get('trigger_source')}")
                    print(f"  Heart Rate: {latest_event.get('heart_rate')} BPM")
                    print(f"  Respiration: {latest_event.get('respiration')} breaths/min")
                    print(f"  Time: {latest_event.get('timestamp')}")
                    print("-" * 40)
                    sys.exit(0)
        except Exception:
            pass # Ignore connection blips while polling
            
        time.sleep(2)
        print(".", end="", flush=True)

    print("\n\n[FAIL] Test timed out after 5 minutes waiting for a webhook.")
    sys.exit(1)

if __name__ == "__main__":
    run_live_test()
