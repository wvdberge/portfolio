const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { fetchCbsCpi } = require('../priceFetchers');

// Fetch the full monthly series from CBS and upsert it. Also run by the scheduler.
async function syncCpi() {
  const rows = await fetchCbsCpi();
  const upsert = db.prepare('INSERT INTO cpi_data (date, cpi_value) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET cpi_value = excluded.cpi_value');
  db.transaction(() => { for (const r of rows) upsert.run(r.date, r.cpi_value); })();
  return { count: rows.length, latest: rows[rows.length - 1] };
}

// POST /api/cpi/sync — before /:id
router.post('/sync', async (req, res) => {
  try {
    res.json(await syncCpi());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

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
module.exports.syncCpi = syncCpi;
