const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'economy.json');
const TICK_MS = 60 * 1000;
const MIN_PRICE = 10;
const STARTING_PRICE = 100;
const MIN_CHANGE = 5;
const MAX_CHANGE = 20;

const DEFAULT_STOCKS = [
  { symbol: 'TKC', name: 'TK Corp' },
  { symbol: 'NOVA', name: 'Nova Labs' },
  { symbol: 'BYTE', name: 'Byte Systems' },
];

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, '{}');
    }
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) || {};
    if (!db._stocks || typeof db._stocks !== 'object') db._stocks = {};
    if (!db._stocks.market || typeof db._stocks.market !== 'object') db._stocks.market = {};
    if (!db._stocks.holdings || typeof db._stocks.holdings !== 'object') db._stocks.holdings = {};
    if (!Number.isFinite(db._stocks.lastTick)) db._stocks.lastTick = 0;
    for (const stock of DEFAULT_STOCKS) {
      if (!db._stocks.market[stock.symbol]) {
        db._stocks.market[stock.symbol] = { ...stock, price: STARTING_PRICE };
      }
    }
    return db;
  } catch (error) {
    console.error('[stocks] database load error:', error.message);
    return { _stocks: { market: {}, holdings: {}, lastTick: 0 } };
  }
}

function saveDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function ensureUserHoldings(db, groupId, userId) {
  if (!db._stocks.holdings[groupId]) db._stocks.holdings[groupId] = {};
  if (!db._stocks.holdings[groupId][userId]) db._stocks.holdings[groupId][userId] = {};
  return db._stocks.holdings[groupId][userId];
}

function tickStocks() {
  const db = loadDB();
  const now = Date.now();
  const currentMinute = Math.floor(now / TICK_MS) * TICK_MS;
  if (!db._stocks.lastTick) {
    db._stocks.lastTick = currentMinute;
    saveDB(db);
    return;
  }
  if (currentMinute <= db._stocks.lastTick) return;
  const ticks = Math.floor((currentMinute - Number(db._stocks.lastTick)) / TICK_MS);
  for (const stock of Object.values(db._stocks.market)) {
    for (let i = 0; i < ticks; i += 1) {
      const magnitude = MIN_CHANGE + Math.floor(Math.random() * (MAX_CHANGE - MIN_CHANGE + 1));
      const direction = Math.random() < 0.5 ? -1 : 1;
      stock.price = Math.max(MIN_PRICE, Math.round(Number(stock.price) + direction * magnitude));
    }
  }
  db._stocks.lastTick = currentMinute;
  saveDB(db);
}

function startStockScheduler() {
  tickStocks();
  if (global.__tkbotStockScheduler) return;
  global.__tkbotStockScheduler = setInterval(() => {
    try { tickStocks(); } catch (error) { console.error('[stocks] tick error:', error.message); }
  }, 10 * 1000);
  global.__tkbotStockScheduler.unref?.();
}

function getStocks() {
  tickStocks();
  return Object.values(loadDB()._stocks.market);
}

function findStock(db, value) {
  const needle = String(value || '').trim().toLowerCase();
  const symbol = normalizeSymbol(value);
  return Object.values(db._stocks.market).find((stock) =>
    stock.symbol === symbol || stock.name.toLowerCase() === needle
  ) || null;
}

function createStock(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, error: 'name' };
  const db = loadDB();
  const exists = Object.values(db._stocks.market).some((stock) => stock.name.toLowerCase() === cleanName.toLowerCase());
  if (exists) return { ok: false, error: 'exists' };

  const words = cleanName.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  let base = words.map((word) => word[0]).join('').slice(0, 5) || 'STK';
  if (base.length < 3) base = (base + 'STK').slice(0, 5);
  let symbol = base;
  let suffix = 2;
  while (db._stocks.market[symbol]) {
    symbol = `${base.slice(0, 4)}${suffix}`.slice(0, 5);
    suffix += 1;
  }

  const stock = { symbol, name: cleanName, price: STARTING_PRICE };
  db._stocks.market[symbol] = stock;
  saveDB(db);
  return { ok: true, stock };
}

function buyStock(groupId, userId, value, quantity) {
  tickStocks();
  const cleanQuantity = Number(quantity);
  if (!Number.isInteger(cleanQuantity) || cleanQuantity < 1) return { ok: false, error: 'quantity' };

  const db = loadDB();
  const stock = findStock(db, value);
  if (!stock) return { ok: false, error: 'stock' };
  const cost = Number(stock.price) * cleanQuantity;

  if (!db[groupId] || !db[groupId][userId]) db[groupId] = { ...(db[groupId] || {}) , [userId]: {} };
  const user = db[groupId][userId];
  user.wallet = Number(user.wallet) || 0;
  if (user.wallet < cost) return { ok: false, error: 'funds', price: stock.price, total: cost, balance: user.wallet };

  const holdings = ensureUserHoldings(db, groupId, userId);
  holdings[stock.symbol] = (Number(holdings[stock.symbol]) || 0) + cleanQuantity;
  user.wallet -= cost;
  saveDB(db);
  return { ok: true, stock, quantity: cleanQuantity, total: cost, balance: user.wallet, holdings };
}

function sellStock(groupId, userId, value, quantity) {
  tickStocks();
  const cleanQuantity = Number(quantity);
  if (!Number.isInteger(cleanQuantity) || cleanQuantity < 1) return { ok: false, error: 'quantity' };

  const db = loadDB();
  const stock = findStock(db, value);
  if (!stock) return { ok: false, error: 'stock' };
  const holdings = ensureUserHoldings(db, groupId, userId);
  const owned = Number(holdings[stock.symbol]) || 0;
  if (owned < cleanQuantity) return { ok: false, error: 'holdings', owned };

  const valueReceived = Number(stock.price) * cleanQuantity;
  if (!db[groupId] || !db[groupId][userId]) db[groupId] = { ...(db[groupId] || {}), [userId]: {} };
  const user = db[groupId][userId];
  user.wallet = Number(user.wallet) || 0;
  holdings[stock.symbol] = owned - cleanQuantity;
  if (holdings[stock.symbol] <= 0) delete holdings[stock.symbol];
  user.wallet += valueReceived;
  saveDB(db);
  return { ok: true, stock, quantity: cleanQuantity, total: valueReceived, balance: user.wallet, holdings };
}

function getPortfolio(groupId, userId) {
  tickStocks();
  const db = loadDB();
  const holdings = ensureUserHoldings(db, groupId, userId);
  const entries = Object.entries(holdings)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([symbol, qty]) => {
      const stock = db._stocks.market[symbol];
      if (!stock) return null;
      return { ...stock, quantity: Number(qty), value: Number(stock.price) * Number(qty) };
    })
    .filter(Boolean);
  return entries;
}

module.exports = {
  DEFAULT_STOCKS,
  STARTING_PRICE,
  startStockScheduler,
  getStocks,
  createStock,
  buyStock,
  sellStock,
  getPortfolio,
};
