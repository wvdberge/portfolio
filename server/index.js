const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Serve React build in production
const clientDist = path.join(__dirname, 'public');
app.use(express.static(clientDist));

// Routes
app.use('/api/dashboard',           require('./routes/dashboard'));
app.use('/api/assets',              require('./routes/assets'));
app.use('/api/liabilities',         require('./routes/liabilities'));
app.use('/api/transactions',        require('./routes/transactions'));
app.use('/api/prices',              require('./routes/prices'));
app.use('/api/snapshots',           require('./routes/snapshots'));
app.use('/api/liability-snapshots', require('./routes/liability-snapshots'));
app.use('/api/benchmark',           require('./routes/benchmark'));
app.use('/api/cpi',                 require('./routes/cpi'));
app.use('/api/portfolio',           require('./routes/portfolio'));
app.use('/api/import',              require('./routes/import'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Portfolio server running on port ${PORT}`));
