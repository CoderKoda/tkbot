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
    description: 'View passive-income items and your individual item IDs',
    usage: ',passive',
    async execute(sock, msg, args, extra) {
      const items = v050.getItems();
      const inv = v050.getInventory(extra.from, extra.sender);
      const shopLines = items.map((item) =>
        `• *${item.name}* — ${v050.formatCoins(item.income)}/hr — ${v050.formatCoins(item.income * 100)} 🪙 — stock: ${item.stock}\n  ${item.description}`
      );
      const ownedLines = inv.items.length
        ? inv.items.map((entry) => `• \`${entry.id}\` *${entry.type.name}* — ${v050.formatCoins(entry.type.income)}/hr`).join('\n')
        : 'None';
      return extra.reply(
        `💼 *Passive Income Shop*\n\n${shopLines.join('\n\n')}\n\n` +
        `Your individual items:\n${ownedLines}\n\n` +
        `Income is credited automatically at every :00 hour.\n` +
        `Buy with \,buy <item name> [quantity]`
      );
    },
  }),

  eco({
    name: 'buy',
    aliases: ['buyitem'],
    description: 'Buy passive-income items',
    usage: ',buy <item name> [quantity]',
    async execute(sock, msg, args, extra) {
      const quantity = parsePositiveInt(args[args.length - 1]) || 1;
      const hasExplicitQuantity = Number.isInteger(Number(args[args.length - 1]));
      const nameArgs = hasExplicitQuantity ? args.slice(0, -1) : args;
      const itemName = nameArgs.join(' ').trim();
      if (!itemName) return extra.reply('❌ Usage: `,buy <item name> [quantity]`');

      const result = v050.buyPassive(extra.from, extra.sender, itemName, quantity);
      if (!result.ok) {
        if (result.error === 'item') return extra.reply('❌ Passive-income item not found.');
        if (result.error === 'stock') return extra.reply(`❌ Only *${result.item.stock}* ${result.item.name} remain in stock.`);
        if (result.error === 'funds') return extra.reply(`❌ You need *${v050.formatCoins(result.price)}* 🪙.`);
        return extra.reply('❌ Invalid quantity.');
      }
      return extra.reply(
        `✅ Bought *${result.quantity}× ${result.item.name}* for *${v050.formatCoins(result.price)}* 🪙.\n\n` +
        `Individual item IDs: ${result.itemIds.map((id) => `\`${id}\``).join(', ')}\n` +
        `Each generates *${v050.formatCoins(result.item.income)} coins/hour* at every :00.`
      );
    },
  }),

  eco({
    name: 'tradinghall',
    aliases: ['th'],
    description: 'Buy, sell and view player listings',
    usage: ',tradinghall view|sell <itemID> <price>|buy <listingCode>',
    async execute(sock, msg, args, extra) {
      const action = (args[0] || 'view').toLowerCase();
      if (action === 'view') {
        const listings = v050.getListings(extra.from);
        if (!listings.length) return extra.reply('🏛️ *Trading Hall*\n\nNo player listings are currently available.');
        const text = listings.map((listing) =>
          `• \`${listing.code}\` *${listing.itemName}* — ${v050.formatCoins(listing.price)} 🪙 — ${listing.income}/hr`
        ).join('\n');
        return extra.reply(`🏛️ *Trading Hall*\n\n${text}\n\nBuy with \,tradinghall buy <itemID>`);
      }
      if (action === 'sell') {
        const price = parsePositiveInt(args[2]);
        if (!args[1] || !price) return extra.reply('❌ Usage: `,tradinghall sell <itemID> <price>`');
        const result = v050.sellToHall(extra.from, extra.sender, args[1], price);
        if (!result.ok) {
          if (result.error === 'owned') return extra.reply('❌ You do not own that individual item ID. Use `,passive` to see your IDs.');
          return extra.reply('❌ Invalid price.');
        }
        return extra.reply(`🏷️ Listed *${result.item.name}* (ID \`${result.listing.itemId}\`) for *${v050.formatCoins(price)}* 🪙.`);
      }
      if (action === 'buy') {
        if (!args[1]) return extra.reply('❌ Usage: `,tradinghall buy <itemID>`');
        const result = v050.buyFromHall(extra.from, extra.sender, args[1]);
        if (!result.ok) {
          if (result.error === 'listing') return extra.reply('❌ Listing not found.');
          if (result.error === 'self') return extra.reply('❌ You cannot buy your own listing.');
          return extra.reply(`❌ You need *${v050.formatCoins(result.listing.price)}* 🪙.`);
        }
        return extra.reply(`✅ Bought *${result.listing.itemName}* — individual ID \`${result.listing.itemId}\` — for *${v050.formatCoins(result.listing.price)}* 🪙.`);
      }
      return extra.reply('❌ Usage: `,tradinghall view|sell <itemID> <price>|buy <itemID>`');
    },
  }),

  sudoOnly({
    name: 'additem',
    description: 'Create a passive-income item type',
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
      return extra.reply(`✅ Created *${result.item.name}*.\nType ID: \`${result.item.typeCode}\`\nIncome: *${result.item.income}/hr*\nPrice: *${v050.formatCoins(result.item.income * 100)}* 🪙\nStock: *0*`);
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
