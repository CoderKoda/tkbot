const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'economy.json');
const HOUR = 60 * 60 * 1000;

const DEFAULT_ITEMS = [
  { typeCode: '1001', name: 'RaspberryPi', income: 25, stock: 50, description: 'A small computer that generates passive income.' },
  { typeCode: '1002', name: 'Laptop', income: 100, stock: 40, description: 'A portable computer with a stronger passive income stream.' },
  { typeCode: '1003', name: 'Miner', income: 500, stock: 30, description: 'A dedicated mining machine with high passive income.' },
  { typeCode: '1004', name: 'Server', income: 1000, stock: 20, description: 'A powerful server producing the maximum starter income.' },
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
    if (!Number.isFinite(db._v050.lastPassiveSync)) db._v050.lastPassiveSync = 0;
    return db;
  } catch (error) {
    console.error('[economy v0.50] database load error:', error.message);
    return { _v050: { items: DEFAULT_ITEMS.map((item) => ({ ...item })), tradingHall: {}, lastPassiveSync: 0 } };
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

  if (!user.passiveItems || typeof user.passiveItems !== 'object' || Array.isArray(user.passiveItems)) {
    user.passiveItems = {};
  }

  migrateLegacyPassiveInventory(user);
  return user;
}

function migrateLegacyPassiveInventory(user) {
  const legacy = user.passiveItems;
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy) || user._v050Migrated) return;
  const converted = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (typeof value === 'number' && value > 0) {
      converted[`legacy:${key}`] = value;
    } else if (value && typeof value === 'object') {
      converted[key] = value;
    }
  }
  user.passiveItems = converted;
  user._v050Migrated = true;
}

function getAllOwnedItems(user) {
  return Object.values(user.passiveItems || {}).filter((entry) => entry && typeof entry === 'object');
}

function usedItemIds(db) {
  const used = new Set();
  for (const [groupId, group] of Object.entries(db)) {
    if (groupId === '_v050' || !group || typeof group !== 'object') continue;
    for (const rawUser of Object.values(group)) {
      const user = rawUser && typeof rawUser === 'object' ? rawUser : {};
      for (const id of Object.keys(user.passiveItems || {})) {
        if (/^\d{4}$/.test(id)) used.add(id);
      }
    }
  }
  for (const listing of Object.values(db._v050.tradingHall || {})) {
    if (listing?.itemId) used.add(String(listing.itemId));
  }
  return used;
}

function generateUniqueItemId(db) {
  const used = usedItemIds(db);
  for (let n = 2000; n <= 9999; n += 1) {
    const id = String(n);
    if (!used.has(id)) return id;
  }
  throw new Error('No unique four-digit item IDs remain.');
}

function findItemType(db, value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return null;
  return db._v050.items.find((item) =>
    String(item.typeCode) === needle || item.name.toLowerCase() === needle
  ) || null;
}

function findOwnedItem(db, user, itemId) {
  const id = String(itemId || '').trim();
  const item = user.passiveItems?.[id];
  if (!item || typeof item !== 'object') return null;
  const type = db._v050.items.find((entry) => String(entry.typeCode) === String(item.typeCode));
  if (!type) return null;
  return { id, instance: item, type };
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
    for (const [userId] of Object.entries(group)) {
      const user = ensureUser(db, groupId, userId);
      let earned = 0;
      for (const owned of getAllOwnedItems(user)) {
        const type = db._v050.items.find((entry) => String(entry.typeCode) === String(owned.typeCode));
        if (!type) continue;
        earned += Number(type.income) * hours;
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
  if (!cleanName || !cleanDescription || !Number.isInteger(cleanIncome) || cleanIncome <= 0) return { ok: false, error: 'invalid' };

  const db = loadDB();
  if (db._v050.items.some((item) => item.name.toLowerCase() === cleanName.toLowerCase())) return { ok: false, error: 'exists' };

  const item = {
    typeCode: generateUniqueItemId({ _v050: { items: db._v050.items, tradingHall: {} } }),
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
  const item = findItemType(db, value);
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
  const type = findItemType(db, value);
  if (!type) return { ok: false, error: 'item' };
  if (type.stock < cleanQuantity) return { ok: false, error: 'stock', item: type };

  const price = type.income * 10 * cleanQuantity;
  const user = ensureUser(db, groupId, userId);
  if (user.wallet < price) return { ok: false, error: 'funds', item: type, price };

  const created = [];
  for (let i = 0; i < cleanQuantity; i += 1) {
    const itemId = generateUniqueItemId(db);
    user.passiveItems[itemId] = {
      typeCode: type.typeCode,
      acquiredAt: Date.now(),
    };
    created.push(itemId);
  }

  user.wallet -= price;
  type.stock -= cleanQuantity;
  saveDB(db);
  return { ok: true, item: type, quantity: cleanQuantity, price, itemIds: created, user };
}

function setBalance(groupId, userId, balance) {
  syncPassiveIncome();
  const cleanBalance = Number(balance);
  if (!Number.isFinite(cleanBalance) || cleanBalance < 0) return { ok: false, error: 'balance' };

  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  user.wallet = cleanBalance;
  saveDB(db);
  return { ok: true, balance: cleanBalance, user };
}

function getInventory(groupId, userId) {
  syncPassiveIncome();
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const items = Object.entries(user.passiveItems || {}).map(([id, instance]) => ({
    id,
    ...instance,
    type: db._v050.items.find((entry) => String(entry.typeCode) === String(instance?.typeCode)),
  })).filter((entry) => entry.type && instanceIsValid(entry));
  return { user, items };
}

function instanceIsValid(entry) {
  return entry && entry.type && entry.typeCode;
}

function sellToHall(groupId, userId, itemId, price) {
  syncPassiveIncome();
  const cleanPrice = Number(price);
  if (!Number.isInteger(cleanPrice) || cleanPrice <= 0) return { ok: false, error: 'price' };

  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const owned = findOwnedItem(db, user, itemId);
  if (!owned) return { ok: false, error: 'owned' };

  const listingCode = owned.id;
  db._v050.tradingHall[listingCode] = {
    code: listingCode,
    itemId: listingCode,
    typeCode: owned.type.typeCode,
    itemName: owned.type.name,
    income: owned.type.income,
    seller: userId,
    groupId,
    price: cleanPrice,
    listedAt: Date.now(),
  };

  delete user.passiveItems[listingCode];
  saveDB(db);
  return { ok: true, listing: db._v050.tradingHall[listingCode], item: owned.type };
}

function getListings(groupId) {
  syncPassiveIncome();
  const db = loadDB();
  return Object.values(db._v050.tradingHall).filter((listing) => listing.groupId === groupId);
}

function buyFromHall(groupId, userId, listingCode) {
  syncPassiveIncome();
  const db = loadDB();
  const code = String(listingCode || '').trim();
  const listing = db._v050.tradingHall[code];
  if (!listing || listing.groupId !== groupId) return { ok: false, error: 'listing' };
  if (listing.seller === userId) return { ok: false, error: 'self' };

  const buyer = ensureUser(db, groupId, userId);
  if (buyer.wallet < listing.price) return { ok: false, error: 'funds', listing };

  const seller = ensureUser(db, groupId, listing.seller);
  buyer.wallet -= listing.price;
  seller.wallet += listing.price;
  buyer.passiveItems[listing.itemId] = {
    typeCode: listing.typeCode,
    acquiredAt: Date.now(),
  };
  delete db._v050.tradingHall[code];
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
  setBalance,
  getInventory,
  sellToHall,
  getListings,
  buyFromHall,
  formatCoins,
};
