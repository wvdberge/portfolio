const cron = require('node-cron');
const { runPriceRefresh } = require('./routes/prices');
const { syncCpi } = require('./routes/cpi');
const { syncBenchmark } = require('./routes/benchmark');

// Default: 18:00 Mon-Fri. Override via PRICE_FETCH_CRON env var.
// TZ is controlled by the process environment (set TZ=Europe/Amsterdam in docker-compose).
const schedule = process.env.PRICE_FETCH_CRON || '0 18 * * 1-5';

cron.schedule(schedule, async () => {
  const now = new Date().toISOString();
  console.log(`[scheduler] Starting scheduled price refresh at ${now}`);
  try {
    const { fetched, skipped, errors } = await runPriceRefresh();
    console.log(`[scheduler] Done — fetched: ${fetched}, skipped: ${skipped}`);
    if (errors.length > 0) {
      for (const e of errors) {
        console.warn(`[scheduler] Error for ${e.ticker} (${e.source}): ${e.message}`);
      }
    }
  } catch (err) {
    console.error(`[scheduler] Unexpected error: ${err.message}`);
  }
  try {
    const { count, latest } = await syncCpi();
    console.log(`[scheduler] CPI synced — ${count} months, latest ${latest.date}`);
  } catch (err) {
    console.warn(`[scheduler] CPI sync failed: ${err.message}`);
  }
  try {
    await new Promise(r => setTimeout(r, 2000)); // Alpha Vantage free tier: max 1 request per second
    const { symbol, count, latest } = await syncBenchmark();
    console.log(`[scheduler] Benchmark ${symbol} synced — ${count} months, latest ${latest.date}`);
  } catch (err) {
    console.warn(`[scheduler] Benchmark sync failed: ${err.message}`);
  }
});

console.log(`[scheduler] Price refresh scheduled: "${schedule}"`);
