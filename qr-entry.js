/**
 * QR/web launcher for tkbot.
 *
 * The bot's historical startup code still contains the pairing-code branch.
 * This launcher keeps that code intact but replaces requestPairingCode() with
 * a harmless no-op and exposes Baileys' normal QR event through pairing-web.
 */

const Module = require('module');
const { attachPairingWeb, startPairingWeb } = require('./pairing-web');

startPairingWeb();

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);

  if (request !== '@whiskeysockets/baileys' || loaded.__tkbotQrWrapped) {
    return loaded;
  }

  const originalMake = loaded.default;
  if (typeof originalMake !== 'function') return loaded;

  function makeQrSocket(...args) {
    const socket = originalMake(...args);

    // The existing index.js calls requestPairingCode() when it sees the first
    // QR event. For QR mode, leave the QR untouched and simply suppress that
    // legacy call so WhatsApp can continue with normal QR authentication.
    const requestPairingCode = socket.requestPairingCode;
    if (typeof requestPairingCode === 'function') {
      socket.requestPairingCode = async () => {
        console.log('🌐 QR web pairing active; ignoring legacy pairing-code request.');
        return null;
      };
    }

    attachPairingWeb(socket);
    return socket;
  }

  const wrapped = { ...loaded, default: makeQrSocket };
  Object.defineProperty(wrapped, '__tkbotQrWrapped', { value: true });
  return wrapped;
};

require('./index.js');
