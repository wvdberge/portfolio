# Prompt: Personal Wealth Tracker — Phase 2b (Meesman & Brand New Day Price Fetching)

Phase 2b of the wealth tracker. Phases 1 and 2 are already built, including the Alpha Vantage price fetching integration.

**Do not modify existing schema or break existing routes.** Add a `price_source` column to the assets table, extend `routes/prices.js`, and add a new `server/priceFetchers.js` module.

---

## Schema Change

Add one column to `assets`:

```sql
ALTER TABLE assets ADD COLUMN price_source TEXT CHECK(price_source IN ('alpha_vantage', 'meesman', 'brand_new_day')) DEFAULT NULL;
```

- `price_source = null` → manual price entry only
- `price_source = 'alpha_vantage'` → use existing Alpha Vantage fetcher; `ticker` field holds the AV symbol
- `price_source = 'meesman'` → use Meesman scraper; `ticker` field holds the fund slug (e.g. `aandelen-wereldwijd-totaal`)
- `price_source = 'brand_new_day'` → use BND API; `ticker` field holds the fund ID as a string (e.g. `1002`)

Update the Add/Edit Asset modal: replace the plain ticker text input with two fields:
- **Price source** (select): None | Alpha Vantage | Meesman | Brand New Day
- **Fund / Ticker** (conditional on price source):
  - Alpha Vantage: free text input, label "Ticker symbol (e.g. IWDA.LON)"
  - Meesman: dropdown of known funds (see below)
  - Brand New Day: dropdown populated by fetching `GET /api/prices/bnd-funds` (see below)
  - None: field hidden

---

## New Module: `server/priceFetchers.js`

Export three async functions. All return `{ date: 'YYYY-MM-DD', price: number }` on success, or throw an error with a descriptive message.

### `fetchAlphaVantagePrice(ticker)`
Already implemented in Phase 2. Move it here from its current location and re-export from `routes/prices.js`.

### `fetchMeesmanPrice(fundSlug)`

Known fund slugs and display names — hardcode this map:
```js
const MEESMAN_FUNDS = {
  'aandelen-wereldwijd-totaal':   'Aandelen Wereldwijd Totaal',
  'aandelen-verantwoorde-toekomst': 'Aandelen Verantwoorde Toekomst',
  'obligaties-wereldwijd':         'Obligaties Wereldwijd',
  'rentefonds':                    'Rentefonds',
};
```

Steps:
1. Fetch `https://www.meesman.nl/onze-fondsen/{fundSlug}` with a standard browser User-Agent header.
2. Parse the HTML body. The current price and date appear as plain text in the format `€90.9617 (27-03-2026)`.
3. Extract with this regex: `/€([\d.]+)\s*\((\d{2})-(\d{2})-(\d{4})\)/`
   - Group 1: price (parse as float)
   - Groups 2/3/4: day/month/year → convert to `YYYY-MM-DD`
4. Return `{ date, price }`.
5. If the regex finds no match, throw: `Meesman: could not parse price from page for fund "${fundSlug}"`.

Install dependency: `npm install cheerio` — not needed if regex match works directly on the response body string, but add cheerio anyway for resilience in case the format is inside a specific element (use `$('[data-price]').text()` or similar as a fallback if regex fails on full body).

### `fetchBrandNewDayPrice(fundId)`

Brand New Day has an official (undocumented) API hosted at `devrobotapi.azurewebsites.net`. **Note:** the "dev" prefix in the domain suggests this is not a formally published API — it may change without notice. Handle errors gracefully.

Steps:
1. Fetch `https://devrobotapi.azurewebsites.net/v1/fundrates?id={fundId}`.
2. Response shape: `{ fundId, rates: [{ date: '2026-03-30T00:00:00', nav: 35.114197, ... }] }`
3. Sort `rates` by `date` descending, take the first entry.
4. Parse date: take the first 10 characters of the ISO string (`2026-03-30`).
5. Return `{ date, price: rates[0].nav }`.
6. If `rates` is empty or missing, throw: `Brand New Day: no rate data returned for fund ID "${fundId}"`.

---

## New Route: `GET /api/prices/bnd-funds`

Fetch `https://devrobotapi.azurewebsites.net/v1/funds`, return the array of `{ id, name }` objects to the client. Cache the response in memory for the duration of the server process (don't re-fetch on every modal open). Return `[]` and log a warning if the endpoint is unreachable.

---

## Extended Route: `POST /api/prices/refresh`

Extend the existing bulk refresh route to route each asset to the correct fetcher based on `price_source`:

```js
if (asset.price_source === 'alpha_vantage') result = await fetchAlphaVantagePrice(asset.ticker);
else if (asset.price_source === 'meesman')    result = await fetchMeesmanPrice(asset.ticker);
else if (asset.price_source === 'brand_new_day') result = await fetchBrandNewDayPrice(asset.ticker);
else continue; // no price_source set, skip
```

Same upsert logic as before: insert into `asset_prices`, or update price if a row already exists for that asset + date.

Same response shape: `{ fetched: N, skipped: N, errors: [{ assetId, ticker, message }] }`.

---

## UX Notes

- In the "Refresh Prices" result toast, distinguish errors by source so the user knows if it's a Meesman scraping failure vs a BND API failure vs an Alpha Vantage issue.
- When Meesman or BND is selected as price source and the `ticker` / fund ID field is filled, show a "Test fetch" button in the modal that calls `POST /api/prices/refresh/:assetId` and displays the returned price inline — helpful for verifying the setup before saving.
- The BND funds dropdown should show the fund name (from the API) as the label and store the `id` as the value. If the `GET /api/prices/bnd-funds` call fails, show a text input as fallback with placeholder "Enter fund ID".

---

## Out of Scope for Phase 2b
- Historical price backfill (fetching past prices, not just today's)
- Meesman Excel historical download parsing
- Any other brokers
