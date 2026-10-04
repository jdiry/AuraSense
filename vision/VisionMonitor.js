import 'dotenv/config';
import { EventEmitter } from 'events';
import {
  SmartSpectraSDK,
  CameraSelection,
  breathingMetrics,
  cardioMetrics,
  decodeMetrics
} from '@smartspectra/node-sdk';
import { VitalsTrigger } from './utils/trigger.js';

const API_KEY = process.env.PRESAGE_API_KEY;
const FASTAPI_URL =
  process.env.FASTAPI_URL ||
  (process.env.BACKEND_URL
    ? `${process.env.BACKEND_URL.replace(/\/$/, '')}/api/panic`
    : 'http://127.0.0.1:8000/api/panic');

export class VisionMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.bufferSize = options.bufferSize ?? 5;
    this.hrThreshold = options.hrThreshold ?? 60;
    this.rrThreshold = options.rrThreshold ?? 25;
    this.cooldownMs = options.cooldownMs ?? 10000;
    this.webhookUrl = options.webhookUrl ?? FASTAPI_URL;

    this.sdk = null;
    this.active = false;
    this.cameraId = null;
    this.cameraLabel = null;

    this.triggerManager = new VitalsTrigger({
      bufferSize: this.bufferSize,
      hrThreshold: this.hrThreshold,
      rrThreshold: this.rrThreshold,
      cooldownMs: this.cooldownMs,
      webhookUrl: this.webhookUrl
    });
  }

  async start(cameraId = null) {
    if (this.sdk) {
      throw new Error('Monitor already active.');
    }
    if (!API_KEY) {
      throw new Error('PRESAGE_API_KEY missing from .env');
    }

    this.sdk = new SmartSpectraSDK({
      apiKey: API_KEY,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics]
    });

    // Event handlers BEFORE useCamera() + start() — same as working monitor.js
    this.sdk.on('processingStatus', (status) => {
      this.emit('processingStatus', status);
    });

    this.sdk.on('validationStatus', (code, ts, hint) => {
      if (code !== 0) {
        console.log(`[Validation] code=${code} hint="${hint}"`);
      }
      this.emit('validationStatus', { code, ts, hint });
    });

    this.sdk.on('metrics', async (buf, ts) => {
      const decoded = decodeMetrics(buf);
      let rawHr = null;
      let rawRr = null;

      if (decoded?.cardio?.pulseRate?.length > 0) {
        rawHr = decoded.cardio.pulseRate[0].value;
      }
      if (decoded?.breathing?.rate?.length > 0) {
        rawRr = decoded.breathing.rate[0].value;
      }

      const result = await this.triggerManager.checkAndDispatch({
        heartRate: rawHr,
        respirationRate: rawRr
      });

      const hrBuf = this.triggerManager.hrSmoother.data.length;
      const rrBuf = this.triggerManager.rrSmoother.data.length;
      const needed = this.triggerManager.bufferSize;

      const smoothedHr =
        result.smoothedHr ??
        Math.round(this.triggerManager.hrSmoother.getAverage());
      const smoothedRr =
        result.smoothedRr ??
        Math.round(this.triggerManager.rrSmoother.getAverage());

      const payload = {
        rawHr,
        rawRr,
        smoothedHr,
        smoothedRr,
        hrBuffer: hrBuf,
        rrBuffer: rrBuf,
        needed,
        triggered: result.triggered,
        reason: result.reason,
        timestamp: Date.now()
      };

      this.emit('metrics', payload);

      if (rawHr || rawRr) {
        console.log(
          `[DEBUG] RAW HR: ${rawHr ?? 'n/a'} | RAW RR: ${rawRr ?? 'n/a'} ` +
            `| Result: ${result.triggered ? '🚨 TRIGGERED' : result.reason}`
        );
      }
      if (result.triggered) {
        console.log(`PANIC DETECTED! FIRING WEBHOOK...`);
      }
    });

    this.sdk.on('error', (code, message, retryable) => {
      console.error('[Presage Error]', code, message, 'Retryable:', retryable);
      this.emit('error', { code, message, retryable });
    });

    const cameras = SmartSpectraSDK.availableCameras();
    if (cameras.length === 0) {
      throw new Error('No cameras available.');
    }

    const selectedCamera = cameraId
      ? cameras.find((c) => c.id === cameraId || c.deviceId === cameraId)
      : cameras[0];

    this.cameraId = selectedCamera?.id || selectedCamera?.deviceId;
    this.cameraLabel =
      selectedCamera?.label || selectedCamera?.name || 'Default Camera';

    // CameraSelection.default avoids MediaPipe NORM_RECT errors on Windows.
    this.sdk.useCamera(CameraSelection.default);
    this.sdk.start();

    this.active = true;
    this.emit('started', {
      cameraId: this.cameraId,
      cameraLabel: this.cameraLabel
    });
    return { cameraId: this.cameraId, cameraLabel: this.cameraLabel };
  }

  async stop() {
    if (!this.sdk) return;
    try {
      await this.sdk.stopAsync();
      await this.sdk.destroy();
    } catch (e) {
      console.error('Error stopping SDK:', e);
    }
    this.sdk = null;
    this.active = false;
    this.cameraId = null;
    this.cameraLabel = null;
    this.emit('stopped');
  }

  getStatus() {
    return {
      active: this.active,
      cameraId: this.cameraId,
      cameraLabel: this.cameraLabel
    };
  }
}
