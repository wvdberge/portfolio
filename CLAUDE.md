# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Commands

```bash
# Development
cd server && npm run dev          # API server on :3001 (uses node --watch)
cd client && npm run dev          # Vite dev server on :5174 (proxies /api → :3001)

# Production build
cd client && npm run build
cp -r dist/* ../server/public/   # Express then serves both API and client
```

No test runner. No linter configured.

## Architecture

**Full-stack single-user app**: Express 4 + SQLite (server) / React 18 + Vite (client). The server is CommonJS; the client is ESM.

### Server

- `server/index.js` — Express entry point, mounts all routes under `/api`
- `server/db.js` — **Core file**: SQLite schema (inline `CREATE TABLE IF NOT EXISTS`), all migrations, and all heavy computation functions (XIRR, asset valuation, net worth history, yearly summary). If you're touching financial logic, it lives here.
- `server/priceFetchers.js` — Alpha Vantage, Meesman (Cheerio scrape), Brand New Day (JSON API)
- `server/routes/` — one file per resource; thin wrappers that call `db.js` functions

### Client

- `client/src/api.js` — typed API client; all `fetch` calls go through here
- `client/src/format.js` — shared date/currency/number formatters
- `client/src/components/` — one component per page/view; component-local state only (`useState`/`useEffect`), no global state

### Database

SQLite at `../../data/wealth.db` (relative to `server/`) by default, or `DB_PATH` env var. Schema is in `db.js`. Migrations run inline at startup via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` guards.

Key design decisions:
- **Amounts always positive** in the DB; sign is derived from transaction type at query time
- **Snapshot override rule**: a manual `snapshots` entry takes precedence over price-based valuation if it's more recent than the latest `asset_prices` entry
- Archived assets (`archived = 1`) are excluded from current net worth but included in historical XIRR cash flows

### XIRR

Implemented from scratch in `db.js` (Newton-Raphson + bisection fallback). Sign convention: buy/deposit/fee = negative outflow, sell/withdrawal/dividend/interest = positive inflow. Period-based XIRR (1Y, 3Y) adds synthetic opening/closing cash flows around the period.

The `fee` transaction type is treated as outflow in XIRR and subtracted from savings balance, but excluded from contributions tracking. This is the correct treatment for broker/custody costs.

### Import parsers (`server/routes/import.js`)

| Format | Key | Notes |
|---|---|---|
| ABN AMRO brokerage | `abn` | CSV; auto-detected by headers |
| ABN AMRO savings | `abn_savings` | TAB file, no header, tab-separated; auto-detected by `.tab` extension; requires fund→asset mapping step on first import |
| Centraal Beheer | `centraal_beheer` | UTF-16 LE encoded — decoded from buffer before PapaParse; semicolon delimiter; `Overboeking` rows skipped |
| Meesman | `meesman` | CSV; `Dividend herbelegging` rows emit two transactions (dividend + buy) so reinvestment has zero net XIRR impact; `Stortingsmix` has no qty/price |

All parsers use name/FONDSCODE-based asset mapping saved in `import_mappings` table. ABN brokerage, Meesman, and Centraal Beheer auto-create assets if no mapping found. ABN savings requires explicit mapping via UI before commit.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | — | Enables Alpha Vantage price fetching (free tier: 25 req/day) |
| `DB_PATH` | `../../data/wealth.db` | SQLite file location |
| `PORT` | 3001 | HTTP port |
