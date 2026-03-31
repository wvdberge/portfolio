import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtEur, fmtDate, fmtShares, fmtNum, today } from '../format.js';

const ASSET_TYPES = ['stock', 'etf', 'savings', 'real_estate', 'pension', 'crypto', 'other'];
const LIQUID_TYPES = ['stock', 'etf', 'crypto'];
const SAVINGS_TYPE = 'savings';

// ── Add/Edit Asset Modal ────────────────────────────────────────────────────
function AssetModal({ asset, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: asset.name,
    type: asset.type,
    currency: asset.currency,
    target_allocation_pct: asset.target_allocation_pct ?? '',
    ticker: asset.ticker ?? '',
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.assets.update(asset.id, {
        name: form.name.trim(),
        type: form.type,
        currency: form.currency.trim() || 'EUR',
        target_allocation_pct: form.target_allocation_pct !== '' ? Number(form.target_allocation_pct) : null,
        ticker: form.ticker.trim() || null,
      });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Edit Asset</h2>
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
              <input value={form.currency} onChange={e => set('currency', e.target.value)} />
            </div>
          </div>
          <div className="form-row-inline">
            <div>
              <label>Target allocation %</label>
              <input type="number" step="0.01" min="0" max="100"
                value={form.target_allocation_pct} onChange={e => set('target_allocation_pct', e.target.value)}
                placeholder="optional" />
            </div>
            <div>
              <label>Price ticker (Alpha Vantage symbol)</label>
              <input value={form.ticker} onChange={e => set('ticker', e.target.value)} placeholder="e.g. LON:IWDA" />
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

// ── Add Transaction Modal ────────────────────────────────────────────────────
function AddTransactionModal({ asset, onClose, onSaved }) {
  const isLiquid = LIQUID_TYPES.includes(asset.type);
  const isSavings = asset.type === SAVINGS_TYPE;

  const [date, setDate] = useState(today());
  const [type, setType] = useState(isLiquid ? 'buy' : 'deposit');
  const [quantity, setQuantity] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // For stock/etf/crypto buy/sell: compute amount live
  const isTradeTx = isLiquid && (type === 'buy' || type === 'sell');
  const isDividend = isLiquid && type === 'dividend';

  const computedAmount = useMemo(() => {
    if (!isTradeTx) return null;
    const q = parseFloat(quantity);
    const p = parseFloat(pricePerUnit);
    const f = parseFloat(fee) || 0;
    if (isNaN(q) || isNaN(p)) return null;
    return type === 'buy' ? q * p + f : q * p - f;
  }, [isTradeTx, type, quantity, pricePerUnit, fee]);

  const liquidTypes = isLiquid
    ? ['buy', 'sell', 'dividend']
    : isSavings
    ? ['deposit', 'withdrawal', 'interest']
    : ['deposit', 'withdrawal'];

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const finalAmount = isTradeTx
        ? computedAmount
        : parseFloat(amount);

      if (finalAmount == null || isNaN(finalAmount) || finalAmount < 0) {
        throw new Error('Amount must be a positive number');
      }

      await api.transactions.create({
        asset_id: asset.id,
        date,
        type,
        quantity: isTradeTx ? parseFloat(quantity) : null,
        price_per_unit: isTradeTx ? parseFloat(pricePerUnit) : null,
        amount: finalAmount,
        fee: fee ? parseFloat(fee) : null,
        notes: notes.trim() || null,
      });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Transaction — {asset.name}</h2>
        <form onSubmit={submit}>
          <div className="form-row-inline">
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div>
              <label>Type</label>
              <select value={type} onChange={e => setType(e.target.value)}>
                {liquidTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {isTradeTx && (
            <>
              <div className="form-row-inline">
                <div>
                  <label>Quantity (shares)</label>
                  <input type="number" step="any" min="0" value={quantity}
                    onChange={e => setQuantity(e.target.value)} required />
                </div>
                <div>
                  <label>Price per unit ({asset.currency})</label>
                  <input type="number" step="any" min="0" value={pricePerUnit}
                    onChange={e => setPricePerUnit(e.target.value)} required />
                </div>
              </div>
              <div className="form-row-inline">
                <div>
                  <label>Fee (optional)</label>
                  <input type="number" step="any" min="0" value={fee}
                    onChange={e => setFee(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label>Amount ({asset.currency})</label>
                  <div className="computed-field">
                    {computedAmount !== null ? fmtNum(computedAmount, 2) : '—'}
                  </div>
                  <div className="form-hint">
                    {type === 'buy' ? 'qty × price + fee' : 'qty × price − fee'}
                  </div>
                </div>
              </div>
            </>
          )}

          {(isDividend || isSavings) && (
            <div className="form-row">
              <label>Amount ({asset.currency})</label>
              <input type="number" step="any" min="0" value={amount}
                onChange={e => setAmount(e.target.value)} required />
            </div>
          )}

          <div className="form-row">
            <label>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
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

// ── Add Price Modal ──────────────────────────────────────────────────────────
function AddPriceModal({ asset, onClose, onSaved }) {
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.prices.create({ asset_id: asset.id, date, price: parseFloat(price) });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Price — {asset.name}</h2>
        <form onSubmit={submit}>
          <div className="form-row-inline">
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div>
              <label>Price per unit ({asset.currency})</label>
              <input type="number" step="any" min="0.000001" value={price}
                onChange={e => setPrice(e.target.value)} required autoFocus />
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

// ── Add Snapshot Modal ───────────────────────────────────────────────────────
function AddSnapshotModal({ asset, onClose, onSaved }) {
  const [date, setDate] = useState(today());
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.snapshots.create({ asset_id: asset.id, date, value: parseFloat(value), notes: notes.trim() || null });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Snapshot — {asset.name}</h2>
        <form onSubmit={submit}>
          <div className="form-row-inline">
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div>
              <label>Value ({asset.currency})</label>
              <input type="number" step="any" min="0" value={value}
                onChange={e => setValue(e.target.value)} required autoFocus />
            </div>
          </div>
          <div className="form-row">
            <label>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
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

// ── Transactions Tab ─────────────────────────────────────────────────────────
function TransactionsTab({ asset }) {
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  function load() {
    setLoading(true);
    api.transactions.list(asset.id).then(setTxs).finally(() => setLoading(false));
  }
  useEffect(load, [asset.id]);

  async function del(tx) {
    if (!confirm(`Delete transaction on ${tx.date}?`)) return;
    await api.transactions.delete(tx.id);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add Transaction</button>
      </div>
      {loading ? <div className="loading">Loading…</div> : txs.length === 0 ? (
        <div className="empty-state">No transactions yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th className="num">Quantity</th>
              <th className="num">Price/Unit</th>
              <th className="num">Amount</th>
              <th className="num">Fee</th>
              <th>Notes</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {txs.map(tx => (
              <tr key={tx.id}>
                <td>{fmtDate(tx.date)}</td>
                <td><span className="type-badge">{tx.type}</span></td>
                <td className="num">{tx.quantity !== null ? fmtShares(tx.quantity) : '—'}</td>
                <td className="num">{tx.price_per_unit !== null ? fmtNum(tx.price_per_unit, 4) : '—'}</td>
                <td className="num">{fmtEur(tx.amount)}</td>
                <td className="num">{tx.fee !== null ? fmtEur(tx.fee) : '—'}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{tx.notes ?? ''}</td>
                <td className="actions">
                  <button className="btn btn-sm btn-danger" onClick={() => del(tx)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal && <AddTransactionModal asset={asset} onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}

// ── Prices Tab ───────────────────────────────────────────────────────────────
function PricesTab({ asset }) {
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  function load() {
    setLoading(true);
    api.prices.list(asset.id).then(setPrices).finally(() => setLoading(false));
  }
  useEffect(load, [asset.id]);

  async function del(row) {
    if (!confirm(`Delete price on ${row.date}?`)) return;
    await api.prices.delete(row.id);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add Price</button>
      </div>
      {loading ? <div className="loading">Loading…</div> : prices.length === 0 ? (
        <div className="empty-state">No prices yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Price per unit ({asset.currency})</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {prices.map(p => (
              <tr key={p.id}>
                <td>{fmtDate(p.date)}</td>
                <td className="num">{fmtNum(p.price, 4)}</td>
                <td className="actions">
                  <button className="btn btn-sm btn-danger" onClick={() => del(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal && <AddPriceModal asset={asset} onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}

// ── Snapshots Tab ────────────────────────────────────────────────────────────
function SnapshotsTab({ asset }) {
  const [snaps, setSnaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  function load() {
    setLoading(true);
    api.snapshots.list(asset.id).then(setSnaps).finally(() => setLoading(false));
  }
  useEffect(load, [asset.id]);

  async function del(row) {
    if (!confirm(`Delete snapshot on ${row.date}?`)) return;
    await api.snapshots.delete(row.id);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add Snapshot</button>
      </div>
      {loading ? <div className="loading">Loading…</div> : snaps.length === 0 ? (
        <div className="empty-state">No snapshots yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Value ({asset.currency})</th>
              <th>Notes</th>
              <th className="actions"></th>
            </tr>
          </thead>
          <tbody>
            {snaps.map(s => (
              <tr key={s.id}>
                <td>{fmtDate(s.date)}</td>
                <td className="num">{fmtEur(s.value)}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.notes ?? ''}</td>
                <td className="actions">
                  <button className="btn btn-sm btn-danger" onClick={() => del(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal && <AddSnapshotModal asset={asset} onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}

// ── Asset Detail ─────────────────────────────────────────────────────────────
export default function AssetDetail() {
  const { id } = useParams();
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('transactions');
  const [editModal, setEditModal] = useState(false);

  function loadAsset() {
    api.assets.get(id).then(setAsset).finally(() => setLoading(false));
  }
  useEffect(loadAsset, [id]);

  async function handleArchive() {
    if (!confirm(`Archive "${asset.name}"? It will be hidden from active views.`)) return;
    await api.assets.archive(asset.id);
    loadAsset();
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (!asset) return <div className="error-msg">Asset not found.</div>;

  const showPricesTab = LIQUID_TYPES.includes(asset.type);

  return (
    <div>
      <Link to="/assets" className="detail-back">← Assets</Link>

      <div className="detail-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>{asset.name}{asset.archived && <span style={{ fontSize: 13, color: 'var(--text-faint)', marginLeft: 8 }}>(archived)</span>}</h1>
          <div className="meta">
            <span className="type-badge">{asset.type}</span>
            {' '}· {asset.currency}
            {asset.ticker && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>{asset.ticker}</span>}
          </div>
          <div className="value">
            {asset.current_value !== null ? fmtEur(asset.current_value) : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn btn-sm" onClick={() => setEditModal(true)}>Edit</button>
          {!asset.archived && (
            <button className="btn btn-sm btn-danger" onClick={handleArchive}>Archive</button>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={'tab-btn' + (tab === 'transactions' ? ' active' : '')}
          onClick={() => setTab('transactions')}>Transactions</button>
        {showPricesTab && (
          <button className={'tab-btn' + (tab === 'prices' ? ' active' : '')}
            onClick={() => setTab('prices')}>Prices</button>
        )}
        <button className={'tab-btn' + (tab === 'snapshots' ? ' active' : '')}
          onClick={() => setTab('snapshots')}>Snapshots</button>
      </div>

      <div className="section">
        {tab === 'transactions' && <TransactionsTab asset={asset} />}
        {tab === 'prices' && showPricesTab && <PricesTab asset={asset} />}
        {tab === 'snapshots' && <SnapshotsTab asset={asset} />}
      </div>

      {editModal && (
        <AssetModal asset={asset} onClose={() => setEditModal(false)} onSaved={loadAsset} />
      )}
    </div>
  );
}
