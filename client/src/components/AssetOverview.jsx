import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api.js';
import { fmtEur, fmtNum, fmtDate, fmtShares } from '../format.js';

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  const pct = Math.round(v * 1000) / 10 + 0; // + 0: no "-0,0%"
  return (pct > 0 ? '+' : '') + fmtNum(pct, 1) + '%';
}

function fmtEurK(v) {
  if (Math.abs(v) >= 1000) return `€${+(v / 1000).toFixed(1)}k`;
  return `€${v.toFixed(0)}`;
}

function signColor(v) {
  if (v === null || v === undefined) return 'var(--text-muted)';
  if (Math.abs(v) < 0.0005) return undefined; // zero, or rounds to 0,0%: no colour
  return v > 0 ? 'var(--positive)' : 'var(--negative)';
}

function yearsSince(dateStr) {
  return (Date.now() - new Date(dateStr + 'T12:00:00').getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function ValueChart({ history }) {
  if (history.length === 0) return <div className="empty-state">No value history yet.</div>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={history} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={d => d.slice(0, 7)} minTickGap={40}
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
        <YAxis tickFormatter={fmtEurK} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={56} />
        <Tooltip
          labelFormatter={fmtDate}
          formatter={(v, name) => [fmtEur(v), name]}
          contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 12 }}
          labelStyle={{ color: 'var(--text-muted)' }}
          itemStyle={{ color: 'var(--text)' }}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }}
          formatter={name => <span style={{ color: 'var(--text-muted)' }}>{name}</span>} />
        {/* A dot only when there is one point: a line needs two */}
        <Line type="linear" dataKey="value" name="Value" stroke="#6366f1" strokeWidth={2}
          dot={history.length === 1} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="net_cash_in" name="Net cash in" stroke="#059669" strokeWidth={2}
          strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ReturnRow({ row, className }) {
  return (
    <tr className={className}>
      <td>{row.label}</td>
      <td className="num">{fmtEur(row.start)}</td>
      <td className="num">{fmtEur(row.net_cash_in)}</td>
      <td className="num" style={{ color: signColor(row.gain) }}>{fmtEur(row.gain)}</td>
      <td className="num">{fmtEur(row.end)}</td>
      <td className="num" style={{ color: signColor(row.xirr) }}>{fmtPct(row.xirr)}</td>
    </tr>
  );
}

function Fact({ label, children }) {
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{children}</div>
    </div>
  );
}

export default function AssetOverview({ asset }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.assets.overview(asset.id).then(setData).catch(e => setErr(e.message));
  }, [asset.id]);

  if (err) return <div className="error-msg">{err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const all = data.periods.find(p => p.period === 'all');

  return (
    <div>
      <div className="stat-row">
        <div className="stat-box">
          <div className="stat-box-label">XIRR since start</div>
          <div className="stat-box-value" style={{ color: signColor(all.xirr) }}>{fmtPct(all.xirr)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-label">Total gain</div>
          <div className="stat-box-value" style={{ color: signColor(all.gain) }}>{fmtEur(all.gain)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-label">Net cash in</div>
          <div className="stat-box-value">{fmtEur(all.net_cash_in)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-label">Weight (excl. woning)</div>
          <div className="stat-box-value">{data.weight_pct !== null ? fmtNum(data.weight_pct, 1) + '%' : '—'}</div>
        </div>
      </div>

      <div className="fact-grid">
        <Fact label="Held since">
          {data.first_date ? `${fmtDate(data.first_date)} (${fmtNum(yearsSince(data.first_date), 1)} yr)` : '—'}
        </Fact>
        <Fact label="Value as of">{fmtDate(data.value_date)}</Fact>
        {data.units !== null && <Fact label="Units">{fmtShares(data.units)}</Fact>}
        {data.latest_price !== null && <Fact label="Latest price">{fmtNum(data.latest_price, 4)}</Fact>}
        {data.dividends > 0 && <Fact label="Dividends">{fmtEur(data.dividends)}</Fact>}
        {data.interest > 0 && <Fact label="Interest">{fmtEur(data.interest)}</Fact>}
        {data.fees > 0 && <Fact label="Fees">{fmtEur(data.fees)}</Fact>}
        <Fact label="Transactions">{data.transactions}</Fact>
      </div>

      <h3 className="overview-heading">Value over time</h3>
      <ValueChart history={data.history} />

      <h3 className="overview-heading">Returns</h3>
      <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Period</th>
            <th className="num">Start</th>
            <th className="num">Net cash in</th>
            <th className="num">Gain</th>
            <th className="num">End</th>
            <th className="num">XIRR (per year)</th>
          </tr>
        </thead>
        <tbody>
          {data.periods.map(r => <ReturnRow key={r.period} row={r} className="summary-row" />)}
          {data.years.map(r => <ReturnRow key={r.period} row={r} />)}
        </tbody>
      </table>
      </div>
      <div className="form-hint" style={{ marginTop: 8 }}>
        End = Start + Net cash in + Gain. Net cash in counts buys, deposits and fees minus sales, withdrawals and
        dividends or interest paid out. XIRR is annualised, so a short period can show a large figure.
      </div>
    </div>
  );
}
