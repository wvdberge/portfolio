const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/liability-snapshots?liabilityId=X
router.get('/', (req, res) => {
  const { liabilityId } = req.query;
  if (!liabilityId) return res.status(400).json({ error: 'liabilityId required' });

  const rows = db.prepare(
    'SELECT * FROM liability_snapshots WHERE liability_id = ? ORDER BY date DESC'
  ).all(liabilityId);
  res.json(rows);
});

// POST /api/liability-snapshots
router.post('/', (req, res) => {
  const { liability_id, date, balance, interest_rate_pct, notes } = req.body;
  if (!liability_id || !date || balance == null) {
    return res.status(400).json({ error: 'liability_id, date, balance required' });
  }
  if (balance < 0) return res.status(400).json({ error: 'balance must be >= 0' });

  const info = db.prepare(`
    INSERT INTO liability_snapshots (liability_id, date, balance, interest_rate_pct, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(liability_id, date, balance, interest_rate_pct ?? null, notes ?? null);

  res.status(201).json(
    db.prepare('SELECT * FROM liability_snapshots WHERE id = ?').get(info.lastInsertRowid)
  );
});

// DELETE /api/liability-snapshots/:id — hard delete
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM liability_snapshots WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM liability_snapshots WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
