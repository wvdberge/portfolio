const AdmZip = require('adm-zip');

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

// Monthly closes, oldest first. Free tier: 25 requests/day, 1 per second.
async function fetchAlphaVantageMonthly(symbol) {
  if (!AV_KEY) throw new Error('ALPHA_VANTAGE_API_KEY not set');
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=${encodeURIComponent(symbol)}&apikey=${AV_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Alpha Vantage: HTTP ${resp.status}`);
  const data = await resp.json();
  const series = data['Monthly Time Series'];
  if (!series) throw new Error(`Alpha Vantage: ${data['Error Message'] || data.Information || data.Note || 'no monthly series'}`.slice(0, 200));
  return Object.entries(series)
    .map(([date, v]) => ({ date, price: parseFloat(v['4. close']) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Meesman ───────────────────────────────────────────────────────────────────

const MEESMAN_FUNDS = {
  'aandelen-wereldwijd-totaal':     'Aandelen Wereldwijd Totaal',
  'aandelen-verantwoorde-toekomst': 'Aandelen Verantwoorde Toekomst',
  'obligaties-wereldwijd':          'Obligaties Wereldwijd',
  'rentefonds':                     'Rentefonds',
};

// Full trading-price history ("handelskoersen", ~2x a week since 2015) from the
// xlsx linked on Meesman's fund pages. Column header = fund name; the standard
// class has a " A" suffix where a B class exists. Dividend dates carry an extra
// row with the dividend per unit, so per date the highest value is the price.
const MEESMAN_HISTORY_URL = 'https://www.meesman.nl/media/k5wd2q3j/handelskoersen-vanaf-2015-01-05.xlsx';

async function fetchMeesmanHistory(fundSlug) {
  const fundName = MEESMAN_FUNDS[fundSlug];
  if (!fundName) throw new Error(`Meesman: unknown fund "${fundSlug}"`);
  const resp = await fetch(MEESMAN_HISTORY_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker/2b)' } });
  if (!resp.ok) throw new Error(`Meesman history: HTTP ${resp.status}`);
  const zip = new AdmZip(Buffer.from(await resp.arrayBuffer()));

  const strings = [...zip.readAsText('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join(''));
  const rows = [...zip.readAsText('xl/worksheets/sheet1.xml').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r => {
    const cells = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[3] || '').match(/<v>([^<]*)<\/v>/);
      if (v) cells[c[1]] = /t="s"/.test(c[2]) ? strings[+v[1]] : v[1];
    }
    return cells;
  });

  const header = rows.find(r => r.A === 'datum');
  if (!header) throw new Error('Meesman history: header row not found');
  const col = Object.keys(header).find(k => header[k] === `${fundName} A`)
    || Object.keys(header).find(k => header[k] === fundName);
  if (!col) throw new Error(`Meesman history: no column for "${fundName}"`);

  const byDate = {};
  for (const r of rows) {
    const serial = Number(r.A), price = Number(r[col]);
    if (!serial || !price) continue;
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
    byDate[date] = Math.max(byDate[date] || 0, price);
  }
  return Object.entries(byDate).map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date));
}

// Units bought by a Meesman deposit: executed at the first trading price on or after
// the deposit date. Null if that price isn't published yet. Rounded to Meesman's 4 decimals.
function meesmanUnits(netAmount, date, history) {
  const trade = history.find(h => h.date >= date);
  if (!trade) return null;
  return { quantity: Math.round(netAmount / trade.price * 10000) / 10000, price: trade.price, tradeDate: trade.date };
}

// ── CBS CPI ───────────────────────────────────────────────────────────────────

// Monthly CPI, all households, total spending ("Alle bestedingen"), 2025=100,
// from CBS open data. Table 86141NED runs from 2009-12; it replaced 83131NED
// (2015=100, ended 2025). The category key is padded with two spaces.
const CBS_CPI_URL = "https://opendata.cbs.nl/ODataApi/odata/86141NED/TypedDataSet?$filter=Bestedingscategorieen%20eq%20%27T001112%20%20%27&$select=Perioden,CPI_1";

async function fetchCbsCpi() {
  const resp = await fetch(CBS_CPI_URL);
  if (!resp.ok) throw new Error(`CBS CPI: HTTP ${resp.status}`);
  const rows = (await resp.json()).value
    .filter(r => /^\d{4}MM\d{2}$/.test(r.Perioden) && r.CPI_1 != null)
    .map(r => ({ date: `${r.Perioden.slice(0, 4)}-${r.Perioden.slice(6, 8)}-01`, cpi_value: r.CPI_1 }));
  if (rows.length === 0) throw new Error('CBS CPI: no monthly values returned');
  return rows;
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
  fetchAlphaVantageMonthly,
  fetchMeesmanHistory,
  meesmanUnits,
  fetchCbsCpi,
  fetchBrandNewDayPrice,
  MEESMAN_FUNDS,
};
