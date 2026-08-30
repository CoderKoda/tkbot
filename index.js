/**
 * WhatsApp MD Bot - Main Entry Point
 */
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/tmp/puppeteer_cache_disabled';

const { initializeTempSystem } = require('./utils/tempManager');
const { startCleanup, cleanupOldFiles } = require('./utils/cleanup');
initializeTempSystem();
startCleanup();

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const forbiddenPatternsConsole = [
  'closing session', 'closing open session', 'sessionentry', 'prekey bundle',
  'pendingprekey', '_chains', 'registrationid', 'currentratchet', 'chainkey',
  'ratchet', 'signal protocol', 'ephemeralkeypair', 'indexinfo', 'basekey'
];
const shouldSuppress = (args) => {
  const message = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (_) { return String(a); }
  }).join(' ').toLowerCase();
  return forbiddenPatternsConsole.some((pattern) => message.includes(pattern));
};
console.log = (...args) => { if (!shouldSuppress(args)) originalConsoleLog.apply(console, args); };
console.error = (...args) => { if (!shouldSuppress(args)) originalConsoleError.apply(console, args); };
console.warn = (...args) => { if (!shouldSuppress(args)) originalConsoleWarn.apply(console, args); };

const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const config = require('./config');
const handler = require('./handler');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

function cleanupPuppeteerCache() {
  try {
    const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer');
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch (err) {
    console.error('⚠️ Failed to cleanup Puppeteer cache:', err.message || err);
  }
}

const store = {
  messages: new Map(),
  maxPerChat: 20,
  bind: (ev) => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;
        const jid = msg.key.remoteJid;
        if (!jid) continue;
        if (!store.messages.has(jid)) store.messages.set(jid, new Map());
        const chatMsgs = store.messages.get(jid);
        chatMsgs.set(msg.key.id, msg);
        while (chatMsgs.size > store.maxPerChat) {
          const oldestKey = chatMsgs.keys().next().value;
          chatMsgs.delete(oldestKey);
        }
      }
    });
  },
  loadMessage: async (jid, id) => store.messages.get(jid)?.get(id) || null,
};

const processedMessages = new Set();
setInterval(() => processedMessages.clear(), 5 * 60 * 1000).unref?.();

function createSuppressedLogger(level = 'silent') {
  const forbiddenPatterns = [
    'closing session', 'closing open session', 'sessionentry', 'prekey bundle',
    'pendingprekey', '_chains', 'registrationid', 'currentratchet', 'chainkey',
    'ratchet', 'signal protocol', 'ephemeralkeypair', 'indexinfo', 'basekey', 'ratchetkey'
  ];
  let logger;
  try {
    logger = pino({
      level,
      transport: process.env.NODE_ENV === 'production' ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true, ignore: 'pid,hostname' },
      },
      customLevels: { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 },
      redact: ['registrationId', 'ephemeralKeyPair', 'rootKey', 'chainKey', 'baseKey'],
    });
  } catch (_) {
    logger = pino({ level });
  }
  const originalInfo = logger.info.bind(logger);
  logger.info = (...args) => {
    let text = '';
    try { text = args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').toLowerCase(); } catch (_) {}
    if (!forbiddenPatterns.some((pattern) => text.includes(pattern))) originalInfo(...args);
  };
  logger.debug = () => {};
  logger.trace = () => {};
  return logger;
}

let activeSocket = null;
let reconnectTimer = null;
let reconnecting = false;
let shuttingDown = false;
let connectionGeneration = 0;

function isLoggedOut(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
}

function scheduleReconnect(reason = 'connection closed') {
  if (shuttingDown || reconnectTimer || reconnecting) return;
  console.log(`🔄 Scheduling reconnect: ${reason}`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    reconnecting = true;
    try {
      await startBot();
    } catch (err) {
      console.error('❌ Reconnect failed:', err?.message || err);
      scheduleReconnect('reconnect attempt failed');
    } finally {
      reconnecting = false;
    }
  }, 5000);
  reconnectTimer.unref?.();
}

async function startBot() {
  if (shuttingDown) return null;

  const generation = ++connectionGeneration;
  const sessionFolder = `./${config.sessionName}`;
  const sessionFile = path.join(sessionFolder, 'creds.json');

  if (config.sessionID && config.sessionID.startsWith('KnightBot!')) {
    try {
      const [header, b64data] = config.sessionID.split('!');
      if (header !== 'KnightBot' || !b64data) throw new Error("Invalid session format. Expected 'KnightBot!.....'");
      const compressedData = Buffer.from(b64data.replace('...', ''), 'base64');
      const decompressedData = zlib.gunzipSync(compressedData);
      if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });
      fs.writeFileSync(sessionFile, decompressedData, 'utf8');
      console.log('📡 Session: 🔑 Retrieved from KnightBot Session');
    } catch (err) {
      console.error('📡 Session: ❌ Error processing KnightBot session:', err.message || err);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();
  const suppressedLogger = createSuppressedLogger('silent');
  const pairingNumber = String(process.env.PAIRING_NUMBER || '66821625733').replace(/\D/g, '');
  const pairingMode = !state.creds.registered;
  let pairingRequested = false;

  const sock = makeWASocket({
    version,
    logger: suppressedLogger,
    printQRInTerminal: false,
    browser: ['Chrome', 'Windows', '10.0'],
    auth: state,
    syncFullHistory: false,
    downloadHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  activeSocket = sock;
  store.bind(sock.ev);

  const onClosed = (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && pairingMode && !pairingRequested) {
      pairingRequested = true;
      sock.requestPairingCode(pairingNumber)
        .then((code) => {
          console.log(`\n📱 WhatsApp pairing code: ${code}`);
          console.log('Open WhatsApp → Linked devices → Link with phone number instead.');
          console.log('⚠️ Do not share this pairing code with anyone.\n');
        })
        .catch((error) => {
          pairingRequested = false;
          console.error('❌ Failed to request WhatsApp pairing code:', error?.message || error);
        });
    }

    if (connection !== 'close') return;

    if (generation !== connectionGeneration || sock !== activeSocket) return;

    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
    const loggedOut = isLoggedOut(lastDisconnect);

    if (statusCode === 515 || statusCode === 503 || statusCode === 408) {
      console.log(`⚠️ Connection closed (${statusCode}).`);
    } else {
      console.log('⚠️ Connection closed due to:', errorMessage);
    }

    activeSocket = null;
    if (!loggedOut) {
      scheduleReconnect(`WhatsApp disconnect${statusCode ? ` (${statusCode})` : ''}`);
    } else {
      console.error('❌ WhatsApp session is logged out. Manual re-pairing is required.');
    }
  };

  sock.ev.on('connection.update', onClosed);
  sock.ev.on('creds.update', saveCreds);

  const isSystemJid = (jid) => {
    if (!jid) return true;
    return jid.includes('@broadcast') ||
      jid.includes('status.broadcast') ||
      jid.includes('@newsletter') ||
      jid.includes('@newsletter.');
  };

  sock.ev.on('connection.update', async ({ connection }) => {
    if (connection !== 'open' || generation !== connectionGeneration || sock !== activeSocket) return;
    console.log('\n✅ Bot connected successfully!');
    console.log(`📱 Bot Number: ${sock.user.id.split(':')[0]}`);
    console.log(`🤖 Bot Name: ${config.botName}`);
    console.log(`⚡ Prefix: ${config.prefix}`);
    const ownerNames = Array.isArray(config.ownerName) ? config.ownerName.join(',') : config.ownerName;
    console.log(`👑 Owner: ${ownerNames}\n`);
    console.log('Bot is ready to receive messages!\n');

    try {
      if (config.autoBio) await sock.updateProfileStatus(`${config.botName} | Active 24/7`);
    } catch (err) {
      console.warn('⚠️ Failed to update profile status:', err?.message || err);
    }

    try {
      handler.initializeAntiCall(sock);
    } catch (err) {
      console.warn('⚠️ Failed to initialize anti-call:', err?.message || err);
    }

    const now = Date.now();
    for (const [jid, chatMsgs] of store.messages.entries()) {
      const timestamps = Array.from(chatMsgs.values()).map((m) => Number(m.messageTimestamp || 0) * 1000);
      if (timestamps.length && now - Math.max(...timestamps) > 24 * 60 * 60 * 1000) {
        store.messages.delete(jid);
      }
    }
    console.log(`🧹 Store cleaned. Active chats: ${store.messages.size}`);
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue;
      const from = msg.key.remoteJid;
      if (!from || isSystemJid(from)) continue;

      const msgId = msg.key.id;
      if (processedMessages.has(msgId)) continue;

      const MESSAGE_AGE_LIMIT = 5 * 60 * 1000;
      if (msg.messageTimestamp) {
        const messageAge = Date.now() - Number(msg.messageTimestamp) * 1000;
        if (messageAge > MESSAGE_AGE_LIMIT) continue;
      }
      processedMessages.add(msgId);

      if (!store.messages.has(from)) store.messages.set(from, new Map());
      const chatMsgs = store.messages.get(from);
      chatMsgs.set(msg.key.id, msg);
      while (chatMsgs.size > store.maxPerChat) {
        const oldestKey = chatMsgs.keys().next().value;
        chatMsgs.delete(oldestKey);
      }

      Promise.resolve(handler.handleMessage(sock, msg)).catch((err) => {
        const message = err?.message || String(err);
        if (!message.includes('rate-overlimit') && !message.includes('not-authorized')) {
          console.error('Error handling message:', message);
        }
      });

      setImmediate(async () => {
        if (generation !== connectionGeneration || sock !== activeSocket) return;
        if (config.autoRead && from.endsWith('@g.us')) {
          try { await sock.readMessages([msg.key]); } catch (_) {}
        }
        if (from.endsWith('@g.us')) {
          try {
            const groupMetadata = await handler.getGroupMetadata(sock, from);
            if (groupMetadata) await handler.handleAntilink(sock, msg, groupMetadata);
          } catch (_) {}
        }
      });
    }
  });

  sock.ev.on('message-receipt.update', () => {});
  sock.ev.on('messages.update', () => {});
  sock.ev.on('group-participants.update', async (update) => {
    try { await handler.handleGroupUpdate(sock, update); } catch (err) {
      console.error('Error handling group update:', err?.message || err);
    }
  });
  sock.ev.on('error', (error) => {
    const statusCode = error?.output?.statusCode;
    if (statusCode === 515 || statusCode === 503 || statusCode === 408) return;
    console.error('Socket error:', error?.message || error);
  });

  return sock;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  try {
    if (activeSocket) await activeSocket.end(undefined, undefined, { reason: signal });
  } catch (_) {}
  process.exit(0);
}

console.log('🚀 Starting WhatsApp MD Bot...\n');
console.log(`📦 Bot Name: ${config.botName}`);
console.log(`⚡ Prefix: ${config.prefix}`);
const ownerNames = Array.isArray(config.ownerName) ? config.ownerName.join(',') : config.ownerName;
console.log(`👑 Owner: ${ownerNames}\n`);
cleanupPuppeteerCache();

startBot().catch((err) => {
  console.error('Error starting bot:', err?.message || err);
  scheduleReconnect('initial startup failed');
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  if (err?.code === 'ENOSPC' || err?.errno === -28 || err?.message?.includes('no space left on device')) {
    console.error('⚠️ ENOSPC Error: No space left on device. Attempting cleanup...');
    try { cleanupOldFiles(); } catch (_) {}
    return;
  }
  console.error('Uncaught Exception:', err);
  // Do not call process.exit here. Let the reconnect/hosting layer recover where possible.
});

process.on('unhandledRejection', (err) => {
  if (err?.code === 'ENOSPC' || err?.errno === -28 || err?.message?.includes('no space left on device')) {
    console.warn('⚠️ ENOSPC Error in promise: No space left on device. Attempting cleanup...');
    try { cleanupOldFiles(); } catch (_) {}
    return;
  }
  if (err?.message?.includes('rate-overlimit')) {
    console.warn('⚠️ Rate limit reached. Please slow down your requests.');
    return;
  }
  console.error('Unhandled Rejection:', err);
});

module.exports = { store };