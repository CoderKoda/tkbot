const screens = {
  entry: document.getElementById('screen-entry'),
  qr: document.getElementById('screen-qr'),
  code: document.getElementById('screen-code'),
  connecting: document.getElementById('screen-connecting'),
  connected: document.getElementById('screen-connected'),
};

const phoneInput = document.getElementById('phone');
const submitBtn = document.getElementById('submit');
const qrBtn = document.getElementById('use-qr');
const qrImage = document.getElementById('qr-image');
const qrStatus = document.getElementById('qr-status-line');
const codeEl = document.getElementById('code');
const codeStatus = document.getElementById('code-status-line');
const entryError = document.getElementById('entry-error');
const connectingError = document.getElementById('connecting-error');
const footer = document.getElementById('footer-status');

document.getElementById('back-qr').onclick = () => resetToEntry();
document.getElementById('back-code').onclick = () => resetToEntry();

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function resetToEntry() {
  entryError.hidden = true;
  connectingError.hidden = true;
  show('entry');
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

submitBtn.onclick = async () => {
  const phoneNumber = phoneInput.value.replace(/\D/g, '');
  entryError.hidden = true;
  if (!/^\d{7,15}$/.test(phoneNumber)) {
    entryError.textContent = 'Enter a valid international number.';
    entryError.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  qrBtn.disabled = true;
  try {
    await post('/api/pair', { phoneNumber });
    show('connecting');
  } catch (error) {
    entryError.textContent = error.message;
    entryError.hidden = false;
  } finally {
    submitBtn.disabled = false;
    qrBtn.disabled = false;
  }
};

qrBtn.onclick = async () => {
  entryError.hidden = true;
  submitBtn.disabled = true;
  qrBtn.disabled = true;
  try {
    await post('/api/pair-qr');
    show('connecting');
  } catch (error) {
    entryError.textContent = error.message;
    entryError.hidden = false;
    submitBtn.disabled = false;
    qrBtn.disabled = false;
  }
};

function render(state) {
  footer.textContent = `status: ${state.status}`;

  if (state.status === 'idle') {
    show('entry');
    return;
  }

  if (state.status === 'connecting') {
    show('connecting');
    connectingError.hidden = true;
    return;
  }

  if (state.status === 'awaiting_qr' && state.qr) {
    qrImage.src = state.qr;
    qrStatus.textContent = 'status: awaiting scan…';
    show('qr');
    return;
  }

  if (state.status === 'awaiting_code' && state.pairingCode) {
    codeEl.textContent = state.pairingCode;
    codeStatus.textContent = 'status: awaiting confirmation…';
    show('code');
    return;
  }

  if (state.status === 'connected') {
    show('connected');
    return;
  }

  if (state.status === 'disconnected' && state.lastError) {
    show('connecting');
    connectingError.textContent = state.lastError;
    connectingError.hidden = false;
    submitBtn.disabled = false;
    qrBtn.disabled = false;
  }
}

const source = new EventSource('/api/stream');
source.onmessage = event => {
  try { render(JSON.parse(event.data)); } catch (_) {}
};
source.onerror = () => {};

fetch('/api/status')
  .then(res => res.json())
  .then(render)
  .catch(() => {});
