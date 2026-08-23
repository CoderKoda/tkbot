const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'economy.json');
const HOUR = 60 * 60 * 1000;

const DEFAULT_ITEMS = [
  { code: '1001', name: 'Raspberry Pi', income: 25, stock: 100, description: 'A small computer that generates passive income.' },
  { code: '1002', name: 'Laptop', income: 100, stock: 50, description: 'A portable computer with a stronger passive income stream.' },
  { code: '1003', name: 'Miner', income: 500, stock: 20, description: 'A dedicated mining machine with high passive income.' },
  { code: '1004', name: 'Server', income: 1000, stock: 5, description: 'A powerful server producing the maximum starter income.' },
];

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, '{}');
    }
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) || {};
    if (!db._v050) db._v050 = {};
    if (!Array.isArray(db._v050.items)) db._v050.items = DEFAULT_ITEMS.map((item) => ({ ...item }));
    if (!db._v050.tradingHall) db._v050.tradingHall = {};
    if (!Number.isFinite(db._v050.nextTradingCode)) db._v050.nextTradingCode = 5000;
    if (!Number.isFinite(db._v050.lastPassiveSync)) db._v050.lastPassiveSync = 0;
    return db;
  } catch (error) {
    console.error('[economy v0.50] database load error:', error.message);
    return { _v050: { items: DEFAULT_ITEMS.map((item) => ({ ...item })), tradingHall: {}, nextTradingCode: 5000, lastPassiveSync: 0 } };
  }
}

function saveDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function ensureUser(db, groupId, userId) {
  if (!db[groupId]) db[groupId] = {};
  if (!db[groupId][userId] || typeof db[groupId][userId] !== 'object') db[groupId][userId] = {};
  const user = db[groupId][userId];
  user.wallet = Number(user.wallet) || 0;
  user.bank = Number(user.bank) || 0;
  user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {};
  user.passiveItems = user.passiveItems && typeof user.passiveItems === 'object' ? user.passiveItems : {};
  return user;
}

function nextFourDigitCode(items) {
  const used = new Set(items.map((item) => String(item.code)));
  for (let n = 1000; n <= 4999; n += 1) {
    if (!used.has(String(n))) return String(n);
  }
  throw new Error('No passive item codes remain.');
}

function findItem(db, value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return null;
  return db._v050.items.find((item) =>
    String(item.code) === needle || item.name.toLowerCase() === needle
  ) || null;
}

function syncPassiveIncome() {
  const db = loadDB();
  const now = Date.now();
  const currentHour = Math.floor(now / HOUR) * HOUR;

  if (!db._v050.lastPassiveSync) {
    db._v050.lastPassiveSync = currentHour;
    saveDB(db);
    return { hours: 0, total: 0 };
  }

  const last = Number(db._v050.lastPassiveSync);
  if (currentHour <= last) return { hours: 0, total: 0 };

  const hours = Math.floor((currentHour - last) / HOUR);
  let total = 0;

  for (const [groupId, group] of Object.entries(db)) {
    if (groupId === '_v050' || !group || typeof group !== 'object') continue;
    for (const [userId, rawUser] of Object.entries(group)) {
      const user = ensureUser(db, groupId, userId);
      let earned = 0;
      for (const [code, quantityRaw] of Object.entries(user.passiveItems)) {
        const quantity = Math.max(0, Number(quantityRaw) || 0);
        const item = db._v050.items.find((entry) => String(entry.code) === String(code));
        if (!item || quantity <= 0) continue;
        earned += Number(item.income) * quantity * hours;
      }
      if (earned > 0) {
        user.wallet += earned;
        total += earned;
      }
    }
  }

  db._v050.lastPassiveSync = currentHour;
  saveDB(db);
  return { hours, total };
}

function startPassiveIncomeScheduler() {
  syncPassiveIncome();
  if (global.__tkbotV050PassiveScheduler) return;
  global.__tkbotV050PassiveScheduler = setInterval(() => {
    try { syncPassiveIncome(); } catch (error) { console.error('[economy v0.50] passive sync error:', error.message); }
  }, 30 * 1000);
  global.__tkbotV050PassiveScheduler.unref?.();
}

function getItems() {
  syncPassiveIncome();
  return loadDB()._v050.items;
}

function addItem(name, income, description) {
  const cleanName = String(name || '').trim();
  const cleanDescription = String(description || '').trim();
  const cleanIncome = Number(income);
  if (!cleanName || !cleanDescription || !Number.isInteger(cleanIncome) || cleanIncome <= 0) {
    return { ok: false, error: 'invalid' };
  }

  const db = loadDB();
  if (db._v050.items.some((item) => item.name.toLowerCase() === cleanName.toLowerCase())) {
    return { ok: false, error: 'exists' };
  }

  const item = {
    code: nextFourDigitCode(db._v050.items),
    name: cleanName,
    income: cleanIncome,
    stock: 0,
    description: cleanDescription,
  };
  db._v050.items.push(item);
  saveDB(db);
  return { ok: true, item };
}

function addStock(value, amount) {
  const cleanAmount = Number(amount);
  if (!Number.isInteger(cleanAmount) || cleanAmount <= 0) return { ok: false, error: 'invalid' };
  const db = loadDB();
  const item = findItem(db, value);
  if (!item) return { ok: false, error: 'item' };
  item.stock += cleanAmount;
  saveDB(db);
  return { ok: true, item, amount: cleanAmount };
}

function buyPassive(groupId, userId, value, quantity = 1) {
  syncPassiveIncome();
  const cleanQuantity = Number(quantity);
  if (!Number.isInteger(cleanQuantity) || cleanQuantity <= 0) return { ok: false, error: 'invalid' };

  const db = loadDB();
  const item = findItem(db, value);
  if (!item) return { ok: false, error: 'item' };
  if (item.stock < cleanQuantity) return { ok: false, error: 'stock', item };

  const price = item.income * 100 * cleanQuantity;
  const user = ensureUser(db, groupId, userId);
  if (user.wallet < price) return { ok: false, error: 'funds', item, price };

  user.wallet -= price;
  item.stock -= cleanQuantity;
  user.passiveItems[item.code] = (Number(user.passiveItems[item.code]) || 0) + cleanQuantity;
  saveDB(db);
  return { ok: true, item, quantity: cleanQuantity, price, user };
}

function getInventory(groupId, userId) {
  syncPassiveIncome();
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  return { user, items: db._v050.items.filter((item) => (Number(user.passiveItems[item.code]) || 0) > 0) };
}

function sellToHall(groupId, userId, value, price) {
  syncPassiveIncome();
  const cleanPrice = Number(price);
  if (!Number.isInteger(cleanPrice) || cleanPrice <= 0) return { ok: false, error: 'price' };

  const db = loadDB();
  const item = findItem(db, value);
  if (!item) return { ok: false, error: 'item' };
  const user = ensureUser(db, groupId, userId);
  const owned = Number(user.passiveItems[item.code]) || 0;
  if (owned < 1) return { ok: false, error: 'owned', item };

  let code = Number(db._v050.nextTradingCode) || 5000;
  const used = new Set(Object.keys(db._v050.tradingHall));
  while (used.has(String(code))) {
    code += 1;
    if (code > 9999) code = 5000;
  }
  db._v050.nextTradingCode = code + 1 > 9999 ? 5000 : code + 1;

  user.passiveItems[item.code] = owned - 1;
  if (user.passiveItems[item.code] <= 0) delete user.passiveItems[item.code];

  db._v050.tradingHall[String(code)] = {
    code: String(code),
    itemCode: item.code,
    itemName: item.name,
    income: item.income,
    seller: userId,
    groupId,
    price: cleanPrice,
    listedAt: Date.now(),
  };

  saveDB(db);
  return { ok: true, listing: db._v050.tradingHall[String(code)], item };
}

function getListings(groupId) {
  syncPassiveIncome();
  const db = loadDB();
  return Object.values(db._v050.tradingHall).filter((listing) => listing.groupId === groupId);
}

function buyFromHall(groupId, userId, listingCode) {
  syncPassiveIncome();
  const db = loadDB();
  const listing = db._v050.tradingHall[String(listingCode).trim()];
  if (!listing || listing.groupId !== groupId) return { ok: false, error: 'listing' };
  if (listing.seller === userId) return { ok: false, error: 'self' };

  const buyer = ensureUser(db, groupId, userId);
  if (buyer.wallet < listing.price) return { ok: false, error: 'funds', listing };

  const seller = ensureUser(db, groupId, listing.seller);
  buyer.wallet -= listing.price;
  seller.wallet += listing.price;
  buyer.passiveItems[listing.itemCode] = (Number(buyer.passiveItems[listing.itemCode]) || 0) + 1;
  delete db._v050.tradingHall[String(listingCode).trim()];
  saveDB(db);

  return { ok: true, listing, buyer, seller };
}

function formatCoins(value) {
  return Number(value || 0).toLocaleString('en-US');
}

module.exports = {
  DEFAULT_ITEMS,
  syncPassiveIncome,
  startPassiveIncomeScheduler,
  getItems,
  addItem,
  addStock,
  buyPassive,
  getInventory,
  sellToHall,
  getListings,
  buyFromHall,
  formatCoins,
};
