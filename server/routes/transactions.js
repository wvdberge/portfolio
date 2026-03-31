const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/transactions?assetId=X
router.get('/', (req, res) => {
  const { assetId } = req.query;
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const rows = db.prepare(
    'SELECT * FROM transactions WHERE asset_id = ? ORDER BY date DESC, id DESC'
  ).all(assetId);
  res.json(rows);
});

// POST /api/transactions
router.post('/', (req, res) => {
  const { asset_id, date, type, quantity, price_per_unit, amount, fee, notes } = req.body;
  if (!asset_id || !date || !type || amount == null) {
    return res.status(400).json({ error: 'asset_id, date, type, amount required' });
  }
  if (amount < 0) return res.status(400).json({ error: 'amount must be >= 0' });

  const asset = db.prepare('SELECT type FROM assets WHERE id = ?').get(asset_id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const info = db.prepare(`
    INSERT INTO transactions (asset_id, date, type, quantity, price_per_unit, amount, fee, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    asset_id, date, type,
    quantity ?? null,
    price_per_unit ?? null,
    amount,
    fee ?? null,
    notes ?? null
  );

  res.status(201).json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid));
});

// DELETE /api/transactions/:id — hard delete
router.delete('/:id', (req, res) => {
  const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
