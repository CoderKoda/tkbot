/**
 * Antitoxic Command - Analyze text for toxicity using the provided API
 */

const axios = require('axios');
const database = require('../../database');

const DEFAULT_API_KEY = 'uJ2c2efPEQ1L7b6qaQVHe63Ijj32nxBtIHi8Qceg55s';

function extractText(msg) {
  if (!msg) return '';

  const message = msg.message || msg;
  if (typeof message?.conversation === 'string' && message.conversation.trim()) {
    return message.conversation.trim();
  }

  if (typeof message?.extendedTextMessage?.text === 'string' && message.extendedTextMessage.text.trim()) {
    return message.extendedTextMessage.text.trim();
  }

  const quoted = message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    if (typeof quoted === 'string' && quoted.trim()) {
      return quoted.trim();
    }
    if (typeof quoted.conversation === 'string' && quoted.conversation.trim()) {
      return quoted.conversation.trim();
    }
    if (typeof quoted.extendedTextMessage?.text === 'string' && quoted.extendedTextMessage.text.trim()) {
      return quoted.extendedTextMessage.text.trim();
    }
  }

  return '';
}

function parseAnalysis(payload) {
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

  if (raw?.scores && typeof raw.scores === 'object') {
    const entries = Object.entries(raw.scores).filter(([, value]) => typeof value === 'number');
    const top = entries.reduce((best, current) => (current[1] > best[1] ? current : best), entries[0] || ['', 0]);
    if (top) {
      score = top[1];
      summary = `${top[0]}: ${Number(top[1]).toFixed(4)}`;
      flagged = top[1] >= 0.6;
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
      flagged = score >= 0.6;
    }
  }

  return { flagged, parameter, score, summary };
}

function formatResult(payload) {
  if (!payload) return 'No result returned.';

  if (typeof payload === 'string') {
    return payload;
  }

  const result = payload?.data || payload?.result || payload?.analysis || payload;

  if (typeof result === 'string') {
    return result;
  }

  const lines = [];
  const status = payload?.flagged || result?.flagged || payload?.toxic || result?.toxic || payload?.is_toxic || result?.is_toxic ? 'Flagged' : 'Safe';
  lines.push(`Status: ${status}`);

  const score = payload?.score ?? result?.score ?? payload?.confidence ?? result?.confidence ?? payload?.probability ?? result?.probability ?? payload?.toxicity_score ?? result?.toxicity_score ?? null;
  if (score !== undefined && score !== null) {
    const rounded = typeof score === 'number' ? score.toFixed(4) : score;
    lines.push(`Score: ${rounded}`);
  }

  const summary = payload?.summary || result?.summary || payload?.details || result?.details || payload?.message || result?.message || '';
  if (summary) {
    lines.push(`Details: ${summary}`);
  }

  if (lines.length > 0) {
    return lines.join('\n');
  }

  return JSON.stringify(result, null, 2);
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

  return parseAnalysis(response.data);
}

module.exports = {
  name: 'antitoxic',
  aliases: ['toxic'],
  category: 'admin',
  description: 'Configure passive toxicity moderation or analyze a message manually',
  usage: '/antitoxic [on/off/set/get] or /antitoxic <text>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  analyzeText,
  extractText,
  getReason: (payload) => parseAnalysis(payload).parameter,

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

      const text = (args.join(' ').trim() || extractText(msg)).trim();
      if (!text) {
        return extra.reply('❌ Usage: /antitoxic <text>\nReply to a message with /antitoxic to analyze it.');
      }

      const apiKey = process.env.ANTITOXIC_API_KEY || process.env.TOXIC_API_KEY || DEFAULT_API_KEY;
      if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        return extra.reply('⚠️ Toxicity API key is not configured. Replace YOUR_API_KEY_HERE in the command file with your real key.');
      }

      await extra.reply('🧪 Analyzing text...');

      const analysis = await analyzeText(text, apiKey);
      const formatted = formatResult({
        ...analysis,
        label: analysis.parameter,
      });
      return extra.reply(`🧪 *Toxicity Analysis*\n\n${formatted}`);
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || 'Unknown error';
      return extra.reply(`❌ Toxicity analysis failed.\n\n${message}`);
    }
  },
};
