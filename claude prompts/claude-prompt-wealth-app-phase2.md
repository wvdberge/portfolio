# Prompt: Personal Portfolio Tracker — Phase 2 (Returns, Charts & Import)

Phase 2 of the portfolio tracker. Phase 1 is already built and working — the full database schema and all CRUD routes exist.

**Do not modify the existing schema or break existing API routes.** Only add new routes and extend `db.js` with new computation functions.

Same tech stack: Express + `better-sqlite3` on port 3001, React + Vite on port 5174.

---

## `amount` Sign Convention (established in Phase 1)

`amount` is always stored as a positive number. For cash flow computations:
- **Outflows (treat as negative):** `buy`, `deposit`
- **Inflows (treat as positive):** `sell`, `withdrawal`, `dividend`, `interest`

---

## New Computations (`server/db.js`)

### XIRR

Implement XIRR in plain JS — no external library. Use Newton-Raphson with bisection fallback. Input: array of `{ date: Date, amount: number }` where outflows are negative and inflows are positive. Return annualized rate as a decimal (e.g. `0.072` for 7.2%), or `null` if fewer than 2 cash flows or if convergence fails.

**Per-asset XIRR (`period`: `1y` | `3y` | `all`):**
1. Take all transactions for the asset within the period. Apply sign convention above.
2. For `1y`/`3y`: if the asset had value at the start of the period, add a synthetic "opening purchase" cash flow on the period start date with a negative amount equal to the asset value on that date (reconstructed from prices × holdings at that date).
3. Add a synthetic terminal inflow on today's date equal to the current asset value.
4. Run XIRR on this cash flow array.

**Portfolio XIRR (`period`: `1y` | `3y` | `all`):**
Same logic but aggregate across all non-archived assets. Terminal cash flow = total current net worth.

**Routes:**
- `GET /api/assets/:id/xirr?period=1y|3y|all` → `{ xirr: 0.072 }` or `{ xirr: null }`
- `GET /api/portfolio/xirr?period=1y|3y|all` → same shape

### Benchmark Return

Given a date range, compute annualized MSCI World return:
`((end_price / start_price) ^ (1 / years)) − 1`

Use the nearest `benchmark_prices` entry on or before `from` as `start_price`, and nearest entry on or before `to` as `end_price`. Return `null` if no data available for the range.

**Route:** `GET /api/benchmark/return?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ return: 0.089 }` or `{ return: null }`

### Real Return

`real_return = nominal_xirr − annualized_cpi_change`

Where: `annualized_cpi_change = ((cpi_end / cpi_start) ^ (1 / years)) − 1`

Use the nearest CPI entry to period start/end dates. Return `null` if CPI data is unavailable.

### Net Worth History

Reconstruct historical net worth for charting.

**Route:** `GET /api/portfolio/history?granularity=monthly` → array of `{ date, net_worth, breakdown: { stock, etf, savings, real_estate, pension, crypto, other, liabilities } }`

For each month-end data point (from earliest transaction/snapshot date to today):
- **Liquid assets (stock/etf/crypto):** most recent `asset_prices` entry with `date ≤ month_end` × net holdings from transactions with `date ≤ month_end`. Null if no price entry exists yet.
- **Savings:** sum of inflow transactions − sum of outflow transactions with `date ≤ month_end`.
- **Illiquid assets:** most recent `snapshots` entry with `date ≤ month_end`. Null if none.
- **Liabilities:** most recent `liability_snapshots` entry with `date ≤ month_end`. Zero if none.
- Skip a month if all asset values are null (no data yet at all).

### Contributions vs Growth

**Route:** `GET /api/portfolio/contributions-vs-growth` → array of `{ year, contributions, gain, end_value }`

Per calendar year:
- `contributions` = sum of outflow amounts (`buy`/`deposit`) − sum of inflow amounts (`sell`/`withdrawal`) across all assets for that year. (Dividends and interest excluded from contributions — they count as gain.)
- `end_value` = net worth at Dec 31 of that year (using net worth history logic above).
- `gain` = `end_value − start_value − contributions` where `start_value` = net worth at Jan 1 (= Dec 31 of prior year).

### Yearly Summary

**Route:** `GET /api/portfolio/yearly-summary` → `{ portfolio: [...], byAsset: [...] }`

Portfolio rows — one per calendar year + one all-time row:
`{ year, start_net_worth, contributions, growth, end_net_worth, nominal_return_pct, real_return_pct, msci_world_pct }`

Per-asset rows — same columns, grouped by year. Include assets that had a balance during the year even if no transactions. Add subtotal rows per asset type (`_subtotal: true, type: 'stock'` etc.). `msci_world_pct` is null for savings/real_estate/pension rows.

---

## Automatic Price Fetching (Alpha Vantage)

API key stored in environment variable `ALPHA_VANTAGE_API_KEY`. If the variable is not set, price fetching is silently disabled — manual entry still works normally.

### Route: `POST /api/prices/refresh`

Fetches the latest price for every non-archived asset that has a `ticker` set. Processes assets **sequentially** (not in parallel) to respect Alpha Vantage rate limits. Returns a summary: `{ fetched: N, skipped: N, errors: [{ assetId, ticker, message }] }`.

For each asset:
1. Call Alpha Vantage Global Quote endpoint:
   `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={ticker}&apikey={key}`
2. Extract `data['Global Quote']['05. price']` as a float.
3. Extract `data['Global Quote']['07. latest trading day']` as the date (`YYYY-MM-DD`).
4. Upsert into `asset_prices`: if a row already exists for this asset + date, update the price; otherwise insert.
5. If the API returns an empty `Global Quote` object (unknown ticker) or any error, record it in the errors array and continue.

### Route: `POST /api/prices/refresh/:assetId`

Same logic but for a single asset. Returns `{ date, price }` on success or `{ error: message }` on failure.

### UI

**Assets View:** add a "Refresh All Prices" button in the page header. On click, calls `POST /api/prices/refresh`, shows a toast/banner with the result summary (e.g. "Updated 8 prices. 2 errors: MEESMAN, BND").

**Asset Detail — Prices tab:** add a "Fetch Latest Price" button next to "Add Price". Calls `POST /api/prices/refresh/:assetId`. Disabled if no ticker is set on the asset (show tooltip: "Set a ticker symbol on this asset to enable auto-fetch").

**No automatic fetching on page load** — always user-initiated to stay within the 25 requests/day free tier limit.

---

## Extended Views

### Dashboard — add charts and return metrics

Add below the existing net worth number and allocation table:

**Net Worth Over Time** (Recharts `AreaChart`):
- X-axis: months. Y-axis: EUR.
- Stacked areas by asset type (one color per type). Liabilities shown as a separate line going downward from zero (or as a "debt" stacked area below the x-axis).
- Data from `/api/portfolio/history`.

**Asset Allocation** (Recharts `PieChart` / donut):
- Two donuts side by side: actual allocation % vs target allocation %.
- Only assets with `target_allocation_pct` set appear in the target donut. Others grouped as "Unassigned".

**Contributions vs Growth** (Recharts `BarChart`, stacked):
- X-axis: year. Two stacked bars per year: contributions (bottom) + market gain (top).
- Data from `/api/portfolio/contributions-vs-growth`.

**Returns Section:**
- Portfolio XIRR: 1Y | 3Y | All-time — shown as three stat boxes.
- Each paired with MSCI World return for the same period.
- Real return (all-time).

### Assets View — add return columns

Extend the existing assets table with two new columns: **XIRR (1Y)** and **XIRR (all-time)**. Fetched in bulk via a new route `GET /api/assets/xirr-summary` that returns all asset XIRRs in one query to avoid N+1 requests.

### Yearly Summary View (`/yearly`) — new

**Portfolio-level table** (one row per year + all-time row):
`Year | Start NW | Contributions | Growth | End NW | Nominal % | Real % | MSCI %`

Below, **per-asset breakdown:**
- Default: collapsed. Expand button per year (or a global "expand all" toggle).
- When expanded: one row per asset, same columns. Subtotal row per asset type. MSCI % = "—" for savings/real_estate/pension rows.
- Rows for assets with no activity in a year but existing balance are still shown (zero contributions, gain = value change).

---

## CSV Import

### UI Flow
1. User opens import modal, selects a file and optionally selects the format (auto-detect by filename as fallback).
2. **For Raisin:** an account-mapping step appears first — list of unique account names found in the file, each with a dropdown to select an existing asset or "Create new asset". Mappings are pre-filled from `import_mappings` table. User confirms mappings before proceeding.
3. Parsed rows are shown in a review table: date, type, asset name, quantity, amount, status (OK / Error / Duplicate). Errors shown inline. User can uncheck individual rows.
4. "Import X rows" button — bulk saves checked, non-duplicate rows. Shows result: X imported, Y skipped (duplicates), Z errors.

### Server: `routes/import.js`

**Deduplication:** before saving, check for existing transaction with same (`asset_id`, `date`, `type`, `amount`, `quantity`). Skip if found, count as duplicate.

**Error handling:** if a row fails to parse (missing required field, invalid date, non-numeric amount), mark it as an error with a message. Never abort the whole import for a single bad row.

### Parsers

**ABN AMRO brokerage** (type: stock/etf) — fully implemented:
- Expected columns: date, transaction type (Koop/Verkoop/Dividend), security name, ISIN, quantity, price, currency, exchange rate, gross amount, costs, net amount
- Map: Koop→buy, Verkoop→sell, Dividend→dividend
- `amount` = net amount (always store positive)
- `fee` = costs field
- Store ISIN in notes field
- Apply exchange rate to normalize to EUR if currency ≠ EUR

**Centraal Beheer** — stub:
```js
// TODO: confirm column names from sample export
// Expected: date, type, fund name, units, NAV, amount
function parseCentraalBeheer(rows) {
  throw new Error('Centraal Beheer parser not yet implemented');
}
```

**Meesman** — stub:
```js
// TODO: confirm column names from sample export
// Expected: date, fund name, units purchased, NAV per unit
function parseMeesman(rows) {
  throw new Error('Meesman parser not yet implemented');
}
```

**Brand New Day** — stub:
```js
// TODO: confirm column names from sample export
// Expected: similar to Meesman — units + NAV
function parseBrandNewDay(rows) {
  throw new Error('Brand New Day parser not yet implemented');
}
```

**Raisin** (type: savings) — fully implemented:
- Expected columns: date, account name, transaction type, amount, balance
- Map transaction types: deposit→deposit, withdrawal→withdrawal, interest→interest
- Amount always stored positive
- Before import, UI provides account→asset mapping (see UI Flow above); parser receives a `{ externalName → assetId }` map
- After successful import, save any new mappings to `import_mappings` table

---

## UX Details (unchanged)
- No auth, single-user
- Amounts: EUR, 2 decimal places. Quantities: up to 6 decimal places.
- Dates: stored ISO `YYYY-MM-DD`, displayed `DD MMM YYYY`
- Show loading states on async data fetches; show "No data yet" empty states on charts with no data
