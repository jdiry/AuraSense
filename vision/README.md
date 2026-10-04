# Aura Sense: Vision Module (Presage SDK)
This module uses the Presage SmartSpectra SDK to headlessly monitor a user's heart rate and respiration using a standard laptop webcam. When biometric anomalies (e.g., panic attacks) are detected, this script fires a webhook to the FastAPI backend to trigger the FREE-WILi hardware intervention.

## Trigger Logic & Smoothing
Raw computer vision data can be noisy. To prevent false alarms, this module uses a DataSmoother (utils/smoothing.js) that calculates a rolling average of the last 5 confident readings.

The webhook triggers based on an OR condition to make live hackathon demos foolproof:

Heart Rate Spikes: Smoothed HR > 100 BPM

Respiration Spikes: Smoothed RR > 25 breaths/min (hyperventilation)

When either threshold is crossed, it sends this JSON payload to [http://127.0.0.1:8000/api/panic](http://127.0.0.1:8000/api/panic):

```JSON
{
  "event": "panic_attack",
  "trigger_source": "respiration", 
  "heart_rate": 82,
  "respiration": 28,
  "timestamp": "2026-10-03T20:15:00.000Z"
}
```
(A 10-second cooldown timer prevents spamming the backend).

⚠️ CRITICAL: The WSL / Linux Trap
Do NOT run this module inside WSL (Windows Subsystem for Linux).

WSL cannot access the physical Windows webcam without complex USB passthrough.

Running npm install inside Ubuntu downloads Linux .so binaries. Windows requires .dll binaries to interact with the camera hardware.

If your project is currently inside WSL, you must copy it to your native Windows C:\ drive before running it. Open Windows PowerShell and run:

```PowerShell
# Copy the project to Windows (skipping any contaminated Linux node_modules)
robocopy "\\wsl.localhost\Ubuntu\home\PROJECT_DIRECTORY" "C:\Users\YOUR_USERNAME\MHacks26\AuraSense\vision" /E /XD node_modules

# Navigate to the new Windows directory
cd C:\Users\YOUR_USERNAME\MHacks26\AuraSense\vision
```
## Setup Instructions
1. Prerequisites

Node.js: Ensure you have Node.js v20 or higher installed natively on Windows.

Terminal: Use PowerShell or Command Prompt (Not Git Bash or WSL).

2. Environment Variables

You need a Presage API key to authenticate the computer vision model.

Create a file named exactly .env in this vision/ directory.

Add your API key (no quotes):

```Plaintext
PRESAGE_API_KEY=your_api_key_here
```
3. Installation

Install the required dependencies (this pulls down the @smartspectra/node-sdk-win32-x64 native runtime for Windows, as well as dotenv for the API key):

```PowerShell
npm install
```

4. Running the Monitor

Ensure your face and chest are well-lit and in frame, then run the headless monitor:

```PowerShell
node monitor.js
```
Note: No video window will pop up. The script runs entirely in the background and logs vitals directly to the terminal after a ~15-second baseline calibration.

## Troubleshooting
Error: Failed to load shared library: The specified module could not be found.

Cause: You ran npm install inside WSL, so Node is trying to run Linux binaries on Windows.

Fix: Delete the node_modules folder and package-lock.json, make sure you are in a native Windows PowerShell terminal, and run npm install again.

Error: Available Cameras [] (Empty Array)

Cause: Windows Privacy Settings are blocking Node from accessing the camera, or another app is using it.

Fix:

Close Discord, Zoom, OBS, or any browser using the webcam.

Go to Windows Settings -> Privacy & security -> Camera.

Ensure "Let desktop apps access your camera" is toggled ON.

Data Output: Validation: 5 Increase light on face. or Validation: 7 Place more of the chest in view.

Fix: The SDK needs perfect lighting to detect microscopic skin color changes (rPPG). Turn on a desk lamp pointing directly at your face. Tilt the screen back so your upper chest is visible for respiration tracking.

Data Output: Heart Rate or Breathing rate: [] is empty

Fix: The AI model requires a stable 10-15 second buffer to calculate frequency. Hold perfectly still and wait for the buffer to fill.