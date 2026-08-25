require('dotenv').config();

// Baileys dependencies expect these globals on older Node versions too.
if (typeof globalThis.File === 'undefined') {
  try {
    globalThis.File = require('node:buffer').File;
  } catch (_) {
    const { Blob } = require('node:buffer');
    globalThis.File = class File extends Blob {
      constructor(chunks, name, options = {}) {
        super(chunks, options);
        this.name = name;
        this.lastModified = options.lastModified ?? Date.now();
      }
    };
  }
}
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('node:crypto').webcrypto;
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const config = require('./config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || config.PORT || 10000);
const SESSION_DIR = path.resolve(`./${config.sessionName}`);
const DEFAULT_PHONE = '66821625733';

const state = {
  status: 'idle', // idle | awaiting_qr | awaiting_code | connecting | connected | disconnected
  qr: null,
  pairingCode: null,
  lastError: null,
};

const clients = new Set();
let pairingSocket = null;
let pairingSaveCreds = null;
let requestedMode = null; // 'qr' | 'code'
let pendingPhoneNumber = null;
let botProcess = null;
let pairingStarting = false;

function publish(patch) {
  Object.assign(state, patch);
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (_) { clients.delete(res); }
  }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function clearAuth() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  } catch (_) {}
}

async function hasRegisteredSession() {
  try {
    const { state: authState } = await useMultiFileAuthState(SESSION_DIR);
    return Boolean(authState.creds.registered);
  } catch (_) {
    return false;
  }
}

function stopPairingSocket() {
  if (!pairingSocket) return;
  try {
    pairingSocket.ev.removeAllListeners();
    pairingSocket.end(new Error('Pairing complete'));
  } catch (_) {}
  pairingSocket = null;
  pairingSaveCreds = null;
}

function startBotProcess() {
  if (botProcess) return;
  botProcess = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit',
  });

  botProcess.on('exit', (code, signal) => {
    botProcess = null;
    console.log(`🤖 tkbot exited (code=${code}, signal=${signal || 'none'})`);
  });
}

async function requestPairingCodeWithRetry(sock, phoneNumber) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 2000 : 2500));
    try {
      return await sock.requestPairingCode(phoneNumber);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function startPairingSocket() {
  if (pairingStarting) return;
  pairingStarting = true;

  stopPairingSocket();

  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  pairingSaveCreds = saveCreds;

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (_) {
    version = undefined;
  }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: authState,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Chrome', 'Windows', '10.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  pairingSocket = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async update => {
    const { connection, qr, lastDisconnect } = update;

    if (qr && requestedMode === 'qr') {
      try {
        const dataUrl = await QRCode.toDataURL(qr, {
          width: 360,
          margin: 2,
          errorCorrectionLevel: 'M',
        });
        publish({ status: 'awaiting_qr', qr: dataUrl, pairingCode: null, lastError: null });
      } catch (error) {
        publish({ status: 'disconnected', lastError: error.message });
      }
    }

    if (qr && requestedMode === 'code' && pendingPhoneNumber) {
      publish({ status: 'awaiting_code', pairingCode: null, qr: null, lastError: null });
      try {
        const code = await requestPairingCodeWithRetry(sock, pendingPhoneNumber);
        publish({ status: 'awaiting_code', pairingCode: code, qr: null, lastError: null });
      } catch (error) {
        publish({ status: 'disconnected', lastError: error?.message || String(error) });
      }
    }

    if (connection === 'open') {
      publish({ status: 'connected', qr: null, pairingCode: null, lastError: null });
      stopPairingSocket();
      startBotProcess();
      pairingStarting = false;
      return;
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        publish({ status: 'disconnected', qr: null, pairingCode: null, lastError: 'WhatsApp logged out. Start a new pairing session.' });
        pairingStarting = false;
        return;
      }

      if (pairingSocket === sock) {
        publish({ status: 'disconnected', lastError: `Connection closed (${code ?? 'unknown'}). Retrying…` });
        pairingStarting = false;
        setTimeout(() => {
          startPairingSocket().catch(error => {
            pairingStarting = false;
            publish({ status: 'disconnected', lastError: error.message });
          });
        }, 3000);
      }
    }
  });

  pairingStarting = false;
}

app.get('/api/status', (_req, res) => {
  res.json(state);
});

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify(state)}\n\n`);
  clients.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.post('/api/pair', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body?.phoneNumber || DEFAULT_PHONE);
    if (!/^\d{7,15}$/.test(phoneNumber)) {
      return res.status(400).json({ error: 'Enter a valid phone number with country code, digits only.' });
    }

    if (botProcess) {
      try { botProcess.kill('SIGTERM'); } catch (_) {}
      botProcess = null;
    }

    clearAuth();
    requestedMode = 'code';
    pendingPhoneNumber = phoneNumber;
    publish({ status: 'connecting', qr: null, pairingCode: null, lastError: null });
    startPairingSocket().catch(error => publish({ status: 'disconnected', lastError: error.message }));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pair-qr', async (_req, res) => {
  try {
    if (botProcess) {
      try { botProcess.kill('SIGTERM'); } catch (_) {}
      botProcess = null;
    }

    clearAuth();
    requestedMode = 'qr';
    pendingPhoneNumber = null;
    publish({ status: 'connecting', qr: null, pairingCode: null, lastError: null });
    startPairingSocket().catch(error => publish({ status: 'disconnected', lastError: error.message }));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout', async (_req, res) => {
  try {
    if (botProcess) {
      try { botProcess.kill('SIGTERM'); } catch (_) {}
      botProcess = null;
    }
    stopPairingSocket();
    clearAuth();
    requestedMode = null;
    pendingPhoneNumber = null;
    publish({ status: 'idle', qr: null, pairingCode: null, lastError: null });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🌐 tkbot pairing website running on 0.0.0.0:${PORT}`);

  if (await hasRegisteredSession()) {
    publish({ status: 'connected', qr: null, pairingCode: null, lastError: null });
    startBotProcess();
  } else {
    publish({ status: 'idle', qr: null, pairingCode: null, lastError: null });
  }
});
