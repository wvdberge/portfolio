const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/benchmark
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM benchmark_prices ORDER BY date DESC').all());
});

// POST /api/benchmark
router.post('/', (req, res) => {
  const { date, price } = req.body;
  if (!date || price == null) return res.status(400).json({ error: 'date and price required' });

  const info = db.prepare(
    'INSERT INTO benchmark_prices (date, price) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET price = excluded.price'
  ).run(date, price);

  const row = db.prepare('SELECT * FROM benchmark_prices WHERE id = ?').get(info.lastInsertRowid) ||
    db.prepare('SELECT * FROM benchmark_prices WHERE date = ?').get(date);
  res.status(201).json(row);
});

// DELETE /api/benchmark/:id
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM benchmark_prices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM benchmark_prices WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
