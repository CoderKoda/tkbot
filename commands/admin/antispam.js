/**
 * AntiSpam Command - Configure anti-spam protection
 */

const database = require('../../database');

module.exports = {
  name: 'antispam',
  aliases: [],
  category: 'admin',
  description: 'Configure anti-spam protection',
  usage: '.antispam <on/off/set/get>',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const settings = database.getGroupSettings(extra.from);
      if (!args[0]) {
        const status = settings.antiSpam ? 'ON' : 'OFF';
        const action = settings.antiSpamAction || 'warn';
        const threshold = settings.antiSpamThreshold || 5;
        const window = settings.antiSpamWindow || 10;
        return extra.reply(
          `🚫 *Anti-Spam Status*\n\n` +
          `Status: *${status}*\n` +
          `Threshold: *${threshold}* messages\n` +
          `Window: *${window}* seconds\n` +
          `Action: *${action}*\n\n` +
          `Usage:\n` +
          `  .antispam on\n` +
          `  .antispam off\n` +
          `  .antispam set <messages> <seconds> <warn|kick>\n` +
          `  .antispam get`
        );
      }

      const opt = args[0].toLowerCase();

      if (opt === 'toggle') {
        const newState = !settings.antiSpam;
        database.updateGroupSettings(extra.from, { antiSpam: newState });
        return extra.reply(`*Anti-spam has been turned ${newState ? 'ON' : 'OFF'}*`);
      }

      if (opt === 'on') {
        if (settings.antiSpam) {
          return extra.reply('*Anti-spam is already on*');
        }
        database.updateGroupSettings(extra.from, { antiSpam: true });
        return extra.reply('*Anti-spam has been turned ON*');
      }

      if (opt === 'off') {
        if (!settings.antiSpam) {
          return extra.reply('*Anti-spam is already off*');
        }
        database.updateGroupSettings(extra.from, { antiSpam: false });
        return extra.reply('*Anti-spam has been turned OFF*');
      }

      if (opt === 'set') {
        if (args.length < 4) {
          return extra.reply('*Usage: .antispam set <messages> <seconds> <warn|kick>*');
        }

        const threshold = parseInt(args[1], 10);
        const windowSeconds = parseInt(args[2], 10);
        const action = args[3].toLowerCase();

        if (Number.isNaN(threshold) || threshold < 1) {
          return extra.reply('*Please provide a valid number of messages (at least 1)*');
        }
        if (Number.isNaN(windowSeconds) || windowSeconds < 1) {
          return extra.reply('*Please provide a valid time window in seconds (at least 1)*');
        }
        if (!['warn', 'kick'].includes(action)) {
          return extra.reply('*Action must be warn or kick*');
        }

        database.updateGroupSettings(extra.from, {
          antiSpam: true,
          antiSpamThreshold: threshold,
          antiSpamWindow: windowSeconds,
          antiSpamAction: action,
        });

        return extra.reply(`*Anti-spam set to ${threshold} messages in ${windowSeconds} seconds with action ${action}*`);
      }

      if (opt === 'get') {
        const status = settings.antiSpam ? 'ON' : 'OFF';
        const action = settings.antiSpamAction || 'warn';
        const threshold = settings.antiSpamThreshold || 5;
        const window = settings.antiSpamWindow || 10;
        return extra.reply(`*Anti-spam Configuration:*
Status: ${status}
Threshold: ${threshold} messages
Window: ${window} seconds
Action: ${action}`);
      }

      return extra.reply('*Use .antispam for usage.*');
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  },
};
