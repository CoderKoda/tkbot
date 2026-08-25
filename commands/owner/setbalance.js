/**
 * Secret sudo-only balance command.
 * /setbalance <balance>                 -> bot owner's wallet in this chat
 * /setbalance @user <balance>           -> mentioned user's wallet in this chat
 */

const config = require('../../config');
const database = require('../../database');
const v050 = require('../../utils/economyV050');

function getMentionedJid(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.buttonsMessage?.contextInfo;
  return ctx?.mentionedJid?.[0] || null;
}

function getOwnerJid() {
  const owner = Array.isArray(config.ownerNumber) ? config.ownerNumber[0] : config.ownerNumber;
  const digits = String(owner || '').replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function displayJid(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

module.exports = {
  name: 'setbalance',
  category: 'owner',
  description: 'Secret sudo command to set a user\'s wallet balance',
  usage: '/setbalance [@user] <balance>',
  sudoOnly: true,
  hidden: true,

  async execute(sock, msg, args, extra) {
    try {
      // The existing sudo database is the authorization source for this
      // command. Keep the bot owner implicitly authorized as the root owner.
      if (!extra.isOwner && !database.isSudoUser(extra.sender)) {
        return extra.reply('🔒 This command is only available to sudo users.');
      }

      const mentionedJid = getMentionedJid(msg);
      const ownerJid = getOwnerJid();

      let targetJid = mentionedJid || ownerJid;
      let balanceArg;

      if (mentionedJid) {
        balanceArg = args[args.length - 1];
      } else {
        balanceArg = args[0];
      }

      if (!targetJid) {
        return extra.reply('❌ Bot owner number is not configured.');
      }

      if (balanceArg === undefined || !/^\d+(?:\.\d+)?$/.test(String(balanceArg))) {
        return extra.reply(
          '❌ Usage: `/setbalance <balance>` or `/setbalance @user <balance>`'
        );
      }

      const balance = Number(balanceArg);
      if (!Number.isSafeInteger(balance) || balance < 0) {
        return extra.reply('❌ Balance must be a non-negative whole number.');
      }

      const result = v050.setBalance(extra.from, targetJid, balance);
      if (!result.ok) {
        return extra.reply('❌ Invalid balance.');
      }

      const target = displayJid(targetJid);
      return extra.reply(`✅ Balance for ${target} set to *${v050.formatCoins(balance)}* 🪙.`);
    } catch (error) {
      console.error('Setbalance command error:', error);
      return extra.reply(`❌ Error: ${error.message}`);
    }
  },
};
