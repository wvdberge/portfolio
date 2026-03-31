# Prompt: Build a Personal Wealth Tracker App

Build a personal wealth tracker web app with the same tech stack as my existing budget-app: Express + SQLite (`better-sqlite3`) server on port **3001**, React + Vite client on port **5174** (set in `vite.config.js`), client proxies `/api` to the server. Same folder structure: `server/` (with `db.js`, `index.js`, `routes/`) and `client/src/` (with `App.jsx`, `api.js`, `components/`). Database at `../data/wealth.db` in dev, `/data/wealth.db` in prod via `DB_PATH` env var.

---

## Data Model

**Assets** — one row per asset:
- `id`, `name`, `type` (enum: `stock`, `etf`, `savings`, `real_estate`, `pension`, `crypto`, `other`), `currency` (default `EUR`), `target_allocation_pct` (nullable)

**Liabilities** — one row per liability:
- `id`, `name`, `type` (enum: `mortgage`, `loan`, `other`), `currency`

**Transactions** — for liquid assets (stocks, ETFs, savings, crypto):
- `id`, `asset_id`, `date`, `type` (enum: `buy`, `sell`, `deposit`, `withdrawal`, `dividend`, `interest`), `quantity` (nullable — for shares), `price_per_unit` (nullable), `amount` (always in asset currency — the actual cash flow: positive = money in, negative = money out), `fee` (nullable), `notes`

**Snapshots** — for illiquid assets (real_estate, pension) and optionally to override liquid asset values:
- `id`, `asset_id`, `date`, `value` (current estimated value in asset currency), `notes`

**Liability snapshots** — periodic balance recording:
- `id`, `liability_id`, `date`, `balance` (outstanding amount), `interest_rate_pct` (nullable), `notes`

**Benchmark prices** — MSCI World index values for return comparison:
- `id`, `date`, `price` — manually entered or imported via CSV

**CPI data** — Dutch inflation index for real return calculation:
- `id`, `date` (first of month), `cpi_value`

---

## Core Computations (all in `server/db.js`)

**Current asset value:**
- Liquid assets: last snapshot value OR computed from transactions (sum of shares × last known price for stocks/ETFs; net deposits for savings)
- Illiquid assets: most recent snapshot value

**Net worth:** sum of all asset values − sum of all liability balances, in EUR (MVP assumes all EUR)

**XIRR per asset:** implement XIRR (Newton-Raphson or bisection) in JS. Cash flows = all transactions (deposits/buys as negative outflows, withdrawals/sells/dividends as positive inflows) plus a synthetic "sell everything today" cash flow at current value. Returns annualized money-weighted return.

**Portfolio XIRR:** same logic but aggregated — all cash flows across all assets + total current net worth as terminal cash flow.

**Benchmark return:** given a date range, compute the return for a hypothetical investment in MSCI World using the same contribution timing (time-weighted approximation is acceptable for MVP).

**Real return:** nominal XIRR − annualized CPI change over the same period.

**Contributions vs growth:** total net contributions (sum of deposits/buys minus withdrawals/sells) vs current value − contributions = unrealized gain.

---

## Views

### Dashboard (default view)
- Net worth today (large number) + sparkline over time (monthly data points)
- Asset allocation: actual % vs target % per asset type, flag drift > 5%
- Top-line returns: portfolio XIRR (1Y, 3Y, all-time), vs MSCI World same periods, real return
- Liabilities summary: total outstanding, largest liability
- Contributions vs growth: stacked bar chart per year — contributions (bottom) + market gain (top)

### Assets View
- Table of all assets: name, type, current value, weight %, individual XIRR (1Y + all-time), delta vs MSCI World benchmark
- Click into asset → transaction log + snapshot history + value chart over time

### Add/Edit Transactions (modal per asset)
- For stocks/ETFs: date, type (buy/sell/dividend), quantity, price per unit, fee — auto-compute `amount`
- For savings: date, type (deposit/withdrawal/interest), amount

### Snapshots Modal
- For illiquid assets and liability snapshots: date + value entry, list of past snapshots

### Yearly Summary View
Two levels:

**Portfolio level** — one row per calendar year + all-time row:
year | start net worth | contributions | growth | end net worth | nominal return % | real return % | MSCI World %

**Per-asset breakdown** (expandable per year or tab):
- Same columns, one row per asset
- Assets with no activity in a year still show if they had a balance
- Subtotal row per asset type (stocks, savings, real_estate, etc.)
- MSCI World column shows N/A for savings/real_estate/pension rows

### Benchmark & CPI Management (admin page)
- Import MSCI World prices via CSV (date, price) or manual entry
- Import/enter CPI values (month, index value)

---

## Charts

Use **Recharts** for all visualizations:

- **Net worth over time** (Dashboard): area chart, monthly data points, stacked by asset type
- **Asset allocation** (Dashboard): two donut charts side by side — actual vs target allocation
- **Individual asset value over time** (Asset detail): line chart combining snapshot values + computed value from transactions
- **Yearly returns comparison** (Yearly summary): grouped bar chart — nominal return, real return, MSCI World — one group per year
- **Contributions vs growth** (Dashboard): stacked bar chart per year — contributions (bottom) + market gain (top)

---

## Transaction Import

Server-side parsing in `routes/import.js`. Client-side review modal — show parsed rows, allow user to confirm/discard individual rows, then bulk-save. Support format auto-detection by filename pattern or user selection.

### General Import Rules
- Deduplicate on import: skip rows where an identical transaction (same asset, date, type, amount, quantity) already exists — show skipped count to user
- All amounts normalized to EUR (apply exchange rate column if present)
- Parsing errors shown inline per row; user can skip bad rows and import the rest

### Supported Formats

**ABN AMRO brokerage** (`type: stock` / `etf`)
- Export format: CSV from their investment portal
- Expected columns: date, transaction type (Koop/Verkoop/Dividend), security name, ISIN, quantity, price, currency, exchange rate, gross amount, costs, net amount
- Map to: `buy` / `sell` / `dividend` transaction types; derive `amount` from net amount; store ISIN in notes field

**Centraal Beheer** (`type: stock` / `etf` / `pension`)
- Build a parser stub with clearly marked `TODO: confirm column names from sample export`; document what columns are expected

**Meesman** (`type: pension` / `etf`)
- Index fund — likely shows units purchased, NAV per unit, date
- Map to: `buy` transactions with quantity + price_per_unit
- Build parser stub with `TODO: confirm from sample export`

**Brand New Day** (`type: etf`)
- Similar to Meesman — units + NAV
- Build parser stub with `TODO: confirm from sample export`

**Raisin** (`type: savings`)
- Savings platform — transactions are deposits, withdrawals, and interest payments across multiple sub-accounts
- Expected columns: date, account name, transaction type, amount, balance
- Map to: `deposit` / `withdrawal` / `interest` types
- Since there are many Raisin sub-accounts, the import UI must let the user map each Raisin account name to an existing asset (or create a new asset on the fly); store this mapping for future imports

---

## UX Details
- No auth — single-user local app
- All monetary values displayed in EUR with 2 decimal places; share quantities with up to 6 decimals
- Dates stored as ISO strings (`YYYY-MM-DD`), displayed as `DD MMM YYYY`
- Deletions: deleting an asset soft-deletes (archived flag) to preserve history; transactions and snapshots can be hard-deleted
- Mobile-friendly but desktop-first

---

## Out of Scope (MVP)
- Automatic price fetching (manual entry only)
- Multi-currency FX conversion
- Tax reporting beyond Box 3 estimation
- User accounts / profiles
