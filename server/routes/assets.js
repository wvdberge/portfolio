const express = require('express');
const router = express.Router();
const { db, getAssetCurrentValue } = require('../db');

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
  const { name, type, currency = 'EUR', target_allocation_pct = null, ticker = null } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });

  const stmt = db.prepare(`
    INSERT INTO assets (name, type, currency, target_allocation_pct, ticker)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, type, currency, target_allocation_pct, ticker);
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(asset);
});

// PUT /api/assets/:id
router.put('/:id', (req, res) => {
  const { name, type, currency, target_allocation_pct, ticker } = req.body;
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE assets SET
      name = ?, type = ?, currency = ?,
      target_allocation_pct = ?, ticker = ?
    WHERE id = ?
  `).run(
    name ?? asset.name,
    type ?? asset.type,
    currency ?? asset.currency,
    target_allocation_pct !== undefined ? target_allocation_pct : asset.target_allocation_pct,
    ticker !== undefined ? ticker : asset.ticker,
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
