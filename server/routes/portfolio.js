const express = require('express');
const router = express.Router();
const {
  getPortfolioXirr,
  getBenchmarkReturn,
  getRealReturn,
  getNetWorthHistory,
  getContributionsVsGrowth,
  getYearlySummary,
} = require('../db');

// GET /api/portfolio/xirr?period=1y|3y|all[&exclude=real_estate]
router.get('/xirr', (req, res) => {
  const period = req.query.period || 'all';
  if (!['1y', '3y', 'all'].includes(period)) {
    return res.status(400).json({ error: 'period must be 1y, 3y, or all' });
  }
  const excludeTypes = req.query.exclude ? String(req.query.exclude).split(',') : [];
  const rate = getPortfolioXirr(period, excludeTypes);
  res.json({ xirr: rate });
});

// GET /api/portfolio/history?granularity=monthly
router.get('/history', (req, res) => {
  res.json(getNetWorthHistory());
});

// GET /api/portfolio/contributions-vs-growth
router.get('/contributions-vs-growth', (req, res) => {
  res.json(getContributionsVsGrowth());
});

// GET /api/portfolio/yearly-summary
router.get('/yearly-summary', (req, res) => {
  res.json(getYearlySummary());
});

module.exports = router;
