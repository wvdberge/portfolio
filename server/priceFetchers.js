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
  if (!quote || !quote['05. price']) {
    // The daily rate limit also comes back as a quote-less response, with the reason in Information/Note
    throw new Error(`Alpha Vantage: ${data['Error Message'] || data.Information || data.Note || 'empty quote, unknown ticker?'}`.slice(0, 200));
  }
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

// ── ABN AMRO fund screener ────────────────────────────────────────────────────

const ABN_BASE = 'https://fondsen.abnamro.nl/fundscreener/nl';
const ABN_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker)' };

// Latest price and date from the public fund page (HTML, no API). The fundId is what
// the chart endpoint wants. A missing field means ABN changed the page or the ISIN is wrong.
async function fetchAbnAmroFund(isin) {
  const resp = await fetch(`${ABN_BASE}/fund/${encodeURIComponent(isin)}`, { headers: ABN_HEADERS });
  if (!resp.ok) throw new Error(`ABN AMRO: HTTP ${resp.status} for "${isin}"`);
  const html = await resp.text();
  const price = html.match(/Koers\s*<\/div>\s*<\/div>\s*<div>\s*€\s*([\d.]+,\d+)/);
  const date = html.match(/Koersdatum[\s\S]{0,200}?(\d{2})-(\d{2})-(\d{4})/);
  const fundId = html.match(/charts\/quotes\?fundId=(\d+)/);
  if (!price || !date || !fundId) throw new Error(`ABN AMRO: no price found on the page for "${isin}"`);
  return {
    price: parseFloat(price[1].replace(/\./g, '').replace(',', '.')),
    date: `${date[3]}-${date[2]}-${date[1]}`,
    fundId: fundId[1],
  };
}

// Daily total-return index behind the fund page's chart: about 3 years, starts at 100,
// dividends reinvested. Not a price; see abnPriceHistory. Oldest first.
async function fetchAbnAmroIndex(fundId) {
  const resp = await fetch(`${ABN_BASE}/charts/quotes?fundId=${encodeURIComponent(fundId)}`, { headers: ABN_HEADERS });
  if (!resp.ok) throw new Error(`ABN AMRO index: HTTP ${resp.status} for fund ${fundId}`);
  const rows = (await resp.json())?.quotes?.rows;
  if (!rows || Object.keys(rows).length === 0) throw new Error(`ABN AMRO index: no data for fund ${fundId}`);
  return Object.values(rows)
    .map(r => ({ date: new Date(r.c[0].v * 1000).toISOString().slice(0, 10), value: r.c[1].v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Euro prices from the index, walking back from the latest real price. Between dividends
// price / index is constant. Across a dividend D per unit it was D / index higher before:
// the index counts D as return, the price drops by it. The step falls on the dividend's
// booking date, not the (unknown) ex-date: until then the value includes the dividend
// receivable, and the step lines up with the cash flow in XIRR.
// dividends: [{ date, perUnit }]. Weekends are skipped (the chart repeats Friday).
function abnPriceHistory(index, latest, dividends) {
  const anchor = index.find(i => i.date === latest.date);
  if (!anchor) throw new Error(`ABN AMRO index: no value for ${latest.date}`);
  const divs = dividends.filter(d => d.date <= latest.date).sort((a, b) => b.date.localeCompare(a.date));

  let ratio = latest.price / anchor.value;
  let next = 0;
  let later = anchor; // index value of the day after the one being priced
  const prices = [];
  for (const i of index.filter(i => i.date < latest.date).reverse()) {
    while (next < divs.length && i.date < divs[next].date) {
      ratio += divs[next].perUnit / later.value;
      next++;
    }
    later = i;
    const day = new Date(`${i.date}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) prices.push({ date: i.date, price: Math.round(i.value * ratio * 100) / 100 });
  }
  return prices.reverse();
}

module.exports = {
  fetchAbnAmroFund,
  fetchAbnAmroIndex,
  abnPriceHistory,
  fetchAlphaVantagePrice,
  fetchAlphaVantageMonthly,
  fetchMeesmanHistory,
  meesmanUnits,
  fetchCbsCpi,
  fetchBrandNewDayPrice,
  MEESMAN_FUNDS,
};
