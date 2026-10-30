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
    archived             INTEGER NOT NULL DEFAULT 0,
    price_source         TEXT CHECK(price_source IN ('alpha_vantage','meesman','brand_new_day')) DEFAULT NULL
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

// ── Migrations ────────────────────────────────────────────────────────────────
// price_source column (Phase 2b) — idempotent
try {
  db.exec(`ALTER TABLE assets ADD COLUMN price_source TEXT CHECK(price_source IN ('alpha_vantage','meesman','brand_new_day')) DEFAULT NULL`);
} catch (e) {
  if (!e.message.includes('duplicate column')) throw e;
}

// Add 'fee' to transactions type CHECK — requires table recreation (SQLite limitation)
{
  const txSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'").get();
  if (txSchema && !txSchema.sql.includes("'fee'")) {
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN;
        ALTER TABLE transactions RENAME TO _transactions_old;
        CREATE TABLE transactions (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id       INTEGER NOT NULL REFERENCES assets(id),
          date           TEXT NOT NULL,
          type           TEXT NOT NULL CHECK(type IN ('buy','sell','deposit','withdrawal','dividend','interest','fee')),
          quantity       REAL,
          price_per_unit REAL,
          amount         REAL NOT NULL CHECK(amount >= 0),
          fee            REAL,
          notes          TEXT
        );
        INSERT INTO transactions SELECT * FROM _transactions_old;
        DROP TABLE _transactions_old;
        COMMIT;
      `);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(dateStr) {
  // Parse YYYY-MM-DD as local noon to avoid midnight timezone boundary issues
  return new Date(dateStr + 'T12:00:00');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Core computations ─────────────────────────────────────────────────────────

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
        COALESCE(SUM(CASE WHEN type IN ('deposit','interest')    THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type IN ('withdrawal','fee') THEN amount ELSE 0 END), 0) AS balance
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

// ── Point-in-time value ───────────────────────────────────────────────────────

function getAssetValueAtDate(assetId, dateStr) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) return null;

  const latestSnapshot = db.prepare(
    'SELECT date, value FROM snapshots WHERE asset_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
  ).get(assetId, dateStr);

  if (['real_estate', 'pension', 'other'].includes(asset.type)) {
    return latestSnapshot ? latestSnapshot.value : null;
  }

  if (['stock', 'etf', 'crypto'].includes(asset.type)) {
    const latestPrice = db.prepare(
      'SELECT date, price FROM asset_prices WHERE asset_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
    ).get(assetId, dateStr);

    if (latestSnapshot && (!latestPrice || latestSnapshot.date >= latestPrice.date)) {
      return latestSnapshot.value;
    }
    if (!latestPrice) return null;

    const result = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'buy'  THEN quantity ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'sell' THEN quantity ELSE 0 END), 0) AS holdings
      FROM transactions
      WHERE asset_id = ? AND date <= ? AND quantity IS NOT NULL
    `).get(assetId, dateStr);
    return latestPrice.price * (result ? result.holdings : 0);
  }

  if (asset.type === 'savings') {
    const latestPriceRow = db.prepare(
      'SELECT date FROM asset_prices WHERE asset_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
    ).get(assetId, dateStr);

    if (latestSnapshot && (!latestPriceRow || latestSnapshot.date >= latestPriceRow.date)) {
      return latestSnapshot.value;
    }

    // Without deposits the transaction balance is just interest/fees, not the account value
    const hasDeposit = db.prepare(
      "SELECT 1 FROM transactions WHERE asset_id = ? AND type = 'deposit' AND date <= ? LIMIT 1"
    ).get(assetId, dateStr);
    if (!hasDeposit) return null;

    const result = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('deposit','interest')    THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type IN ('withdrawal','fee') THEN amount ELSE 0 END), 0) AS balance
      FROM transactions
      WHERE asset_id = ? AND date <= ?
    `).get(assetId, dateStr);
    return result ? result.balance : 0;
  }

  return null;
}

// True when the asset held something by dateStr but can't be valued then
// (snapshot-only asset with no snapshot yet). Treating that as 0 inflates returns.
function isUnvalued(assetId, dateStr) {
  if (getAssetValueAtDate(assetId, dateStr) !== null) return false;
  return !!db.prepare('SELECT 1 FROM transactions WHERE asset_id = ? AND date <= ? LIMIT 1').get(assetId, dateStr);
}

// excludeTypes: asset types left out, e.g. ['real_estate'] for returns without the house
function activeAssets(excludeTypes = []) {
  return db.prepare('SELECT id, type FROM assets WHERE archived = 0').all().filter(a => !excludeTypes.includes(a.type));
}

function anyUnvalued(dateStr, excludeTypes = []) {
  return activeAssets(excludeTypes).some(a => isUnvalued(a.id, dateStr));
}

// Investment value for XIRR: assets only. Liabilities have no recorded cash flows
// (repayments aren't booked), so subtracting them would show as a loss.
function getAssetsValueAtDate(dateStr, excludeTypes = []) {
  let total = 0;
  for (const a of activeAssets(excludeTypes)) {
    const v = getAssetValueAtDate(a.id, dateStr);
    if (v !== null) total += v;
  }
  return total;
}

function getNetWorthAtDate(dateStr) {
  const assets = db.prepare('SELECT id FROM assets WHERE archived = 0').all();
  let total = 0;
  for (const asset of assets) {
    const v = getAssetValueAtDate(asset.id, dateStr);
    if (v !== null) total += v;
  }
  const liabilities = db.prepare('SELECT id FROM liabilities').all();
  for (const liability of liabilities) {
    const snap = db.prepare(
      'SELECT balance FROM liability_snapshots WHERE liability_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
    ).get(liability.id, dateStr);
    if (snap) total -= snap.balance;
  }
  return total;
}

// ── XIRR ─────────────────────────────────────────────────────────────────────

/**
 * XIRR via Newton-Raphson with bisection fallback.
 * @param {Array<{date: Date, amount: number}>} cashflows - negative=outflow, positive=inflow
 * @returns {number|null} annualized rate or null on failure
 */
function xirr(cashflows) {
  const r = xirrRaw(cashflows);
  return r !== null && Math.abs(r) < 1e-9 ? 0 : r; // no "-0.00%" from solver noise
}

function xirrRaw(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  if (!cashflows.some(cf => cf.amount < 0)) return null;
  if (!cashflows.some(cf => cf.amount > 0)) return null;

  const t0 = cashflows[0].date.getTime();
  const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

  function npv(r) {
    if (r <= -1) return NaN;
    let sum = 0;
    for (const cf of cashflows) {
      const t = (cf.date.getTime() - t0) / MS_PER_YEAR;
      sum += cf.amount / Math.pow(1 + r, t);
    }
    return sum;
  }

  function dnpv(r) {
    if (r <= -1) return NaN;
    let sum = 0;
    for (const cf of cashflows) {
      const t = (cf.date.getTime() - t0) / MS_PER_YEAR;
      sum -= t * cf.amount / Math.pow(1 + r, t + 1);
    }
    return sum;
  }

  // Newton-Raphson
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(r);
    const df = dnpv(r);
    if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-14) break;
    const step = f / df;
    const rNew = r - step;
    if (!isFinite(rNew) || rNew <= -1) break;
    r = rNew;
    if (Math.abs(step) < 1e-10) return r;
  }

  // Bisection fallback — find a bracket with opposite signs
  const CANDIDATES = [-0.9999, -0.5, -0.1, 0, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 50];
  let lo = null, hi = null, fLo = null;

  for (let i = 0; i < CANDIDATES.length - 1; i++) {
    const a = CANDIDATES[i], b = CANDIDATES[i + 1];
    const fa = npv(a), fb = npv(b);
    if (!isFinite(fa) || !isFinite(fb)) continue;
    if (Math.sign(fa) !== Math.sign(fb)) {
      lo = a; hi = b; fLo = fa;
      break;
    }
  }
  if (lo === null) return null;

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (!isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-7 || (hi - lo) < 1e-12) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; }
    else hi = mid;
  }

  return null;
}

function buildCashflows(assetIds, fromDateStr, toDateStr) {
  const cfs = [];
  for (const assetId of assetIds) {
    // A savings account valued from its transactions already holds its interest;
    // counting it as a payout too would double it. With a snapshot, interest is paid out.
    const asset = db.prepare('SELECT type FROM assets WHERE id = ?').get(assetId);
    const hasSnapshot = db.prepare('SELECT 1 FROM snapshots WHERE asset_id = ? LIMIT 1').get(assetId);
    const interestInside = asset?.type === 'savings' && !hasSnapshot;
    const query = fromDateStr
      ? 'SELECT date, type, amount FROM transactions WHERE asset_id = ? AND date > ? AND date <= ? ORDER BY date'
      : 'SELECT date, type, amount FROM transactions WHERE asset_id = ? AND date <= ? ORDER BY date';
    const params = fromDateStr ? [assetId, fromDateStr, toDateStr] : [assetId, toDateStr];
    for (const tx of db.prepare(query).all(...params)) {
      if (tx.type === 'interest' && interestInside) continue;
      const isOut = tx.type === 'buy' || tx.type === 'deposit' || tx.type === 'fee';
      cfs.push({ date: parseDate(tx.date), amount: isOut ? -tx.amount : tx.amount });
    }

    // Asset tracked only by snapshots (house, Raisin): its first snapshot is the
    // contribution, so later value changes count as return, not the whole value
    const contributed = db.prepare(
      "SELECT 1 FROM transactions WHERE asset_id = ? AND type IN ('buy','deposit') LIMIT 1"
    ).get(assetId);
    const archived = db.prepare('SELECT archived FROM assets WHERE id = ?').get(assetId)?.archived;
    if (!contributed && !archived) { // archived: no closing value, so no opening either
      const first = db.prepare('SELECT date, value FROM snapshots WHERE asset_id = ? ORDER BY date LIMIT 1').get(assetId);
      if (first && first.value > 0 && (!fromDateStr || first.date > fromDateStr) && first.date <= toDateStr) {
        cfs.push({ date: parseDate(first.date), amount: -first.value });
      }
    }
  }
  return cfs;
}

function getAssetXirr(assetId, period = 'all') {
  const today = todayStr();
  let periodStart = null;

  if (period === '1y') {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    periodStart = d.toISOString().slice(0, 10);
  } else if (period === '3y') {
    const d = new Date(); d.setFullYear(d.getFullYear() - 3);
    periodStart = d.toISOString().slice(0, 10);
  }

  const cfs = [];

  if (periodStart) {
    if (isUnvalued(assetId, periodStart)) return null;
    const openVal = getAssetValueAtDate(assetId, periodStart);
    if (openVal !== null && openVal > 0) {
      cfs.push({ date: parseDate(periodStart), amount: -openVal });
    }
  }

  cfs.push(...buildCashflows([assetId], periodStart, today));

  const curVal = getAssetCurrentValue(assetId);
  if (curVal !== null && curVal >= 0) {
    cfs.push({ date: parseDate(today), amount: curVal });
  }

  if (cfs.length < 2) return null;
  cfs.sort((a, b) => a.date - b.date);
  return xirr(cfs);
}

// Archived assets included: their past cash flows still belong to the return
function assetIdsForXirr(excludeTypes = []) {
  return db.prepare('SELECT id, type FROM assets').all().filter(a => !excludeTypes.includes(a.type)).map(a => a.id);
}

// Portfolio XIRR over one calendar-year window (start = prior year end)
function portfolioXirrBetween(fromStr, toStr, excludeTypes = []) {
  if (anyUnvalued(fromStr, excludeTypes) || anyUnvalued(toStr, excludeTypes)) return null;
  const cfs = [];
  const startVal = getAssetsValueAtDate(fromStr, excludeTypes);
  if (startVal > 0) cfs.push({ date: parseDate(fromStr), amount: -startVal });
  cfs.push(...buildCashflows(assetIdsForXirr(excludeTypes), fromStr, toStr));
  cfs.push({ date: parseDate(toStr), amount: getAssetsValueAtDate(toStr, excludeTypes) });
  cfs.sort((a, b) => a.date - b.date);
  return xirr(cfs);
}

function getPortfolioXirr(period = 'all', excludeTypes = []) {
  const today = todayStr();
  let periodStart = null;

  if (period === '1y') {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    periodStart = d.toISOString().slice(0, 10);
  } else if (period === '3y') {
    const d = new Date(); d.setFullYear(d.getFullYear() - 3);
    periodStart = d.toISOString().slice(0, 10);
  }

  const cfs = [];

  if (periodStart) {
    if (anyUnvalued(periodStart, excludeTypes)) return null;
    const openVal = getAssetsValueAtDate(periodStart, excludeTypes);
    if (openVal > 0) cfs.push({ date: parseDate(periodStart), amount: -openVal });
  }

  cfs.push(...buildCashflows(assetIdsForXirr(excludeTypes), periodStart, today));

  cfs.push({ date: parseDate(today), amount: getAssetsValueAtDate(today, excludeTypes) });

  if (cfs.length < 2) return null;
  cfs.sort((a, b) => a.date - b.date);
  return xirr(cfs);
}

// ── Benchmark & CPI ───────────────────────────────────────────────────────────

function getBenchmarkReturn(fromStr, toStr) {
  const startRow = db.prepare(
    'SELECT price FROM benchmark_prices WHERE date <= ? ORDER BY date DESC LIMIT 1'
  ).get(fromStr);
  const endRow = db.prepare(
    'SELECT price FROM benchmark_prices WHERE date <= ? ORDER BY date DESC LIMIT 1'
  ).get(toStr);

  if (!startRow || !endRow || startRow.price <= 0) return null;

  const years = (parseDate(toStr) - parseDate(fromStr)) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return null;

  return Math.pow(endRow.price / startRow.price, 1 / years) - 1;
}

function getRealReturn(xirrValue, fromStr, toStr) {
  if (xirrValue === null) return null;

  const startCpi = db.prepare(
    'SELECT cpi_value FROM cpi_data WHERE date <= ? ORDER BY date DESC LIMIT 1'
  ).get(fromStr);
  const endCpi = db.prepare(
    'SELECT cpi_value FROM cpi_data WHERE date <= ? ORDER BY date DESC LIMIT 1'
  ).get(toStr);

  if (!startCpi || !endCpi || startCpi.cpi_value <= 0) return null;

  const years = (parseDate(toStr) - parseDate(fromStr)) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return null;

  const annualizedCpi = Math.pow(endCpi.cpi_value / startCpi.cpi_value, 1 / years) - 1;
  return xirrValue - annualizedCpi;
}

// ── Net Worth History ─────────────────────────────────────────────────────────

function getNetWorthHistory() {
  const rows = [
    db.prepare('SELECT MIN(date) AS d FROM transactions').get(),
    db.prepare('SELECT MIN(date) AS d FROM snapshots').get(),
    db.prepare('SELECT MIN(date) AS d FROM asset_prices').get(),
  ].map(r => r?.d).filter(Boolean);

  if (rows.length === 0) return [];

  const earliest = rows.sort()[0];
  const start = parseDate(earliest);
  const now = new Date();

  const assets = db.prepare('SELECT * FROM assets WHERE archived = 0').all();
  const liabilityIds = db.prepare('SELECT id FROM liabilities').all().map(l => l.id);

  const result = [];
  let y = start.getFullYear(), m = start.getMonth(); // 0-indexed month

  while (true) {
    // last day of month (y, m)
    const monthEnd = new Date(y, m + 1, 0);
    if (monthEnd > now) break;

    const dateStr = monthEnd.toISOString().slice(0, 10);
    const breakdown = { stock: 0, etf: 0, savings: 0, real_estate: 0, pension: 0, crypto: 0, other: 0, liabilities: 0 };
    let allNull = true;

    for (const asset of assets) {
      const v = getAssetValueAtDate(asset.id, dateStr);
      if (v !== null) {
        allNull = false;
        breakdown[asset.type] += v;
      }
    }

    if (!allNull) {
      let liabTotal = 0;
      for (const lid of liabilityIds) {
        const snap = db.prepare(
          'SELECT balance FROM liability_snapshots WHERE liability_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
        ).get(lid, dateStr);
        if (snap) liabTotal += snap.balance;
      }
      breakdown.liabilities = liabTotal;

      const assetTotal = Object.entries(breakdown)
        .filter(([k]) => k !== 'liabilities')
        .reduce((s, [, v]) => s + v, 0);

      result.push({ date: dateStr, net_worth: assetTotal - liabTotal, breakdown });
    }

    m++;
    if (m > 11) { m = 0; y++; }
  }

  return result;
}

// ── Contributions vs Growth ───────────────────────────────────────────────────

function getContributionsVsGrowth() {
  const earliest = db.prepare('SELECT MIN(date) AS d FROM transactions').get();
  if (!earliest?.d) return [];

  const firstYear = parseDate(earliest.d).getFullYear();
  const lastYear = new Date().getFullYear();
  const today = todayStr();
  const result = [];

  for (let year = firstYear; year <= lastYear; year++) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const actualEnd = yearEnd > today ? today : yearEnd;
    const priorEnd = `${year - 1}-12-31`;

    const contrRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('buy','deposit') THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type IN ('sell','withdrawal') THEN amount ELSE 0 END), 0) AS contributions
      FROM transactions WHERE date >= ? AND date <= ?
    `).get(yearStart, actualEnd);

    const startValue = getNetWorthAtDate(priorEnd);
    const endValue = getNetWorthAtDate(actualEnd);
    const contributions = contrRow?.contributions ?? 0;

    result.push({ year, contributions, gain: endValue - startValue - contributions, end_value: endValue });
  }

  return result;
}

// ── Yearly Summary ────────────────────────────────────────────────────────────

function getYearlySummary() {
  const earliest = db.prepare('SELECT MIN(date) AS d FROM transactions').get();
  if (!earliest?.d) return { portfolio: [], byAsset: [] };

  const firstYear = parseDate(earliest.d).getFullYear();
  const lastYear = new Date().getFullYear();
  const today = todayStr();

  const assets = db.prepare('SELECT * FROM assets WHERE archived = 0').all();

  const portfolioRows = [];
  const byAssetRows = [];
  let allTimeContributions = 0;

  for (let year = firstYear; year <= lastYear; year++) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const actualEnd = yearEnd > today ? today : yearEnd;
    const priorEnd = `${year - 1}-12-31`;

    const startNW = getNetWorthAtDate(priorEnd);
    const endNW = getNetWorthAtDate(actualEnd);

    const contrRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('buy','deposit') THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type IN ('sell','withdrawal') THEN amount ELSE 0 END), 0) AS contributions
      FROM transactions WHERE date >= ? AND date <= ?
    `).get(yearStart, actualEnd);
    const contributions = contrRow?.contributions ?? 0;
    allTimeContributions += contributions;
    const growth = endNW - startNW - contributions;

    // Portfolio XIRR for this year, with and without real estate
    const nominalReturn = portfolioXirrBetween(priorEnd, actualEnd);
    const nominalExRe = portfolioXirrBetween(priorEnd, actualEnd, ['real_estate']);

    const msciReturn = getBenchmarkReturn(priorEnd, actualEnd);
    const realReturn = getRealReturn(nominalReturn, priorEnd, actualEnd);

    portfolioRows.push({
      year,
      start_net_worth: startNW,
      contributions,
      growth,
      end_net_worth: endNW,
      nominal_return_pct: nominalReturn !== null ? nominalReturn * 100 : null,
      real_return_pct: realReturn !== null ? realReturn * 100 : null,
      msci_world_pct: msciReturn !== null ? msciReturn * 100 : null,
      nominal_ex_re_pct: nominalExRe !== null ? nominalExRe * 100 : null,
      real_ex_re_pct: (r => r !== null ? r * 100 : null)(getRealReturn(nominalExRe, priorEnd, actualEnd)),
    });

    // Per-asset rows
    const noMsciTypes = new Set(['savings', 'real_estate', 'pension']);
    for (const asset of assets) {
      const sv = getAssetValueAtDate(asset.id, priorEnd);
      const ev = getAssetValueAtDate(asset.id, actualEnd);
      if (!sv && !ev) continue; // not held this year (null, or 0 for a priced asset bought later)

      const aCRow = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type IN ('buy','deposit') THEN amount ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN type IN ('sell','withdrawal') THEN amount ELSE 0 END), 0) AS contributions
        FROM transactions WHERE asset_id = ? AND date >= ? AND date <= ?
      `).get(asset.id, yearStart, actualEnd);
      const aCont = aCRow?.contributions ?? 0;
      const svN = sv ?? 0, evN = ev ?? 0;

      const aCfs = [];
      if (svN > 0) aCfs.push({ date: parseDate(priorEnd), amount: -svN });
      aCfs.push(...buildCashflows([asset.id], priorEnd, actualEnd));
      aCfs.push({ date: parseDate(actualEnd), amount: evN });
      aCfs.sort((a, b) => a.date - b.date);
      const aNominal = (isUnvalued(asset.id, priorEnd) || isUnvalued(asset.id, actualEnd)) ? null : xirr(aCfs);

      byAssetRows.push({
        year,
        asset_id: asset.id,
        asset_name: asset.name,
        asset_type: asset.type,
        start_net_worth: svN,
        contributions: aCont,
        growth: evN - svN - aCont,
        end_net_worth: evN,
        nominal_return_pct: aNominal !== null ? aNominal * 100 : null,
        real_return_pct: null,
        msci_world_pct: noMsciTypes.has(asset.type) ? null : (msciReturn !== null ? msciReturn * 100 : null),
      });
    }
  }

  // All-time row
  const allStartNW = portfolioRows[0]?.start_net_worth ?? 0;
  const allEndNW = portfolioRows[portfolioRows.length - 1]?.end_net_worth ?? 0;
  const allNominal = getPortfolioXirr('all');
  const allNominalExRe = getPortfolioXirr('all', ['real_estate']);
  const allFirstPriorEnd = firstYear > 0 ? `${firstYear - 1}-12-31` : null;
  const allMsci = allFirstPriorEnd ? getBenchmarkReturn(allFirstPriorEnd, today) : null;
  const allReal = allFirstPriorEnd ? getRealReturn(allNominal, allFirstPriorEnd, today) : null;

  portfolioRows.push({
    year: 'all',
    start_net_worth: allStartNW,
    contributions: allTimeContributions,
    growth: allEndNW - allStartNW - allTimeContributions,
    end_net_worth: allEndNW,
    nominal_return_pct: allNominal !== null ? allNominal * 100 : null,
    real_return_pct: allReal !== null ? allReal * 100 : null,
    msci_world_pct: allMsci !== null ? allMsci * 100 : null,
    nominal_ex_re_pct: allNominalExRe !== null ? allNominalExRe * 100 : null,
    real_ex_re_pct: (r => r !== null ? r * 100 : null)(allFirstPriorEnd ? getRealReturn(allNominalExRe, allFirstPriorEnd, today) : null),
  });

  // Add subtotal rows per type per year
  const TYPES = ['stock', 'etf', 'savings', 'real_estate', 'pension', 'crypto', 'other'];
  const byAssetWithSubtotals = [];
  const years = [...new Set(byAssetRows.map(r => r.year))];

  for (const year of years) {
    for (const type of TYPES) {
      const group = byAssetRows.filter(r => r.year === year && r.asset_type === type);
      if (group.length === 0) continue;
      byAssetWithSubtotals.push(...group);
      if (group.length > 1) {
        byAssetWithSubtotals.push({
          _subtotal: true,
          year,
          asset_type: type,
          start_net_worth: group.reduce((s, r) => s + r.start_net_worth, 0),
          contributions: group.reduce((s, r) => s + r.contributions, 0),
          growth: group.reduce((s, r) => s + r.growth, 0),
          end_net_worth: group.reduce((s, r) => s + r.end_net_worth, 0),
          nominal_return_pct: null,
          real_return_pct: null,
          msci_world_pct: null,
        });
      }
    }
  }

  return { portfolio: portfolioRows, byAsset: byAssetWithSubtotals };
}

module.exports = {
  db,
  getAssetCurrentValue,
  getNetHoldings,
  getNetWorth,
  getAssetValueAtDate,
  getNetWorthAtDate,
  xirr,
  getAssetXirr,
  getPortfolioXirr,
  getBenchmarkReturn,
  getRealReturn,
  getNetWorthHistory,
  getContributionsVsGrowth,
  getYearlySummary,
};
