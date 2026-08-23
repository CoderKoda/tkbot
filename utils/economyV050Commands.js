const v050 = require('./economyV050');
const database = require('../database');

const eco = (def) => ({ category: 'economy', groupOnly: true, ...def });
const sudoOnly = (def) => eco({ ...def, sudoOnly: true });
const parsePositiveInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const commands = [
  eco({
    name: 'passive',
    aliases: ['passiveincome', 'passives'],
    description: 'View passive-income items and your holdings',
    usage: ',passive',
    async execute(sock, msg, args, extra) {
      const items = v050.getItems();
      const inv = v050.getInventory(extra.from, extra.sender);
      const lines = items.map((item) => {
        const owned = Number(inv.user.passiveItems[item.code]) || 0;
        return `• \`${item.code}\` *${item.name}* — ${v050.formatCoins(item.income)}/hr — ${v050.formatCoins(item.income * 100)} 🪙 — stock: ${item.stock}${owned ? ` — owned: ${owned}` : ''}\n  ${item.description}`;
      });
      return extra.reply(`💼 *Passive Income Shop*\n\n${lines.join('\n\n')}\n\nIncome is credited automatically at every :00 hour.\nBuy with \,buy <itemcode> [quantity]`);
    },
  }),

  eco({
    name: 'buy',
    aliases: ['buyitem'],
    description: 'Buy passive-income items',
    usage: ',buy <itemcode> [quantity]',
    async execute(sock, msg, args, extra) {
      const quantity = parsePositiveInt(args[1] || 1);
      if (!args[0] || !quantity) return extra.reply('❌ Usage: `,buy <itemcode> [quantity]`');
      const result = v050.buyPassive(extra.from, extra.sender, args[0], quantity);
      if (!result.ok) {
        if (result.error === 'item') return extra.reply('❌ Passive-income item not found.');
        if (result.error === 'stock') return extra.reply(`❌ Only *${result.item.stock}* ${result.item.name} remain in stock.`);
        if (result.error === 'funds') return extra.reply(`❌ You need *${v050.formatCoins(result.price)}* 🪙.`);
        return extra.reply('❌ Invalid quantity.');
      }
      return extra.reply(`✅ Bought *${result.quantity}× ${result.item.name}* for *${v050.formatCoins(result.price)}* 🪙.\n\nThey will all generate *${v050.formatCoins(result.item.income * result.quantity)} coins/hour* at each :00.`);
    },
  }),

  eco({
    name: 'tradinghall',
    aliases: ['th'],
    description: 'Buy, sell and view player listings',
    usage: ',tradinghall view|sell <itemcode> <price>|buy <listingcode>',
    async execute(sock, msg, args, extra) {
      const action = (args[0] || 'view').toLowerCase();
      if (action === 'view') {
        const listings = v050.getListings(extra.from);
        if (!listings.length) return extra.reply('🏛️ *Trading Hall*\n\nNo player listings are currently available.');
        const text = listings.map((listing) => `• \`${listing.code}\` *${listing.itemName}* — ${v050.formatCoins(listing.price)} 🪙 — ${listing.income}/hr`).join('\n');
        return extra.reply(`🏛️ *Trading Hall*\n\n${text}\n\nBuy with \,tradinghall buy <listingcode>`);
      }
      if (action === 'sell') {
        const price = parsePositiveInt(args[2]);
        if (!args[1] || !price) return extra.reply('❌ Usage: `,tradinghall sell <itemcode> <price>`');
        const result = v050.sellToHall(extra.from, extra.sender, args[1], price);
        if (!result.ok) {
          if (result.error === 'item') return extra.reply('❌ Item not found.');
          if (result.error === 'owned') return extra.reply('❌ You do not own that passive-income item.');
          return extra.reply('❌ Invalid price.');
        }
        return extra.reply(`🏷️ Listed *${result.item.name}* for *${v050.formatCoins(price)}* 🪙.\nListing code: \`${result.listing.code}\``);
      }
      if (action === 'buy') {
        if (!args[1]) return extra.reply('❌ Usage: `,tradinghall buy <listingcode>`');
        const result = v050.buyFromHall(extra.from, extra.sender, args[1]);
        if (!result.ok) {
          if (result.error === 'listing') return extra.reply('❌ Listing not found.');
          if (result.error === 'self') return extra.reply('❌ You cannot buy your own listing.');
          return extra.reply(`❌ You need *${v050.formatCoins(result.listing.price)}* 🪙.`);
        }
        return extra.reply(`✅ Bought *${result.listing.itemName}* from another user for *${v050.formatCoins(result.listing.price)}* 🪙.\nListing \`${result.listing.code}\` has been removed.`);
      }
      return extra.reply('❌ Usage: `,tradinghall view|sell <itemcode> <price>|buy <listingcode>`');
    },
  }),

  sudoOnly({
    name: 'additem',
    description: 'Create a passive-income item',
    usage: ',additem <name> <income> <description>',
    async execute(sock, msg, args, extra) {
      if (!database.isSudoUser(extra.sender)) return extra.reply('❌ Sudo only.');
      const incomeIndex = args.findIndex((arg) => /^\d+$/.test(arg));
      if (incomeIndex <= 0 || incomeIndex >= args.length - 1) return extra.reply('❌ Usage: `,additem <name> <income> <description>`');
      const name = args.slice(0, incomeIndex).join(' ');
      const income = Number(args[incomeIndex]);
      const description = args.slice(incomeIndex + 1).join(' ');
      const result = v050.addItem(name, income, description);
      if (!result.ok) return extra.reply(result.error === 'exists' ? '❌ An item with that name already exists.' : '❌ Invalid item data.');
      return extra.reply(`✅ Created *${result.item.name}*.\nCode: \`${result.item.code}\`\nIncome: *${result.item.income}/hr*\nPrice: *${v050.formatCoins(result.item.income * 100)}* 🪙\nStock: *0*`);
    },
  }),

  sudoOnly({
    name: 'addstock',
    description: 'Increase passive-income item stock',
    usage: ',addstock <item> <amount>',
    async execute(sock, msg, args, extra) {
      if (!database.isSudoUser(extra.sender)) return extra.reply('❌ Sudo only.');
      const amount = parsePositiveInt(args[1]);
      if (!args[0] || !amount) return extra.reply('❌ Usage: `,addstock <item> <amount>`');
      const result = v050.addStock(args[0], amount);
      if (!result.ok) return extra.reply(result.error === 'item' ? '❌ Item not found.' : '❌ Invalid amount.');
      return extra.reply(`✅ Added *${amount}* stock to *${result.item.name}*. New stock: *${result.item.stock}*.`);
    },
  }),
];

module.exports = commands;
