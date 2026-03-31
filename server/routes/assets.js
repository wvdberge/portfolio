const express = require('express');
const router = express.Router();
const { db, getAssetCurrentValue, getAssetXirr } = require('../db');

// GET /api/assets
router.get('/', (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const assets = db.prepare(
    `SELECT * FROM assets${includeArchived ? '' : ' WHERE archived = 0'} ORDER BY name`
  ).all();

  // Compute total asset value for weight calculation
  const activeAssets = includeArchived
    ? db.prepare('SELECT id FROM assets WHERE archived = 0').all()
    : assets;
  let totalValue = 0;
  const valueMap = {};
  for (const a of activeAssets) {
    const v = getAssetCurrentValue(a.id);
    valueMap[a.id] = v;
    if (v !== null) totalValue += v;
  }

  const result = assets.map(a => ({
    ...a,
    current_value: valueMap[a.id] ?? getAssetCurrentValue(a.id),
    weight_pct: totalValue > 0 && valueMap[a.id] != null
      ? (valueMap[a.id] / totalValue) * 100
      : null,
  }));

  res.json(result);
});

// GET /api/assets/xirr-summary  — must be before /:id
router.get('/xirr-summary', (req, res) => {
  const assets = db.prepare('SELECT id FROM assets WHERE archived = 0').all();
  const result = assets.map(a => ({
    asset_id: a.id,
    xirr_1y: getAssetXirr(a.id, '1y'),
    xirr_all: getAssetXirr(a.id, 'all'),
  }));
  res.json(result);
});

// GET /api/assets/:id/xirr?period=1y|3y|all
router.get('/:id/xirr', (req, res) => {
  const period = req.query.period || 'all';
  if (!['1y', '3y', 'all'].includes(period)) {
    return res.status(400).json({ error: 'period must be 1y, 3y, or all' });
  }
  const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });
  res.json({ xirr: getAssetXirr(asset.id, period) });
});

// GET /api/assets/:id
router.get('/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });

  const current_value = getAssetCurrentValue(asset.id);

  // Total active asset value for weight
  const activeAssets = db.prepare('SELECT id FROM assets WHERE archived = 0').all();
  let totalValue = 0;
  for (const a of activeAssets) {
    const v = getAssetCurrentValue(a.id);
    if (v !== null) totalValue += v;
  }

  res.json({
    ...asset,
    current_value,
    weight_pct: totalValue > 0 && current_value != null
      ? (current_value / totalValue) * 100
      : null,
  });
});

// POST /api/assets
router.post('/', (req, res) => {
  const { name, type, currency = 'EUR', target_allocation_pct = null, ticker = null, price_source = null } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });

  const info = db.prepare(`
    INSERT INTO assets (name, type, currency, target_allocation_pct, ticker, price_source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, type, currency, target_allocation_pct, ticker, price_source);
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(asset);
});

// PUT /api/assets/:id
router.put('/:id', (req, res) => {
  const { name, type, currency, target_allocation_pct, ticker, price_source } = req.body;
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE assets SET
      name = ?, type = ?, currency = ?,
      target_allocation_pct = ?, ticker = ?, price_source = ?
    WHERE id = ?
  `).run(
    name ?? asset.name,
    type ?? asset.type,
    currency ?? asset.currency,
    target_allocation_pct !== undefined ? target_allocation_pct : asset.target_allocation_pct,
    ticker !== undefined ? ticker : asset.ticker,
    price_source !== undefined ? price_source : asset.price_source,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id));
});

// DELETE /api/assets/:id  — soft delete (archive)
router.delete('/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE assets SET archived = 1 WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
