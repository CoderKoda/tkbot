/**
 * Pairing-code launcher for tkbot.
 *
 * The pairing number defaults to the configured owner number so Railway
 * does not need a separate PAIRING_NUMBER variable.
 */

const Module = require('module');
const config = require('./config');

const pairingNumber = String(
  process.env.PAIRING_NUMBER ||
  (Array.isArray(config.ownerNumber) ? config.ownerNumber[0] : config.ownerNumber) ||
  '66821625733'
).replace(/\D/g, '');

if (!/^\d{7,15}$/.test(pairingNumber)) {
  console.error('❌ Invalid pairing number. Set PAIRING_NUMBER to your WhatsApp number with country code, digits only.');
  process.exit(1);
}

const originalLoad = Module._load;
let pairingRequested = false;

Module._load = function patchedLoad(request, parent, isMain) {
  // Prevent index.js from printing QR codes.
  if (request === 'qrcode-terminal') {
    return {
      generate() {
        // QR authentication is intentionally disabled in pairing-code mode.
      }
    };
  }

  const loaded = originalLoad.apply(this, arguments);
  if (request !== '@whiskeysockets/baileys' || loaded.__tkbotPairingWrapped) {
    return loaded;
  }

  const originalMake = loaded.default;
  if (typeof originalMake !== 'function') return loaded;

  function makePairingSocket(...args) {
    const socket = originalMake(...args);

    // Existing sessions should reconnect normally and must not request a new code.
    const registered = Boolean(args[0]?.auth?.creds?.registered);
    if (!registered && !pairingRequested && typeof socket.requestPairingCode === 'function') {
      pairingRequested = true;
      setTimeout(async () => {
        try {
          const code = await socket.requestPairingCode(pairingNumber);
          console.log(`\n📱 WhatsApp pairing code: ${code}`);
          console.log('Open WhatsApp → Linked devices → Link a device → Link with phone number instead.');
          console.log('⚠️ Do not share this pairing code with anyone.\n');
        } catch (error) {
          pairingRequested = false;
          console.error('❌ Failed to request WhatsApp pairing code:', error?.message || error);
        }
      }, 1000);
    }

    return socket;
  }

  const wrapped = { ...loaded, default: makePairingSocket };
  Object.defineProperty(wrapped, '__tkbotPairingWrapped', { value: true });
  return wrapped;
};

require('./index.js');
