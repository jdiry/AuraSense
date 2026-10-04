import 'dotenv/config'
import { 
  SmartSpectraSDK, 
  CameraSelection, 
  breathingMetrics, 
  cardioMetrics, 
  decodeMetrics 
} from '@smartspectra/node-sdk';
import { VitalsTrigger } from './utils/trigger.js';

// Replace with your API key from physiology.presagetech.com
const API_KEY = process.env.PRESAGE_API_KEY;

if (!API_KEY) {
    console.error("ERROR: PRESAGE_API_KEY is missing from the .env file.");
    process.exit(1);
}

const FASTAPI_URL = process.env.FASTAPI_URL || 
  (process.env.BACKEND_URL 
    ? `${process.env.BACKEND_URL.replace(/\/$/, '')}/api/panic` 
    : 'http://127.0.0.1:8000/api/panic');

const triggerManager = new VitalsTrigger({
  bufferSize: 5,
  hrThreshold: 60,
  rrThreshold: 25,
  cooldownMs: 10000,
  webhookUrl: FASTAPI_URL
});

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
  let rawHr = null;
  let rawRr = null;
  
  // 1. Extract Heart Rate
  if (decoded?.cardio?.pulseRate?.length > 0) {
    rawHr = decoded.cardio.pulseRate[0].value;
  }
  
  // 2. Extract Respiration Rate
  if (decoded?.breathing?.rate?.length > 0) {
    rawRr = decoded.breathing.rate[0].value;
  }

  const result = await triggerManager.checkAndDispatch({
    heartRate: rawHr,
    respirationRate: rawRr
  });

  if (rawHr || rawRr) {
    const hrBuf = triggerManager.hrSmoother.data.length;
    const rrBuf = triggerManager.rrSmoother.data.length;
    const needed = triggerManager.bufferSize;
    console.log(
      `[DEBUG] RAW HR: ${rawHr ?? 'n/a'} | RAW RR: ${rawRr ?? 'n/a'} ` +
      `| Smoothed HR: ${result.smoothedHr} | Smoothed RR: ${result.smoothedRr} ` +
      `| HR buffer: ${hrBuf}/${needed} | RR buffer: ${rrBuf}/${needed} ` +
      `| Threshold HR>${triggerManager.hrThreshold} RR>${triggerManager.rrThreshold} ` +
      `| Result: ${result.triggered ? '🚨 TRIGGERED' : result.reason}`
    );
  }

  if (result.triggered) {
    console.log(`\nPANIC DETECTED! (HR: ${result.payload.heart_rate}, RR: ${result.payload.respiration}) FIRING WEBHOOK...`);
    if (result.delivered) {
      console.log("Webhook delivered successfully!", result.response);
    } else {
      console.log(`Backend rejected webhook: ${result.status || result.error}`);
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