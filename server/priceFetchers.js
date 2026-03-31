const cheerio = require('cheerio');

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY;

// ── Alpha Vantage ─────────────────────────────────────────────────────────────

async function fetchAlphaVantagePrice(ticker) {
  if (!AV_KEY) throw new Error('ALPHA_VANTAGE_API_KEY not set');
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${AV_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Alpha Vantage: HTTP ${resp.status}`);
  const data = await resp.json();
  const quote = data['Global Quote'];
  if (!quote || !quote['05. price']) throw new Error('Alpha Vantage: empty quote — unknown ticker?');
  return {
    price: parseFloat(quote['05. price']),
    date: quote['07. latest trading day'],
  };
}

// ── Meesman ───────────────────────────────────────────────────────────────────

const MEESMAN_FUNDS = {
  'aandelen-wereldwijd-totaal':     'Aandelen Wereldwijd Totaal',
  'aandelen-verantwoorde-toekomst': 'Aandelen Verantwoorde Toekomst',
  'obligaties-wereldwijd':          'Obligaties Wereldwijd',
  'rentefonds':                     'Rentefonds',
};

async function fetchMeesmanPrice(fundSlug) {
  const url = `https://www.meesman.nl/onze-fondsen/${encodeURIComponent(fundSlug)}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker/2b)' },
  });
  if (!resp.ok) throw new Error(`Meesman: HTTP ${resp.status} for fund "${fundSlug}"`);

  const html = await resp.text();

  // Try regex on full HTML body first
  const match = html.match(/€([\d.,]+)\s*\((\d{2})-(\d{2})-(\d{4})\)/);
  if (match) {
    const price = parseFloat(match[1].replace(',', '.'));
    const date = `${match[4]}-${match[3]}-${match[2]}`;
    return { date, price };
  }

  // Cheerio fallback: try data-price attribute or text nodes near "koers"
  const $ = cheerio.load(html);
  let priceText = $('[data-price]').attr('data-price') || $('[data-koers]').attr('data-koers') || '';
  if (!priceText) {
    // Try finding a text node that contains a euro sign near a date pattern
    $('*').each((_, el) => {
      const text = $(el).text();
      const m = text.match(/€([\d.,]+)\s*\((\d{2})-(\d{2})-(\d{4})\)/);
      if (m && !priceText) {
        priceText = m[0];
      }
    });
    const m2 = priceText.match(/€([\d.,]+)\s*\((\d{2})-(\d{2})-(\d{4})\)/);
    if (m2) {
      return { date: `${m2[4]}-${m2[3]}-${m2[2]}`, price: parseFloat(m2[1].replace(',', '.')) };
    }
  }

  throw new Error(`Meesman: could not parse price from page for fund "${fundSlug}"`);
}

// ── Brand New Day ─────────────────────────────────────────────────────────────

async function fetchBrandNewDayPrice(fundId) {
  const url = `https://devrobotapi.azurewebsites.net/v1/fundrates?id=${encodeURIComponent(fundId)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Brand New Day: HTTP ${resp.status} for fund ID "${fundId}"`);

  const data = await resp.json();
  const rates = data?.rates;
  if (!Array.isArray(rates) || rates.length === 0) {
    throw new Error(`Brand New Day: no rate data returned for fund ID "${fundId}"`);
  }

  // Sort descending by date string (ISO prefix is lexicographically comparable)
  const sorted = [...rates].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  return {
    date: latest.date.slice(0, 10),
    price: latest.nav,
  };
}

module.exports = {
  fetchAlphaVantagePrice,
  fetchMeesmanPrice,
  fetchBrandNewDayPrice,
  MEESMAN_FUNDS,
};
