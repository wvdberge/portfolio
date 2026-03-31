const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'wealth.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    type                 TEXT NOT NULL CHECK(type IN ('stock','etf','savings','real_estate','pension','crypto','other')),
    currency             TEXT NOT NULL DEFAULT 'EUR',
    target_allocation_pct REAL,
    ticker               TEXT,
    archived             INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS liabilities (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    type     TEXT NOT NULL CHECK(type IN ('mortgage','loan','other')),
    currency TEXT NOT NULL DEFAULT 'EUR'
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id       INTEGER NOT NULL REFERENCES assets(id),
    date           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK(type IN ('buy','sell','deposit','withdrawal','dividend','interest')),
    quantity       REAL,
    price_per_unit REAL,
    amount         REAL NOT NULL CHECK(amount >= 0),
    fee            REAL,
    notes          TEXT
  );

  CREATE TABLE IF NOT EXISTS asset_prices (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    date     TEXT NOT NULL,
    price    REAL NOT NULL CHECK(price > 0),
    UNIQUE(asset_id, date)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    date     TEXT NOT NULL,
    value    REAL NOT NULL CHECK(value >= 0),
    notes    TEXT
  );

  CREATE TABLE IF NOT EXISTS liability_snapshots (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    liability_id      INTEGER NOT NULL REFERENCES liabilities(id),
    date              TEXT NOT NULL,
    balance           REAL NOT NULL CHECK(balance >= 0),
    interest_rate_pct REAL,
    notes             TEXT
  );

  CREATE TABLE IF NOT EXISTS benchmark_prices (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    date  TEXT NOT NULL UNIQUE,
    price REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cpi_data (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL UNIQUE,
    cpi_value REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS import_mappings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    broker        TEXT NOT NULL,
    external_name TEXT NOT NULL,
    asset_id      INTEGER NOT NULL REFERENCES assets(id),
    UNIQUE(broker, external_name)
  );
`);

// ── Core computations ─────────────────────────────────────────────────────

function getNetHoldings(assetId) {
  const result = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'buy'  THEN quantity ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'sell' THEN quantity ELSE 0 END), 0) AS holdings
    FROM transactions
    WHERE asset_id = ? AND quantity IS NOT NULL
  `).get(assetId);
  return result ? result.holdings : 0;
}

function getAssetCurrentValue(assetId) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) return null;

  const latestSnapshot = db.prepare(
    'SELECT date, value FROM snapshots WHERE asset_id = ? ORDER BY date DESC LIMIT 1'
  ).get(assetId);

  // Illiquid types: snapshot only
  if (['real_estate', 'pension', 'other'].includes(asset.type)) {
    return latestSnapshot ? latestSnapshot.value : null;
  }

  // Liquid types: stock / etf / crypto
  if (['stock', 'etf', 'crypto'].includes(asset.type)) {
    const latestPrice = db.prepare(
      'SELECT date, price FROM asset_prices WHERE asset_id = ? ORDER BY date DESC LIMIT 1'
    ).get(assetId);

    // Override rule: snapshot more recent than latest price
    if (latestSnapshot && (!latestPrice || latestSnapshot.date > latestPrice.date)) {
      return latestSnapshot.value;
    }

    if (!latestPrice) return null;

    const holdings = getNetHoldings(assetId);
    return latestPrice.price * holdings;
  }

  // Savings
  if (asset.type === 'savings') {
    const latestPrice = db.prepare(
      'SELECT date FROM asset_prices WHERE asset_id = ? ORDER BY date DESC LIMIT 1'
    ).get(assetId);

    // Override rule
    if (latestSnapshot && (!latestPrice || latestSnapshot.date > latestPrice.date)) {
      return latestSnapshot.value;
    }

    const result = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('deposit','interest') THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'withdrawal'           THEN amount ELSE 0 END), 0) AS balance
      FROM transactions
      WHERE asset_id = ?
    `).get(assetId);
    return result ? result.balance : 0;
  }

  return null;
}

function getNetWorth() {
  const assets = db.prepare('SELECT id FROM assets WHERE archived = 0').all();
  let totalAssets = 0;
  for (const asset of assets) {
    const val = getAssetCurrentValue(asset.id);
    if (val !== null) totalAssets += val;
  }

  const liabilities = db.prepare('SELECT id FROM liabilities').all();
  let totalLiabilities = 0;
  for (const liability of liabilities) {
    const snap = db.prepare(
      'SELECT balance FROM liability_snapshots WHERE liability_id = ? ORDER BY date DESC LIMIT 1'
    ).get(liability.id);
    if (snap) totalLiabilities += snap.balance;
  }

  return totalAssets - totalLiabilities;
}

module.exports = { db, getAssetCurrentValue, getNetHoldings, getNetWorth };
