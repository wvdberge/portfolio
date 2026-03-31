# Personal Portfolio Tracker

A self-hosted, single-user net worth and investment portfolio tracker. No cloud, no subscriptions, no data leaving your machine.

Built with Express + SQLite on the backend and React + Vite on the frontend.

---

## Features

### Dashboard
- Net worth card (assets − liabilities)
- **XIRR returns** — 1-year, 3-year, and all-time, each paired with the MSCI World benchmark return for the same period
- **Net worth over time** — stacked area chart by asset type (monthly)
- **Asset allocation** — two donut charts: actual vs target allocation
- **Contributions vs growth** — stacked bar chart per calendar year

### Assets
- Track stocks, ETFs, savings accounts, real estate, pension, crypto, and other assets
- Per-asset current value using the right method per type:
  - Liquid (stock/ETF/crypto): latest price × net holdings
  - Savings: sum of deposits + interest − withdrawals
  - Illiquid (real estate/pension/other): latest snapshot value
- Manual override via value snapshots (takes precedence over price-based calculation)
- Soft delete (archive) to keep history intact
- XIRR (1Y) and XIRR (all-time) columns in the assets table

### Transactions
- Full transaction history per asset
- Types: buy, sell, deposit, withdrawal, dividend, interest
- Auto-calculates total amount for buy/sell (qty × price ± fee)

### Prices
- Manual price entry per asset
- **Automatic price fetching** from three sources:
  - **Alpha Vantage** — stocks and ETFs via their Global Quote API
  - **Meesman** — NAV scraped from the Meesman website (4 funds supported)
  - **Brand New Day** — NAV via the BND fund rates API
- "Refresh All Prices" button (bulk, sequential to respect rate limits)
- "Fetch Latest Price" button per asset in the Prices tab
- "Test" button in the asset edit modal to verify a price source before saving

### Yearly Summary (`/yearly`)
- Per-calendar-year table: start NW, contributions, growth, end NW, nominal XIRR %, real return %, MSCI World %
- All-time row at the bottom
- Expandable per-asset breakdown with subtotals per asset type

### Liabilities
- Track mortgages, loans, and other liabilities
- Balance snapshots with optional interest rate

### CSV Import (`/import`)
- Multi-step flow: upload → (account mapping for Raisin) → row review → commit
- Duplicate detection before saving
- Supported formats:
  - **ABN AMRO brokerage** — fully implemented
  - **Raisin** — fully implemented, including account→asset mapping UI and persistent mapping storage

### Benchmark & CPI data entry
- Manual entry of MSCI World index prices for benchmark comparison
- Manual entry of CPI data for real return calculation

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js, Express 4 |
| Database | SQLite via `better-sqlite3` |
| HTML scraping | Cheerio |
| CSV parsing | PapaParse + Multer |
| Client | React 18, React Router 6 |
| Charts | Recharts |
| Build | Vite 5 |

---

## Getting Started

### Prerequisites
- Node.js 18+ (global `fetch` is used server-side)
- npm

### Install

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

### Run in development

```bash
# Terminal 1 — API server on :3001
cd server
npm run dev

# Terminal 2 — Vite dev server on :5174 (proxies /api to :3001)
cd client
npm run dev
```

Open [http://localhost:5174](http://localhost:5174).

### Build for production

```bash
cd client
npm run build
# Copy dist/ output to server/public/
cp -r dist/* ../server/public/
```

Then run `node server/index.js` — the Express server serves both the API and the React app.

### Database location

SQLite database is stored at `../../data/wealth.db` relative to the `server/` directory (i.e. two levels up from the repo root). Override with the `DB_PATH` environment variable.

```bash
DB_PATH=/your/path/wealth.db node index.js
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | Optional | Enables Alpha Vantage price fetching. Free tier: 25 requests/day. |
| `DB_PATH` | Optional | Override the default SQLite file path. |
| `PORT` | Optional | HTTP port (default: 3001). |

Price fetching is always **user-initiated** — no background polling — to stay within the free tier limit.

---

## Project Structure

```
portfolio/
├── server/
│   ├── index.js              # Express app entry point
│   ├── db.js                 # Schema, migrations, all computation functions
│   ├── priceFetchers.js      # Alpha Vantage, Meesman, Brand New Day fetchers
│   └── routes/
│       ├── assets.js
│       ├── transactions.js
│       ├── prices.js         # CRUD + refresh endpoints + BND fund list
│       ├── snapshots.js
│       ├── liabilities.js
│       ├── liability-snapshots.js
│       ├── portfolio.js      # XIRR, history, contributions, yearly summary
│       ├── dashboard.js
│       ├── benchmark.js
│       ├── cpi.js
│       └── import.js         # CSV import (preview + commit)
└── client/
    └── src/
        ├── App.jsx
        ├── api.js            # Typed API client
        ├── format.js         # Date/currency/number formatters
        └── components/
            ├── Dashboard.jsx
            ├── AssetsView.jsx
            ├── AssetDetail.jsx
            ├── LiabilitiesView.jsx
            ├── LiabilityDetail.jsx
            ├── YearlySummary.jsx
            ├── ImportPage.jsx
            ├── PriceSourceFields.jsx  # Shared price source selector
            └── DataEntry.jsx
```

---

## XIRR Computation

XIRR is computed in plain JavaScript (no external library) using Newton-Raphson with a bisection fallback. Cash flow sign convention: **buy/deposit = negative (outflow), sell/withdrawal/dividend/interest = positive (inflow)**.

For period-based XIRR (1Y, 3Y):
- A synthetic opening cash flow is added on the period start date equal to the reconstructed asset/portfolio value at that date
- A synthetic terminal inflow is added at today's date equal to the current value

All-time XIRR uses actual transactions only (no synthetic opening) plus a terminal inflow at today.

---

## Still To Do

### CSV import parsers — stubs only

Three parsers exist as stubs in `server/routes/import.js` and throw `"not yet implemented"`. Column names need to be confirmed against real export files before these can be completed:

- **Centraal Beheer** — expected: date, type, fund name, units, NAV, amount
- **Meesman** — expected: date, fund name, units purchased, NAV per unit
- **Brand New Day** — expected: similar to Meesman (units + NAV)

### Historical price backfill

The current price fetchers only retrieve today's latest NAV. There is no way to backfill historical prices for:
- **Meesman** — they offer an Excel download of historical NAV data; parsing this is not yet implemented
- **Brand New Day** — the same fund rates API endpoint likely supports date ranges but this has not been explored

### Per-asset real return in yearly summary

The per-asset rows in the yearly summary always show `—` for real return %. Only the portfolio-level rows compute a real return (nominal XIRR minus annualized CPI). Per-asset real return is straightforward to add once the portfolio-level approach is validated.

---

## Design Decisions

- **No auth** — single-user, intended to run locally or on a private server
- **No ORM** — raw `better-sqlite3` prepared statements throughout
- **No global state** — React component-local state only (`useState`/`useEffect`)
- **Amounts always positive** in the database; sign is derived from transaction type at computation time
- **Archived assets** are soft-deleted and excluded from current net worth but included in historical XIRR cash flows
- **Snapshot override rule**: a manual value snapshot takes precedence over price-based calculation if it is more recent than the latest price entry
