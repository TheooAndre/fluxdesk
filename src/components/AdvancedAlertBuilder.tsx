import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Plus, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  ADVANCED_INDICATORS,
  ADVANCED_TIMEFRAMES,
  ALERT_COOLDOWNS,
  MAX_ALERT_MARKETS,
  MAX_ALERT_CONDITIONS,
  defaultTechnicalCondition,
  indicatorDefinition,
  marketVenueLabel,
  validateTechnicalCondition,
  type TechnicalCondition,
  type IndicatorId,
  type AdvancedTimeframe,
} from '../lib/advanced-alert.ts';
import type { AlertInput, Market } from '../types.ts';
import { ErrorText } from './UiPrimitives.tsx';
import './alerts.css';

const row = (value = defaultTechnicalCondition()) => ({ id: crypto.randomUUID(), value });
export default function AdvancedAlertBuilder({
  item,
  pending,
  onCreate,
}: {
  item: Market | undefined;
  pending: boolean;
  onCreate: (input: AlertInput) => void;
}) {
  const [name, setName] = useState(''),
    [scope, setScope] = useState<'single' | 'basket'>('single');
  const [selected, setSelected] = useState<string[]>(item ? [item.id] : []),
    [query, setQuery] = useState('');
  const [conditions, setConditions] = useState(() => [row()]);
  const [match, setMatch] = useState<'all' | 'any'>('all'),
    [repeat, setRepeat] = useState(false),
    [cooldown, setCooldown] = useState(5);
  const markets = useQuery({ queryKey: ['markets'], queryFn: () => api.markets(), staleTime: 15_000 });
  const assets = markets.data?.assets ?? [];
  const assetIds = scope === 'single' ? (item ? [item.id] : []) : selected;
  const visible = assets
    .filter((asset) =>
      `${asset.base} ${asset.symbol} ${asset.venue}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 80);
  let error = '';
  try {
    conditions.forEach((c) => validateTechnicalCondition(c.value));
  } catch (e) {
    error = e instanceof Error ? e.message : 'Check condition parameters';
  }
  const update = (index: number, value: TechnicalCondition) =>
    setConditions((rows) => rows.map((r, i) => (i === index ? { ...r, value } : r)));
  function preset(value: string) {
    if (value === 'momentum')
      setConditions([
        row({
          ...defaultTechnicalCondition('rsi'),
          signal: 'cross_up',
          params: { period: 14, threshold: 30 },
        }),
      ]);
    if (value === 'trend')
      setConditions([
        row(defaultTechnicalCondition('ema_cross')),
        row({
          ...defaultTechnicalCondition('rsi'),
          signal: 'above',
          timeframe: '4h',
          params: { period: 14, threshold: 50 },
        }),
      ]);
    if (value === 'breakout')
      setConditions([
        row(defaultTechnicalCondition('bollinger')),
        row(defaultTechnicalCondition('volume_change')),
      ]);
    setMatch('all');
  }
  return (
    <form
      className="advanced-builder"
      onSubmit={(event) => {
        event.preventDefault();
        if (!error && assetIds.length && !pending)
          onCreate({
            kind: 'technical',
            assetId: assetIds[0]!,
            assetIds,
            name,
            conditions: conditions.map((c) => c.value),
            match,
            cooldownMinutes: cooldown,
            repeat,
          });
      }}
    >
      <div className="alert-form-grid">
        <label className="field">
          Name
          <input
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="field">
          Start from
          <select defaultValue="custom" onChange={(e) => preset(e.target.value)}>
            <option value="custom">Custom rule</option>
            <option value="momentum">RSI reversal</option>
            <option value="trend">Trend + momentum</option>
            <option value="breakout">Volume-backed breakout</option>
          </select>
        </label>
      </div>
      <label className="field">
        Markets
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="single">Selected market · {item?.base ?? 'none'}</option>
          <option value="basket">Choose multiple markets</option>
        </select>
      </label>
      {scope === 'single' ? (
        <div className="alert-market-summary">
          {item ? `${item.symbol} · ${marketVenueLabel(item.venue)}` : 'Select a market above.'}
        </div>
      ) : (
        <div className="alert-market-picker">
          <div className="row-between">
            <b>
              {selected.length} / {MAX_ALERT_MARKETS} markets
            </b>
            <button type="button" className="subtle" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
          <div className="alert-bulk-buttons">
            {(['binance', 'hyperliquid'] as const).map((venue) => (
              <button
                key={venue}
                type="button"
                className="secondary"
                disabled={!assets.some((a) => a.venue === venue)}
                onClick={() =>
                  setSelected(
                    assets
                      .filter((a) => a.venue === venue)
                      .sort((a, b) => b.volumeUsd24h - a.volumeUsd24h)
                      .slice(0, MAX_ALERT_MARKETS)
                      .map((a) => a.id),
                  )
                }
              >
                Top 20 {marketVenueLabel(venue)}
              </button>
            ))}
          </div>
          <label className="field">
            Find markets
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="BTC, ETH, SOL…"
            />
          </label>
          {markets.error && <ErrorText error={markets.error} />}
          <div className="alert-market-options" aria-label="Available alert markets">
            {visible.map((asset) => (
              <label key={asset.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(asset.id)}
                  disabled={!selected.includes(asset.id) && selected.length >= MAX_ALERT_MARKETS}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked ? [...ids, asset.id] : ids.filter((id) => id !== asset.id),
                    )
                  }
                />
                <span>
                  {asset.symbol}
                  <small>{marketVenueLabel(asset.venue)}</small>
                </span>
              </label>
            ))}
            {!visible.length && (
              <span className="small-label">
                {markets.isLoading ? 'Loading markets…' : 'No matching markets.'}
              </span>
            )}
          </div>
          {selected.length > 0 && (
            <div className="alert-selected-markets" aria-label="Selected alert markets">
              {selected.map((id) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setSelected((ids) => ids.filter((x) => x !== id))}
                  aria-label={`Remove ${id}`}
                >
                  {id.split(':')[1]}
                  <X size={12} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {conditions.length > 1 && (
        <label className="field">
          Trigger when
          <select value={match} onChange={(e) => setMatch(e.target.value as typeof match)}>
            <option value="all">All conditions match · AND</option>
            <option value="any">Any condition matches · OR</option>
          </select>
        </label>
      )}
      <div className="alert-conditions">
        {conditions.map(({ id, value }, index) => {
          const definition = indicatorDefinition(value.indicator);
          return (
            <fieldset className="alert-condition" key={id}>
              <legend>Condition {index + 1}</legend>
              {conditions.length > 1 && (
                <button
                  type="button"
                  className="icon-btn remove-condition"
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() => setConditions((rows) => rows.filter((r) => r.id !== id))}
                >
                  <X size={15} />
                </button>
              )}
              <div className="alert-form-grid">
                <label className="field">
                  Indicator
                  <select
                    value={value.indicator}
                    onChange={(e) =>
                      update(index, {
                        ...defaultTechnicalCondition(e.target.value as IndicatorId),
                        timeframe: value.timeframe,
                      })
                    }
                  >
                    {(['Momentum', 'Trend', 'Volatility', 'Price action', 'Volume'] as const).map((group) => (
                      <optgroup key={group} label={group}>
                        {ADVANCED_INDICATORS.filter((d) => d.group === group).map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Timeframe
                  <select
                    value={value.timeframe}
                    onChange={(e) =>
                      update(index, { ...value, timeframe: e.target.value as AdvancedTimeframe })
                    }
                  >
                    {ADVANCED_TIMEFRAMES.map((tf) => (
                      <option key={tf}>{tf}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                Signal
                <select
                  value={value.signal}
                  onChange={(e) => update(index, { ...value, signal: e.target.value })}
                >
                  {definition.signals.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="alert-form-grid">
                {definition.params.map((param) => (
                  <label key={param.key} className="field">
                    {param.label}
                    <input
                      type="number"
                      min={param.min}
                      max={param.max}
                      step={param.step ?? 1}
                      value={Number.isFinite(value.params[param.key]) ? value.params[param.key] : ''}
                      onChange={(e) =>
                        update(index, {
                          ...value,
                          params: {
                            ...value.params,
                            [param.key]: e.target.value === '' ? NaN : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <button
        type="button"
        className="secondary full"
        disabled={conditions.length >= MAX_ALERT_CONDITIONS}
        onClick={() => setConditions((rows) => [...rows, row()])}
      >
        <Plus size={15} />
        Add condition
      </button>
      <div className="alert-form-grid mt-3">
        <label className="field">
          After trigger
          <select value={repeat ? 'repeat' : 'once'} onChange={(e) => setRepeat(e.target.value === 'repeat')}>
            <option value="once">Disable · reactivate manually</option>
            <option value="repeat">Keep active</option>
          </select>
        </label>
        <label className="field">
          Cooldown per market
          <select value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))}>
            {ALERT_COOLDOWNS.map((n) => (
              <option key={n} value={n}>
                {n === 1440 ? '1 day' : n >= 60 ? `${n / 60}h` : `${n}m`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="footnote">
        Closed candles · checks about once a minute. First check arms the rule; later matching signals trigger
        it. Large baskets may queue.
      </p>
      {error && (
        <p className="negative" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary full mt-3"
        type="submit"
        disabled={pending || !navigator.onLine || !assetIds.length || !!error}
      >
        <BellRing size={16} />
        Create advanced alert
      </button>
    </form>
  );
}
