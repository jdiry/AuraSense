import 'dotenv/config'
import { 
  SmartSpectraSDK, 
  CameraSelection, 
  breathingMetrics, 
  cardioMetrics, 
  decodeMetrics 
} from '@smartspectra/node-sdk';
import { DataSmoother } from './utils/smoothing.js';

// Replace with your API key from physiology.presagetech.com
const API_KEY = process.env.PRESAGE_API_KEY;

if (!API_KEY) {
    console.error("ERROR: PRESAGE_API_KEY is missing from the .env file.");
    process.exit(1);
}

const FASTAPI_URL = 'http://127.0.0.1:800/api/panic'; // The CS 2 local server

// Initialize smoothers
const hrSmoother = new DataSmoother(5);
const rrSmoother = new DataSmoother(5);

// Cooldown timer so we don't spam backend
let lastTriggerTime = 0;
const COOLDOWN_MS = 10000; // 10 seconds

const sdk = new SmartSpectraSDK({
  apiKey: API_KEY,
  requestedMetrics: [...breathingMetrics, ...cardioMetrics],
});

// 1. Status Listeners
sdk.on('processingStatus', (status) => {
  console.log('[Presage] Processing status:', status);
});

sdk.on('validationStatus', (code, ts, hint) => {
    console.log('Validation:', code, hint, 'at', ts, 'µs');
});

// 2. Metrics Decoding Loop
sdk.on('metrics', async (buf, ts) => {
  const decoded = decodeMetrics(buf);
  let smoothedHr = 0;
  let smoothedRr = 0;
  
  // 1. Extract and Smooth Heart Rate
  if (decoded?.cardio?.pulseRate?.length > 0) {
    const rawHr = decoded.cardio.pulseRate[0].value;
    if (rawHr) {
      hrSmoother.add(rawHr);
      smoothedHr = Math.round(hrSmoother.getAverage());
      console.log(`HR: ${smoothedHr} BPM (RAW HR: ${rawHr})`);
    }
  }
  
  // 2. Extract and Smooth Respiration Rate
  if (decoded?.breathing?.rate?.length > 0) {
    const rawRr = decoded.breathing.rate[0].value;
    if (rawRr) {
      rrSmoother.add(rawRr);
      smoothedRr = Math.round(rrSmoother.getAverage());
      console.log(`RR: ${smoothedRr} breaths/min (RAW RR: ${rawRr})`);
    }
  }

  // 3. The OR Trigger Logic
  const now = Date.now();
  const isHrSpiking = hrSmoother.isReady() && smoothedHr > 100;
  const isRrSpiking = rrSmoother.isReady() && smoothedRr > 25; // 25+ is hyperventilation

  // If EITHER metric spikes, fire the webhook
  if ((isHrSpiking || isRrSpiking) && (now - lastTriggerTime > COOLDOWN_MS)) {
    console.log(`\nPANIC DETECTED! (HR: ${smoothedHr}, RR: ${smoothedRr}) FIRING WEBHOOK...`);
    lastTriggerTime = now;
    
    try {
      const response = await fetch(FASTAPI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: "panic_attack",
          trigger_source: isHrSpiking ? "heart_rate" : "respiration",
          heart_rate: smoothedHr,
          respiration: smoothedRr,
          timestamp: new Date().toISOString()
        })
      });
      
      if (response.ok) {
        console.log("Webhook delivered successfully!");
      } else {
        console.log(`Backend rejected webhook: ${response.status}`);
      }
    } catch (err) {
      console.log("Could not reach FastAPI backend. Is the Python server running?");
    }
  }
});

// 3. Error Handling
sdk.on('error', (code, message, retryable) => {
  console.error('[Presage Error]', code, message, 'Retryable:', retryable);
});

const cameras = SmartSpectraSDK.availableCameras();
if (cameras.length > 0) {
  sdk.useCamera(CameraSelection.byId(cameras[0].id), { width: 1280, height: 720 });
}

console.log('Vailable Cameras', cameras);

// 4. Attach Default Camera & Start
console.log('Starting headless camera capture...');
sdk.useCamera(CameraSelection.default);
sdk.start();

console.log('Aura Sense Vision Monitor active. Press Ctrl+C to stop.');

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down camera feed...');
  await sdk.stopAsync();
  await sdk.destroy();
  process.exit(0);
});