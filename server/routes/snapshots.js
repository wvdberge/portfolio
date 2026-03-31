const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/snapshots?assetId=X
router.get('/', (req, res) => {
  const { assetId } = req.query;
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const rows = db.prepare(
    'SELECT * FROM snapshots WHERE asset_id = ? ORDER BY date DESC'
  ).all(assetId);
  res.json(rows);
});

// POST /api/snapshots
router.post('/', (req, res) => {
  const { asset_id, date, value, notes } = req.body;
  if (!asset_id || !date || value == null) {
    return res.status(400).json({ error: 'asset_id, date, value required' });
  }
  if (value < 0) return res.status(400).json({ error: 'value must be >= 0' });

  const info = db.prepare(
    'INSERT INTO snapshots (asset_id, date, value, notes) VALUES (?, ?, ?, ?)'
  ).run(asset_id, date, value, notes ?? null);

  res.status(201).json(db.prepare('SELECT * FROM snapshots WHERE id = ?').get(info.lastInsertRowid));
});

// DELETE /api/snapshots/:id — hard delete
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM snapshots WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM snapshots WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
