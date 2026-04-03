const express = require('express');
const router = express.Router();
const multer = require('multer');
const Papa = require('papaparse');
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

      const dateRaw = (row['Boekdatum'] || '').trim();
      const fundName = (row['Fondsnaam'] || '').trim();

      if (!dateRaw || !typeRaw) return [{ status: 'error', error: 'Missing date or type', _raw: row }];

      const dmyMatch = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!dmyMatch) return [{ status: 'error', error: `Unrecognised date: ${dateRaw}`, _raw: row }];
      const date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

      if (typeRaw === 'Aankoop') {
        if (!fundName) return [{ status: 'error', error: 'Missing fund name', _raw: row }];

        const netto = parseDutchNumber(row['Netto bedrag (EUR)']);
        const fee = parseDutchNumber(row['Aankoopkosten']) || 0;
        const quantity = row['Aantal stukken'] ? parseDutchNumber(row['Aantal stukken']) : null;
        const price = row['Koers'] ? parseDutchNumber(row['Koers']) : null;

        if (isNaN(netto)) return [{ status: 'error', error: 'Invalid amount', _raw: row }];

        return [{
          status: 'ok',
          date,
          type: 'buy',
          asset_name: fundName,
          external_name: fundName,
          broker: 'centraal_beheer',
          quantity: quantity && !isNaN(quantity) ? quantity : null,
          price_per_unit: price && !isNaN(price) ? price : null,
          amount: netto,
          fee: fee > 0 ? fee : null,
          notes: null,
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
  return lines.map(line => {
    try {
      const cols = line.split('\t');
      if (cols.length < 8) {
        return { status: 'error', error: `Expected 8 columns, got ${cols.length}`, _raw: line.slice(0, 80) };
      }

      const dateRaw = cols[2].trim();
      if (!/^\d{8}$/.test(dateRaw)) {
        return { status: 'error', error: `Invalid date: ${dateRaw}`, _raw: line.slice(0, 80) };
      }
      const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;

      const signedAmount = parseDutchNumber(cols[6].trim());
      if (isNaN(signedAmount)) {
        return { status: 'error', error: `Invalid amount: ${cols[6]}`, _raw: line.slice(0, 80) };
      }
      const amount = Math.abs(signedAmount);

      const desc = (cols[7] || '').replace(/\s+/g, ' ').trim();
      const accountNum = cols[0].trim();

      let type, target, asset_name, external_name, quantity = null, price_per_unit = null, notes = null;

      if (/^STORTING BELEG\. FONDS/.test(desc) || /^HERBELEGGING/.test(desc)) {
        type = 'buy';
        target = 'fund';
        const m = desc.match(/^(?:STORTING BELEG\. FONDS|HERBELEGGING)\s+(.*?)\s+FONDSCODE\s+(\d+)/i);
        asset_name = m ? m[1].trim() : desc.slice(0, 40).trim();
        external_name = m ? m[2] : null;
        const qp = desc.match(/ST\s+([\d,.]+)\s*@\s*EUR\s+([\d,.]+)/);
        if (qp) { quantity = parseDutchNumber(qp[1]); price_per_unit = parseDutchNumber(qp[2]); }
      } else if (/^OPNAME BELEG\. FONDS/.test(desc)) {
        type = 'sell';
        target = 'fund';
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
        const taxMatch = desc.match(/BELASTING\s+EUR\s+([\d,.]+)/i);
        if (taxMatch) notes = `Dividendbelasting EUR ${parseDutchNumber(taxMatch[1]).toFixed(2)} (already deducted)`;
      } else if (/^SEPA/.test(desc)) {
        type = signedAmount >= 0 ? 'deposit' : 'withdrawal';
        target = 'savings';
        asset_name = `ABN ${accountNum}`;
        external_name = accountNum;
      } else if (/Servicekosten/i.test(desc)) {
        type = 'fee';
        target = 'savings';
        asset_name = `ABN ${accountNum}`;
        external_name = accountNum;
        notes = 'ABN AMRO servicekosten';
      } else if (/^RENTE EN\/OF KOSTEN/.test(desc)) {
        type = 'interest';
        target = 'savings';
        asset_name = `ABN ${accountNum}`;
        external_name = accountNum;
      } else {
        return { status: 'error', error: `Unrecognised description: ${desc.slice(0, 60)}`, _raw: line.slice(0, 80) };
      }

      return {
        status: 'ok',
        date,
        type,
        target,
        asset_name: asset_name || `ABN ${accountNum}`,
        external_name: external_name || accountNum,
        broker: 'abn_savings',
        quantity: quantity != null && !isNaN(quantity) ? quantity : null,
        price_per_unit: price_per_unit != null && !isNaN(price_per_unit) ? price_per_unit : null,
        amount,
        fee: null,
        notes,
        asset_id: null,
      };
    } catch (err) {
      return { status: 'error', error: err.message, _raw: line.slice(0, 80) };
    }
  });
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

function checkDuplicate(row) {
  if (!row.asset_id) return false;
  const existing = db.prepare(`
    SELECT id FROM transactions
    WHERE asset_id = ? AND date = ? AND type = ? AND ABS(amount - ?) < 0.005
    ${row.quantity != null ? 'AND ABS(COALESCE(quantity,0) - ?) < 0.000001' : 'AND quantity IS NULL'}
  `).get(
    row.asset_id, row.date, row.type, row.amount,
    ...(row.quantity != null ? [row.quantity] : [])
  );
  return !!existing;
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
router.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const rawText = req.file.buffer.toString('utf8');
  const filename = req.file.originalname || '';

  // Detect format early — needed before PapaParse for headerless formats
  let format = req.body.format || detectFormat(filename, []);

  // ── Centraal Beheer (UTF-16 LE encoded, semicolon-delimited) ─────────────
  if (format === 'centraal_beheer') {
    let csvText = rawText;
    if (req.file.buffer[0] === 0xFF && req.file.buffer[1] === 0xFE) {
      csvText = req.file.buffer.toString('utf16le').replace(/^\uFEFF/, '');
    }
    const cbParsed = Papa.parse(csvText, { header: true, delimiter: ';', skipEmptyLines: true, dynamicTyping: false });
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

  let imported = 0, skipped = 0, caCount = 0;
  const errors = [];
  const newAssetCache = {};

  for (const row of rows) {
    if (row.status === 'skip' || row.status === 'duplicate') { skipped++; continue; }
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
    if (['meesman', 'centraal_beheer'].includes(row.broker) && !row.asset_id) {
      const assetName = row.asset_name;
      if (!newAssetCache[assetName]) {
        const typeGuess = ['buy', 'sell', 'dividend'].includes(row.type) ? 'etf' : 'other';
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
