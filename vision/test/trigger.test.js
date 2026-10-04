import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DataSmoother } from '../utils/smoothing.js';
import { VitalsTrigger } from '../utils/trigger.js';

describe('DataSmoother', () => {
  it('should return 0 when empty', () => {
    const smoother = new DataSmoother(5);
    assert.strictEqual(smoother.getAverage(), 0);
    assert.strictEqual(smoother.isReady(), false);
  });

  it('should compute running average', () => {
    const smoother = new DataSmoother(3);
    smoother.add(60);
    smoother.add(70);
    assert.strictEqual(smoother.getAverage(), 65);
    assert.strictEqual(smoother.isReady(), false);

    smoother.add(80);
    assert.strictEqual(smoother.getAverage(), 70);
    assert.strictEqual(smoother.isReady(), true);
  });

  it('should drop oldest value once buffer size is exceeded', () => {
    const smoother = new DataSmoother(3);
    smoother.add(60);
    smoother.add(70);
    smoother.add(80); // avg = 70
    smoother.add(90); // 60 dropped, window is [70, 80, 90], avg = 80
    assert.strictEqual(smoother.getAverage(), 80);
    assert.strictEqual(smoother.isReady(), true);
  });
});

describe('VitalsTrigger - Threshold & Trigger Rules', () => {
  it('should not trigger if buffer is not full', () => {
    const trigger = new VitalsTrigger({ bufferSize: 5, hrThreshold: 100, rrThreshold: 25 });
    for (let i = 0; i < 4; i++) {
      const { smoothedHr, smoothedRr } = trigger.addVitals({ heartRate: 130, respirationRate: 16 });
      const evalResult = trigger.evaluateTrigger(smoothedHr, smoothedRr);
      assert.strictEqual(evalResult.triggered, false);
      assert.strictEqual(evalResult.reason, 'below_threshold');
    }
  });

  it('should not trigger for calm normal vitals', () => {
    const trigger = new VitalsTrigger({ bufferSize: 3, hrThreshold: 100, rrThreshold: 25 });
    trigger.addVitals({ heartRate: 72, respirationRate: 14 });
    trigger.addVitals({ heartRate: 74, respirationRate: 15 });
    const { smoothedHr, smoothedRr } = trigger.addVitals({ heartRate: 70, respirationRate: 14 });

    const evalResult = trigger.evaluateTrigger(smoothedHr, smoothedRr);
    assert.strictEqual(evalResult.triggered, false);
    assert.strictEqual(evalResult.reason, 'below_threshold');
  });

  it('should trigger when smoothed heart rate exceeds threshold (HR > 100)', () => {
    const trigger = new VitalsTrigger({ bufferSize: 3, hrThreshold: 100, rrThreshold: 25 });
    trigger.addVitals({ heartRate: 110, respirationRate: 16 });
    trigger.addVitals({ heartRate: 115, respirationRate: 16 });
    const { smoothedHr, smoothedRr } = trigger.addVitals({ heartRate: 120, respirationRate: 16 });

    const evalResult = trigger.evaluateTrigger(smoothedHr, smoothedRr);
    assert.strictEqual(evalResult.triggered, true);
    assert.strictEqual(evalResult.triggerSource, 'heart_rate');
    assert.strictEqual(evalResult.payload.event, 'panic_attack');
    assert.strictEqual(evalResult.payload.trigger_source, 'heart_rate');
    assert.strictEqual(evalResult.payload.heart_rate, 115);
    assert.strictEqual(evalResult.payload.respiration, 16);
    assert.ok(evalResult.payload.timestamp);
  });

  it('should trigger when smoothed respiration rate exceeds threshold (RR > 25)', () => {
    const trigger = new VitalsTrigger({ bufferSize: 3, hrThreshold: 100, rrThreshold: 25 });
    trigger.addVitals({ heartRate: 80, respirationRate: 28 });
    trigger.addVitals({ heartRate: 80, respirationRate: 29 });
    const { smoothedHr, smoothedRr } = trigger.addVitals({ heartRate: 80, respirationRate: 30 });

    const evalResult = trigger.evaluateTrigger(smoothedHr, smoothedRr);
    assert.strictEqual(evalResult.triggered, true);
    assert.strictEqual(evalResult.triggerSource, 'respiration');
    assert.strictEqual(evalResult.payload.event, 'panic_attack');
    assert.strictEqual(evalResult.payload.trigger_source, 'respiration');
    assert.strictEqual(evalResult.payload.heart_rate, 80);
    assert.strictEqual(evalResult.payload.respiration, 29);
  });

  it('should enforce cooldown period between triggers', () => {
    const trigger = new VitalsTrigger({
      bufferSize: 2,
      hrThreshold: 100,
      rrThreshold: 25,
      cooldownMs: 5000
    });

    const t0 = 1000000;
    trigger.addVitals({ heartRate: 120, respirationRate: 20 });
    const { smoothedHr, smoothedRr } = trigger.addVitals({ heartRate: 120, respirationRate: 20 });

    // First trigger fires
    const eval1 = trigger.evaluateTrigger(smoothedHr, smoothedRr, t0);
    assert.strictEqual(eval1.triggered, true);
    trigger.lastTriggerTime = t0;

    // Immediate second evaluation during cooldown must NOT trigger
    const eval2 = trigger.evaluateTrigger(smoothedHr, smoothedRr, t0 + 2000);
    assert.strictEqual(eval2.triggered, false);
    assert.strictEqual(eval2.reason, 'cooldown_active');

    // After cooldown has passed (5001ms later), should trigger again
    const eval3 = trigger.evaluateTrigger(smoothedHr, smoothedRr, t0 + 5001);
    assert.strictEqual(eval3.triggered, true);
  });
});

describe('VitalsTrigger - Webhook Dispatch Integration', () => {
  it('should send HTTP POST webhook with correct payload and headers', async () => {
    let receivedPayload = null;
    let receivedHeaders = null;

    // Create an ephemeral HTTP server to act as the backend
    const server = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        receivedPayload = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'Intervention triggered' }));
      });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const webhookUrl = `http://127.0.0.1:${port}/api/panic`;

    try {
      const trigger = new VitalsTrigger({
        bufferSize: 2,
        hrThreshold: 100,
        rrThreshold: 25,
        webhookUrl
      });

      trigger.addVitals({ heartRate: 125, respirationRate: 18 });
      const result = await trigger.checkAndDispatch({
        heartRate: 125,
        respirationRate: 18
      });

      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.delivered, true);
      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(result.response, { status: 'success', message: 'Intervention triggered' });

      // Verify what the mock server received
      assert.strictEqual(receivedHeaders['content-type'], 'application/json');
      assert.strictEqual(receivedPayload.event, 'panic_attack');
      assert.strictEqual(receivedPayload.trigger_source, 'heart_rate');
      assert.strictEqual(receivedPayload.heart_rate, 125);
      assert.strictEqual(receivedPayload.respiration, 18);
      assert.ok(receivedPayload.timestamp);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
