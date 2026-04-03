# Import Guide: Getting all accounts into the wealth app

## Accounts with full import support

### Meesman (CSV)
1. Log in → Transacties → download CSV
2. Upload via Import
3. `Dividend herbelegging` rows automatically split into dividend + buy (zero net XIRR impact)
4. `Stortingsmix` rows (no qty/price) import fine with just the amount

### Centraal Beheer (CSV)
1. Export from their portal (UTF-16 LE encoded — the importer handles this automatically)
2. Upload via Import — `Overboeking` rows are automatically skipped
3. Only `Aankoop` rows are currently parsed; sell/dividend rows will show as errors and need manual entry

### ABN AMRO savings (TAB/TXT file)
1. Log in → Sparen → download TAB/TXT export
2. On **first import**: you'll be asked to map each account number and fund code to an asset — create new assets as needed
3. On subsequent imports: mappings are saved, duplicate rows are skipped

---

## Savings accounts (fully manual)

For accounts where you enter manually (Rabo, ING, other savings):

1. Create the asset in the app (type: `savings`)
2. Enter deposits, withdrawals, and interest transactions from the beginning
3. Tip: if you have old bank statements, you only need the net monthly deposits/withdrawals and interest — you don't need every internal transfer

---

## Brokerage accounts with partial history (e.g., data only from Dec 2024)

You have two separate goals, and they need different solutions:

### Goal 1: Correct net worth / portfolio value (from any date)

Use a **snapshot**:
- Go to the asset in the app → add a snapshot for e.g. `2024-11-30` with the actual portfolio value at that date
- A snapshot overrides price-based valuation for net worth history — so the net worth chart is correct back to that date even without individual transactions

### Goal 2: Correct XIRR / return calculation

Use a **synthetic "opening buy" transaction**:
- On the date before your data starts (e.g. `2024-11-30`), manually add a `buy` transaction with:
  - Amount = total portfolio value at that date
  - No quantity or price needed (or estimate if you have it)
  - Notes: `Opening balance — synthetic transaction`
- Then import all real transactions from Dec 2024 onward
- This treats the portfolio value at that date as your cost basis, so XIRR is calculated correctly from that point forward

**You don't need to set a snapshot AND a synthetic buy** — pick based on your priority:
- Net worth history accurate → snapshot
- XIRR/return calculation accurate → synthetic buy
- Both → do both (snapshot for history, synthetic buy for XIRR)

### Recommended approach for partial brokerage data

1. Note the portfolio value on the last date before your data (e.g. from a statement or the broker's app)
2. Add a snapshot for that date
3. Add a synthetic buy on that date (same amount) — this anchors the return calculation
4. Import all available transaction history from that point forward
5. The duplicate checker prevents double-importing if you re-run the same file

---

## Order of operations (suggested)

1. Create all assets first (name, type, currency)
2. For partial-history brokerages: add snapshot + synthetic buy on the "start" date
3. Import Meesman (furthest history usually available)
4. Import Centraal Beheer
5. Import ABN brokerage (chain multiple exports if needed)
6. Import ABN savings TAB files (map accounts on first run)
7. Enter manual savings accounts transaction by transaction
