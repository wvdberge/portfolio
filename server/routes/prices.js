const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/prices?assetId=X
router.get('/', (req, res) => {
  const { assetId } = req.query;
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const rows = db.prepare(
    'SELECT * FROM asset_prices WHERE asset_id = ? ORDER BY date DESC'
  ).all(assetId);
  res.json(rows);
});

// POST /api/prices
router.post('/', (req, res) => {
  const { asset_id, date, price } = req.body;
  if (!asset_id || !date || price == null) {
    return res.status(400).json({ error: 'asset_id, date, price required' });
  }
  if (price <= 0) return res.status(400).json({ error: 'price must be > 0' });

  const info = db.prepare(`
    INSERT INTO asset_prices (asset_id, date, price)
    VALUES (?, ?, ?)
    ON CONFLICT(asset_id, date) DO UPDATE SET price = excluded.price
  `).run(asset_id, date, price);

  const row = db.prepare('SELECT * FROM asset_prices WHERE id = ?').get(info.lastInsertRowid) ||
    db.prepare('SELECT * FROM asset_prices WHERE asset_id = ? AND date = ?').get(asset_id, date);
  res.status(201).json(row);
});

// DELETE /api/prices/:id — hard delete
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM asset_prices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM asset_prices WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
