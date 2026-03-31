import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { fmtDate, fmtNum, today } from '../format.js';

function BenchmarkSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.benchmark.list().then(setRows).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.benchmark.create({ date, price: parseFloat(price) });
      setPrice('');
      load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  async function del(row) {
    if (!confirm(`Delete MSCI World entry for ${row.date}?`)) return;
    await api.benchmark.delete(row.id);
    load();
  }

  return (
    <div className="section">
      <div className="section-header">
        <h2>MSCI World Prices</h2>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
          <label>Price (index value)</label>
          <input type="number" step="any" min="0" value={price}
            onChange={e => setPrice(e.target.value)} required placeholder="e.g. 3542.10" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ flexShrink: 0 }}>
          {saving ? 'Saving…' : 'Add'}
        </button>
      </form>
      {err && <div className="error-msg" style={{ marginBottom: 8 }}>{err}</div>}

      {loading ? <div className="loading">Loading…</div> : rows.length === 0 ? (
        <div className="empty-state">No entries yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Price</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{fmtDate(r.date)}</td>
                <td className="num">{fmtNum(r.price, 2)}</td>
                <td className="actions">
                  <button className="btn btn-sm btn-danger" onClick={() => del(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CpiSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(today().slice(0, 7) + '-01');
  const [cpiValue, setCpiValue] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.cpi.list().then(setRows).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.cpi.create({ date, cpi_value: parseFloat(cpiValue) });
      setCpiValue('');
      load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  async function del(row) {
    if (!confirm(`Delete CPI entry for ${row.date}?`)) return;
    await api.cpi.delete(row.id);
    load();
  }

  // For CPI, let user pick month via month input
  function handleMonthChange(e) {
    const val = e.target.value; // YYYY-MM
    setDate(val ? val + '-01' : '');
  }

  return (
    <div className="section">
      <div className="section-header">
        <h2>CPI Values (Netherlands)</h2>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label>Month</label>
          <input type="month" value={date.slice(0, 7)}
            onChange={handleMonthChange} required />
        </div>
        <div style={{ flex: 1 }}>
          <label>CPI value</label>
          <input type="number" step="any" min="0" value={cpiValue}
            onChange={e => setCpiValue(e.target.value)} required placeholder="e.g. 131.4" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ flexShrink: 0 }}>
          {saving ? 'Saving…' : 'Add'}
        </button>
      </form>
      {err && <div className="error-msg" style={{ marginBottom: 8 }}>{err}</div>}

      {loading ? <div className="loading">Loading…</div> : rows.length === 0 ? (
        <div className="empty-state">No entries yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">CPI value</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.date.slice(0, 7)}</td>
                <td className="num">{fmtNum(r.cpi_value, 1)}</td>
                <td className="actions">
                  <button className="btn btn-sm btn-danger" onClick={() => del(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function DataEntry() {
  return (
    <div>
      <div className="page-header">
        <h1>Data Entry</h1>
      </div>
      <BenchmarkSection />
      <CpiSection />
    </div>
  );
}
