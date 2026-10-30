import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
} from 'recharts';
import { api } from '../api.js';
import { fmtEur, fmtNum, fmtDate } from '../format.js';

// ── Colour palette ────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  stock:        '#3b82f6',
  etf:          '#6366f1',
  savings:      '#10b981',
  real_estate:  '#f59e0b',
  pension:      '#8b5cf6',
  crypto:       '#ef4444',
  other:        '#6b7280',
  liabilities:  '#f43f5e',
};

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtEurK(v) {
  if (v == null) return '';
  if (Math.abs(v) >= 1000) return `€${(v / 1000).toFixed(0)}k`;
  return `€${v.toFixed(0)}`;
}

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return (v >= 0 ? '+' : '') + fmtNum(v, 1) + '%';
}

// ── Return stat box ───────────────────────────────────────────────────────────

function ReturnBox({ label, value, exHouse, msci, loading }) {
  return (
    <div className="stat-box">
      <div className="stat-box-label">{label}</div>
      {loading ? (
        <div className="stat-box-value muted">…</div>
      ) : (
        <>
          <div className="stat-box-value" style={{ color: value === null ? 'var(--text-muted)' : value >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {value !== null ? fmtPct(value) : '—'}
          </div>
          {exHouse !== undefined && (
            <div className="stat-box-sub">Excl. woning: {exHouse !== null ? fmtPct(exHouse) : '—'}</div>
          )}
          {msci !== undefined && (
            <div className="stat-box-sub">MSCI World: {msci !== null ? fmtPct(msci) : '—'}</div>
          )}
        </>
      )}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

const AREA_TYPES = ['stock', 'etf', 'savings', 'real_estate', 'pension', 'crypto', 'other'];

function loadHiddenSeries() {
  try { return new Set(JSON.parse(localStorage.getItem('netWorthHidden')) || []); } catch { return new Set(); }
}

function NetWorthChart({ data }) {
  // Series switched off by clicking the legend; remembered per browser
  const [hidden, setHidden] = useState(loadHiddenSeries);
  function toggle(key) {
    setHidden(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem('netWorthHidden', JSON.stringify([...next])); } catch { /* toggling still works this session */ }
      return next;
    });
  }

  if (!data || data.length === 0) return <div className="empty-state">No historical data yet.</div>;

  // Format for recharts: flatten breakdown into top-level keys
  const chartData = data.map(d => ({
    date: d.date,
    label: d.date.slice(0, 7), // "YYYY-MM"
    ...Object.fromEntries(AREA_TYPES.map(t => [t, d.breakdown[t] || 0])),
    liabilities: -(d.breakdown.liabilities || 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} interval="preserveStartEnd" />
        <YAxis tickFormatter={fmtEurK} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={52} />
        <Tooltip formatter={(v, name) => [fmtEur(v), name]} labelStyle={{ color: 'var(--text)' }} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12, cursor: 'pointer' }}
          onClick={e => toggle(e.dataKey)}
          formatter={(value, entry) => (
            <span style={{ color: hidden.has(entry.dataKey) ? 'var(--text-faint)' : undefined,
              textDecoration: hidden.has(entry.dataKey) ? 'line-through' : undefined }}>{value}</span>
          )} />
        {AREA_TYPES.map(t => (
          <Area key={t} type="monotone" dataKey={t} stackId="1" hide={hidden.has(t)}
            stroke={TYPE_COLORS[t]} fill={TYPE_COLORS[t]} fillOpacity={0.7} />
        ))}
        <Area type="monotone" dataKey="liabilities" stackId="2" hide={hidden.has('liabilities')}
          stroke={TYPE_COLORS.liabilities} fill={TYPE_COLORS.liabilities} fillOpacity={0.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function AllocationDonut({ allocation }) {
  if (!allocation || allocation.length === 0) return <div className="empty-state">No assets yet.</div>;

  const activeItems = allocation.filter(a => a.current_value > 0 && a.weight_pct != null); // excl. woning
  const actual = activeItems.map(a => ({ name: a.name, value: Math.round(a.weight_pct * 10) / 10 }));

  const withTarget = allocation.filter(a => a.target_allocation_pct != null && a.target_allocation_pct > 0);
  const targetTotal = withTarget.reduce((s, a) => s + a.target_allocation_pct, 0);
  const unassigned = Math.max(0, 100 - targetTotal);
  const target = [
    ...withTarget.map(a => ({ name: a.name, value: a.target_allocation_pct })),
    ...(unassigned > 0.5 ? [{ name: 'Unassigned', value: unassigned }] : []),
  ];

  const getColor = (name, idx) => {
    const asset = allocation.find(a => a.name === name);
    if (asset) return TYPE_COLORS[asset.type] || '#999';
    return idx === target.length - 1 ? '#d1d5db' : '#999';
  };

  const RADIAN = Math.PI / 180;
  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
    if (value < 5) return null;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={10}>{value}%</text>;
  };

  return (
    <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Actual</div>
        <PieChart width={160} height={160}>
          <Pie data={actual} cx={75} cy={75} innerRadius={45} outerRadius={75}
            dataKey="value" labelLine={false} label={renderLabel}>
            {actual.map((entry, idx) => (
              <Cell key={idx} fill={getColor(entry.name, idx)} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => `${v}%`} />
        </PieChart>
      </div>
      {target.length > 0 && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Target</div>
          <PieChart width={160} height={160}>
            <Pie data={target} cx={75} cy={75} innerRadius={45} outerRadius={75}
              dataKey="value" labelLine={false} label={renderLabel}>
              {target.map((entry, idx) => (
                <Cell key={idx} fill={getColor(entry.name, idx)} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `${v}%`} />
          </PieChart>
        </div>
      )}
    </div>
  );
}

function ContributionsChart({ data }) {
  if (!data || data.length === 0) return <div className="empty-state">No data yet.</div>;

  const chartData = data.map(d => ({
    year: String(d.year),
    Contributions: Math.max(0, d.contributions),
    Growth: d.gain,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
        <YAxis tickFormatter={fmtEurK} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={52} />
        <Tooltip formatter={(v, name) => [fmtEur(v), name]} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Contributions" stackId="a" fill="#6366f1" />
        <Bar dataKey="Growth" stackId="a" fill="#10b981" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [cvg, setCvg] = useState(null);
  const [xirr1y, setXirr1y] = useState(undefined);
  const [xirr3y, setXirr3y] = useState(undefined);
  const [xirrAll, setXirrAll] = useState(undefined);
  const [exHouse, setExHouse] = useState({}); // period -> XIRR without real estate
  const [msci1y, setMsci1y] = useState(undefined);
  const [msci3y, setMsci3y] = useState(undefined);
  const [msciAll, setMsciAll] = useState(undefined);
  const [realAll, setRealAll] = useState(undefined);
  const [realAllExHouse, setRealAllExHouse] = useState(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.dashboard.get().then(setData).finally(() => setLoading(false));
    api.portfolio.history().then(setHistory);
    api.portfolio.contributionsVsGrowth().then(setCvg);

    const todayStr = new Date().toISOString().slice(0, 10);
    const date1y = new Date(); date1y.setFullYear(date1y.getFullYear() - 1);
    const date3y = new Date(); date3y.setFullYear(date3y.getFullYear() - 3);
    const str1y = date1y.toISOString().slice(0, 10);
    const str3y = date3y.toISOString().slice(0, 10);

    for (const p of ['1y', '3y', 'all']) {
      api.portfolio.xirr(p, 'real_estate')
        .then(r => setExHouse(s => ({ ...s, [p]: r.xirr })))
        .catch(() => setExHouse(s => ({ ...s, [p]: null })));
    }
    api.portfolio.xirr('1y').then(r => setXirr1y(r.xirr)).catch(() => setXirr1y(null));
    api.portfolio.xirr('3y').then(r => setXirr3y(r.xirr)).catch(() => setXirr3y(null));
    api.portfolio.xirr('all').then(r => {
      setXirrAll(r.xirr);
    }).catch(() => setXirrAll(null));

    // All-time real return = all-time XIRR minus annualised CPI, computed in the yearly summary (in %)
    api.portfolio.yearlySummary().then(d => {
      const all = d.portfolio.find(r => r.year === 'all');
      setRealAll(all?.real_return_pct != null ? all.real_return_pct / 100 : null);
      setRealAllExHouse(all?.real_ex_re_pct != null ? all.real_ex_re_pct / 100 : null);
    }).catch(() => { setRealAll(null); setRealAllExHouse(null); });

    api.benchmark.getReturn(str1y, todayStr).then(r => setMsci1y(r.return)).catch(() => setMsci1y(null));
    api.benchmark.getReturn(str3y, todayStr).then(r => setMsci3y(r.return)).catch(() => setMsci3y(null));

    // For all-time MSCI, use earliest history date when available
    api.portfolio.history().then(h => {
      if (h && h.length > 0) {
        api.benchmark.getReturn(h[0].date, todayStr).then(r => setMsciAll(r.return)).catch(() => setMsciAll(null));
      } else {
        setMsciAll(null);
      }
    });
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!data) return <div className="error-msg">Failed to load dashboard.</div>;

  const { net_worth, total_assets, total_liabilities, allocation, liabilities } = data;

  const toPercent = v => v !== null && v !== undefined ? v * 100 : null;

  return (
    <div>
      {/* ── Net Worth Card ── */}
      <div className="net-worth-card">
        <div className="net-worth-label">Net Worth</div>
        <div className="net-worth-value">{fmtEur(net_worth)}</div>
        <div className="net-worth-sub">
          <div className="net-worth-sub-item">Assets <span>{fmtEur(total_assets)}</span></div>
          <div className="net-worth-sub-item">Liabilities <span>{fmtEur(total_liabilities)}</span></div>
        </div>
      </div>

      {/* ── Returns ── */}
      <div className="section">
        <div className="section-header"><h2>Returns</h2></div>
        <div className="stat-row">
          <ReturnBox label="1-Year (XIRR)" value={toPercent(xirr1y)} exHouse={toPercent(exHouse['1y'])} msci={toPercent(msci1y)} loading={xirr1y === undefined} />
          <ReturnBox label="3-Year (XIRR)" value={toPercent(xirr3y)} exHouse={toPercent(exHouse['3y'])} msci={toPercent(msci3y)} loading={xirr3y === undefined} />
          <ReturnBox label="All-Time (XIRR)" value={toPercent(xirrAll)} exHouse={toPercent(exHouse['all'])} msci={toPercent(msciAll)} loading={xirrAll === undefined} />
          <ReturnBox label="Real Return (All-Time)" value={toPercent(realAll)} exHouse={toPercent(realAllExHouse)} loading={realAll === undefined} />
        </div>
      </div>

      {/* ── Net Worth Over Time ── */}
      <div className="section">
        <div className="section-header"><h2>Net Worth Over Time</h2></div>
        {history === null ? <div className="loading">Loading…</div> : <NetWorthChart data={history} />}
      </div>

      {/* ── Allocation ── */}
      <div className="section">
        <div className="section-header"><h2>Asset Allocation</h2></div>
        {allocation.length === 0 ? (
          <div className="empty-state">No assets yet.</div>
        ) : (
          <>
            <AllocationDonut allocation={allocation} />
            <table className="data-table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th className="num">Value (EUR)</th>
                  <th className="num">Weight % (excl. woning)</th>
                  <th className="num">Target %</th>
                  <th className="num">Drift (pp)</th>
                </tr>
              </thead>
              <tbody>
                {allocation.map(a => {
                  const driftAbs = a.drift_pp !== null ? Math.abs(a.drift_pp) : null;
                  const driftWarn = driftAbs !== null && driftAbs > 5;
                  return (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td><span className="type-badge">{a.type}</span></td>
                      <td className="num">{a.current_value !== null ? fmtEur(a.current_value) : '—'}</td>
                      <td className="num">{a.weight_pct !== null ? fmtNum(a.weight_pct) + '%' : '—'}</td>
                      <td className="num">{a.target_allocation_pct !== null ? fmtNum(a.target_allocation_pct) + '%' : '—'}</td>
                      <td className="num">
                        {a.drift_pp !== null ? (
                          <span className={`drift-badge ${driftWarn ? 'drift-warn' : 'drift-ok'}`}>
                            {a.drift_pp > 0 ? '+' : ''}{fmtNum(a.drift_pp)} pp
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ── Contributions vs Growth ── */}
      <div className="section">
        <div className="section-header"><h2>Contributions vs Growth</h2></div>
        {cvg === null ? <div className="loading">Loading…</div> : <ContributionsChart data={cvg} />}
      </div>

      {/* ── Liabilities ── */}
      <div className="section">
        <div className="section-header">
          <h2>Liabilities</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Total: <strong style={{ color: 'var(--text)' }}>{fmtEur(total_liabilities)}</strong>
          </span>
        </div>
        {liabilities.length === 0 ? (
          <div className="empty-state">No liabilities yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Liability</th>
                <th>Type</th>
                <th className="num">Balance</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map(l => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td><span className="type-badge">{l.type}</span></td>
                  <td className="num">{l.latest_balance !== null ? fmtEur(l.latest_balance) : '—'}</td>
                  <td>{l.latest_date ? fmtDate(l.latest_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
