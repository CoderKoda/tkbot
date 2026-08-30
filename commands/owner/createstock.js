const stocks = require('../../utils/stocks');

module.exports = {
  name: 'createstock',
  aliases: ['newstock'],
  category: 'owner',
  ownerOnly: true,
  description: 'Create a new virtual stock at 100 coins',
  usage: '/createstock <name>',

  async execute(sock, msg, args, extra) {
    const name = args.join(' ').trim();
    if (!name) return extra.reply('❌ Usage: `/createstock <name>`');

    const result = stocks.createStock(name);
    if (!result.ok) {
      if (result.error === 'exists') return extra.reply('❌ A stock with that name already exists.');
      return extra.reply('❌ Stock name cannot be empty.');
    }

    return extra.reply(
      `✅ Created *${result.stock.name}*\n` +
      `Symbol: *${result.stock.symbol}*\n` +
      `Starting price: *${result.stock.price}* 🪙\n\n` +
      `It will begin changing by *5–20 coins* every minute.`
    );
  },
};
