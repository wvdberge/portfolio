const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/cpi
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM cpi_data ORDER BY date DESC').all());
});

// POST /api/cpi
router.post('/', (req, res) => {
  const { date, cpi_value } = req.body;
  if (!date || cpi_value == null) return res.status(400).json({ error: 'date and cpi_value required' });

  const info = db.prepare(
    'INSERT INTO cpi_data (date, cpi_value) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET cpi_value = excluded.cpi_value'
  ).run(date, cpi_value);

  const row = db.prepare('SELECT * FROM cpi_data WHERE id = ?').get(info.lastInsertRowid) ||
    db.prepare('SELECT * FROM cpi_data WHERE date = ?').get(date);
  res.status(201).json(row);
});

// DELETE /api/cpi/:id
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM cpi_data WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM cpi_data WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
