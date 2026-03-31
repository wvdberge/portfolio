import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtEur, fmtDate, fmtNum, today } from '../format.js';

const LIABILITY_TYPES = ['mortgage', 'loan', 'other'];

function EditLiabilityModal({ liability, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: liability.name,
    type: liability.type,
    currency: liability.currency,
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.liabilities.update(liability.id, {
        name: form.name.trim(),
        type: form.type,
        currency: form.currency.trim() || 'EUR',
      });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Edit Liability</h2>
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
              <input value={form.currency} onChange={e => set('currency', e.target.value)} />
            </div>
          </div>
          {err && <div className="error-msg">{err}</div>}
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddSnapshotModal({ liability, onClose, onSaved }) {
  const [date, setDate] = useState(today());
  const [balance, setBalance] = useState('');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.liabilitySnapshots.create({
        liability_id: liability.id,
        date,
        balance: parseFloat(balance),
        interest_rate_pct: rate ? parseFloat(rate) : null,
        notes: notes.trim() || null,
      });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Snapshot — {liability.name}</h2>
        <form onSubmit={submit}>
          <div className="form-row-inline">
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div>
              <label>Balance ({liability.currency})</label>
              <input type="number" step="any" min="0" value={balance}
                onChange={e => setBalance(e.target.value)} required autoFocus />
            </div>
          </div>
          <div className="form-row-inline">
            <div>
              <label>Interest rate % (optional)</label>
              <input type="number" step="any" min="0" value={rate}
                onChange={e => setRate(e.target.value)} placeholder="optional" />
            </div>
            <div>
              <label>Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
            </div>
          </div>
          {err && <div className="error-msg">{err}</div>}
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LiabilityDetail() {
  const { id } = useParams();
  const [liability, setLiability] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(false);
  const [addModal, setAddModal] = useState(false);

  function loadLiability() {
    return api.liabilities.get(id).then(setLiability);
  }
  function loadSnapshots() {
    return api.liabilitySnapshots.list(id).then(setSnapshots);
  }

  useEffect(() => {
    Promise.all([loadLiability(), loadSnapshots()]).finally(() => setLoading(false));
  }, [id]);

  function reload() {
    loadLiability();
    loadSnapshots();
  }

  async function delSnapshot(snap) {
    if (!confirm(`Delete snapshot on ${snap.date}?`)) return;
    await api.liabilitySnapshots.delete(snap.id);
    loadSnapshots();
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (!liability) return <div className="error-msg">Liability not found.</div>;

  return (
    <div>
      <Link to="/liabilities" className="detail-back">← Liabilities</Link>

      <div className="detail-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>{liability.name}</h1>
          <div className="meta">
            <span className="type-badge">{liability.type}</span>
            {' '}· {liability.currency}
          </div>
          {liability.latest_balance !== null && (
            <div className="value">{fmtEur(liability.latest_balance)}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn btn-sm" onClick={() => setEditModal(true)}>Edit</button>
          <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}>+ Add Snapshot</button>
        </div>
      </div>

      <div className="section">
        {snapshots.length === 0 ? (
          <div className="empty-state">No snapshots yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Balance ({liability.currency})</th>
                <th className="num">Interest rate %</th>
                <th>Notes</th>
                <th className="actions"></th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => (
                <tr key={s.id}>
                  <td>{fmtDate(s.date)}</td>
                  <td className="num">{fmtEur(s.balance)}</td>
                  <td className="num">{s.interest_rate_pct !== null ? fmtNum(s.interest_rate_pct, 2) + '%' : '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.notes ?? ''}</td>
                  <td className="actions">
                    <button className="btn btn-sm btn-danger" onClick={() => delSnapshot(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editModal && <EditLiabilityModal liability={liability} onClose={() => setEditModal(false)} onSaved={reload} />}
      {addModal && <AddSnapshotModal liability={liability} onClose={() => setAddModal(false)} onSaved={loadSnapshots} />}
    </div>
  );
}
