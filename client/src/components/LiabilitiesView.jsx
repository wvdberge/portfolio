import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { fmtEur, fmtDate } from '../format.js';

const LIABILITY_TYPES = ['mortgage', 'loan', 'other'];

function LiabilityModal({ liability, onClose, onSaved }) {
  const editing = !!liability;
  const [form, setForm] = useState({
    name: liability?.name ?? '',
    type: liability?.type ?? 'mortgage',
    currency: liability?.currency ?? 'EUR',
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const payload = { name: form.name.trim(), type: form.type, currency: form.currency.trim() || 'EUR' };
      if (editing) {
        await api.liabilities.update(liability.id, payload);
      } else {
        await api.liabilities.create(payload);
      }
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{editing ? 'Edit Liability' : 'Add Liability'}</h2>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
          </div>
          <div className="form-row-inline">
            <div>
              <label>Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                {LIABILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label>Currency</label>
              <input value={form.currency} onChange={e => set('currency', e.target.value)} placeholder="EUR" />
            </div>
          </div>
          {err && <div className="error-msg">{err}</div>}
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Add Liability'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LiabilitiesView() {
  const navigate = useNavigate();
  const [liabilities, setLiabilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  function load() {
    setLoading(true);
    api.liabilities.list().then(setLiabilities).finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <div>
      <div className="page-header">
        <h1>Liabilities</h1>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add Liability</button>
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : liabilities.length === 0 ? (
        <div className="empty-state">No liabilities yet.</div>
      ) : (
        <div className="section">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Currency</th>
                <th className="num">Latest Balance</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map(l => (
                <tr key={l.id} className="clickable-row" onClick={() => navigate(`/liabilities/${l.id}`)}>
                  <td>{l.name}</td>
                  <td><span className="type-badge">{l.type}</span></td>
                  <td>{l.currency}</td>
                  <td className="num">{l.latest_balance !== null ? fmtEur(l.latest_balance) : '—'}</td>
                  <td>{l.latest_date ? fmtDate(l.latest_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <LiabilityModal onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}
