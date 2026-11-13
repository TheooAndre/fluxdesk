import { useState } from 'react';
import { HelpDetails } from './UiPrimitives.tsx';
import JournalNumberInput from './JournalNumberInput.tsx';
import type { JournalTrade, JournalLeg, JournalFill } from '../journal/model.ts';
import { tradeMetrics, MAX_JOURNAL_LEGS } from '../journal/model.ts';
import { money } from '../lib/format.ts';
const localTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export default function JournalTradeEditor({
  trade,
  setTrade,
  onSave,
  onCancel,
  busy,
}: {
  trade: JournalTrade;
  setTrade: (t: JournalTrade) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [expandAll, setExpandAll] = useState(false);
  const set = <K extends keyof JournalTrade>(key: K, value: JournalTrade[K]) =>
    setTrade({ ...trade, [key]: value });
  const legSet = (i: number, leg: JournalLeg) =>
    set(
      'legs',
      trade.legs.map((l, j) => (i === j ? leg : l)),
    );
  const fillSet = (i: number, j: number, patch: Partial<JournalFill>) =>
    legSet(i, {
      ...trade.legs[i]!,
      fills: trade.legs[i]!.fills.map((f, k) => (j === k ? { ...f, ...patch } : f)),
    });
  let preview = '';
  try {
    const m = tradeMetrics(trade);
    preview = `${m.status.toUpperCase()} · Net ${money(m.net, false)} · Fees ${money(m.fees, false)} · R ${m.rMultiple?.toFixed(2) ?? '—'}`;
  } catch (e) {
    preview = (e as Error).message;
  }
  return (
    <section className="card" aria-label="Trade editor">
      <h2>{trade.id ? 'Edit trade' : 'New trade'}</h2>
      <HelpDetails title="Accounting details">
        Linear contracts / long spot. Base-unit quantities; USD-equivalent cash flows. Weighted-average fills.
        Leverage does not multiply P&L.
      </HelpDetails>
      <div className="workspace-grid">
        <label>
          Journal date
          <input type="date" value={trade.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          Trade title
          <input value={trade.title} maxLength={160} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label>
          Account
          <input value={trade.account} onChange={(e) => set('account', e.target.value)} />
        </label>
        <label>
          Strategy / setup
          <input
            value={trade.strategy}
            placeholder="SFP, stat-arb, breakout…"
            onChange={(e) => set('strategy', e.target.value)}
          />
        </label>
        <label>
          Trade timeframe
          <input value={trade.timeframe} onChange={(e) => set('timeframe', e.target.value)} />
        </label>
        <label>
          Planned risk (USD)
          <JournalNumberInput
            type="number"
            min="0"
            step="any"
            value={trade.riskUsd ?? ''}
            onChange={(e) => set('riskUsd', e.target.value ? Number(e.target.value) : null)}
          />
        </label>
      </div>
      <div className="journal-shared workspace-grid">
        <label>
          Entry thesis
          <textarea value={trade.thesis} onChange={(e) => set('thesis', e.target.value)} maxLength={4000} />
        </label>
        <label>
          Invalidation / exit rules
          <textarea
            value={trade.invalidation}
            onChange={(e) => set('invalidation', e.target.value)}
            maxLength={2000}
          />
        </label>
        <label className="journal-full-width">
          Shared target & management
          <textarea value={trade.plan} onChange={(e) => set('plan', e.target.value)} maxLength={4000} />
        </label>
      </div>
      <details className="editor-details">
        <summary>Costs & sizing</summary>
        <div className="workspace-grid">
          <label>
            Recorded MFE (USD; optional)
            <JournalNumberInput
              type="number"
              min="0"
              step="any"
              value={trade.mfeUsd ?? ''}
              onChange={(e) => set('mfeUsd', e.target.value ? Number(e.target.value) : null)}
            />
          </label>{' '}
          <label>
            Recorded MAE (USD; optional)
            <JournalNumberInput
              type="number"
              min="0"
              step="any"
              value={trade.maeUsd ?? ''}
              onChange={(e) => set('maeUsd', e.target.value ? Number(e.target.value) : null)}
            />
          </label>{' '}
          <label>
            Account equity at entry (USD)
            <JournalNumberInput
              type="number"
              min="0"
              step="any"
              value={trade.accountEquityUsd ?? ''}
              onChange={(e) => set('accountEquityUsd', e.target.value ? Number(e.target.value) : null)}
            />
          </label>{' '}
          <label>
            Funding cash flow (USD; received + / paid −)
            <JournalNumberInput
              type="number"
              step="any"
              value={trade.fundingUsd}
              onChange={(e) => set('fundingUsd', Number(e.target.value))}
            />
          </label>{' '}
          <label>
            Other costs (USD)
            <JournalNumberInput
              type="number"
              min="0"
              step="any"
              value={trade.otherCostsUsd}
              onChange={(e) => set('otherCostsUsd', Number(e.target.value))}
            />
          </label>{' '}
          <label>
            Tags (comma separated)
            <input value={trade.tags.join(',')} onChange={(e) => set('tags', e.target.value.split(','))} />
          </label>
        </div>
      </details>
      <div className="row-between journal-legs-heading">
        <h3>
          Positions{' '}
          <span className="small-label">
            {trade.legs.length} / {MAX_JOURNAL_LEGS}
          </span>
        </h3>
        <button type="button" className="subtle" onClick={() => setExpandAll(!expandAll)}>
          {expandAll ? 'Collapse positions' : 'Expand positions'}
        </button>
      </div>
      {trade.legs.map((leg, i) => (
        <details
          className="journal-leg"
          key={i}
          open={expandAll || trade.legs.length <= 2 || i === trade.legs.length - 1}
        >
          <summary>
            <span>
              Leg {i + 1} · {leg.assetId.split(':')[1] || 'New position'}
            </span>
            <span className="small-label">
              {leg.direction.toUpperCase()} · {leg.fills.length} fills
            </span>
          </summary>
          <fieldset>
            <legend className="sr-only">Leg {i + 1}</legend>
            <div className="workspace-controls">
              <label>
                Leg {i + 1} contract
                <input
                  value={leg.assetId}
                  placeholder="binance:BTCUSDT"
                  onChange={(e) => legSet(i, { ...leg, assetId: e.target.value })}
                />
              </label>
              <label>
                Instrument
                <select
                  value={leg.instrument}
                  onChange={(e) =>
                    legSet(i, {
                      ...leg,
                      instrument: e.target.value as JournalLeg['instrument'],
                      direction: e.target.value === 'spot' ? 'long' : leg.direction,
                    })
                  }
                >
                  <option value="linear_perp">Perpetual</option>
                  <option value="spot">Spot</option>
                </select>
              </label>
              <label>
                Direction
                <select
                  value={leg.direction}
                  onChange={(e) =>
                    legSet(i, { ...leg, direction: e.target.value as JournalLeg['direction'] })
                  }
                >
                  <option value="long">Long</option>
                  <option value="short" disabled={leg.instrument === 'spot'}>
                    Short
                  </option>
                </select>
              </label>
              <label>
                Leverage
                <JournalNumberInput
                  type="number"
                  min="1"
                  max="200"
                  value={leg.leverage}
                  onChange={(e) => legSet(i, { ...leg, leverage: Number(e.target.value) })}
                />
              </label>
              <label>
                Initial stop
                <JournalNumberInput
                  type="number"
                  step="any"
                  min="0"
                  value={leg.stop ?? ''}
                  onChange={(e) =>
                    legSet(i, { ...leg, stop: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </label>
              <label>
                Initial target
                <JournalNumberInput
                  type="number"
                  step="any"
                  min="0"
                  value={leg.target ?? ''}
                  onChange={(e) =>
                    legSet(i, { ...leg, target: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </label>
              {trade.legs.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    set(
                      'legs',
                      trade.legs.filter((_, j) => j !== i),
                    )
                  }
                >
                  Remove leg {i + 1}
                </button>
              )}
            </div>
            <div className="market-scroller">
              <table className="market-table" aria-label={`Leg ${i + 1} fills`}>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Time · device timezone</th>
                    <th>Base quantity</th>
                    <th>Price (USD)</th>
                    <th>Fee USD (rebate −)</th>
                    <th>Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {leg.fills.map((f, j) => (
                    <tr key={f.id}>
                      <td>
                        <select
                          aria-label={`Leg ${i + 1} fill ${j + 1} kind`}
                          value={f.kind}
                          onChange={(e) => fillSet(i, j, { kind: e.target.value as JournalFill['kind'] })}
                        >
                          <option value="entry">Entry</option>
                          <option value="exit">Exit</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="datetime-local"
                          aria-label={`Leg ${i + 1} fill ${j + 1} time`}
                          value={localTime(f.time)}
                          onChange={(e) =>
                            fillSet(i, j, {
                              time: e.target.value ? new Date(e.target.value).toISOString() : '',
                            })
                          }
                        />
                      </td>
                      <td>
                        <JournalNumberInput
                          type="number"
                          step="any"
                          min="0"
                          aria-label={`Leg ${i + 1} fill ${j + 1} quantity`}
                          value={f.quantity || ''}
                          onChange={(e) => fillSet(i, j, { quantity: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <JournalNumberInput
                          type="number"
                          step="any"
                          min="0"
                          aria-label={`Leg ${i + 1} fill ${j + 1} price`}
                          value={f.price || ''}
                          onChange={(e) => fillSet(i, j, { price: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <JournalNumberInput
                          type="number"
                          step="any"
                          aria-label={`Leg ${i + 1} fill ${j + 1} fee`}
                          value={f.feeUsd}
                          onChange={(e) => fillSet(i, j, { feeUsd: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={`Remove leg ${i + 1} fill ${j + 1}`}
                          onClick={() => legSet(i, { ...leg, fills: leg.fills.filter((_, k) => j !== k) })}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="workspace-controls">
              {(['entry', 'exit'] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  disabled={leg.fills.length >= 100}
                  onClick={() =>
                    legSet(i, {
                      ...leg,
                      fills: [
                        ...leg.fills,
                        {
                          id: crypto.randomUUID(),
                          kind,
                          time: new Date().toISOString(),
                          quantity: 0,
                          price: 0,
                          feeUsd: 0,
                        },
                      ],
                    })
                  }
                >
                  Add {kind} fill · leg {i + 1}
                </button>
              ))}
              <small>{leg.fills.length} / 100 fills</small>
            </div>
          </fieldset>
        </details>
      ))}
      <button
        className="secondary"
        disabled={trade.legs.length >= MAX_JOURNAL_LEGS}
        onClick={() =>
          set('legs', [
            ...trade.legs,
            {
              assetId: 'binance:ETHUSDT',
              instrument: trade.legs.at(-1)?.instrument ?? 'linear_perp',
              direction: trade.legs.at(-1)?.direction ?? 'long',
              leverage: 1,
              stop: null,
              target: null,
              fills: [],
            },
          ])
        }
      >
        Add position
      </button>
      <details className="editor-details">
        <summary>Review & attachments</summary>
        <div className="workspace-grid">
          {(['review', 'lessons'] as const).map((key) => (
            <label key={key}>
              {
                {
                  thesis: 'Entry thesis',
                  invalidation: 'Invalidation / exit rules',
                  plan: 'Trade plan / management',
                  review: 'Post-trade review',
                  lessons: 'Lessons / next action',
                }[key]
              }
              <textarea value={trade[key]} onChange={(e) => set(key, e.target.value)} />
            </label>
          ))}
          <label>
            Mistakes (comma separated)
            <input
              value={trade.mistakes.join(',')}
              onChange={(e) => set('mistakes', e.target.value.split(','))}
            />
          </label>
          <label>
            Emotions (comma separated)
            <input
              value={trade.emotions.join(',')}
              onChange={(e) => set('emotions', e.target.value.split(','))}
            />
          </label>
          <label>
            Entry confidence (0–5)
            <JournalNumberInput
              type="number"
              min="0"
              max="5"
              value={trade.confidence}
              onChange={(e) => set('confidence', Number(e.target.value))}
            />
          </label>
          <label>
            Execution rating (0–5)
            <JournalNumberInput
              type="number"
              min="0"
              max="5"
              value={trade.rating}
              onChange={(e) => set('rating', Number(e.target.value))}
            />
          </label>
          <label>
            <span>
              <input
                type="checkbox"
                checked={trade.rulesFollowed}
                onChange={(e) => set('rulesFollowed', e.target.checked)}
              />{' '}
              Followed my trading rules
            </span>
          </label>
          <label>
            Screenshot/chart HTTPS links (one per line)
            <textarea
              value={trade.screenshotUrls.join('\n')}
              onChange={(e) => set('screenshotUrls', e.target.value.split('\n'))}
            />
          </label>
        </div>
      </details>
      {trade.scannerContext && <p className="footnote">Scanner context: {trade.scannerContext}</p>}
      <p className="notice" role="status">
        {preview}
        {trade.riskUsd && trade.accountEquityUsd
          ? ` · planned risk ${((100 * trade.riskUsd) / trade.accountEquityUsd).toFixed(2)}%`
          : ''}
      </p>
      <div className="workspace-controls">
        <button className="primary" disabled={busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save trade'}
        </button>
        <button className="secondary" disabled={busy} onClick={onCancel}>
          Close editor
        </button>
      </div>
      <HelpDetails title="P&L details">
        Closed-trade analytics exclude plans and open positions. P&L includes recorded fees, funding and
        costs; unrealized P&L is separate. Screenshots are stored as links.
      </HelpDetails>
    </section>
  );
}
