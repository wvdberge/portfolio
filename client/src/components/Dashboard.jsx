import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { fmtEur, fmtNum, fmtDate } from '../format.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.dashboard.get()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!data) return <div className="error-msg">Failed to load dashboard.</div>;

  const { net_worth, total_assets, total_liabilities, allocation, liabilities } = data;

  return (
    <div>
      <div className="net-worth-card">
        <div className="net-worth-label">Net Worth</div>
        <div className="net-worth-value">{fmtEur(net_worth)}</div>
        <div className="net-worth-sub">
          <div className="net-worth-sub-item">Assets <span>{fmtEur(total_assets)}</span></div>
          <div className="net-worth-sub-item">Liabilities <span>{fmtEur(total_liabilities)}</span></div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h2>Asset Allocation</h2>
        </div>
        {allocation.length === 0 ? (
          <div className="empty-state">No assets yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th className="num">Value (EUR)</th>
                <th className="num">Weight %</th>
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
        )}
      </div>

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
