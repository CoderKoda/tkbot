/**
 * Antitoxic Command - Configure passive toxicity moderation
 */

const axios = require('axios');
const database = require('../../database');

const DEFAULT_API_KEY = 'uJ2c2efPEQ1L7b6qaQVHe63Ijj32nxBtIHi8Qceg55s';
const DEFAULT_THRESHOLD = 0.7;

function parseAnalysis(payload, threshold = DEFAULT_THRESHOLD) {
  if (!payload) {
    return { flagged: false, parameter: 'toxicity', score: null, summary: '' };
  }

  if (typeof payload === 'string') {
    return { flagged: false, parameter: 'toxicity', score: null, summary: payload };
  }

  const result = payload?.data || payload?.result || payload?.analysis || payload;
  const raw = typeof result === 'object' ? result : {};
  const parameter = raw?.parameter || raw?.reason || raw?.category || raw?.label || raw?.classification || raw?.prediction || raw?.type || payload?.parameter || payload?.reason || payload?.category || payload?.label || payload?.classification || 'toxicity';

  let score = raw?.score ?? raw?.confidence ?? raw?.probability ?? raw?.toxicity_score ?? payload?.score ?? payload?.confidence ?? null;
  let summary = raw?.message || raw?.summary || raw?.details || payload?.message || payload?.summary || '';
  let flagged = false;
  let resolvedParameter = parameter;

  if (raw?.scores && typeof raw.scores === 'object') {
    const entries = Object.entries(raw.scores).filter(([, value]) => typeof value === 'number');
    const top = entries.reduce((best, current) => (current[1] > best[1] ? current : best), entries[0] || ['', 0]);
    if (top) {
      score = top[1];
      resolvedParameter = top[0];
      summary = `${top[0]}: ${Number(top[1]).toFixed(4)}`;
      flagged = top[1] >= threshold;
    }
  } else {
    if (typeof raw?.flagged === 'boolean') {
      flagged = raw.flagged;
    } else if (typeof raw?.toxic === 'boolean') {
      flagged = raw.toxic;
    } else if (typeof raw?.is_toxic === 'boolean') {
      flagged = raw.is_toxic;
    } else if (typeof payload?.flagged === 'boolean') {
      flagged = payload.flagged;
    } else if (typeof payload?.toxic === 'boolean') {
      flagged = payload.toxic;
    } else if (typeof payload?.is_toxic === 'boolean') {
      flagged = payload.is_toxic;
    } else if (typeof score === 'number') {
      flagged = score >= threshold;
    }
  }

  return { flagged, parameter: resolvedParameter, score, summary };
}

async function analyzeText(text, apiKey = DEFAULT_API_KEY) {
  const response = await axios.post(
    'http://136.83.44.36:8443/api/v1/analyze',
    { text },
    {
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  return response.data;
}

module.exports = {
  name: 'antitoxic',
  aliases: ['toxic'],
  category: 'admin',
  description: 'Configure passive toxicity moderation',
  usage: '/antitoxic [on/off/set/get]',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  analyzeText,
  parseAnalysis,

  async execute(sock, msg, args, extra) {
    try {
      const firstArg = (args[0] || '').toLowerCase();

      if (['on', 'off', 'set', 'get'].includes(firstArg)) {
        if (!args[0]) {
          const settings = database.getGroupSettings(extra.from);
          const status = settings.antitoxic ? 'ON' : 'OFF';
          const action = settings.antitoxicAction || 'warn';
          return extra.reply(
            `🛡️ *Antitoxic Status*\n\n` +
            `Status: *${status}*\n` +
            `Action: *${action}*\n\n` +
            `Usage:\n` +
            `  /antitoxic on\n` +
            `  /antitoxic off\n` +
            `  /antitoxic set warn\n` +
            `  /antitoxic get`
          );
        }

        if (firstArg === 'on') {
          if (database.getGroupSettings(extra.from).antitoxic) {
            return extra.reply('*Antitoxic is already on*');
          }
          database.updateGroupSettings(extra.from, { antitoxic: true });
          return extra.reply('*Antitoxic has been turned ON*');
        }

        if (firstArg === 'off') {
          database.updateGroupSettings(extra.from, { antitoxic: false });
          return extra.reply('*Antitoxic has been turned OFF*');
        }

        if (firstArg === 'set') {
          if (args.length < 2) {
            return extra.reply('*Please specify an action: /antitoxic set warn*');
          }

          const action = args[1].toLowerCase();
          if (!['warn'].includes(action)) {
            return extra.reply('*Invalid action. Choose warn.*');
          }

          database.updateGroupSettings(extra.from, {
            antitoxicAction: action,
            antitoxic: true,
          });
          return extra.reply(`*Antitoxic action set to ${action}*`);
        }

        if (firstArg === 'get') {
          const settings = database.getGroupSettings(extra.from);
          const status = settings.antitoxic ? 'ON' : 'OFF';
          const action = settings.antitoxicAction || 'warn';
          return extra.reply(`*Antitoxic Configuration:*\nStatus: ${status}\nAction: ${action}`);
        }
      }

      return extra.reply(
        '❌ Usage:\n' +
        '  /antitoxic on\n' +
        '  /antitoxic off\n' +
        '  /antitoxic set warn\n' +
        '  /antitoxic get'
      );
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || 'Unknown error';
      return extra.reply(`❌ Error: ${message}`);
    }
  },
};
