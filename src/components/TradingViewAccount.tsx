import { useEffect, useState } from 'react';
import { tradingViewChart, tradingViewLayout } from '../lib/tradingview.ts';
const storageKey = 'fluxdesk.tradingview.layout.v1';
export default function TradingViewAccount({ assetId, interval }: { assetId: string; interval: string }) {
  const [layout, setLayout] = useState('');
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    try {
      const saved = tradingViewLayout(localStorage.getItem(storageKey) ?? '');
      if (saved) {
        setLayout(saved);
        setInput(saved);
      }
    } catch {
      /* Storage can be disabled. Links still work. */
    }
  }, []);
  const save = () => {
    const value = input.trim() ? tradingViewLayout(input) : '';
    if (value === null) {
      setMessage(
        'Enter an HTTPS TradingView chart layout URL, such as https://www.tradingview.com/chart/Ab12Cd34/.',
      );
      return;
    }
    setLayout(value);
    try {
      if (value) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
      setMessage(value ? 'Layout shortcut saved on this device.' : 'Layout shortcut removed.');
    } catch {
      setMessage('Shortcut works for this session; browser storage is unavailable.');
    }
  };
  return (
    <details className="tradingview-account">
      <summary>My TradingView · account & saved indicators</summary>
      <p className="footnote">
        Open TradingView in a new tab, sign in there and choose your saved layout or indicators. Account
        indicators and Pine scripts run on TradingView; they do not sync into this chart.
      </p>
      <div className="controls">
        <a
          className="secondary"
          href={tradingViewChart(assetId, interval)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open TradingView chart ↗
        </a>
        {layout && (
          <a className="secondary" href={layout} target="_blank" rel="noopener noreferrer">
            Open my saved layout ↗
          </a>
        )}
      </div>
      {assetId.startsWith('hyperliquid:') && assetId !== 'hyperliquid:BTC' && (
        <p className="footnote">
          Select {assetId} in TradingView’s symbol search. An exact chart mapping has not been verified for
          this contract.
        </p>
      )}
      <label className="small-label" htmlFor="tradingview-layout">
        Saved TradingView layout URL (optional)
      </label>
      <div className="controls">
        <input
          id="tradingview-layout"
          type="url"
          placeholder="https://www.tradingview.com/chart/…/"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button className="secondary" onClick={save}>
          Save layout shortcut
        </button>
      </div>
      <p className="footnote">
        This shortcut is saved on this device. Your saved layout keeps its own symbol and timeframe. FluxDesk
        never receives your TradingView password.
      </p>
      {message && (
        <p role="status" className="footnote">
          {message}
        </p>
      )}
    </details>
  );
}
