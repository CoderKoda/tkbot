/**
 * Compatibility launcher for older Render Start Commands.
 *
 * Older deployments used `node pairing-entry.js`. Keep that command working,
 * but route it into the unified web pairing server instead of the old
 * phone-number-only pairing flow.
 */
require('./web-entry.js');
