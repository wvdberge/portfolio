const express = require('express');
const router = express.Router();
const { db, getBenchmarkReturn } = require('../db');
const { fetchAlphaVantageMonthly } = require('../priceFetchers');

// MSCI World benchmark: iShares Core MSCI World (IWDA) in EUR on Euronext Amsterdam.
// Accumulating, so its price tracks the index's net total return minus 0.20% TER.
const BENCHMARK_SYMBOL = process.env.BENCHMARK_SYMBOL || 'IWDA.AMS';

async function syncBenchmark() {
  const rows = await fetchAlphaVantageMonthly(BENCHMARK_SYMBOL);
  const upsert = db.prepare('INSERT INTO benchmark_prices (date, price) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET price = excluded.price');
  db.transaction(() => { for (const r of rows) upsert.run(r.date, r.price); })();
  return { symbol: BENCHMARK_SYMBOL, count: rows.length, first: rows[0], latest: rows[rows.length - 1] };
}

// POST /api/benchmark/sync — before /:id
router.post('/sync', async (req, res) => {
  try {
    res.json(await syncBenchmark());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/benchmark/return?from=YYYY-MM-DD&to=YYYY-MM-DD — before /:id
router.get('/return', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  res.json({ return: getBenchmarkReturn(from, to) });
});

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
module.exports.syncBenchmark = syncBenchmark;
