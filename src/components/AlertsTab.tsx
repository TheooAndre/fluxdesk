import { useState } from 'react';
import { usePushNotifications } from '../lib/use-push-notifications.ts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, X } from 'lucide-react';
import { priceAlertDirection } from '../lib/price-alert.ts';
import { MACRO_LEAD_MINUTES, macroLeadLabel, type MacroLeadMinutes } from '../lib/macro-alert.ts';
import { api } from '../lib/api.ts';
import type { Market, AlertKind } from '../types.ts';
import { money, price, clock } from '../lib/format.ts';
import { Pill, ErrorText, Loading, Card } from './UiPrimitives.tsx';
import AdvancedAlertBuilder from './AdvancedAlertBuilder.tsx';
import { technicalConditionLabel } from '../lib/advanced-alert.ts';

function AlertsTab({ item }: { item: Market | undefined }) {
  const client = useQueryClient();
  const [advanced, setAdvanced] = useState(false);
  const [kind, setKind] = useState<Exclude<AlertKind, 'technical'>>('volume'),
    [threshold, setThreshold] = useState('100'),
    [lowerPrice, setLowerPrice] = useState(''),
    [upperPrice, setUpperPrice] = useState(''),
    [leadMinutes, setLeadMinutes] = useState<MacroLeadMinutes>(15),
    [macroTiming, setMacroTiming] = useState<'before' | 'release'>('release'),
    [repeat, setRepeat] = useState(false),
    [message, setMessage] = useState('');
  const rules = useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 15_000 });
  const macroCalendar = useQuery({
    queryKey: ['calendar'],
    queryFn: api.calendar,
    enabled: !advanced && kind === 'macro',
    staleTime: 10 * 60_000,
  });
  const create = useMutation({
    mutationFn: api.createAlert,
    onSuccess: ({ alert }) => {
      setMessage(
        alert.kind === 'technical'
          ? 'Advanced alert created. The first check arms your rule.'
          : alert.kind === 'price'
            ? `Alert created: price ${alert.direction} ${price(alert.threshold)}. Monitoring runs on your dashboard server.`
            : alert.kind === 'macro'
              ? alert.timing === 'release'
                ? 'Release alert created. Sent when the source reports the actual value, with consensus and previous.'
                : 'Advance reminder created, with consensus, forecast and previous.'
              : 'Alert created. Monitoring runs on your dashboard server.',
      );
      void client.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (e) => setMessage(e.message),
  });
  const remove = useMutation({
    mutationFn: api.deleteAlert,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.setAlertEnabled(id, enabled),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (e) => setMessage(e.message),
  });
  const push = usePushNotifications();
  const direction = priceAlertDirection(item?.price ?? NaN, Number(threshold));
  return (
    <div className="content-stack">
      <div className="alert-categories" aria-label="Alert category">
        <button
          type="button"
          aria-pressed={!advanced && kind !== 'macro'}
          onClick={() => {
            setAdvanced(false);
            if (kind === 'macro') setKind('volume');
            setMessage('');
          }}
        >
          Quick alerts
        </button>
        <button
          type="button"
          aria-pressed={advanced}
          onClick={() => {
            setAdvanced(true);
            setMessage('');
          }}
        >
          Advanced alerts
        </button>
        <button
          type="button"
          aria-pressed={!advanced && kind === 'macro'}
          onClick={() => {
            setAdvanced(false);
            setKind('macro');
            setRepeat(true);
            setMessage('');
          }}
        >
          Macro alerts
        </button>
      </div>
      <div className="cols-2 alerts-layout">
        <Card title={advanced ? 'Advanced alerts' : kind === 'macro' ? 'Macro alerts' : 'Create alert'}>
          {advanced ? (
            <AdvancedAlertBuilder
              item={item}
              pending={create.isPending}
              onCreate={(input) => create.mutate(input)}
            />
          ) : (
            <>
              {kind === 'macro' ? (
                <label className="field">
                  Coverage
                  <input value="US high-impact macro releases" disabled aria-label="Macro alert coverage" />
                </label>
              ) : (
                <label className="field">
                  Asset
                  <input value={item?.id ?? ''} disabled aria-label="Alert asset" />
                </label>
              )}
              <label className="field">
                Alert type
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as Exclude<AlertKind, 'technical'>);
                    if (e.target.value === 'macro') setRepeat(true);
                    if (e.target.value === 'price_range') {
                      setLowerPrice(item ? String(Number((item.price * 0.99).toPrecision(8))) : '');
                      setUpperPrice(item ? String(Number((item.price * 1.01).toPrecision(8))) : '');
                    }
                    setThreshold(
                      e.target.value === 'liquidation'
                        ? '5000000'
                        : e.target.value === 'price'
                          ? String(item?.price ?? 0)
                          : '100',
                    );
                  }}
                >
                  <option value="volume">5m volume spike (%)</option>
                  <option value="price">Price level (USD)</option>
                  <option value="price_range">Price range (USD)</option>
                  <option value="liquidation" disabled={item?.venue !== 'binance'}>
                    Liquidations in 5m (USD) · Binance
                  </option>
                  <option value="macro">High-impact US macro release</option>
                </select>
              </label>
              {kind === 'price' && (
                <div className="notice" role="status">
                  <p>
                    Current {item?.priceBasis === 'mark' ? 'mark' : 'last trade'} price:{' '}
                    {item ? price(item.price) : 'Unavailable'}
                    {item ? ` · ${clock(item.asOf)}` : ''}
                  </p>
                  <p>
                    {direction
                      ? `Price ${direction} ${price(Number(threshold))}`
                      : 'Choose a level above or below the current price.'}
                  </p>
                  <small>Direction is verified against a live quote when saved.</small>
                </div>
              )}
              {kind === 'macro' ? (
                <>
                  <label className="field">
                    Notify
                    <select
                      value={macroTiming}
                      onChange={(e) => setMacroTiming(e.target.value as typeof macroTiming)}
                    >
                      <option value="release">When actual data is released</option>
                      <option value="before">Before release</option>
                    </select>
                  </label>
                  {macroTiming === 'before' && (
                    <label className="field">
                      Notify before release
                      <select
                        value={leadMinutes}
                        onChange={(e) => setLeadMinutes(Number(e.target.value) as MacroLeadMinutes)}
                      >
                        {MACRO_LEAD_MINUTES.map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {macroLeadLabel(minutes)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="notice" role="status">
                    <p>
                      {macroTiming === 'release'
                        ? 'Actual + consensus + previous. Sent once the source publishes the actual value.'
                        : 'Consensus + forecast + previous. One reminder per event.'}
                    </p>
                    {macroCalendar.isLoading ? (
                      <small>Loading upcoming releases…</small>
                    ) : macroCalendar.error ? (
                      <small>Upcoming release preview is temporarily unavailable.</small>
                    ) : macroCalendar.data?.events.length ? (
                      macroCalendar.data.events.slice(0, 3).map((event) => (
                        <small key={event.id}>
                          {event.title} · Consensus: {event.forecast || 'not supplied by source'} · Provider
                          forecast: {event.providerForecast || 'not supplied by source'} · Previous:{' '}
                          {event.previous || 'not supplied by source'}
                        </small>
                      ))
                    ) : (
                      <small>No upcoming high-impact release is currently listed.</small>
                    )}
                  </div>
                </>
              ) : kind === 'price_range' ? (
                <>
                  <label className="field">
                    Lower price (USD)
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={lowerPrice}
                      onChange={(event) => setLowerPrice(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    Upper price (USD)
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={upperPrice}
                      onChange={(event) => setUpperPrice(event.target.value)}
                    />
                  </label>
                  {lowerPrice && upperPrice && Number(lowerPrice) >= Number(upperPrice) && (
                    <p role="status">Lower price must be less than upper price.</p>
                  )}
                </>
              ) : (
                <label className="field">
                  {kind === 'volume'
                    ? 'Volume above baseline (%)'
                    : kind === 'price'
                      ? 'Price level (USD)'
                      : 'Observed liquidations (USD)'}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </label>
              )}
              <details className="help-details">
                <summary>Trigger details</summary>
                <p className="footnote">
                  {kind === 'volume'
                    ? 'Compares the latest fully closed 5m candle to the previous 20 closed 5m bars.'
                    : kind === 'macro'
                      ? 'Uses the latest calendar values at notification time. Consensus and the provider forecast remain separate; missing values are clearly marked rather than guessed.'
                      : kind === 'liquidation'
                        ? 'Binance only. Stream captures at most one forced-liquidation snapshot per symbol per second. Amounts are lower-bound observations, not total liquidations.'
                        : kind === 'price_range'
                          ? 'Alerts when price reaches or crosses above the upper bound or below the lower bound. Checks about once a minute; brief moves between checks may be missed. First observation arms the rule. Re-entry rearms it, with a 5-minute cooldown per boundary.'
                          : 'Checks about once a minute. Reaching or crossing the chosen level triggers an alert; brief moves between checks may be missed. Same-direction repeats have a 5-minute cooldown.'}
                </p>
              </details>
              <label className="field">
                <span>
                  <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />{' '}
                  {kind === 'macro' ? 'Keep active for future releases' : 'Keep active after each trigger'}
                </span>
                <small>
                  {repeat
                    ? kind === 'macro'
                      ? 'Alert once for each new high-impact release.'
                      : 'Repeat when the condition triggers again (with the existing cooldown).'
                    : 'Disable after the first trigger. Reactivate this rule any time.'}
                </small>
              </label>
              <button
                className="primary full"
                disabled={
                  (kind !== 'macro' && !item) ||
                  create.isPending ||
                  !navigator.onLine ||
                  (kind === 'price' && !direction) ||
                  (kind === 'liquidation' && item?.venue !== 'binance') ||
                  (kind === 'macro'
                    ? macroTiming === 'before' && !MACRO_LEAD_MINUTES.includes(leadMinutes)
                    : kind === 'price_range'
                      ? ![Number(lowerPrice), Number(upperPrice)].every(
                          (value) => Number.isFinite(value) && value > 0 && value <= 1e15,
                        ) || Number(lowerPrice) >= Number(upperPrice)
                      : !Number.isFinite(Number(threshold)) || Number(threshold) <= 0)
                }
                onClick={() => {
                  if (kind === 'macro') {
                    create.mutate({
                      assetId: 'macro:US',
                      kind,
                      timing: macroTiming,
                      leadMinutes: macroTiming === 'release' ? 0 : leadMinutes,
                      repeat,
                    });
                  } else if (item) {
                    create.mutate(
                      kind === 'price_range'
                        ? {
                            assetId: item.id,
                            kind,
                            lowerPrice: Number(lowerPrice),
                            upperPrice: Number(upperPrice),
                            repeat,
                          }
                        : { assetId: item.id, kind, threshold: Number(threshold), repeat },
                    );
                  }
                }}
              >
                <BellRing size={16} /> Create alert
              </button>
            </>
          )}
          <button
            className="secondary full mt-3"
            disabled={push.busy || push.state === 'checking' || push.state === 'unsupported'}
            onClick={() => void (push.state === 'error' ? push.refresh() : push.toggle())}
          >
            <Bell size={16} />{' '}
            {push.busy
              ? 'Updating notifications…'
              : push.state === 'checking'
                ? 'Checking notifications…'
                : push.state === 'enabled'
                  ? 'Disable iPhone push notifications'
                  : push.state === 'unsupported'
                    ? 'Push notifications unavailable'
                    : push.state === 'error'
                      ? 'Retry notification status'
                      : 'Enable iPhone push notifications'}
          </button>
          {push.message && (
            <div role="status" className="notice mt-3">
              {push.message}
            </div>
          )}
          {message && (
            <div role="status" className="notice mt-3">
              {message}
            </div>
          )}
        </Card>
        <Card
          title="Alert rules"
          aside={<Pill>{rules.data ? `${rules.data.alerts.length} rules` : 'Not loaded'}</Pill>}
        >
          <button
            type="button"
            className="secondary"
            disabled={rules.isFetching || create.isPending || remove.isPending || toggle.isPending}
            onClick={() => void rules.refetch()}
          >
            {rules.isFetching ? 'Refreshing alerts…' : 'Refresh alerts'}
          </button>
          {rules.error && <ErrorText error={rules.error} />}
          {rules.error && rules.data && (
            <p role="status">
              Refresh failed. Showing the last loaded rules and triggers; their status may have changed.
            </p>
          )}
          {rules.isLoading ? (
            <Loading />
          ) : !rules.data ? null : rules.data?.alerts.length ? (
            rules.data.alerts.map((x) => (
              <div className="alert-rule" key={x.id}>
                <div>
                  <b>
                    {x.kind === 'technical'
                      ? `${x.name} · ADVANCED`
                      : x.kind === 'macro'
                        ? 'US · MACRO'
                        : `${x.assetId.split(':')[1]} · ${x.kind === 'price_range' ? 'PRICE RANGE' : x.kind.toUpperCase()}`}
                  </b>
                  <small>
                    {x.kind === 'technical'
                      ? `${x.assetIds.length} market${x.assetIds.length === 1 ? '' : 's'} · ${x.conditions.map(technicalConditionLabel).join(x.match === 'all' ? ' + ' : ' / ')}`
                      : x.kind === 'macro'
                        ? x.timing === 'release'
                          ? 'On release · actual + consensus + previous'
                          : `${macroLeadLabel(x.leadMinutes)} · consensus + forecast + previous`
                        : x.kind === 'price_range'
                          ? `Below ${price(x.lowerPrice)} or above ${price(x.upperPrice)}`
                          : x.kind === 'volume'
                            ? `≥ ${x.threshold}% spike`
                            : x.kind === 'price'
                              ? `Price ${x.direction ?? 'above'} ${price(x.threshold)}`
                              : `≥ ${money(x.threshold)} / 5m`}
                  </small>
                  {x.kind === 'technical' && (
                    <div className="alert-health">
                      <span>{x.cooldownMinutes}m cooldown / market</span>
                      {Object.values(x.technicalState ?? {}).some((state) => state.error) ? (
                        <span className="negative">
                          Data unavailable ·{' '}
                          {Object.values(x.technicalState ?? {}).filter((state) => state.error).length}{' '}
                          market(s)
                        </span>
                      ) : (
                        <span>
                          {Object.keys(x.technicalState ?? {}).length
                            ? 'Monitoring closed candles'
                            : 'Awaiting first check'}
                        </span>
                      )}
                    </div>
                  )}
                  <small>
                    {x.enabled
                      ? x.repeat
                        ? x.kind === 'macro'
                          ? 'Active · every new release'
                          : 'Active · repeats'
                        : 'Active · one time'
                      : 'Disabled · reactivate to monitor again'}
                  </small>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={toggle.isPending || rules.isFetching || rules.isError || !navigator.onLine}
                  onClick={() => toggle.mutate({ id: x.id, enabled: !x.enabled })}
                >
                  {x.enabled ? 'Disable' : 'Reactivate'}
                </button>
                <button
                  aria-label="Delete alert"
                  className="icon-btn"
                  disabled={
                    remove.isPending ||
                    toggle.isPending ||
                    rules.isFetching ||
                    rules.isError ||
                    !navigator.onLine
                  }
                  onClick={() => remove.mutate(x.id)}
                >
                  <X size={18} />
                </button>
              </div>
            ))
          ) : (
            <div className="empty">No alert rules. Choose a rule on the left.</div>
          )}
          {remove.error && <ErrorText error={remove.error} />}
          <h4 className="mt-6 mb-2">Recent triggers</h4>
          {rules.data?.events.length ? (
            rules.data.events.slice(0, 12).map((e) => (
              <div className="alert-event" key={e.id}>
                <span>{e.message}</span>
                <small>{clock(e.time)}</small>
              </div>
            ))
          ) : rules.data ? (
            <div className="small-label">Nothing triggered yet.</div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export default AlertsTab;
