import 'dotenv/config';
import { EventEmitter } from 'events';
import {
  SmartSpectraSDK,
  CameraSelection,
  ProcessingStatus,
  SmartSpectraErrorCode,
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

// A camera failure this soon after start() is usually the camera still being
// released by another stream (Windows 0xC00D3704), so retry once after a pause.
const RETRY_WINDOW_MS = 5000;
const RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    // wanted: the user asked for vision to be on. retried: the one automatic
    // restart has been used. recovering: a teardown/retry is in progress.
    this.wanted = false;
    this.retried = false;
    this.recovering = false;
    this.startedAt = 0;

    this.triggerManager = new VitalsTrigger({
      bufferSize: this.bufferSize,
      hrThreshold: this.hrThreshold,
      rrThreshold: this.rrThreshold,
      cooldownMs: this.cooldownMs,
      webhookUrl: this.webhookUrl
    });
  }

  async start(cameraId = null) {
    if (this.sdk || this.active) {
      throw new Error('Monitor already active.');
    }
    if (!API_KEY) {
      throw new Error('PRESAGE_API_KEY missing from .env');
    }

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

    this.wanted = true;
    this.retried = false;
    this._startSdk();

    this.active = true;
    this.emit('started', {
      cameraId: this.cameraId,
      cameraLabel: this.cameraLabel
    });
    return { cameraId: this.cameraId, cameraLabel: this.cameraLabel };
  }

  _startSdk() {
    const sdk = new SmartSpectraSDK({
      apiKey: API_KEY,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics]
    });
    this.sdk = sdk;

    // Event handlers BEFORE useCamera() + start() — same as working monitor.js
    this.sdk.on('processingStatus', (status) => {
      this.emit('processingStatus', status);
      if (status === ProcessingStatus.kError && this.sdk === sdk) {
        void this._recover(true);
      }
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
      if (this.sdk !== sdk) return;
      if (code === SmartSpectraErrorCode.kInputUnavailable) {
        void this._recover(true);
      } else if (!retryable) {
        void this._recover(false);
      }
    });

    // CameraSelection.default avoids MediaPipe NORM_RECT errors on Windows.
    this.sdk.useCamera(CameraSelection.default);
    this.sdk.start();
    this.startedAt = Date.now();
  }

  // Tear down a failed session so the camera is released and start() works
  // again. Retries once if the failure came right after starting.
  async _recover(allowRetry) {
    if (this.recovering || !this.sdk) return;
    this.recovering = true;
    try {
      const canRetry =
        allowRetry &&
        !this.retried &&
        Date.now() - this.startedAt < RETRY_WINDOW_MS;
      await this._teardown();

      if (canRetry && this.wanted) {
        this.retried = true;
        console.log('[Vision] Camera failed to start; retrying once...');
        await sleep(RETRY_DELAY_MS);
        if (this.wanted) {
          try {
            this._startSdk();
            return;
          } catch (e) {
            console.error('[Vision] Retry failed:', e);
          }
        }
      }

      if (this.active) {
        console.error('[Vision] Session failed; monitor stopped.');
        this._markStopped();
      }
    } finally {
      this.recovering = false;
    }
  }

  async _teardown() {
    const sdk = this.sdk;
    if (!sdk) return;
    this.sdk = null;
    try {
      await sdk.stopAsync();
      await sdk.destroy();
    } catch (e) {
      console.error('Error stopping SDK:', e);
    }
  }

  _markStopped() {
    this.wanted = false;
    this.active = false;
    this.cameraId = null;
    this.cameraLabel = null;
    this.emit('stopped');
  }

  async stop() {
    if (!this.sdk && !this.active) return;
    this.wanted = false;
    await this._teardown();
    if (this.active) this._markStopped();
  }

  getStatus() {
    return {
      active: this.active,
      cameraId: this.cameraId,
      cameraLabel: this.cameraLabel
    };
  }
}
