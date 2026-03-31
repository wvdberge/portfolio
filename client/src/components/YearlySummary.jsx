import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { fmtEur, fmtNum } from '../format.js';

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return (v >= 0 ? '+' : '') + fmtNum(v, 1) + '%';
}

function pctClass(v) {
  if (v === null || v === undefined) return '';
  return v >= 0 ? 'pos' : 'neg';
}

function TypeBadge({ type }) {
  return <span className="type-badge">{type}</span>;
}

function PortfolioTable({ rows }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Year</th>
          <th className="num">Start NW</th>
          <th className="num">Contributions</th>
          <th className="num">Growth</th>
          <th className="num">End NW</th>
          <th className="num">Nominal %</th>
          <th className="num">Real %</th>
          <th className="num">MSCI World %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.year} className={r.year === 'all' ? 'summary-row' : ''}>
            <td><strong>{r.year === 'all' ? 'All-time' : r.year}</strong></td>
            <td className="num">{fmtEur(r.start_net_worth)}</td>
            <td className="num">{fmtEur(r.contributions)}</td>
            <td className={`num ${pctClass(r.growth)}`}>{fmtEur(r.growth)}</td>
            <td className="num">{fmtEur(r.end_net_worth)}</td>
            <td className={`num ${pctClass(r.nominal_return_pct)}`}>{fmtPct(r.nominal_return_pct)}</td>
            <td className={`num ${pctClass(r.real_return_pct)}`}>{fmtPct(r.real_return_pct)}</td>
            <td className={`num ${pctClass(r.msci_world_pct)}`}>{fmtPct(r.msci_world_pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AssetTable({ rows, year }) {
  const yearRows = rows.filter(r => r.year === year);
  if (yearRows.length === 0) return <div className="empty-state">No asset data for {year}.</div>;

  const noMsciTypes = new Set(['savings', 'real_estate', 'pension']);

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Asset</th>
          <th>Type</th>
          <th className="num">Start Value</th>
          <th className="num">Contributions</th>
          <th className="num">Growth</th>
          <th className="num">End Value</th>
          <th className="num">Nominal %</th>
          <th className="num">MSCI %</th>
        </tr>
      </thead>
      <tbody>
        {yearRows.map((r, i) => {
          if (r._subtotal) {
            return (
              <tr key={`sub-${r.asset_type}-${i}`} className="subtotal-row">
                <td colSpan={2}><strong>{r.asset_type} total</strong></td>
                <td className="num">{fmtEur(r.start_net_worth)}</td>
                <td className="num">{fmtEur(r.contributions)}</td>
                <td className={`num ${pctClass(r.growth)}`}>{fmtEur(r.growth)}</td>
                <td className="num">{fmtEur(r.end_net_worth)}</td>
                <td className="num">—</td>
                <td className="num">—</td>
              </tr>
            );
          }
          return (
            <tr key={`${r.asset_id}-${i}`}>
              <td>{r.asset_name}</td>
              <td><TypeBadge type={r.asset_type} /></td>
              <td className="num">{fmtEur(r.start_net_worth)}</td>
              <td className="num">{fmtEur(r.contributions)}</td>
              <td className={`num ${pctClass(r.growth)}`}>{fmtEur(r.growth)}</td>
              <td className="num">{fmtEur(r.end_net_worth)}</td>
              <td className={`num ${pctClass(r.nominal_return_pct)}`}>{fmtPct(r.nominal_return_pct)}</td>
              <td className={`num ${pctClass(r.msci_world_pct)}`}>
                {noMsciTypes.has(r.asset_type) ? '—' : fmtPct(r.msci_world_pct)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function YearlySummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedYears, setExpandedYears] = useState(new Set());
  const [expandAll, setExpandAll] = useState(false);

  useEffect(() => {
    api.portfolio.yearlySummary()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  function toggleYear(year) {
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  function handleExpandAll() {
    if (expandAll) {
      setExpandedYears(new Set());
      setExpandAll(false);
    } else {
      const allYears = new Set(data?.portfolio.map(r => r.year) ?? []);
      setExpandedYears(allYears);
      setExpandAll(true);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (!data) return <div className="error-msg">Failed to load yearly summary.</div>;

  const { portfolio, byAsset } = data;
  const calendarRows = portfolio.filter(r => r.year !== 'all');
  const allTimeRow = portfolio.find(r => r.year === 'all');

  return (
    <div>
      <div className="page-header">
        <h1>Yearly Summary</h1>
        <button className="btn" onClick={handleExpandAll}>
          {expandAll ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {portfolio.length === 0 ? (
        <div className="empty-state">No data yet. Add some transactions to see a yearly summary.</div>
      ) : (
        <>
          <div className="section">
            <PortfolioTable rows={portfolio} />
          </div>

          <div className="section">
            <div className="section-header"><h2>Per-Asset Breakdown</h2></div>
            {calendarRows.map(row => {
              const expanded = expandedYears.has(row.year);
              return (
                <div key={row.year} style={{ marginBottom: 8 }}>
                  <div
                    className="expand-row"
                    onClick={() => toggleYear(row.year)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}
                  >
                    <span style={{ fontSize: 13, userSelect: 'none' }}>{expanded ? '▼' : '▶'}</span>
                    <strong>{row.year}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      End NW: {fmtEur(row.end_net_worth)} · Nominal: {fmtPct(row.nominal_return_pct)} · MSCI: {fmtPct(row.msci_world_pct)}
                    </span>
                  </div>
                  {expanded && <AssetTable rows={byAsset} year={row.year} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
