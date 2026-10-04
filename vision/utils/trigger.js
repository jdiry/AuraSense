import { DataSmoother } from './smoothing.js';

export class VitalsTrigger {
  /**
   * @param {Object} options
   * @param {number} [options.bufferSize=5] - Number of readings to smooth over
   * @param {number} [options.hrThreshold=100] - Heart rate threshold in BPM
   * @param {number} [options.rrThreshold=25] - Respiration rate threshold in breaths/min
   * @param {number} [options.cooldownMs=10000] - Minimum cooldown between webhook dispatches in ms
   * @param {string} [options.webhookUrl] - URL for the backend panic endpoint
   */
  constructor(options = {}) {
    this.bufferSize = options.bufferSize ?? 5;
    this.hrThreshold = options.hrThreshold ?? 100;
    this.rrThreshold = options.rrThreshold ?? 25;
    this.cooldownMs = options.cooldownMs ?? 10000;

    const envUrl = process.env.FASTAPI_URL || 
      (process.env.BACKEND_URL 
        ? `${process.env.BACKEND_URL.replace(/\/$/, '')}/api/panic` 
        : null);

    this.webhookUrl = options.webhookUrl || envUrl || 'http://127.0.0.1:8000/api/panic';

    this.hrSmoother = new DataSmoother(this.bufferSize);
    this.rrSmoother = new DataSmoother(this.bufferSize);
    this.lastTriggerTime = 0;
  }

  /**
   * Ingest raw metrics and calculate smoothed averages.
   * @param {Object} vitals
   * @param {number} [vitals.heartRate]
   * @param {number} [vitals.respirationRate]
   * @returns {{ smoothedHr: number, smoothedRr: number, hrReady: boolean, rrReady: boolean }}
   */
  addVitals({ heartRate, respirationRate }) {
    let smoothedHr = 0;
    let smoothedRr = 0;

    if (heartRate != null && !isNaN(heartRate)) {
      this.hrSmoother.add(Number(heartRate));
      smoothedHr = Math.round(this.hrSmoother.getAverage());
    } else if (this.hrSmoother.data.length > 0) {
      smoothedHr = Math.round(this.hrSmoother.getAverage());
    }

    if (respirationRate != null && !isNaN(respirationRate)) {
      this.rrSmoother.add(Number(respirationRate));
      smoothedRr = Math.round(this.rrSmoother.getAverage());
    } else if (this.rrSmoother.data.length > 0) {
      smoothedRr = Math.round(this.rrSmoother.getAverage());
    }

    return {
      smoothedHr,
      smoothedRr,
      hrReady: this.hrSmoother.isReady(),
      rrReady: this.rrSmoother.isReady()
    };
  }

  /**
   * Determine whether current smoothed vitals exceed thresholds and cooldown has elapsed.
   * @param {number} smoothedHr
   * @param {number} smoothedRr
   * @param {number} [now=Date.now()]
   * @returns {{ triggered: boolean, reason?: string, triggerSource?: string, payload?: object }}
   */
  evaluateTrigger(smoothedHr, smoothedRr, now = Date.now()) {
    const isHrSpiking = this.hrSmoother.isReady() && smoothedHr > this.hrThreshold;
    const isRrSpiking = this.rrSmoother.isReady() && smoothedRr > this.rrThreshold;

    if (!isHrSpiking && !isRrSpiking) {
      return { triggered: false, reason: 'below_threshold' };
    }

    if (now - this.lastTriggerTime <= this.cooldownMs) {
      return { triggered: false, reason: 'cooldown_active' };
    }

    const triggerSource = isHrSpiking ? 'heart_rate' : 'respiration';
    const payload = {
      event: 'panic_attack',
      trigger_source: triggerSource,
      heart_rate: smoothedHr,
      respiration: smoothedRr,
      timestamp: new Date(now).toISOString()
    };

    return {
      triggered: true,
      triggerSource,
      smoothedHr,
      smoothedRr,
      payload
    };
  }

  /**
   * Send webhook to FastAPI backend.
   * @param {Object} payload
   * @returns {Promise<Response>}
   */
  async sendWebhook(payload) {
    return await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  /**
   * Process a single reading: update smoothers, evaluate trigger, and dispatch webhook if needed.
   * @param {Object} vitals
   * @param {number} [vitals.heartRate]
   * @param {number} [vitals.respirationRate]
   * @param {number} [vitals.now=Date.now()]
   * @returns {Promise<{ triggered: boolean, delivered?: boolean, status?: number, payload?: object, error?: string, response?: any }>}
   */
  async checkAndDispatch({ heartRate, respirationRate, now = Date.now() }) {
    const { smoothedHr, smoothedRr } = this.addVitals({ heartRate, respirationRate });
    const evalResult = this.evaluateTrigger(smoothedHr, smoothedRr, now);

    if (!evalResult.triggered) {
      return {
        triggered: false,
        reason: evalResult.reason,
        smoothedHr,
        smoothedRr
      };
    }

    this.lastTriggerTime = now;

    try {
      const response = await this.sendWebhook(evalResult.payload);
      const data = await response.json().catch(() => null);

      return {
        triggered: true,
        delivered: response.ok,
        status: response.status,
        payload: evalResult.payload,
        response: data
      };
    } catch (err) {
      return {
        triggered: true,
        delivered: false,
        error: err.message,
        payload: evalResult.payload
      };
    }
  }
}
