/**
 * Pairing-code launcher for tkbot.
 *
 * The pairing number defaults to the configured owner number so Railway
 * does not need a separate PAIRING_NUMBER variable.
 */

const config = require('./config');

process.env.PAIRING_NUMBER = String(
  process.env.PAIRING_NUMBER ||
  (Array.isArray(config.ownerNumber) ? config.ownerNumber[0] : config.ownerNumber) ||
  '66821625733'
).replace(/\D/g, '');

require('./index.js');
