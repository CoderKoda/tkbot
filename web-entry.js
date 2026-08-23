require('dotenv').config();

// Baileys/undici may reference browser globals that older Node versions do not expose.
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
const fs = require('fs');
const path = require('path');
const Module = require('module');
const config = require('./config');

const state = {
  connection: 'starting',
  pairingCode: null,
  qr: null,
  phoneNumber: null,
  botNumber: null,
  error: null,
  updatedAt: Date.now(),
};

const subscribers = new Set();
let activeSocket = null;
let pendingPairingPhone = null;

function publish(patch = {}) {
  Object.assign(state, patch, { updatedAt: Date.now() });
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of subscribers) {
    try { res.write(payload); } catch (_) { subscribers.delete(res); }
  }
}

function sanitizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function sessionPath() {
  return path.resolve(`./${config.sessionName}`);
}

function resetSessionFiles() {
  const dir = sessionPath();
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`Failed to reset session: ${error.message}`);
  }
}

// Wrap Baileys' socket factory without changing your existing index.js.
// This lets the web layer observe the socket and request a pairing code on demand.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (request !== '@whiskeysockets/baileys' || loaded.__tkbotWebWrapped) return loaded;

  const originalMake = loaded.default;
  if (typeof originalMake !== 'function') return loaded;

  function makeWrappedSocket(...args) {
    const socket = originalMake(...args);
    activeSocket = socket;

    socket.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        publish({ connection: 'qr', qr, pairingCode: null, error: null });
      }

      if (connection === 'open') {
        const botNumber = socket.user?.id?.split(':')[0] || null;
        publish({
          connection: 'open',
          qr: null,
          pairingCode: null,
          phoneNumber: null,
          botNumber,
          error: null,
        });
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error?.message || null;
        publish({ connection: 'close', error });
      }
    });

    const requestedPhone = pendingPairingPhone;
    pendingPairingPhone = null;

    if (requestedPhone && typeof socket.requestPairingCode === 'function') {
      setTimeout(async () => {
        try {
          const code = await socket.requestPairingCode(requestedPhone);
          publish({ connection: 'pairing', pairingCode: code, qr: null, phoneNumber: requestedPhone, error: null });
        } catch (error) {
          publish({ connection: 'error', error: error.message || String(error) });
        }
      }, 750);
    }

    return socket;
  }

  const wrapped = { ...loaded, default: makeWrappedSocket };
  Object.defineProperty(wrapped, '__tkbotWebWrapped', { value: true });
  return wrapped;
};

const app = express();
app.use(express.json());

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

app.post('/api/pair', async (req, res) => {
  const phoneNumber = sanitizePhone(req.body?.phoneNumber);
  if (!/^\d{7,15}$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'Enter your number with country code, digits only.' });
  }

  try {
    pendingPairingPhone = phoneNumber;
    publish({ connection: 'resetting', pairingCode: null, qr: null, error: null, phoneNumber });

    if (activeSocket) {
      try { await activeSocket.end(undefined, undefined, { reason: 'web-pairing-reset' }); } catch (_) {}
    }

    resetSessionFiles();
    // index.js already owns the normal reconnect/start lifecycle. Closing its
    // current socket causes its existing connection.update handler to create
    // a fresh socket, which the wrapper above converts into a pairing-code flow.
    res.json({ ok: true });
  } catch (error) {
    publish({ connection: 'error', error: error.message || String(error) });
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.post('/api/pair-qr', async (req, res) => {
  try {
    pendingPairingPhone = null;
    publish({ connection: 'resetting', pairingCode: null, qr: null, error: null, phoneNumber: null });

    if (activeSocket) {
      try { await activeSocket.end(undefined, undefined, { reason: 'web-qr-reset' }); } catch (_) {}
    }

    resetSessionFiles();
    res.json({ ok: true });
  } catch (error) {
    publish({ connection: 'error', error: error.message || String(error) });
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.get('/api/status', (_req, res) => {
  res.json(state);
});

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`data: ${JSON.stringify(state)}\n\n`);
  subscribers.add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
  });
});

const port = Number(process.env.PORT || config.PORT || 3000);
app.listen(port, () => {
  console.log(`Pairing website running on port ${port}`);
  console.log(`Local URL: http://localhost:${port}`);
});

// Finally load the unchanged bot entry point. Its existing startup, reconnect,
// store, handler, session and command logic remain in control.
require('./index.js');
