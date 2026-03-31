import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { fmtEur, fmtNum, today } from '../format.js';

const ASSET_TYPES = ['stock', 'etf', 'savings', 'real_estate', 'pension', 'crypto', 'other'];

function AssetModal({ asset, onClose, onSaved }) {
  const editing = !!asset;
  const [form, setForm] = useState({
    name: asset?.name ?? '',
    type: asset?.type ?? 'etf',
    currency: asset?.currency ?? 'EUR',
    target_allocation_pct: asset?.target_allocation_pct ?? '',
    ticker: asset?.ticker ?? '',
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        currency: form.currency.trim() || 'EUR',
        target_allocation_pct: form.target_allocation_pct !== '' ? Number(form.target_allocation_pct) : null,
        ticker: form.ticker.trim() || null,
      };
      if (editing) {
        await api.assets.update(asset.id, payload);
      } else {
        await api.assets.create(payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{editing ? 'Edit Asset' : 'Add Asset'}</h2>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
          </div>
          <div className="form-row-inline">
            <div>
              <label>Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label>Currency</label>
              <input value={form.currency} onChange={e => set('currency', e.target.value)} placeholder="EUR" />
            </div>
          </div>
          <div className="form-row-inline">
            <div>
              <label>Target allocation %</label>
              <input type="number" step="0.01" min="0" max="100" value={form.target_allocation_pct}
                onChange={e => set('target_allocation_pct', e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label>Price ticker (Alpha Vantage symbol)</label>
              <input value={form.ticker} onChange={e => set('ticker', e.target.value)}
                placeholder="e.g. LON:IWDA" />
            </div>
          </div>
          {err && <div className="error-msg">{err}</div>}
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AssetsView() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState(null); // null | 'add' | asset object for edit

  function load() {
    setLoading(true);
    api.assets.list(showArchived)
      .then(setAssets)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [showArchived]);

  const totalValue = assets
    .filter(a => !a.archived)
    .reduce((sum, a) => sum + (a.current_value ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <h1>Assets</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label className="toggle-label">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button className="btn btn-primary" onClick={() => setModal('add')}>+ Add Asset</button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : assets.length === 0 ? (
        <div className="empty-state">No assets yet. Add one to get started.</div>
      ) : (
        <div className="section">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Currency</th>
                <th className="num">Current Value</th>
                <th className="num">Weight %</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id}
                  className={'clickable-row' + (a.archived ? ' archived' : '')}
                  onClick={() => navigate(`/assets/${a.id}`)}>
                  <td>{a.name}{a.archived && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>(archived)</span>}</td>
                  <td><span className="type-badge">{a.type}</span></td>
                  <td>{a.currency}</td>
                  <td className="num">{a.current_value !== null ? fmtEur(a.current_value) : '—'}</td>
                  <td className="num">
                    {!a.archived && totalValue > 0 && a.current_value !== null
                      ? fmtNum((a.current_value / totalValue) * 100) + '%'
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <AssetModal
          asset={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
