import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { fmtEur, fmtDate } from '../format.js';

const FORMATS = [
  { value: '', label: 'Auto-detect' },
  { value: 'abn', label: 'ABN AMRO Brokerage' },
  { value: 'raisin', label: 'Raisin' },
  { value: 'centraal_beheer', label: 'Centraal Beheer' },
  { value: 'meesman', label: 'Meesman' },
  { value: 'brand_new_day', label: 'Brand New Day' },
];

function StatusBadge({ status }) {
  const colors = { ok: 'var(--green)', error: 'var(--red)', duplicate: 'var(--text-muted)' };
  return (
    <span style={{ color: colors[status] || 'inherit', fontWeight: 600, fontSize: 12 }}>
      {status.toUpperCase()}
    </span>
  );
}

// ── Upload step ───────────────────────────────────────────────────────────────

function UploadStep({ onParsed }) {
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState('');
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState('');

  async function handleParse(e) {
    e.preventDefault();
    if (!file) return;
    setParsing(true);
    setErr('');
    try {
      const result = await api.import.preview(file, format || undefined);
      onParsed(result, file.name);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="section">
      <h2>Select File</h2>
      <form onSubmit={handleParse}>
        <div className="form-row">
          <label>CSV file</label>
          <input type="file" accept=".csv,.txt" onChange={e => setFile(e.target.files[0])} required />
        </div>
        <div className="form-row">
          <label>Format</label>
          <select value={format} onChange={e => setFormat(e.target.value)}>
            {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        {err && <div className="error-msg">{err}</div>}
        <div className="modal-footer" style={{ justifyContent: 'flex-start', padding: 0, marginTop: 12 }}>
          <button type="submit" className="btn btn-primary" disabled={parsing || !file}>
            {parsing ? 'Parsing…' : 'Parse File'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Raisin mapping step ───────────────────────────────────────────────────────

function MappingStep({ accounts, existingMappings, onMapped, onBack }) {
  const [assets, setAssets] = useState([]);
  const [mappings, setMappings] = useState(() => {
    const m = {};
    for (const acc of accounts) {
      m[acc] = existingMappings?.[acc] ?? '';
    }
    return m;
  });

  useEffect(() => {
    api.assets.list(false).then(setAssets);
  }, []);

  function setMapping(acc, val) {
    setMappings(prev => ({ ...prev, [acc]: val }));
  }

  function submit(e) {
    e.preventDefault();
    // Validate all accounts are mapped
    for (const acc of accounts) {
      if (!mappings[acc] && mappings[acc] !== 0) return alert(`Please map: ${acc}`);
    }
    // Convert string values to numbers where possible
    const resolved = {};
    for (const [k, v] of Object.entries(mappings)) {
      resolved[k] = typeof v === 'string' && /^\d+$/.test(v) ? parseInt(v, 10) : v;
    }
    onMapped(resolved);
  }

  return (
    <div className="section">
      <h2>Map Raisin Accounts to Assets</h2>
      <form onSubmit={submit}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Raisin Account Name</th>
              <th>Map to Asset</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(acc => (
              <tr key={acc}>
                <td>{acc}</td>
                <td>
                  <select
                    value={mappings[acc] ?? ''}
                    onChange={e => setMapping(acc, e.target.value)}
                    required
                  >
                    <option value="">— select —</option>
                    {assets.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                    ))}
                    <option value={`new:${acc}`}>+ Create new asset "{acc}"</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn" onClick={onBack}>← Back</button>
          <button type="submit" className="btn btn-primary">Continue →</button>
        </div>
      </form>
    </div>
  );
}

// ── Review step ───────────────────────────────────────────────────────────────

function ReviewStep({ rows, mappings, onBack, onImported }) {
  const [selected, setSelected] = useState(() => {
    const s = new Set();
    rows.forEach((r, i) => { if (r.status === 'ok') s.add(i); });
    return s;
  });
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState('');

  const importable = rows.filter((r, i) => selected.has(i) && r.status !== 'error' && r.status !== 'duplicate').length;

  function toggleRow(i) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleImport() {
    setImporting(true);
    setErr('');
    try {
      const selectedRows = rows.map((r, i) => ({
        ...r,
        status: selected.has(i) ? r.status : 'skip',
      }));
      const result = await api.import.commit(selectedRows, mappings || {});
      onImported(result);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setImporting(false);
    }
  }

  const counts = { ok: 0, error: 0, duplicate: 0 };
  rows.forEach(r => { counts[r.status] = (counts[r.status] ?? 0) + 1; });

  return (
    <div className="section">
      <h2>Review Rows</h2>
      <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>
        {rows.length} rows — {counts.ok} OK, {counts.duplicate} duplicate, {counts.error} error
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Date</th>
              <th>Type</th>
              <th>Asset</th>
              <th className="num">Qty</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.status === 'error' ? 'row-error' : r.status === 'duplicate' ? 'row-muted' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    disabled={r.status === 'error' || r.status === 'duplicate'}
                    onChange={() => toggleRow(i)}
                  />
                </td>
                <td>{fmtDate(r.date)}</td>
                <td><span className="type-badge">{r.type}</span></td>
                <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.asset_name}</td>
                <td className="num">{r.quantity != null ? r.quantity : '—'}</td>
                <td className="num">{r.amount != null ? fmtEur(r.amount) : '—'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <div className="error-msg" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={handleImport} disabled={importing || importable === 0}>
          {importing ? 'Importing…' : `Import ${importable} row${importable !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}

// ── Done step ─────────────────────────────────────────────────────────────────

function DoneStep({ result, onReset }) {
  return (
    <div className="section">
      <h2>Import Complete</h2>
      <div style={{ fontSize: 15, marginBottom: 12 }}>
        <span style={{ color: 'var(--green)', marginRight: 16 }}>✓ {result.imported} imported</span>
        <span style={{ color: 'var(--text-muted)', marginRight: 16 }}>{result.skipped} skipped (duplicates)</span>
        {result.errors.length > 0 && (
          <span style={{ color: 'var(--red)' }}>{result.errors.length} errors</span>
        )}
      </div>
      {result.caCount > 0 && (
        <div className="banner banner-warn" style={{ marginBottom: 12 }}>
          {result.caCount} dividend reinvestment{result.caCount > 1 ? 's' : ''} (CA) imported as dividend — add the corresponding buy transaction{result.caCount > 1 ? 's' : ''} manually with the exact unit count from your account.
        </div>
      )}
      {result.errors.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong>Errors:</strong>
          <ul style={{ marginTop: 4 }}>
            {result.errors.slice(0, 10).map((e, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {e.row?.date} {e.row?.asset_name}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button className="btn btn-primary" onClick={onReset}>Import Another File</button>
    </div>
  );
}

// ── Main ImportPage ───────────────────────────────────────────────────────────

export default function ImportPage() {
  const [step, setStep] = useState('upload'); // upload | mapping | review | done
  const [preview, setPreview] = useState(null);
  const [mappings, setMappings] = useState(null);
  const [importResult, setImportResult] = useState(null);

  function handleParsed(result) {
    setPreview(result);
    if (result.format === 'raisin' && result.accounts && result.accounts.length > 0) {
      setStep('mapping');
    } else {
      setStep('review');
    }
  }

  function handleMapped(resolvedMappings) {
    setMappings(resolvedMappings);
    setStep('review');
  }

  function handleImported(result) {
    setImportResult(result);
    setStep('done');
  }

  function reset() {
    setStep('upload');
    setPreview(null);
    setMappings(null);
    setImportResult(null);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Import Transactions</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Supported: ABN AMRO, Raisin
          {' · '}Stubs: Centraal Beheer, Meesman, Brand New Day
        </div>
      </div>

      {step === 'upload' && <UploadStep onParsed={handleParsed} />}

      {step === 'mapping' && preview?.format === 'raisin' && (
        <MappingStep
          accounts={preview.accounts}
          existingMappings={preview.existingMappings}
          onMapped={handleMapped}
          onBack={reset}
        />
      )}

      {step === 'review' && (
        <ReviewStep
          rows={preview?.rows ?? []}
          mappings={mappings}
          onBack={() => {
            if (preview?.format === 'raisin' && preview?.accounts?.length > 0) setStep('mapping');
            else reset();
          }}
          onImported={handleImported}
        />
      )}

      {step === 'done' && importResult && (
        <DoneStep result={importResult} onReset={reset} />
      )}
    </div>
  );
}
