import { useState } from 'react';
import { usePushNotifications } from '../lib/use-push-notifications.ts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Market, AlertKind } from '../types.ts';
import { money, price, clock } from '../lib/format.ts';
import { Pill, ErrorText, Loading, Card } from './UiPrimitives.tsx';

function AlertsTab({ item }: { item: Market | undefined }) {
  const client = useQueryClient();
  const rules = useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 15_000 });
  const [kind, setKind] = useState<AlertKind>('volume'),
    [threshold, setThreshold] = useState('100'),
    [direction, setDirection] = useState<'above' | 'below'>('above'),
    [message, setMessage] = useState('');
  const create = useMutation({
    mutationFn: api.createAlert,
    onSuccess: () => {
      setMessage('Alert created. Monitoring runs on your dashboard server.');
      void client.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (e) => setMessage(e.message),
  });
  const remove = useMutation({
    mutationFn: api.deleteAlert,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const push = usePushNotifications();
  return (
    <div className="content-stack">
      <div className="section-intro">
        <h2>Market alerts</h2>
        <p>Price levels, 5-minute notional volume spikes, and exchange-observed liquidation events.</p>
      </div>
      <div className="cols-2">
        <Card title="Create alert">
          <label className="field">
            Asset
            <input value={item?.id ?? ''} disabled aria-label="Alert asset" />
          </label>
          <label className="field">
            Alert type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as AlertKind);
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
              <option value="liquidation" disabled={item?.venue !== 'binance'}>
                Liquidations in 5m (USD) · Binance
              </option>
            </select>
          </label>
          {kind === 'price' && (
            <label className="field">
              Trigger when
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'above' | 'below')}>
                <option value="above">Price ≥ level</option>
                <option value="below">Price ≤ level</option>
              </select>
            </label>
          )}
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
          <p className="footnote">
            {kind === 'volume'
              ? 'Compares the latest fully closed 5m candle to the previous 20 closed 5m bars.'
              : kind === 'liquidation'
                ? 'Binance only. Stream captures at most one forced-liquidation snapshot per symbol per second. Amounts are lower-bound observations, not total liquidations.'
                : 'Checks latest available quote approximately once a minute.'}
          </p>
          <button
            className="primary full"
            disabled={
              !item ||
              create.isPending ||
              !navigator.onLine ||
              (kind === 'liquidation' && item.venue !== 'binance') ||
              !Number.isFinite(Number(threshold)) ||
              Number(threshold) <= 0
            }
            onClick={() =>
              item && create.mutate({ assetId: item.id, kind, threshold: Number(threshold), direction })
            }
          >
            <BellRing size={16} /> Create alert
          </button>
          <button
            className="secondary full mt-3"
            disabled={push.busy || push.state === 'checking' || push.state === 'unsupported'}
            onClick={() => void (push.state === 'error' ? push.refresh() : push.toggle())}
          >
            <Bell size={16} /> {push.busy ? 'Updating notifications…' : push.state === 'checking'
              ? 'Checking notifications…' : push.state === 'enabled' ? 'Disable iPhone push notifications'
                : push.state === 'unsupported' ? 'Push notifications unavailable'
                  : push.state === 'error' ? 'Retry notification status' : 'Enable iPhone push notifications'}
          </button>
          {push.message && <div role="status" className="notice mt-3">{push.message}</div>}
          {message && (
            <div role="status" className="notice mt-3">
              {message}
            </div>
          )}
        </Card>
        <Card title="Active rules" aside={<Pill>{rules.data?.alerts.length ?? 0} rules</Pill>}>
          {rules.isLoading ? (
            <Loading />
          ) : rules.error ? (
            <ErrorText error={rules.error} />
          ) : rules.data?.alerts.length ? (
            rules.data.alerts.map((x) => (
              <div className="alert-rule" key={x.id}>
                <div>
                  <b>
                    {x.assetId.split(':')[1]} · {x.kind.toUpperCase()}
                  </b>
                  <small>
                    {x.kind === 'volume'
                      ? `≥ ${x.threshold}% spike`
                      : x.kind === 'price'
                        ? `${x.direction} ${price(x.threshold)}`
                        : `≥ ${money(x.threshold)} / 5m`}
                  </small>
                </div>
                <button aria-label="Delete alert" className="icon-btn" onClick={() => remove.mutate(x.id)}>
                  <X size={18} />
                </button>
              </div>
            ))
          ) : (
            <div className="empty">No active alerts. Choose a rule on the left.</div>
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
          ) : (
            <div className="small-label">Nothing triggered yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default AlertsTab;
