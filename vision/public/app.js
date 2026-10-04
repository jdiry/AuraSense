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

let es = null;
let browserStream = null;
let visionActive = false;

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

async function startBrowserPreview() {
  try {
    const constraints = {
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        advanced: [
          { exposureMode: 'continuous' },
          { whiteBalanceMode: 'continuous' }
        ]
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    browserStream = stream;
    els.video.srcObject = stream;
    hideOverlay();
    logMsg('Camera preview on');
  } catch (e) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      browserStream = stream;
      els.video.srcObject = stream;
      hideOverlay();
      logMsg('Camera preview on (basic)');
    } catch (e2) {
      showOverlay('Camera unavailable');
      logMsg('Preview failed: ' + e2.message);
    }
  }
}

function stopBrowserPreview() {
  if (!browserStream) return;
  browserStream.getTracks().forEach((t) => t.stop());
  browserStream = null;
  els.video.srcObject = null;
  logMsg('Camera preview off');
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
        logMsg('Vision ON');
      } else if (msg.type === 'stopped') {
        visionActive = false;
        setStatus('off');
        clearVitals();
        logMsg('Vision OFF');
        startBrowserPreview();
      } else if (msg.type === 'error') {
        logMsg('SDK error: ' + JSON.stringify(msg.data));
      }
    } catch (_) { /* ignore */ }
  };

  es.onerror = () => {
    logMsg('Stream disconnected');
  };
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    visionActive = data.active;
    if (data.active) {
      setStatus('on');
      stopBrowserPreview();
    } else {
      setStatus('off');
      clearVitals();
      if (!browserStream) startBrowserPreview();
    }
  } catch (e) {
    setStatus('off');
  }
}

async function visionOn() {
  els.btnToggle.disabled = true;
  stopBrowserPreview();
  try {
    const res = await fetch('/api/control/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown');
    visionActive = true;
    setStatus('on');
    els.btnToggle.textContent = 'Stop Vision';
    els.btnToggle.className = 'btn-active';
    logMsg('Vision started');
  } catch (e) {
    logMsg('Start failed: ' + e.message);
    visionActive = false;
    setStatus('off');
    clearVitals();
    startBrowserPreview();
  }
  els.btnToggle.disabled = false;
}

async function visionOff() {
  els.btnToggle.disabled = true;
  try {
    await fetch('/api/control/stop', { method: 'POST' });
    visionActive = false;
    setStatus('off');
    clearVitals();
    els.btnToggle.textContent = 'Start Vision';
    els.btnToggle.className = 'btn-primary';
    logMsg('Vision stopped');
    await startBrowserPreview();
  } catch (e) {
    logMsg('Stop failed: ' + e.message);
  }
  els.btnToggle.disabled = false;
}

els.btnToggle.addEventListener('click', () => {
  if (visionActive) visionOff();
  else visionOn();
});

(async () => {
  clearVitals();
  connectSSE();
  await fetchStatus();
  setInterval(fetchStatus, 3000);
})();
