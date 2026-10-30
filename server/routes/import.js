const express = require('express');
const router = express.Router();
const multer = require('multer');
const Papa = require('papaparse');
const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // lib path: the package index runs a debug self-test
const { db } = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Parsers ───────────────────────────────────────────────────────────────────

// Parse Dutch number format: "3.000,00" → 3000.00
function parseDutchNumber(raw) {
  if (raw == null || raw === '') return NaN;
  return parseFloat(String(raw).replace(/\./g, '').replace(',', '.'));
}

function parseMeesman(rows) {
  function parseAmount(raw) {
    return parseDutchNumber(String(raw || '').replace(/€\s*/g, '').trim());
  }

  return rows.flatMap(row => {
    try {
      const dateRaw = (row['Datum'] || '').trim();
      const typeRaw = (row['Type'] || '').trim();
      const fundName = (row['Fonds'] || '').trim();

      if (!dateRaw || !typeRaw || !fundName) {
        return [{ status: 'error', error: 'Missing required field', _raw: row }];
      }

      const dmyMatch = dateRaw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (!dmyMatch) return [{ status: 'error', error: `Unrecognised date: ${dateRaw}`, _raw: row }];
      const date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

      const bruto = parseAmount(row['Bruto']);
      const netto = parseAmount(row['Netto']);
      const kosten = parseAmount(row['Kosten']);
      if (isNaN(bruto)) return [{ status: 'error', error: 'Invalid amount', _raw: row }];

      const quantity = row['Aantal'] ? parseDutchNumber(row['Aantal']) : null;
      const price = row['Koers'] ? parseDutchNumber(row['Koers']) : null;

      const base = {
        status: 'ok',
        asset_name: fundName,
        external_name: fundName,
        broker: 'meesman',
        quantity: quantity && !isNaN(quantity) ? quantity : null,
        price_per_unit: price && !isNaN(price) ? price : null,
        fee: kosten > 0 && !isNaN(kosten) ? kosten : null,
        notes: null,
        asset_id: null,
      };

      if (typeRaw === 'Aankoop') {
        return [{ ...base, date, type: 'buy', amount: bruto }];
      }

      if (typeRaw === 'Dividend herbelegging') {
        // No external cash flow — emit dividend (inflow) + buy (outflow) so they cancel in XIRR
        return [
          { ...base, date, type: 'dividend', amount: netto, fee: null, notes: 'Dividend herbelegging' },
          { ...base, date, type: 'buy',      amount: netto,            notes: 'Dividend herbelegging' },
        ];
      }

      return [{ status: 'error', error: `Unknown type: ${typeRaw}`, _raw: row }];
    } catch (err) {
      return [{ status: 'error', error: err.message, _raw: row }];
    }
  });
}

function parseCentraalBeheer(rows) {
  return rows.flatMap(row => {
    try {
      const typeRaw = (row['Soort'] || '').trim();
      if (typeRaw === 'Overboeking') return []; // incoming bank transfer — skip
      if (typeRaw === 'Dividend reservering') return []; // ex-dividend notice, amounts are zero — skip

      const dateRaw = (row['Boekdatum'] || '').trim();
      const fundName = (row['Fondsnaam'] || '').trim();

      if (!dateRaw || !typeRaw) return [{ status: 'error', error: 'Missing date or type', _raw: row }];

      const dmyMatch = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!dmyMatch) return [{ status: 'error', error: `Unrecognised date: ${dateRaw}`, _raw: row }];
      const date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

      if (typeRaw === 'Aankoop') {
        if (!fundName) return [{ status: 'error', error: 'Missing fund name', _raw: row }];

        // Bruto = cash paid incl. Aankoopkosten; fee is stored for reference only
        const bruto = parseDutchNumber(row['Bruto bedrag (EUR)']);
        const fee = parseDutchNumber(row['Aankoopkosten']) || 0;
        const quantity = row['Aantal stukken'] ? parseDutchNumber(row['Aantal stukken']) : null;
        const price = row['Koers'] ? parseDutchNumber(row['Koers']) : null;

        if (isNaN(bruto)) return [{ status: 'error', error: 'Invalid amount', _raw: row }];

        return [{
          status: 'ok',
          date,
          type: 'buy',
          asset_name: fundName,
          external_name: fundName,
          broker: 'centraal_beheer',
          quantity: quantity && !isNaN(quantity) ? quantity : null,
          price_per_unit: price && !isNaN(price) ? price : null,
          amount: bruto,
          fee: fee > 0 ? fee : null,
          notes: null,
          asset_id: null,
        }];
      }

      if (typeRaw === 'Dividend Uitkering') {
        // Net (after dividendbelasting) is reinvested via a separate Aankoop row a day later
        if (!fundName) return [{ status: 'error', error: 'Missing fund name', _raw: row }];
        const netto = parseDutchNumber(row['Netto bedrag (EUR)']);
        const tax = parseDutchNumber(row['Dividendbelasting']) || 0;
        if (isNaN(netto)) return [{ status: 'error', error: 'Invalid amount', _raw: row }];
        return [{
          status: 'ok',
          date,
          type: 'dividend',
          asset_name: fundName,
          external_name: fundName,
          broker: 'centraal_beheer',
          quantity: null,
          price_per_unit: null,
          amount: netto,
          fee: null,
          notes: tax > 0 ? `Dividendbelasting ${tax.toFixed(2)}` : null,
          asset_id: null,
        }];
      }

      return [{ status: 'error', error: `Unknown type: ${typeRaw}`, _raw: row }];
    } catch (err) {
      return [{ status: 'error', error: err.message, _raw: row }];
    }
  });
}

function parseAbnSavings(rawText) {
  const lines = rawText.split('\n').filter(l => l.trim());
  return lines.flatMap(line => {
    try {
      const cols = line.split('\t');
      if (cols.length < 8) {
        return [{ status: 'error', error: `Expected 8 columns, got ${cols.length}`, _raw: line.slice(0, 80) }];
      }

      const dateRaw = cols[2].trim();
      if (!/^\d{8}$/.test(dateRaw)) {
        return [{ status: 'error', error: `Invalid date: ${dateRaw}`, _raw: line.slice(0, 80) }];
      }
      const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;

      const signedAmount = parseDutchNumber(cols[6].trim());
      if (isNaN(signedAmount)) {
        return [{ status: 'error', error: `Invalid amount: ${cols[6]}`, _raw: line.slice(0, 80) }];
      }
      const amount = Math.abs(signedAmount);

      const desc = (cols[7] || '').replace(/\s+/g, ' ').trim();
      const accountNum = cols[0].trim();

      let type, target, asset_name, external_name, quantity = null, price_per_unit = null, notes = null;
      let grossAmount = amount;
      // Cash leg on the account for fund purchases, sales and fees, so the account
      // balance follows the TAB. Dividends and herbeleggingen pass through within
      // days and net to zero, so they get no cash leg.
      let mirrorType = null;

      if (/^STORTING BELEG\. FONDS/.test(desc) || /^HERBELEGGING/.test(desc)) {
        type = 'buy';
        target = 'fund';
        if (/^STORTING/.test(desc)) mirrorType = 'withdrawal';
        const m = desc.match(/^(?:STORTING BELEG\. FONDS|HERBELEGGING)\s+(.*?)\s+FONDSCODE\s+(\d+)/i);
        asset_name = m ? m[1].trim() : desc.slice(0, 40).trim();
        external_name = m ? m[2] : null;
        const qp = desc.match(/ST\s+([\d,.]+)\s*@\s*EUR\s+([\d,.]+)/);
        if (qp) { quantity = parseDutchNumber(qp[1]); price_per_unit = parseDutchNumber(qp[2]); }
      } else if (/^OPNAME BELEG\. FONDS/.test(desc)) {
        type = 'sell';
        target = 'fund';
        mirrorType = 'deposit';
        const m = desc.match(/^OPNAME BELEG\. FONDS\s+(.*?)\s+FONDSCODE\s+(\d+)/i);
        asset_name = m ? m[1].trim() : desc.slice(0, 40).trim();
        external_name = m ? m[2] : null;
        const qp = desc.match(/ST\s+([\d,.]+)\s*@\s*EUR\s+([\d,.]+)/);
        if (qp) { quantity = parseDutchNumber(qp[1]); price_per_unit = parseDutchNumber(qp[2]); }
      } else if (/^DIVIDEND/.test(desc)) {
        type = 'dividend';
        target = 'fund';
        const m = desc.match(/^DIVIDEND\s+(.*?)\s+FONDSCODE\s+(\d+)/i);
        asset_name = m ? m[1].trim() : desc.slice(0, 40).trim();
        external_name = m ? m[2] : null;
        // Book gross (net + dividendbelasting): the tax is credited in the IB return,
        // and the brokerage export these rows must dedupe against is gross too
        const taxMatch = desc.match(/BELASTING\s+EUR\s+([\d,.]+)/i);
        if (taxMatch) {
          const tax = parseDutchNumber(taxMatch[1]);
          grossAmount = Math.round((amount + tax) * 100) / 100;
          notes = `Dividendbelasting EUR ${tax.toFixed(2)}`;
        }
      } else if (/^SEPA/.test(desc) || /^\/TRTP\/SEPA/.test(desc)) {
        // Transfers from/to own current account: the actual contributions
        type = signedAmount >= 0 ? 'deposit' : 'withdrawal';
        target = 'savings';
        asset_name = `ABN ${accountNum}`;
        external_name = accountNum;
      } else if (/Servicekosten/i.test(desc) || /^ABNAMRO BELEGGEN/i.test(desc)) {
        // Since mid-2026 ABN drops the word "Servicekosten": "ABNAMRO Beleggen Zie uw nota voor details"
        // Fund costs, not savings costs: own mapping key so they can go to a fund asset
        type = 'fee';
        target = 'fund';
        asset_name = 'ABN AMRO servicekosten';
        external_name = 'servicekosten';
        notes = 'ABN AMRO servicekosten';
        mirrorType = 'withdrawal';
      } else if (/^RENTE EN\/OF KOSTEN/.test(desc)) {
        type = 'interest';
        target = 'savings';
        asset_name = `ABN ${accountNum}`;
        external_name = accountNum;
      } else {
        return [{ status: 'error', error: `Unrecognised description: ${desc.slice(0, 60)}`, _raw: line.slice(0, 80) }];
      }

      const rows = [{
        status: 'ok',
        date,
        type,
        target,
        asset_name: asset_name || `ABN ${accountNum}`,
        external_name: external_name || accountNum,
        broker: 'abn_savings',
        quantity: quantity != null && !isNaN(quantity) ? quantity : null,
        price_per_unit: price_per_unit != null && !isNaN(price_per_unit) ? price_per_unit : null,
        amount: grossAmount,
        fee: null,
        notes,
        asset_id: null,
      }];
      if (mirrorType) {
        rows.push({
          status: 'ok',
          date,
          type: mirrorType,
          target: 'savings',
          asset_name: `ABN ${accountNum}`,
          external_name: accountNum,
          broker: 'abn_savings',
          quantity: null,
          price_per_unit: null,
          amount,
          fee: null,
          notes: type === 'fee' ? 'Servicekosten' : `${type === 'buy' ? 'Aankoop' : 'Verkoop'} ${asset_name}`,
          asset_id: null,
        });
      }
      return rows;
    } catch (err) {
      return [{ status: 'error', error: err.message, _raw: line.slice(0, 80) }];
    }
  });
}

// Raisin account statement (PDF), savings or deposito. pdf-parse joins a row's cells
// without spaces: "23.01.2025Storting100,00200,00" = date, description, amount, balance.
// Each row is checked against the printed running balance, which also tells debit from credit.
function parseRaisinPdf(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const accountId = (text.match(/Rekening-ID:\s*(\S+)/) || [])[1];
  if (!accountId) return [{ status: 'error', error: 'No Rekening-ID found: not a Raisin statement?' }];
  const product = ((text.match(/Looptijd\/Product:\s*(.+)/) || [])[1] || '').trim();
  const bank = lines[0] || accountId;
  const kind = /spaar/i.test(product) ? 'spaarrekening' : `deposito ${product}`;
  const asset_name = `Raisin ${bank} ${kind} (${accountId.slice(-3)})`; // same bank can hold several depositos

  const AMOUNT = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const rows = [];
  let balance = null;
  for (const line of lines) {
    const m = line.match(/^(\d{2})\.(\d{2})\.(\d{4})(\D+?)((?:\d{1,3}(?:\.\d{3})*,\d{2}){1,2})$/);
    if (!m) continue;
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    const desc = m[4].trim();
    const amounts = m[5].match(AMOUNT).map(parseDutchNumber);
    const printed = amounts[amounts.length - 1];

    if (desc === 'Saldo startdatum') {
      balance = printed;
      if (printed > 0) rows.push({ date, type: 'deposit', amount: printed, notes: 'Beginsaldo', opening: true });
      continue;
    }
    if (desc === 'Saldo einddatum') {
      if (balance === null || Math.abs(balance - printed) > 0.005) {
        rows.push({ status: 'error', error: `End balance ${printed} does not match computed ${balance}`, _raw: line });
      }
      continue;
    }
    const type = { Storting: 'deposit', Opname: 'withdrawal', Rentebijschrijving: 'interest' }[desc];
    if (!type || amounts.length !== 2) {
      rows.push({ status: 'error', error: `Unrecognised row: ${desc}`, _raw: line });
      continue;
    }
    const amount = amounts[0];
    const expected = Math.round((balance + (type === 'withdrawal' ? -amount : amount)) * 100) / 100;
    if (balance === null || Math.abs(expected - printed) > 0.005) {
      rows.push({ status: 'error', error: `Balance ${printed} does not follow from ${balance} and ${desc} ${amount}`, _raw: line });
      balance = printed;
      continue;
    }
    balance = printed;
    rows.push({ date, type, amount, notes: type === 'interest' ? 'Rente' : null });
  }

  return rows.map(r => r.status === 'error' ? r : {
    status: 'ok',
    asset_name,
    external_name: accountId,
    broker: 'raisin',
    quantity: null,
    price_per_unit: null,
    fee: null,
    asset_id: null,
    ...r,
  });
}

// Decode upload as UTF-16 (LE or BE, with or without BOM) or UTF-8.
// Centraal Beheer exports have shipped as both UTF-16 LE with BOM and UTF-16 BE without BOM.
function decodeBuffer(buf) {
  if (buf.length >= 2) {
    const le = (buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] !== 0 && buf[1] === 0);
    const be = (buf[0] === 0xFE && buf[1] === 0xFF) || (buf[0] === 0 && buf[1] !== 0);
    if (le) return buf.toString('utf16le').replace(/^\uFEFF/, '');
    if (be && buf.length % 2 === 0) return Buffer.from(buf).swap16().toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

function detectFormat(filename, headers) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tab')) return 'abn_savings';
  if (lower.includes('centraal') || lower.includes('centraal_beheer')) return 'centraal_beheer';
  if (lower.includes('meesman')) return 'meesman';

  // Heuristics on headers
  const h = headers.map(s => s.toLowerCase());
  if (h.includes('datum') && h.includes('type') && h.includes('fonds') && h.includes('bruto')) return 'meesman';
  if (h.some(c => c.includes('boekdatum')) && h.some(c => c.includes('soort'))) return 'centraal_beheer';

  return null;
}

function countMatches(row) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE asset_id = ? AND date = ? AND type = ? AND ABS(amount - ?) < 0.005
    ${row.quantity != null ? 'AND (quantity IS NULL OR ABS(quantity - ?) < 0.000001)' : ''}
  `).get(
    row.asset_id, row.date, row.type, row.amount,
    ...(row.quantity != null ? [row.quantity] : [])
  ).n;
}

// Per-request duplicate check. Identical rows in one file (e.g. two €300 transfers on
// one day) are both real: the n-th occurrence is a duplicate only if the DB already
// held at least n matching rows before this request touched that key.
function makeDuplicateChecker() {
  const seen = new Map();
  return row => {
    if (!row.asset_id) return false;
    const key = [row.asset_id, row.date, row.type, Number(row.amount).toFixed(2), row.quantity ?? ''].join('|');
    if (!seen.has(key)) seen.set(key, { inDb: countMatches(row), n: 0 });
    const s = seen.get(key);
    s.n++;
    return s.n <= s.inDb;
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/import/mappings?broker=raisin
router.get('/mappings', (req, res) => {
  const { broker } = req.query;
  const rows = broker
    ? db.prepare('SELECT * FROM import_mappings WHERE broker = ?').all(broker)
    : db.prepare('SELECT * FROM import_mappings').all();
  res.json(rows);
});

// POST /api/import/preview
router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const checkDuplicate = makeDuplicateChecker();

  // ── Raisin (PDF account statements) ──────────────────────────────────────
  if (req.body.format === 'raisin' || (req.file.originalname || '').toLowerCase().endsWith('.pdf')) {
    let rows;
    try {
      rows = parseRaisinPdf((await pdfParse(req.file.buffer)).text);
    } catch (err) {
      return res.status(400).json({ error: `Could not read PDF: ${err.message}` });
    }
    for (const row of rows) {
      if (row.status !== 'ok') continue;
      const mapping = db.prepare('SELECT asset_id FROM import_mappings WHERE broker = ? AND external_name = ?').get('raisin', row.external_name);
      if (mapping) row.asset_id = mapping.asset_id;
      if (!row.asset_id) continue;
      // A statement exported from mid-history repeats an opening balance the account already has
      const earlier = row.opening && db.prepare('SELECT 1 FROM transactions WHERE asset_id = ? AND date <= ? LIMIT 1').get(row.asset_id, row.date);
      if (earlier || checkDuplicate(row)) row.status = 'duplicate';
    }
    return res.json({ format: 'raisin', rows });
  }

  const rawText = decodeBuffer(req.file.buffer);
  const filename = req.file.originalname || '';

  // Detect format early — needed before PapaParse for headerless formats.
  // Sniff the first line too, so CB exports with a generic filename are recognised.
  const firstLine = rawText.split(/\r?\n/, 1)[0];
  let format = req.body.format || detectFormat(filename, firstLine.split(/[;,\t]/));

  // ── Centraal Beheer (UTF-16 encoded, semicolon-delimited) ────────────────
  if (format === 'centraal_beheer') {
    const cbParsed = Papa.parse(rawText, { header: true, delimiter: ';', skipEmptyLines: true, dynamicTyping: false });
    let rows;
    try {
      rows = parseCentraalBeheer(cbParsed.data);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    for (const row of rows) {
      if (row.status !== 'ok') continue;
      const mapping = db.prepare('SELECT asset_id FROM import_mappings WHERE broker = ? AND external_name = ?').get('centraal_beheer', row.external_name);
      if (mapping) {
        row.asset_id = mapping.asset_id;
      } else {
        const asset = db.prepare("SELECT id FROM assets WHERE LOWER(name) = LOWER(?) AND archived = 0").get(row.asset_name);
        if (asset) row.asset_id = asset.id;
      }
      if (row.asset_id && checkDuplicate(row)) row.status = 'duplicate';
    }
    return res.json({ format, rows });
  }

  // ── ABN Savings TAB (headerless, tab-separated) ───────────────────────────
  if (format === 'abn_savings') {
    let rows;
    try {
      rows = parseAbnSavings(rawText);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Build label map: external_name → human-readable label
    const labelMap = {};
    for (const r of rows.filter(r => r.status === 'ok')) {
      if (r.external_name && !labelMap[r.external_name]) {
        labelMap[r.external_name] = r.target === 'fund'
          ? `${r.asset_name} (${r.external_name})`
          : `ABN spaarrekening ${r.external_name}`;
      }
    }

    const existingMappings = db.prepare(
      'SELECT external_name, asset_id FROM import_mappings WHERE broker = ?'
    ).all('abn_savings').reduce((m, r) => { m[r.external_name] = r.asset_id; return m; }, {});

    // Pre-resolve duplicates using existing mappings
    for (const row of rows) {
      if (row.status !== 'ok') continue;
      const mappedId = existingMappings[row.external_name];
      if (mappedId) {
        row.asset_id = mappedId;
        if (checkDuplicate(row)) row.status = 'duplicate';
      }
    }

    return res.json({ format, accounts: Object.keys(labelMap), accountLabels: labelMap, existingMappings, rows });
  }

  // ── CSV formats (PapaParse) ───────────────────────────────────────────────
  const parsed = Papa.parse(rawText, {
    header: true,
    skipEmptyLines: true,
    delimiter: '',     // auto-detect
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return res.status(400).json({ error: 'Failed to parse CSV', details: parsed.errors });
  }

  const headers = parsed.meta.fields || [];
  if (!format) format = detectFormat(filename, headers);

  if (!format) {
    return res.status(400).json({ error: 'Could not detect CSV format. Specify format manually.' });
  }

  let rows;
  try {
    if (format === 'meesman') rows = parseMeesman(parsed.data);
    else return res.status(400).json({ error: `Unknown format: ${format}` });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Resolve asset_id via import_mappings or name match (Meesman)
  for (const row of rows) {
    if (row.status !== 'ok') continue;
    const mapping = db.prepare(
      'SELECT asset_id FROM import_mappings WHERE broker = ? AND external_name = ?'
    ).get(format, row.external_name);
    if (mapping) {
      row.asset_id = mapping.asset_id;
    } else {
      const asset = db.prepare(
        "SELECT id FROM assets WHERE LOWER(name) = LOWER(?) AND archived = 0"
      ).get(row.asset_name);
      if (asset) row.asset_id = asset.id;
    }
    if (row.asset_id && checkDuplicate(row)) row.status = 'duplicate';
  }

  res.json({ format, rows });
});

// POST /api/import/commit
router.post('/commit', (req, res) => {
  const { rows, mappings = {} } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  const checkDuplicate = makeDuplicateChecker();

  let imported = 0, skipped = 0, caCount = 0;
  const errors = [];
  const newAssetCache = {};

  for (const row of rows) {
    if (row.status === 'duplicate') { checkDuplicate(row); skipped++; continue; } // keeps the occurrence count in step
    if (row.status === 'skip') { skipped++; continue; }
    if (row.status === 'error') { errors.push({ row, reason: row.error }); continue; }

    // Resolve asset_id for ABN Savings
    if (row.broker === 'abn_savings' && row.external_name) {
      const mapping = mappings[row.external_name];
      if (!mapping) { errors.push({ row, reason: 'No asset mapping provided' }); continue; }

      if (typeof mapping === 'number') {
        row.asset_id = mapping;
      } else if (typeof mapping === 'string' && mapping.startsWith('new:')) {
        const assetName = mapping.slice(4).trim();
        if (!assetName) { errors.push({ row, reason: 'Empty asset name for new asset' }); continue; }
        if (!newAssetCache[assetName]) {
          const typeGuess = row.target === 'fund' ? 'etf' : 'savings';
          const info = db.prepare(
            'INSERT INTO assets (name, type, currency) VALUES (?, ?, ?)'
          ).run(assetName, typeGuess, 'EUR');
          newAssetCache[assetName] = info.lastInsertRowid;
        }
        row.asset_id = newAssetCache[assetName];
      } else {
        row.asset_id = parseInt(mapping, 10);
      }

      if (row.asset_id) {
        db.prepare(`
          INSERT INTO import_mappings (broker, external_name, asset_id) VALUES (?, ?, ?)
          ON CONFLICT(broker, external_name) DO UPDATE SET asset_id = excluded.asset_id
        `).run('abn_savings', row.external_name, row.asset_id);
      }
    }

    // Resolve asset_id for Meesman, Centraal Beheer (create if still unresolved)
    if (['meesman', 'centraal_beheer', 'raisin'].includes(row.broker) && !row.asset_id) {
      const assetName = row.asset_name;
      if (!newAssetCache[assetName]) {
        const typeGuess = row.broker === 'raisin' ? 'savings' : ['buy', 'sell', 'dividend'].includes(row.type) ? 'etf' : 'other';
        const info = db.prepare(
          'INSERT INTO assets (name, type, currency) VALUES (?, ?, ?)'
        ).run(assetName, typeGuess, 'EUR');
        newAssetCache[assetName] = info.lastInsertRowid;
        if (row.external_name) {
          db.prepare(`
            INSERT INTO import_mappings (broker, external_name, asset_id) VALUES (?, ?, ?)
            ON CONFLICT(broker, external_name) DO UPDATE SET asset_id = excluded.asset_id
          `).run(row.broker, row.external_name, info.lastInsertRowid);
        }
      }
      row.asset_id = newAssetCache[assetName];
    }

    if (!row.asset_id) { errors.push({ row, reason: 'Could not determine asset' }); continue; }

    // Opening balance of a statement that doesn't start at the account's beginning
    if (row.opening && db.prepare('SELECT 1 FROM transactions WHERE asset_id = ? AND date <= ? LIMIT 1').get(row.asset_id, row.date)) { skipped++; continue; }

    // Final duplicate check
    if (checkDuplicate(row)) { skipped++; continue; }

    try {
      db.prepare(`
        INSERT INTO transactions (asset_id, date, type, quantity, price_per_unit, amount, fee, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.asset_id, row.date, row.type,
        row.quantity ?? null, row.price_per_unit ?? null,
        row.amount, row.fee ?? null, row.notes ?? null
      );

      // Backfill price from transaction if available (skip CA rows — Koers is dividend/unit, not NAV)
      if (row.price_per_unit != null && !isNaN(row.price_per_unit) && row.notes !== 'CA (dividend reinvestment)') {
        db.prepare(`
          INSERT INTO asset_prices (asset_id, date, price) VALUES (?, ?, ?)
          ON CONFLICT(asset_id, date) DO NOTHING
        `).run(row.asset_id, row.date, row.price_per_unit);
      }

      if (row.isCA) caCount++;
      imported++;
    } catch (err) {
      errors.push({ row, reason: err.message });
    }
  }

  res.json({ imported, skipped, caCount, errors });
});

module.exports = router;
