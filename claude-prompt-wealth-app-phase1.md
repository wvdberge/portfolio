# Prompt: Personal Wealth Tracker — Phase 1 (Foundation)

Build a personal wealth tracker web app. Same tech stack as my existing budget app at `../budget/`: Express + `better-sqlite3` server on port **3001**, React + Vite client on port **5174** (set in `vite.config.js`), client proxies `/api` to the server. Same folder structure: `server/` (with `db.js`, `index.js`, `routes/`) and `client/src/` (with `App.jsx`, `api.js`, `components/`). Database at `../data/wealth.db` in dev, `/data/wealth.db` in prod via `DB_PATH` env var.

Mirror the `package.json` structure from `../budget/server/` and `../budget/client/`. The client additionally needs `react-router-dom` (v6) and `date-fns`.

Build the server layer first (schema + all routes). Pause and list the available API endpoints before starting the client.

---

## Data Model

Create the **full schema upfront** — Phase 1 only uses a subset, but building it all now avoids migrations later.

**`amount` sign convention throughout the entire app:** always store `amount` as a **positive number**. Direction is determined by `type`. Never store negative amounts.

### Assets
- `id`, `name`, `type` (enum: `stock`, `etf`, `savings`, `real_estate`, `pension`, `crypto`, `other`), `currency` (default `EUR`), `target_allocation_pct` (nullable REAL), `ticker` (nullable TEXT — Alpha Vantage symbol, e.g. `LON:IWDA`), `archived` (INTEGER NOT NULL DEFAULT 0)

### Liabilities
- `id`, `name`, `type` (enum: `mortgage`, `loan`, `other`), `currency` (default `EUR`)

### Transactions — for liquid assets (stock, etf, savings, crypto)
- `id`, `asset_id`, `date` (TEXT ISO `YYYY-MM-DD`), `type` (enum: `buy`, `sell`, `deposit`, `withdrawal`, `dividend`, `interest`), `quantity` (nullable REAL — share count for stocks/ETFs), `price_per_unit` (nullable REAL), `amount` (REAL NOT NULL — always positive, always in asset currency), `fee` (nullable positive REAL), `notes` (TEXT)
- Semantic direction: `buy`/`deposit` = money leaves wallet (outflow); `sell`/`withdrawal`/`dividend`/`interest` = money enters wallet (inflow)

### Asset Prices — current and historical prices for liquid assets
- `id`, `asset_id`, `date` (TEXT ISO `YYYY-MM-DD`), `price` (REAL — price per unit in asset currency)
- One row per asset per date. For savings, price is always 1.0 (optional, schema accepts it).

### Snapshots — for illiquid assets (real_estate, pension); optionally override liquid asset values
- `id`, `asset_id`, `date` (TEXT), `value` (REAL — estimated total value in asset currency), `notes` (TEXT)

### Liability Snapshots
- `id`, `liability_id`, `date` (TEXT), `balance` (REAL — outstanding amount), `interest_rate_pct` (nullable REAL), `notes` (TEXT)

### Benchmark Prices — MSCI World index values (for Phase 2)
- `id`, `date` (TEXT `YYYY-MM-DD`), `price` (REAL)

### CPI Data — Dutch consumer price index (for Phase 2)
- `id`, `date` (TEXT `YYYY-MM-DD`, first of month), `cpi_value` (REAL)

### Import Mappings — maps external broker account names to assets (for Phase 2 CSV import)
- `id`, `broker` (TEXT, e.g. `raisin`), `external_name` (TEXT), `asset_id` (INTEGER REFERENCES assets)
- UNIQUE constraint on (`broker`, `external_name`)

---

## Core Computations (`server/db.js`)

### Current asset value (in asset currency)

- **`stock` / `etf` / `crypto`:** most recent `asset_prices` entry price × net holdings (sum of `buy` quantities − sum of `sell` quantities from transactions). If no price entry exists, return `null`.
- **`savings`:** sum of inflow transactions (`deposit` + `interest` amounts) − sum of outflow transactions (`withdrawal` amounts).
- **`real_estate` / `pension` / `other`:** most recent `snapshots` value. If no snapshot exists, return `null`.
- **Override rule:** if a snapshot exists for a liquid asset and its date is more recent than the latest `asset_prices` entry, the snapshot value overrides the computed value.

### Net holdings (shares)
For a given asset: sum of `buy` quantities − sum of `sell` quantities from all transactions.

### Net worth
Sum of all non-null current asset values − sum of most recent liability balances. All assets and liabilities are denominated in EUR; no FX conversion is needed or implemented.

---

## Views

### Navigation
Top nav with links: Dashboard | Assets | Liabilities | Data Entry

### Dashboard
- Net worth today (large number, EUR)
- **Asset allocation table:** one row per asset — name, type, current value EUR, weight % of total assets, target % (if set), drift (actual pp − target pp; highlight in red if |drift| > 5 percentage points)
- **Liabilities summary:** total outstanding amount, list of each liability with most recent balance and date

### Assets View (`/assets`)
- "Add Asset" button → Add Asset modal
- Table: name, type, currency, current value (null shown as "—"), weight % of total assets
- Archived assets hidden by default; toggle to show all (archived rows visually dimmed)
- Click row → Asset Detail

### Asset Detail (`/assets/:id`)
- Header: asset name, type, current value
- Three tabs: **Transactions** | **Prices** | **Snapshots**

**Transactions tab**
- Table sorted by date descending: date, type, quantity, price/unit, amount, fee, notes
- Delete button per row (hard delete, with confirmation)
- "Add Transaction" button → Add Transaction modal

**Prices tab** (visible for stock/etf/crypto asset types only — hidden for savings)
- Table sorted by date descending: date, price per unit
- Delete button per row (hard delete)
- "Add Price" button → Add Price modal

**Snapshots tab**
- Table sorted by date descending: date, value, notes
- Delete button per row (hard delete)
- "Add Snapshot" button → Add Snapshot modal

### Liabilities View (`/liabilities`)
- "Add Liability" button → Add Liability modal
- Table: name, type, currency, most recent balance, date of last snapshot
- Click row → Liability Detail

### Liability Detail (`/liabilities/:id`)
- Header: liability name, type
- Snapshot history table: date, balance, interest rate %, notes — sorted descending
- Delete button per snapshot (hard delete)
- "Add Snapshot" button → Add Liability Snapshot modal
- Edit liability button → Edit Liability modal

### Data Entry Page (`/data-entry`)
Centralized admin page for reference data. Two sections:

**MSCI World Prices**
- Table of existing entries: date, price — sorted descending, delete button per row
- Form to add a new entry: date + price

**CPI Values**
- Table of existing entries: date (month), cpi_value — sorted descending, delete button per row
- Form to add a new entry: month (date picker) + cpi_value

---

## Modals

### Add/Edit Asset
Fields: name, type (select), currency (default EUR), target_allocation_pct (optional), ticker (optional — label: "Price ticker (Alpha Vantage symbol)", placeholder: e.g. `LON:IWDA`)

### Add Transaction
Opened from Asset Detail. Asset type determines fields:

**stock / etf / crypto — buy / sell:** date, type (buy/sell), quantity, price_per_unit, fee (optional)
- Auto-compute and display `amount` (read-only):
  - buy: `quantity × price_per_unit + fee`
  - sell: `quantity × price_per_unit − fee`
- User edits quantity / price / fee; amount updates live

**stock / etf / crypto — dividend:** date, type (dividend), amount (positive cash inflow)
- No quantity or price fields; dividend is a cash amount, not a unit transaction

**savings:** date, type (deposit/withdrawal/interest), amount
- Validation: amount must be > 0

### Add Price
date, price (> 0)

### Add Snapshot (asset)
date, value (> 0), notes (optional)

### Add/Edit Liability
name, type (select), currency (default EUR)

### Add Liability Snapshot
date, balance (> 0), interest_rate_pct (optional), notes (optional)

---

## UX Details
- No auth — single-user local app
- All EUR monetary values: 2 decimal places. Share quantities: up to 6 decimal places.
- Dates stored as ISO `YYYY-MM-DD`, displayed as `DD MMM YYYY`
- Deletions: assets are soft-deleted (`archived = 1`); all other records are hard-deleted with a confirmation prompt
- Desktop-first; basic mobile support (responsive layout, no mobile-specific optimizations needed)
- Show loading states on async data fetches

---

## Out of Scope for Phase 1
- Charts (no Recharts)
- XIRR / return calculations
- Yearly Summary view
- CSV import
- Benchmark return / real return comparisons
