try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional; hosted environments normally provide process.env directly.
}

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

const http = require('http');
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
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

      if (qr) publish({ connection: 'qr', qr, pairingCode: null, error: null });

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

const publicDir = path.join(__dirname, 'public');

function serveStatic(req, res) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relative);

  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) return sendJson(res, 404, { error: 'Not found' });
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    };

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/api/pair') {
    try {
      const body = await readJson(req);
      const phoneNumber = sanitizePhone(body.phoneNumber);
      if (!/^\d{7,15}$/.test(phoneNumber)) {
        return sendJson(res, 400, { error: 'Enter your number with country code, digits only.' });
      }

      pendingPairingPhone = phoneNumber;
      publish({ connection: 'resetting', pairingCode: null, qr: null, error: null, phoneNumber });

      if (activeSocket) {
        try { await activeSocket.end(undefined, undefined, { reason: 'web-pairing-reset' }); } catch (_) {}
      }

      resetSessionFiles();
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      publish({ connection: 'error', error: error.message || String(error) });
      return sendJson(res, 500, { error: error.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/pair-qr') {
    try {
      pendingPairingPhone = null;
      publish({ connection: 'resetting', pairingCode: null, qr: null, error: null, phoneNumber: null });

      if (activeSocket) {
        try { await activeSocket.end(undefined, undefined, { reason: 'web-qr-reset' }); } catch (_) {}
      }

      resetSessionFiles();
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      publish({ connection: 'error', error: error.message || String(error) });
      return sendJson(res, 500, { error: error.message || String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, state);
  }

  if (req.method === 'GET' && url.pathname === '/api/stream') {
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
    return;
  }

  if (req.method === 'GET' && fs.existsSync(publicDir)) {
    return serveStatic(req, res);
  }

  sendJson(res, 404, { error: 'Not found' });
});

const port = Number(process.env.PORT || config.PORT || 3000);
server.listen(port, () => {
  console.log(`Pairing website running on port ${port}`);
  console.log(`Local URL: http://localhost:${port}`);
});

// Finally load the unchanged bot entry point. Its existing startup, reconnect,
// store, handler, session and command logic remain in control.
require('./index.js');
