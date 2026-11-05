import { useState } from 'react';
import { usePushNotifications } from '../lib/use-push-notifications.ts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, X } from 'lucide-react';
import { priceAlertDirection } from '../lib/price-alert.ts';
import { api } from '../lib/api.ts';
import type { Market, AlertKind } from '../types.ts';
import { money, price, clock } from '../lib/format.ts';
import { Pill, ErrorText, Loading, Card } from './UiPrimitives.tsx';

function AlertsTab({ item }: { item: Market | undefined }) {
  const client = useQueryClient();
  const [kind, setKind] = useState<AlertKind>('volume'),
    [threshold, setThreshold] = useState('100'),
    [lowerPrice, setLowerPrice] = useState(''),
    [upperPrice, setUpperPrice] = useState(''),
    [leadMinutes, setLeadMinutes] = useState<'5' | '15' | '30' | '60'>('15'),
    [repeat, setRepeat] = useState(false),
    [message, setMessage] = useState('');
  const rules = useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 15_000 });
  const macroCalendar = useQuery({
    queryKey: ['calendar'], queryFn: api.calendar, enabled: kind === 'macro', staleTime: 10 * 60_000,
  });
  const create = useMutation({
    mutationFn: api.createAlert,
    onSuccess: ({ alert }) => {
      setMessage(
        alert.kind === 'price'
          ? `Alert created: price ${alert.direction} ${price(alert.threshold)}. Monitoring runs on your dashboard server.`
          : alert.kind === 'macro'
            ? 'Macro alert created. Notifications will include analyst consensus, provider forecast and previous value.'
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
      <div className="section-intro">
        <h2>Market and macro alerts</h2>
        <p>
          Price levels and ranges, volume and liquidation events, plus high-impact US macro releases.
        </p>
      </div>
      <div className="cols-2">
        <Card title="Create alert">
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
                setKind(e.target.value as AlertKind);
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
                Notify before release
                <select value={leadMinutes} onChange={(e) => setLeadMinutes(e.target.value as typeof leadMinutes)}>
                  <option value="5">5 minutes before</option>
                  <option value="15">15 minutes before</option>
                  <option value="30">30 minutes before</option>
                  <option value="60">1 hour before</option>
                </select>
              </label>
              <div className="notice" role="status">
                <p><strong>Every notification includes:</strong> analyst consensus, provider forecast and previous value.</p>
                {macroCalendar.isLoading ? (
                  <small>Loading upcoming releases…</small>
                ) : macroCalendar.error ? (
                  <small>Upcoming release preview is temporarily unavailable.</small>
                ) : macroCalendar.data?.events.length ? (
                  macroCalendar.data.events.slice(0, 3).map((event) => (
                    <small key={event.id}>
                      {event.title} · Consensus: {event.forecast || 'not supplied by source'} · Provider forecast:{' '}
                      {event.providerForecast || 'not supplied by source'} · Previous:{' '}
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
          <label className="field">
            <span>
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />{' '}
              {kind === 'macro' ? 'Keep active for future releases' : 'Keep active after each trigger'}
            </span>
            <small>{repeat
              ? kind === 'macro'
                ? 'Alert once for each new high-impact release.'
                : 'Repeat when the condition triggers again (with the existing cooldown).'
              : 'Disable after the first trigger. Reactivate this rule any time.'}</small>
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
                ? ![5, 15, 30, 60].includes(Number(leadMinutes))
                : kind === 'price_range'
                ? ![Number(lowerPrice), Number(upperPrice)].every(
                    (value) => Number.isFinite(value) && value > 0 && value <= 1e15,
                  ) || Number(lowerPrice) >= Number(upperPrice)
                : !Number.isFinite(Number(threshold)) || Number(threshold) <= 0)
            }
            onClick={() => {
              if (kind === 'macro') {
                create.mutate({ assetId: 'macro:US', kind, leadMinutes: Number(leadMinutes) as 5 | 15 | 30 | 60, repeat });
              } else if (item) {
                create.mutate(
                  kind === 'price_range'
                  ? { assetId: item.id, kind, lowerPrice: Number(lowerPrice), upperPrice: Number(upperPrice), repeat }
                  : { assetId: item.id, kind, threshold: Number(threshold), repeat },
                );
              }
            }}
          >
            <BellRing size={16} /> Create alert
          </button>
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
        <Card title="Alert rules" aside={<Pill>{rules.data ? `${rules.data.alerts.length} rules` : 'Not loaded'}</Pill>}>
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
            <p role="status">Refresh failed. Showing the last loaded rules and triggers; their status may have changed.</p>
          )}
          {rules.isLoading ? (
            <Loading />
          ) : !rules.data ? (
            null
          ) : rules.data?.alerts.length ? (
            rules.data.alerts.map((x) => (
              <div className="alert-rule" key={x.id}>
                <div>
                  <b>
                    {x.kind === 'macro' ? 'US · MACRO' : `${x.assetId.split(':')[1]} · ${x.kind === 'price_range' ? 'PRICE RANGE' : x.kind.toUpperCase()}`}
                  </b>
                  <small>
                    {x.kind === 'macro'
                      ? `${x.leadMinutes}m before · consensus + forecast + previous`
                      : x.kind === 'price_range'
                      ? `Below ${price(x.lowerPrice)} or above ${price(x.upperPrice)}`
                      : x.kind === 'volume'
                        ? `≥ ${x.threshold}% spike`
                        : x.kind === 'price'
                          ? `Price ${x.direction ?? 'above'} ${price(x.threshold)}`
                          : `≥ ${money(x.threshold)} / 5m`}
                  </small>
                  <small>{x.enabled ? (x.repeat ? (x.kind === 'macro' ? 'Active · every new release' : 'Active · repeats') : 'Active · one time') : 'Disabled · reactivate to monitor again'}</small>
                </div>
                <button type="button" className="secondary"
                  disabled={toggle.isPending || rules.isFetching || rules.isError || !navigator.onLine}
                  onClick={() => toggle.mutate({ id: x.id, enabled: !x.enabled })}>
                  {x.enabled ? 'Disable' : 'Reactivate'}
                </button>
                <button aria-label="Delete alert" className="icon-btn"
                  disabled={remove.isPending || toggle.isPending || rules.isFetching || rules.isError || !navigator.onLine}
                  onClick={() => remove.mutate(x.id)}>
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
