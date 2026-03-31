const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/liabilities
router.get('/', (req, res) => {
  const liabilities = db.prepare('SELECT * FROM liabilities ORDER BY name').all();

  const result = liabilities.map(l => {
    const snap = db.prepare(
      'SELECT date, balance FROM liability_snapshots WHERE liability_id = ? ORDER BY date DESC LIMIT 1'
    ).get(l.id);
    return { ...l, latest_balance: snap?.balance ?? null, latest_date: snap?.date ?? null };
  });

  res.json(result);
});

// GET /api/liabilities/:id
router.get('/:id', (req, res) => {
  const liability = db.prepare('SELECT * FROM liabilities WHERE id = ?').get(req.params.id);
  if (!liability) return res.status(404).json({ error: 'Not found' });

  const snap = db.prepare(
    'SELECT date, balance FROM liability_snapshots WHERE liability_id = ? ORDER BY date DESC LIMIT 1'
  ).get(liability.id);

  res.json({ ...liability, latest_balance: snap?.balance ?? null, latest_date: snap?.date ?? null });
});

// POST /api/liabilities
router.post('/', (req, res) => {
  const { name, type, currency = 'EUR' } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });

  const info = db.prepare(
    'INSERT INTO liabilities (name, type, currency) VALUES (?, ?, ?)'
  ).run(name, type, currency);

  res.status(201).json(db.prepare('SELECT * FROM liabilities WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/liabilities/:id
router.put('/:id', (req, res) => {
  const liability = db.prepare('SELECT * FROM liabilities WHERE id = ?').get(req.params.id);
  if (!liability) return res.status(404).json({ error: 'Not found' });

  const { name, type, currency } = req.body;
  db.prepare('UPDATE liabilities SET name = ?, type = ?, currency = ? WHERE id = ?').run(
    name ?? liability.name,
    type ?? liability.type,
    currency ?? liability.currency,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM liabilities WHERE id = ?').get(req.params.id));
});

// DELETE /api/liabilities/:id — hard delete
router.delete('/:id', (req, res) => {
  const liability = db.prepare('SELECT id FROM liabilities WHERE id = ?').get(req.params.id);
  if (!liability) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM liability_snapshots WHERE liability_id = ?').run(req.params.id);
  db.prepare('DELETE FROM liabilities WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
