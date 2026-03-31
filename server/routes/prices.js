const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { fetchAlphaVantagePrice, fetchMeesmanPrice, fetchBrandNewDayPrice } = require('../priceFetchers');

// ── Helpers ───────────────────────────────────────────────────────────────────

function upsertPrice(assetId, date, price) {
  db.prepare(`
    INSERT INTO asset_prices (asset_id, date, price) VALUES (?, ?, ?)
    ON CONFLICT(asset_id, date) DO UPDATE SET price = excluded.price
  `).run(assetId, date, price);
}

async function fetchForAsset(asset) {
  const { price_source, ticker } = asset;
  if (price_source === 'alpha_vantage') return fetchAlphaVantagePrice(ticker);
  if (price_source === 'meesman')       return fetchMeesmanPrice(ticker);
  if (price_source === 'brand_new_day') return fetchBrandNewDayPrice(ticker);
  throw new Error(`No price_source set`);
}

// ── BND funds list (cached in-process) ───────────────────────────────────────

let bndFundsCache = null;

router.get('/bnd-funds', async (req, res) => {
  if (bndFundsCache) return res.json(bndFundsCache);
  try {
    const resp = await fetch('https://devrobotapi.azurewebsites.net/v1/funds');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    bndFundsCache = Array.isArray(data) ? data : (data.funds ?? []);
    res.json(bndFundsCache);
  } catch (err) {
    console.warn('Could not fetch BND fund list:', err.message);
    res.json([]);
  }
});

// ── Bulk refresh logic (also called by scheduler) ────────────────────────────

async function runPriceRefresh() {
  const assets = db.prepare(`
    SELECT id, name, ticker, price_source FROM assets
    WHERE archived = 0
      AND price_source IS NOT NULL
      AND ticker IS NOT NULL AND ticker != ''
  `).all();

  let fetched = 0, skipped = 0;
  const errors = [];

  for (const asset of assets) {
    try {
      const { price, date } = await fetchForAsset(asset);
      upsertPrice(asset.id, date, price);
      fetched++;
    } catch (err) {
      errors.push({ assetId: asset.id, ticker: asset.ticker, source: asset.price_source, message: err.message });
      skipped++;
    }
  }

  return { fetched, skipped, errors };
}

// ── Bulk refresh endpoint — must be before /:id ───────────────────────────────

router.post('/refresh', async (req, res) => {
  const result = await runPriceRefresh();
  res.json(result);
});

// ── Single asset refresh — must be before /:id ───────────────────────────────

router.post('/refresh/:assetId', async (req, res) => {
  const asset = db.prepare('SELECT id, ticker, price_source FROM assets WHERE id = ?').get(req.params.assetId);
  if (!asset) return res.status(404).json({ error: 'Not found' });
  if (!asset.price_source) return res.status(400).json({ error: 'No price_source set on this asset' });
  if (!asset.ticker) return res.status(400).json({ error: 'No ticker set on this asset' });

  try {
    const { price, date } = await fetchForAsset(asset);
    upsertPrice(asset.id, date, price);
    res.json({ date, price });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { assetId } = req.query;
  if (!assetId) return res.status(400).json({ error: 'assetId required' });
  res.json(db.prepare('SELECT * FROM asset_prices WHERE asset_id = ? ORDER BY date DESC').all(assetId));
});

router.post('/', (req, res) => {
  const { asset_id, date, price } = req.body;
  if (!asset_id || !date || price == null) return res.status(400).json({ error: 'asset_id, date, price required' });
  if (price <= 0) return res.status(400).json({ error: 'price must be > 0' });

  const info = db.prepare(`
    INSERT INTO asset_prices (asset_id, date, price) VALUES (?, ?, ?)
    ON CONFLICT(asset_id, date) DO UPDATE SET price = excluded.price
  `).run(asset_id, date, price);

  const row = db.prepare('SELECT * FROM asset_prices WHERE id = ?').get(info.lastInsertRowid)
    || db.prepare('SELECT * FROM asset_prices WHERE asset_id = ? AND date = ?').get(asset_id, date);
  res.status(201).json(row);
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM asset_prices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM asset_prices WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
module.exports.runPriceRefresh = runPriceRefresh;
