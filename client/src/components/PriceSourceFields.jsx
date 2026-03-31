import { useState, useEffect } from 'react';
import { api } from '../api.js';

const MEESMAN_FUNDS = {
  'aandelen-wereldwijd-totaal':     'Aandelen Wereldwijd Totaal',
  'aandelen-verantwoorde-toekomst': 'Aandelen Verantwoorde Toekomst',
  'obligaties-wereldwijd':          'Obligaties Wereldwijd',
  'rentefonds':                     'Rentefonds',
};

const SOURCE_LABELS = {
  '':               'None',
  'alpha_vantage':  'Alpha Vantage',
  'meesman':        'Meesman',
  'brand_new_day':  'Brand New Day',
};

/**
 * Shared price-source + fund/ticker fields for asset modals.
 * Props:
 *   priceSource  string  current value of price_source ('', 'alpha_vantage', 'meesman', 'brand_new_day')
 *   ticker       string  current ticker/fund-slug/fund-id value
 *   assetId      number|null  set when editing an existing saved asset (enables Test Fetch)
 *   onChange     (priceSource, ticker) => void
 */
export default function PriceSourceFields({ priceSource, ticker, assetId, onChange }) {
  const [bndFunds, setBndFunds] = useState(null);   // null = loading, [] = failed/empty
  const [testResult, setTestResult] = useState(null); // { ok, msg }
  const [testing, setTesting] = useState(false);

  // Load BND fund list when BND is selected
  useEffect(() => {
    if (priceSource === 'brand_new_day' && bndFunds === null) {
      api.prices.bndFunds()
        .then(funds => setBndFunds(funds))
        .catch(() => setBndFunds([]));
    }
  }, [priceSource]);

  function setSource(src) {
    // Reset ticker when source changes
    onChange(src, '');
    setTestResult(null);
  }

  function setTicker(tk) {
    onChange(priceSource, tk);
    setTestResult(null);
  }

  async function handleTest() {
    if (!assetId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.prices.refreshOne(assetId);
      setTestResult({ ok: true, msg: `${result.price} on ${result.date}` });
    } catch (err) {
      setTestResult({ ok: false, msg: err.message });
    } finally {
      setTesting(false);
    }
  }

  // Can test fetch when: editing existing asset AND ticker is filled AND price_source set
  const canTest = !!assetId && !!priceSource && !!ticker.trim();

  return (
    <>
      <div className="form-row">
        <label>Price source</label>
        <select value={priceSource} onChange={e => setSource(e.target.value)}>
          {Object.entries(SOURCE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {priceSource === 'alpha_vantage' && (
        <div className="form-row">
          <label>Ticker symbol (e.g. IWDA.LON)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="e.g. IWDA.LON" />
            {canTest && (
              <button type="button" className="btn btn-sm" onClick={handleTest} disabled={testing} style={{ flexShrink: 0 }}>
                {testing ? '…' : 'Test'}
              </button>
            )}
          </div>
          {testResult && <TestResultHint result={testResult} />}
        </div>
      )}

      {priceSource === 'meesman' && (
        <div className="form-row">
          <label>Meesman fund</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <select value={ticker} onChange={e => setTicker(e.target.value)}>
              <option value="">— select fund —</option>
              {Object.entries(MEESMAN_FUNDS).map(([slug, name]) => (
                <option key={slug} value={slug}>{name}</option>
              ))}
            </select>
            {canTest && (
              <button type="button" className="btn btn-sm" onClick={handleTest} disabled={testing} style={{ flexShrink: 0 }}>
                {testing ? '…' : 'Test'}
              </button>
            )}
          </div>
          {testResult && <TestResultHint result={testResult} />}
        </div>
      )}

      {priceSource === 'brand_new_day' && (
        <div className="form-row">
          <label>Brand New Day fund</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            {bndFunds === null ? (
              <input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="Loading funds…" disabled />
            ) : bndFunds.length > 0 ? (
              <select value={ticker} onChange={e => setTicker(e.target.value)}>
                <option value="">— select fund —</option>
                {bndFunds.map(f => (
                  <option key={f.id} value={String(f.id)}>{f.name}</option>
                ))}
              </select>
            ) : (
              <input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="Enter fund ID (e.g. 1002)" />
            )}
            {canTest && (
              <button type="button" className="btn btn-sm" onClick={handleTest} disabled={testing} style={{ flexShrink: 0 }}>
                {testing ? '…' : 'Test'}
              </button>
            )}
          </div>
          {testResult && <TestResultHint result={testResult} />}
        </div>
      )}
    </>
  );
}

function TestResultHint({ result }) {
  return (
    <div style={{ fontSize: 12, marginTop: 4, color: result.ok ? 'var(--positive)' : 'var(--negative)' }}>
      {result.ok ? `✓ ${result.msg}` : `✗ ${result.msg}`}
    </div>
  );
}
