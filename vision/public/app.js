const els = {
  video: document.getElementById('camera-feed'),
  overlay: document.getElementById('camera-overlay'),
  cameraSection: document.getElementById('camera-section'),
  btnToggle: document.getElementById('btn-toggle'),
  statusBadge: document.getElementById('status-badge'),
  valHr: document.getElementById('val-hr'),
  valRr: document.getElementById('val-rr'),
  log: document.getElementById('event-log')
};

// Windows releases the webcam asynchronously after track.stop(). Starting the
// SDK before then fails with 0xC00D3704 (camera busy).
const CAMERA_RELEASE_MS = 700;

let es = null;
let browserStream = null;
let previewPromise = null; // in-flight getUserMedia, so overlapping calls share it
let visionActive = false;
let starting = false; // between clicking Start and the server confirming
let busy = false; // a Start/Stop request is in flight

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logMsg(msg) {
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  els.log.prepend(div);
  if (els.log.children.length > 40) els.log.lastChild.remove();
}

function setStatus(state) {
  els.statusBadge.className = 'badge';
  if (state === 'on') els.statusBadge.classList.add('on');
  if (state === 'triggered') els.statusBadge.classList.add('triggered');
  els.statusBadge.textContent = state === 'triggered' ? 'TRIGGERED' : state.toUpperCase();
}

function setButton(active) {
  els.btnToggle.textContent = active ? 'Stop Vision' : 'Start Vision';
  els.btnToggle.className = active ? 'btn-active' : 'btn-primary';
}

function showOverlay(text) {
  els.overlay.querySelector('span').textContent = text;
  els.overlay.classList.remove('hidden');
}

function hideOverlay() {
  els.overlay.classList.add('hidden');
}

function clearVitals() {
  els.valHr.textContent = '--';
  els.valRr.textContent = '--';
  els.valHr.classList.add('blank');
  els.valRr.classList.add('blank');
}

function showVitals(d) {
  const hr = d.rawHr;
  const rr = d.rawRr;
  if (hr != null) {
    els.valHr.textContent = Math.round(hr);
    els.valHr.classList.remove('blank');
  }
  if (rr != null) {
    els.valRr.textContent = Math.round(rr * 10) / 10;
    els.valRr.classList.remove('blank');
  }
}

function previewAllowed() {
  return !visionActive && !starting;
}

async function acquireCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        advanced: [
          { exposureMode: 'continuous' },
          { whiteBalanceMode: 'continuous' }
        ]
      }
    });
  } catch (e) {
    return await navigator.mediaDevices.getUserMedia({ video: true });
  }
}

// Idempotent: never holds more than one browser stream on the camera.
function startBrowserPreview() {
  if (browserStream || !previewAllowed()) return Promise.resolve();
  if (previewPromise) return previewPromise;

  previewPromise = (async () => {
    try {
      const stream = await acquireCamera();
      // Vision may have started while getUserMedia was pending; hand the
      // camera straight back instead of leaking the stream.
      if (!previewAllowed() || browserStream) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      browserStream = stream;
      els.video.srcObject = stream;
      hideOverlay();
      logMsg('Camera preview on');
    } catch (e) {
      showOverlay('Camera unavailable');
      logMsg('Preview failed: ' + e.message);
    } finally {
      previewPromise = null;
    }
  })();
  return previewPromise;
}

function stopBrowserPreview() {
  if (!browserStream) return;
  browserStream.getTracks().forEach((t) => t.stop());
  browserStream = null;
  els.video.srcObject = null;
  logMsg('Camera preview off');
}

function handleStopped() {
  visionActive = false;
  setStatus('off');
  setButton(false);
  clearVitals();
  // startBrowserPreview(); // TEMP: camera preview disabled
}

function connectSSE() {
  if (es) es.close();
  es = new EventSource('/api/stream');

  es.onopen = () => {
    logMsg('Connected to stream');
  };

  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'metrics') {
        if (visionActive) showVitals(msg.data);
      } else if (msg.type === 'started') {
        visionActive = true;
        setStatus('on');
        setButton(true);
        logMsg('Vision ON');
      } else if (msg.type === 'stopped') {
        // Fires for user stops and for the server giving up after a camera
        // failure. This is the only place the preview restarts after Stop.
        logMsg('Vision OFF');
        handleStopped();
      } else if (msg.type === 'error') {
        logMsg('SDK error: ' + JSON.stringify(msg.data));
      }
    } catch (_) { /* ignore */ }
  };

  es.onerror = () => {
    logMsg('Stream disconnected');
  };
}

// Keeps the badge and button in sync with the server. Never touches the
// camera: opening it from a timer is what raced the SDK for the webcam.
async function fetchStatus() {
  if (busy) return;
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (busy) return;
    visionActive = data.active;
    setStatus(data.active ? 'on' : 'off');
    setButton(data.active);
    if (!data.active) clearVitals();
  } catch (e) {
    setStatus('off');
  }
}

async function visionOn() {
  busy = true;
  starting = true;
  els.btnToggle.disabled = true;
  try {
    // Let any in-flight preview open finish (it closes itself since
    // starting is set), then release the camera and give Windows time.
    if (previewPromise) await previewPromise;
    stopBrowserPreview();
    await sleep(CAMERA_RELEASE_MS);

    const res = await fetch('/api/control/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown');
    visionActive = true;
    setStatus('on');
    setButton(true);
    logMsg('Vision started');
  } catch (e) {
    logMsg('Start failed: ' + e.message);
    starting = false;
    handleStopped();
  } finally {
    starting = false;
    busy = false;
    els.btnToggle.disabled = false;
  }
}

async function visionOff() {
  busy = true;
  els.btnToggle.disabled = true;
  try {
    const res = await fetch('/api/control/stop', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    logMsg('Vision stopped');
    // Covers the case where the SSE 'stopped' event was missed; a no-op if
    // it already restarted the preview.
    handleStopped();
  } catch (e) {
    logMsg('Stop failed: ' + e.message);
  } finally {
    busy = false;
    els.btnToggle.disabled = false;
  }
}

els.btnToggle.addEventListener('click', () => {
  if (visionActive) visionOff();
  else visionOn();
});

(async () => {
  clearVitals();
  connectSSE();
  await fetchStatus();
  // if (!visionActive) startBrowserPreview(); // TEMP: camera preview disabled
  setInterval(fetchStatus, 3000);
})();
