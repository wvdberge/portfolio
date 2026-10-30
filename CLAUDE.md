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

No test runner. No linter configured. To check a change against real data, run the server on a copy of the DB (`DB_PATH=<copy> PORT=3999 node index.js`) and call the API; never test against the live DB.

## Deploy on NAS

The app runs on the NAS (192.168.1.202) as a Dockge stack pulling `ghcr.io/wvdberge/portfolio:latest`. Dockge is on :5002, the app on :3001. GitHub Actions builds and pushes a new image on every push to `main`.

Deploy workflow:
1. Commit and push changes
2. Wait ~2 min for GitHub Actions to build
3. In **Dockge**: **Update** the `portfolio` stack (pulls the image). Restart or redeploy without pull keeps the old image; environment changes need a Deploy.

The Dockge stack file is separate from `docker-compose.yml` in this repo; keep both in step. The container needs `dns: [1.1.1.1, 9.9.9.9]`: the NAS's Pi-hole is unreachable from containers, and without it every outbound fetch fails with `EAI_AGAIN`.

One-off data fixes on the live DB: write an idempotent node script that requires `./db`, put it on the NAS, and have the user run `sudo docker exec -i -w /app/server <container> node - < script.js` (sudo needs the user's password). Test the script on a DB copy first, twice.

## Architecture

**Full-stack single-user app**: Express 4 + SQLite (server) / React 18 + Vite (client). The server is CommonJS; the client is ESM.

### Server

- `server/index.js` — Express entry point, mounts all routes under `/api`
- `server/db.js` — **Core file**: SQLite schema (inline `CREATE TABLE IF NOT EXISTS`), all migrations, and all heavy computation functions (XIRR, asset valuation, net worth history, yearly summary). If you're touching financial logic, it lives here.
- `server/priceFetchers.js` — Alpha Vantage (quotes, monthly series), Meesman (price-history xlsx from meesman.nl, read with adm-zip), Brand New Day (JSON API), CBS CPI
- `server/scheduler.js` — daily job (`PRICE_FETCH_CRON`): price refresh, CPI sync, benchmark sync
- `server/routes/` — one file per resource; thin wrappers that call `db.js` functions

### Client

- `client/src/api.js` — typed API client; all `fetch` calls go through here
- `client/src/format.js` — shared date/currency/number formatters
- `client/src/components/` — one component per page/view; component-local state only (`useState`/`useEffect`), no global state. View preferences (table sort, hidden chart series) live in `localStorage`, wrapped in try/catch.

### Database

SQLite at `../../data/wealth.db` (relative to `server/`) by default, or `DB_PATH` env var. Schema is in `db.js`. Migrations run inline at startup via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` guards. On the NAS most data sits in the `-wal` file.

Key design decisions:
- **Amounts always positive** in the DB; sign is derived from transaction type at query time
- Archived assets (`archived = 1`) are excluded from current net worth but included in historical XIRR cash flows

### Valuation

How an asset gets its value (`getAssetCurrentValue`, `getAssetValueAtDate`):
- **Priced**: `stock`, `etf`, `crypto`, and `pension` with a `price_source`: units (sum of buy/sell `quantity`) × latest `asset_prices` price. A snapshot overrides only when it is at least as recent as the latest price, so an old snapshot can fill dates before the first price (CB uses one on 2024-12-31).
- **Snapshot only**: `real_estate`, `other`, and `pension` without a `price_source`.
- **Savings**: latest snapshot if one exists; otherwise the balance from transactions (deposit + interest − withdrawal − fee). Without a deposit on or before the date, the account counts as unvalued.

Rules that keep returns honest:
- An asset with transactions but no value on a date is **unvalued**, not 0. Any XIRR whose window starts or ends there returns null (shown as "—").
- A snapshot-only asset without buy/deposit transactions (house, Good Shares) treats its first snapshot as the contribution, so only later changes count as return.
- Don't add snapshots to priced assets or to savings accounts valued from transactions. On a savings account a snapshot also flips interest to "paid out" in XIRR.

### XIRR

Implemented from scratch in `db.js` (Newton-Raphson + bisection fallback; results within 1e-9 of zero become 0). Sign convention: buy/deposit/fee = negative outflow, sell/withdrawal/dividend/interest = positive inflow. Period-based XIRR (1Y, 3Y, yearly rows) adds synthetic opening/closing cash flows around the period.

- **Portfolio XIRR covers assets only.** Liabilities have no recorded cash flows (repayments aren't booked), so they stay out; net worth figures still include them.
- `excludeTypes` (e.g. `['real_estate']`, API `?exclude=real_estate`) gives the returns without the house shown on the dashboard and in the yearly summary.
- Interest on a savings account without snapshots is not a cash flow: it stays in the balance and counts once, as growth.
- The `fee` type is an outflow in XIRR and subtracted from savings balance, but excluded from contributions tracking.

Dashboard weights and targets (`target_allocation_pct`) are shares of investments excluding `real_estate`.

### Import parsers (`server/routes/import.js`)

| Format | Key | Notes |
|---|---|---|
| ABN AMRO TAB | `abn_savings` | No header, tab-separated, detected by `.tab`. Maps fondscodes and the account number to assets in the UI on first import. Fund purchases, sales and servicekosten get a cash leg on the savings account so its balance matches the TAB; SEPA rows are deposits/withdrawals; dividends booked gross (net + dividendbelasting). Servicekosten use mapping key `servicekosten` (→ NT WLD SCR EQ IDX A). |
| Centraal Beheer | `centraal_beheer` | UTF-16 (LE with BOM or BE without), semicolon, detected by header. Purchases at Bruto. One priced asset per fund, mapped by fund name; each purchase brings units and Koers (monthly prices). `Overboeking` and `Dividend reservering` skipped. |
| Meesman | `meesman` | CSV. `Dividend herbelegging` emits dividend + buy. `Stortingsmix` rows have no units: derived from the price-history xlsx (first trading price on or after the deposit date, class A); an unpublished price is an error row. |
| Raisin | `raisin` | PDF account statement (pdf-parse), detected by `.pdf`. One savings asset per account, mapped by Rekening-ID. Every row checked against the printed running balance. Opening balance booked only if the account has no earlier transactions. |

The duplicate check counts occurrences per request: two identical rows in one file both import unless the DB already holds two. Mappings live in `import_mappings`; Meesman, CB and Raisin auto-create assets when unmapped. `IMPORT_GUIDE.md` has the user-facing steps.

### External data

- **CPI**: CBS open data table `86141NED` (2025=100, monthly from 2009-12). The total category key is `'T001112  '` (two trailing spaces).
- **MSCI World benchmark**: Alpha Vantage `TIME_SERIES_MONTHLY` of `IWDA.AMS` (EUR, accumulating). Free tier allows 1 request per second and 25 per day.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | — | Alpha Vantage quotes and the benchmark series |
| `BENCHMARK_SYMBOL` | `IWDA.AMS` | Alpha Vantage symbol for the MSCI World benchmark |
| `PRICE_FETCH_CRON` | `0 18 * * 1-5` | Schedule of the daily price/CPI/benchmark job |
| `TZ` | — | Timezone for the scheduler (`Europe/Amsterdam`) |
| `DB_PATH` | `../../data/wealth.db` | SQLite file location |
| `PORT` | 3001 | HTTP port |
