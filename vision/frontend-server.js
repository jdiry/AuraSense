import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { SmartSpectraSDK } from '@smartspectra/node-sdk';
import { VisionMonitor } from './VisionMonitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const monitor = new VisionMonitor();
const SSE_CLIENTS = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of SSE_CLIENTS) {
    res.write(msg);
  }
}

monitor.on('metrics', (d) => broadcast({ type: 'metrics', data: d }));
monitor.on('started', (info) => broadcast({ type: 'started', data: info }));
monitor.on('stopped', () => broadcast({ type: 'stopped', data: {} }));
monitor.on('error', (err) => broadcast({ type: 'error', data: err }));

// ------------------------------------------------------------------
// API
// ------------------------------------------------------------------

app.get('/api/cameras', (req, res) => {
  try {
    const cameras = SmartSpectraSDK.availableCameras();
    res.json({ cameras });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json(monitor.getStatus());
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  SSE_CLIENTS.add(res);

  res.write(
    `data: ${JSON.stringify({ type: 'connected', data: monitor.getStatus() })}\n\n`
  );

  req.on('close', () => SSE_CLIENTS.delete(res));
});

app.post('/api/control/start', async (req, res) => {
  try {
    const { cameraId } = req.body || {};
    const info = await monitor.start(cameraId || null);
    res.json({ status: 'started', ...info });
  } catch (e) {
    console.error('Start error:', e);
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.post('/api/control/stop', async (req, res) => {
  try {
    await monitor.stop();
    res.json({ status: 'stopped' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------

const PORT = process.env.FRONTEND_PORT || 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[AuraSense Frontend] Server running at http://localhost:${PORT}`);
});
