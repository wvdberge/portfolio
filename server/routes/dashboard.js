const express = require('express');
const router = express.Router();
const { db, getAssetCurrentValue, getNetWorth } = require('../db');

// GET /api/dashboard
router.get('/', (req, res) => {
  // All active assets with current value
  const assets = db.prepare('SELECT * FROM assets WHERE archived = 0 ORDER BY name').all();

  const assetValues = assets.map(a => ({
    ...a,
    current_value: getAssetCurrentValue(a.id),
  }));

  const totalAssets = assetValues.reduce((sum, a) => sum + (a.current_value ?? 0), 0);

  const allocation = assetValues.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    current_value: a.current_value,
    target_allocation_pct: a.target_allocation_pct,
    weight_pct: totalAssets > 0 && a.current_value != null
      ? (a.current_value / totalAssets) * 100
      : null,
    drift_pp: (a.target_allocation_pct != null && totalAssets > 0 && a.current_value != null)
      ? (a.current_value / totalAssets) * 100 - a.target_allocation_pct
      : null,
  }));

  // Liabilities
  const liabilities = db.prepare('SELECT * FROM liabilities ORDER BY name').all();
  const liabilityData = liabilities.map(l => {
    const snap = db.prepare(
      'SELECT date, balance FROM liability_snapshots WHERE liability_id = ? ORDER BY date DESC LIMIT 1'
    ).get(l.id);
    return { ...l, latest_balance: snap?.balance ?? null, latest_date: snap?.date ?? null };
  });

  const totalLiabilities = liabilityData.reduce(
    (sum, l) => sum + (l.latest_balance ?? 0), 0
  );

  const netWorth = totalAssets - totalLiabilities;

  res.json({
    net_worth: netWorth,
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    allocation,
    liabilities: liabilityData,
  });
});

module.exports = router;
