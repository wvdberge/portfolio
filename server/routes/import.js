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

function parseAbnAmro(rows) {
  return rows.map((row, i) => {
    try {
      const dateRaw = row['Datum'] || row['Date'] || '';
      const typeRaw = (row['Order type'] || row['Omschrijving'] || row['Type'] || '').trim();
      const name = (row['Naam fonds'] || row['Naam'] || row['Security'] || '').trim();
      const isin = (row['ISIN'] || '').trim();
      const qtyRaw = row['Aantal/Bedrag'] || row['Aantal'] || row['Quantity'] || '';
      const priceRaw = row['Koers'] || row['Price'] || '';
      const fxRateRaw = row['Koersratio'] || row['Exchange Rate'] || '1';
      const feeRaw = row['Provisie'] || row['Commission'] || row['Fee'] || '0';
      const netAmountRaw = row['Netto waarde'] || row['Transactiewaarde'] || row['Net Amount'] || row['Bedrag'] || '';

      if (!dateRaw || !typeRaw) return { status: 'error', error: 'Missing date or type', _raw: row };

      // Parse date: d-m-yyyy, dd-mm-yyyy, or yyyy-mm-dd
      let date;
      const dmyMatch = dateRaw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      if (dmyMatch) {
        const d = dmyMatch[1].padStart(2, '0');
        const m = dmyMatch[2].padStart(2, '0');
        date = `${dmyMatch[3]}-${m}-${d}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        date = dateRaw;
      } else {
        return { status: 'error', error: `Unrecognised date format: ${dateRaw}`, _raw: row };
      }

      const typeMap = {
        'Aankoop': 'buy', 'Koop': 'buy',
        'Verkoop': 'sell',
        'Dividend': 'dividend',
        'CA': 'buy',
      };
      const type = typeMap[typeRaw];
      if (!type) return { status: 'error', error: `Unknown transaction type: ${typeRaw}`, _raw: row };

      const fxRate = parseDutchNumber(fxRateRaw) || 1;
      const quantity = qtyRaw ? parseDutchNumber(qtyRaw) : null;
      const pricePerUnit = priceRaw ? parseDutchNumber(priceRaw) : null;
      const fee = Math.abs(parseDutchNumber(feeRaw) || 0);

      let amount;
      if (netAmountRaw) {
        amount = Math.abs(parseDutchNumber(netAmountRaw) / fxRate);
      } else if (quantity && pricePerUnit) {
        amount = Math.abs(quantity * pricePerUnit / fxRate) + (type === 'buy' ? fee : -fee);
      } else {
        return { status: 'error', error: 'Cannot determine amount', _raw: row };
      }

      if (isNaN(amount)) return { status: 'error', error: 'Invalid amount', _raw: row };

      const notes = typeRaw === 'CA' ? 'CA (dividend reinvestment)' : (isin ? `ISIN: ${isin}` : null);
      const externalName = isin || name;

      return {
        status: 'ok',
        date,
        type,
        asset_name: name,
        external_name: externalName,
        broker: 'abn',
        quantity: quantity && !isNaN(quantity) ? quantity : null,
        price_per_unit: pricePerUnit && !isNaN(pricePerUnit) ? pricePerUnit / fxRate : null,
        amount,
        fee: fee > 0 ? fee : null,
        notes,
        asset_id: null,
      };
    } catch (err) {
      return { status: 'error', error: err.message, _raw: row };
    }
  });
}

function parseRaisin(rows) {
  return rows.map((row) => {
    try {
      const dateRaw = row['Date'] || row['Datum'] || row['Datum/tijd'] || '';
      const accountName = (row['Account Name'] || row['Account'] || row['Accountnaam'] || '').trim();
      const typeRaw = (row['Transaction type'] || row['Type'] || row['Transactietype'] || '').trim().toLowerCase();
      const amountRaw = row['Amount'] || row['Bedrag'] || row['Saldo'] || '';

      if (!dateRaw || !accountName || !typeRaw) {
        return { status: 'error', error: 'Missing required field', _raw: row };
      }

      let date;
      const dmyMatch = dateRaw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      const mdyMatch = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (dmyMatch) date = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
      else if (mdyMatch) date = `${mdyMatch[3]}-${mdyMatch[1]}-${mdyMatch[2]}`;
      else if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) date = dateRaw.slice(0, 10);
      else return { status: 'error', error: `Unrecognised date format: ${dateRaw}`, _raw: row };

      const typeMap = {
        'deposit': 'deposit', 'storting': 'deposit', 'inleg': 'deposit',
        'withdrawal': 'withdrawal', 'opname': 'withdrawal', 'uitkering': 'withdrawal',
        'interest': 'interest', 'rente': 'interest',
      };
      const type = typeMap[typeRaw];
      if (!type) return { status: 'error', error: `Unknown type: ${typeRaw}`, _raw: row };

      const amount = Math.abs(parseFloat(amountRaw.toString().replace(',', '.')) || 0);
      if (isNaN(amount)) return { status: 'error', error: 'Invalid amount', _raw: row };

      return {
        status: 'ok',
        date,
        type,
        asset_name: accountName,
        external_account: accountName,
        broker: 'raisin',
        quantity: null,
        price_per_unit: null,
        amount,
        fee: null,
        notes: null,
        asset_id: null,
      };
    } catch (err) {
      return { status: 'error', error: err.message, _raw: row };
    }
  });
}

function parseCentraalBeheer(rows) {
  // TODO: confirm column names from sample export
  // Expected: date, type, fund name, units, NAV, amount
  throw new Error('Centraal Beheer parser not yet implemented');
}

function parseMeesman(rows) {
  // TODO: confirm column names from sample export
  // Expected: date, fund name, units purchased, NAV per unit
  throw new Error('Meesman parser not yet implemented');
}

function parseBrandNewDay(rows) {
  // TODO: confirm column names from sample export
  // Expected: similar to Meesman — units + NAV
  throw new Error('Brand New Day parser not yet implemented');
}

function detectFormat(filename, headers) {
  const lower = filename.toLowerCase();
  if (lower.includes('raisin')) return 'raisin';
  if (lower.includes('abn') || lower.includes('abnAmro')) return 'abn';
  if (lower.includes('centraal') || lower.includes('centraal_beheer')) return 'centraal_beheer';
  if (lower.includes('meesman')) return 'meesman';
  if (lower.includes('brand') || lower.includes('bnd')) return 'brand_new_day';

  // Heuristics on headers
  const h = headers.map(s => s.toLowerCase());
  if (h.includes('account name') || h.includes('accountnaam')) return 'raisin';
  if (h.includes('netto waarde') || h.includes('order type') || h.includes('aantal/bedrag')) return 'abn';
  if (h.includes('isin') && (h.includes('koop') || h.includes('omschrijving') || h.includes('naam fonds'))) return 'abn';

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

  const csv = req.file.buffer.toString('utf8');
  const filename = req.file.originalname || '';

  // PapaParse with auto-delimiter detection
  const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true,
    delimiter: '',     // auto-detect
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return res.status(400).json({ error: 'Failed to parse CSV', details: parsed.errors });
  }

  const headers = parsed.meta.fields || [];
  const format = req.body.format || detectFormat(filename, headers);

  if (!format) {
    return res.status(400).json({ error: 'Could not detect CSV format. Specify format manually.' });
  }

  let rows;
  try {
    if (format === 'abn') rows = parseAbnAmro(parsed.data);
    else if (format === 'raisin') rows = parseRaisin(parsed.data);
    else if (format === 'centraal_beheer') rows = parseCentraalBeheer(parsed.data);
    else if (format === 'meesman') rows = parseMeesman(parsed.data);
    else if (format === 'brand_new_day') rows = parseBrandNewDay(parsed.data);
    else return res.status(400).json({ error: `Unknown format: ${format}` });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // For ABN: try to resolve asset_id via import_mappings or name match
  if (format === 'abn') {
    for (const row of rows) {
      if (row.status !== 'ok') continue;
      const mapping = db.prepare(
        'SELECT asset_id FROM import_mappings WHERE broker = ? AND external_name = ?'
      ).get('abn', row.external_name);
      if (mapping) {
        row.asset_id = mapping.asset_id;
      } else {
        // Try name match
        const asset = db.prepare(
          "SELECT id FROM assets WHERE LOWER(name) = LOWER(?) AND archived = 0"
        ).get(row.asset_name);
        if (asset) row.asset_id = asset.id;
      }
      // Check duplicate (only if asset resolved)
      if (row.asset_id && checkDuplicate(row)) row.status = 'duplicate';
    }

    return res.json({ format, rows });
  }

  // For Raisin: return unique account names + existing mappings so UI can show mapping step
  if (format === 'raisin') {
    const accounts = [...new Set(rows.filter(r => r.status === 'ok').map(r => r.external_account))];
    const existingMappings = db.prepare(
      'SELECT external_name, asset_id FROM import_mappings WHERE broker = ?'
    ).all('raisin').reduce((m, r) => { m[r.external_name] = r.asset_id; return m; }, {});

    return res.json({ format, accounts, existingMappings, rows });
  }

  res.json({ format, rows });
});

// POST /api/import/commit
router.post('/commit', (req, res) => {
  const { rows, mappings = {} } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

  let imported = 0, skipped = 0;
  const errors = [];

  // Save Raisin mappings & resolve asset_ids
  const newAssetCache = {};

  for (const row of rows) {
    if (row.status === 'skip' || row.status === 'duplicate') { skipped++; continue; }
    if (row.status === 'error') { errors.push({ row, reason: row.error }); continue; }

    // Resolve asset_id for Raisin
    if (row.broker === 'raisin' && row.external_account) {
      const mapping = mappings[row.external_account];
      if (!mapping) { errors.push({ row, reason: 'No asset mapping provided' }); continue; }

      if (typeof mapping === 'number') {
        row.asset_id = mapping;
      } else if (typeof mapping === 'string' && mapping.startsWith('new:')) {
        const assetName = mapping.slice(4).trim();
        if (!assetName) { errors.push({ row, reason: 'Empty asset name for new asset' }); continue; }

        if (!newAssetCache[assetName]) {
          // Create new savings asset
          const info = db.prepare(
            "INSERT INTO assets (name, type, currency) VALUES (?, 'savings', 'EUR')"
          ).run(assetName);
          newAssetCache[assetName] = info.lastInsertRowid;
        }
        row.asset_id = newAssetCache[assetName];
      } else {
        row.asset_id = parseInt(mapping, 10);
      }

      // Save/update mapping
      if (row.asset_id) {
        db.prepare(`
          INSERT INTO import_mappings (broker, external_name, asset_id) VALUES (?, ?, ?)
          ON CONFLICT(broker, external_name) DO UPDATE SET asset_id = excluded.asset_id
        `).run('raisin', row.external_account, row.asset_id);
      }
    }

    // Resolve asset_id for ABN (create if still unresolved)
    if (row.broker === 'abn' && !row.asset_id) {
      const assetName = row.asset_name;
      if (!newAssetCache[assetName]) {
        const typeGuess = ['buy', 'sell', 'dividend'].includes(row.type) ? 'etf' : 'other';
        const info = db.prepare(
          'INSERT INTO assets (name, type, currency) VALUES (?, ?, ?)'
        ).run(assetName, typeGuess, 'EUR');
        newAssetCache[assetName] = info.lastInsertRowid;
        // Save mapping
        if (row.external_name) {
          db.prepare(`
            INSERT INTO import_mappings (broker, external_name, asset_id) VALUES (?, ?, ?)
            ON CONFLICT(broker, external_name) DO UPDATE SET asset_id = excluded.asset_id
          `).run('abn', row.external_name, info.lastInsertRowid);
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

      // Backfill price from transaction if available
      if (row.price_per_unit != null && !isNaN(row.price_per_unit)) {
        db.prepare(`
          INSERT INTO asset_prices (asset_id, date, price) VALUES (?, ?, ?)
          ON CONFLICT(asset_id, date) DO NOTHING
        `).run(row.asset_id, row.date, row.price_per_unit);
      }

      imported++;
    } catch (err) {
      errors.push({ row, reason: err.message });
    }
  }

  res.json({ imported, skipped, errors });
});

module.exports = router;
