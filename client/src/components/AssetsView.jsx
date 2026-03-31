import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { fmtEur, fmtNum, today } from '../format.js';
import PriceSourceFields from './PriceSourceFields.jsx';

const ASSET_TYPES = ['stock', 'etf', 'savings', 'real_estate', 'pension', 'crypto', 'other'];

function AssetModal({ asset, onClose, onSaved }) {
  const editing = !!asset;
  const [form, setForm] = useState({
    name: asset?.name ?? '',
    type: asset?.type ?? 'etf',
    currency: asset?.currency ?? 'EUR',
    target_allocation_pct: asset?.target_allocation_pct ?? '',
    price_source: asset?.price_source ?? '',
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
        price_source: form.price_source || null,
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
          <div className="form-row">
            <label>Target allocation %</label>
            <input type="number" step="0.01" min="0" max="100" value={form.target_allocation_pct}
              onChange={e => set('target_allocation_pct', e.target.value)} placeholder="optional" style={{ maxWidth: 180 }} />
          </div>
          <PriceSourceFields
            priceSource={form.price_source}
            ticker={form.ticker}
            assetId={editing ? asset.id : null}
            onChange={(ps, tk) => setForm(f => ({ ...f, price_source: ps, ticker: tk }))}
          />
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
  const [modal, setModal] = useState(null);
  const [xirrMap, setXirrMap] = useState({});
  const [xirrLoading, setXirrLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshBanner, setRefreshBanner] = useState(null);

  function load() {
    setLoading(true);
    api.assets.list(showArchived)
      .then(setAssets)
      .finally(() => setLoading(false));
  }

  function loadXirr() {
    setXirrLoading(true);
    api.assets.xirrSummary()
      .then(rows => {
        const map = {};
        rows.forEach(r => { map[r.asset_id] = r; });
        setXirrMap(map);
      })
      .catch(() => {})
      .finally(() => setXirrLoading(false));
  }

  useEffect(() => { load(); }, [showArchived]);
  useEffect(() => { loadXirr(); }, []);

  async function handleRefreshAll() {
    setRefreshing(true);
    setRefreshBanner(null);
    try {
      const result = await api.prices.refreshAll();
      const errNames = result.errors.map(e => `${e.ticker} (${e.source ?? 'unknown'})`).join(', ');
      setRefreshBanner({
        type: result.errors.length > 0 ? 'warn' : 'ok',
        msg: `Updated ${result.fetched} price${result.fetched !== 1 ? 's' : ''}.${result.errors.length > 0 ? ` ${result.errors.length} error(s): ${errNames}` : ''}`,
      });
      load();
      loadXirr();
    } catch (err) {
      setRefreshBanner({ type: 'err', msg: err.message });
    } finally {
      setRefreshing(false);
    }
  }

  const totalValue = assets
    .filter(a => !a.archived)
    .reduce((sum, a) => sum + (a.current_value ?? 0), 0);

  function fmtXirr(v) {
    if (v === undefined) return xirrLoading ? '…' : '—';
    if (v === null) return '—';
    const pct = v * 100;
    return <span style={{ color: pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{(pct >= 0 ? '+' : '') + fmtNum(pct, 1) + '%'}</span>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Assets</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label className="toggle-label">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button className="btn" onClick={handleRefreshAll} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh All Prices'}
          </button>
          <button className="btn btn-primary" onClick={() => setModal('add')}>+ Add Asset</button>
        </div>
      </div>

      {refreshBanner && (
        <div className={`banner banner-${refreshBanner.type}`} style={{ marginBottom: 12 }}>
          {refreshBanner.msg}
          <button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={() => setRefreshBanner(null)}>×</button>
        </div>
      )}

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
                <th className="num">XIRR (1Y)</th>
                <th className="num">XIRR (All)</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => {
                const x = xirrMap[a.id];
                return (
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
                    <td className="num">{fmtXirr(x?.xirr_1y)}</td>
                    <td className="num">{fmtXirr(x?.xirr_all)}</td>
                  </tr>
                );
              })}
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
