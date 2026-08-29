const stocks = require('../../utils/stocks');
const economy = require('../../utils/economy');

stocks.startStockScheduler();

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = {
  name: 'stocks',
  aliases: ['stock', 'share'],
  category: 'economy',
  groupOnly: true,
  description: 'View and trade virtual stocks',
  usage: '/stocks view | /stocks buy <symbol> <quantity> | /stocks sell <symbol> <quantity>',

  async execute(sock, msg, args, extra) {
    const action = (args[0] || 'view').toLowerCase();

    if (action === 'view' || action === 'list' || action === 'market') {
      const market = stocks.getStocks();
      const portfolio = stocks.getPortfolio(extra.from, extra.sender);
      const marketLines = market.map((stock) => `• *${stock.symbol}* — ${stock.name} — *${fmt(stock.price)}* 🪙`).join('\n');
      const portfolioLines = portfolio.length
        ? portfolio.map((entry) => `• *${entry.symbol}* x${entry.quantity} — value *${fmt(entry.value)}* 🪙`).join('\n')
        : 'None';
      const user = economy.getUserData(extra.from, extra.sender);

      return extra.reply(
        `📈 *Stock Market*\n\n${marketLines}\n\n` +
        `*Your portfolio*\n${portfolioLines}\n\n` +
        `Wallet: *${fmt(user.wallet)}* 🪙\n\n` +
        `Buy: \/stocks buy <symbol> <quantity>\n` +
        `Sell: \/stocks sell <symbol> <quantity>`
      );
    }

    if (action === 'buy') {
      const symbol = args[1];
      const quantity = parsePositiveInt(args[2]);
      if (!symbol || !quantity) return extra.reply('❌ Usage: `/stocks buy <symbol> <quantity>`');

      const result = stocks.buyStock(extra.from, extra.sender, symbol, quantity);
      if (!result.ok) {
        if (result.error === 'stock') return extra.reply('❌ Stock not found. Use `/stocks view`.');
        if (result.error === 'funds') return extra.reply(`❌ Not enough coins. Need *${fmt(result.total)}* 🪙 but you only have *${fmt(result.balance)}* 🪙.`);
        return extra.reply('❌ Quantity must be a positive whole number.');
      }

      return extra.reply(
        `✅ Bought *${quantity}× ${result.stock.symbol}* (${result.stock.name}) for *${fmt(result.total)}* 🪙.\n` +
        `Price: *${fmt(result.stock.price)}* 🪙 each\n` +
        `Wallet: *${fmt(result.balance)}* 🪙`
      );
    }

    if (action === 'sell') {
      const symbol = args[1];
      const quantity = parsePositiveInt(args[2]);
      if (!symbol || !quantity) return extra.reply('❌ Usage: `/stocks sell <symbol> <quantity>`');

      const result = stocks.sellStock(extra.from, extra.sender, symbol, quantity);
      if (!result.ok) {
        if (result.error === 'stock') return extra.reply('❌ Stock not found. Use `/stocks view`.');
        if (result.error === 'holdings') return extra.reply(`❌ You only own *${fmt(result.owned)}× ${String(symbol).toUpperCase()}*.`);
        return extra.reply('❌ Quantity must be a positive whole number.');
      }

      return extra.reply(
        `✅ Sold *${quantity}× ${result.stock.symbol}* (${result.stock.name}) for *${fmt(result.total)}* 🪙.\n` +
        `Price: *${fmt(result.stock.price)}* 🪙 each\n` +
        `Wallet: *${fmt(result.balance)}* 🪙`
      );
    }

    return extra.reply('❌ Usage: `/stocks view`, `/stocks buy <symbol> <quantity>`, or `/stocks sell <symbol> <quantity>`');
  },
};
