import { candles, freshMarkets } from './market.ts';
import { volumeSpikePct, crossedPriceLevel, priceRangeCrossing } from '../src/engine/stats.ts';
import { snapshot, triggered } from './store.ts';
import { deliver } from './notifications.ts';
let running = false;
// Polling only fires on crossings/new closed bars rather than repeatedly alerting on a static price.
const lastPrice = new Map<string, number>();
const seenVolumeBar = new Map<string, number>();
export function armPriceAlert(id: string, price: number) {
  lastPrice.set(id, price);
}
export async function scanAlerts() {
  if (running) return;
  running = true;
  try {
    const rules = snapshot().alerts.filter((x) => x.enabled && x.kind !== 'liquidation');
    const ids = new Set(rules.map((x) => x.id));
    for (const id of lastPrice.keys()) if (!ids.has(id)) lastPrice.delete(id);
    for (const id of seenVolumeBar.keys()) if (!ids.has(id)) seenVolumeBar.delete(id);
    if (!rules.length) return;
    const list = await freshMarkets();
    for (const rule of rules) {
      const priorPrice = lastPrice.get(rule.id),
        priorBar = seenVolumeBar.get(rule.id);
      let recorded = false;
      try {
        let message = '';
        let boundary: 'above' | 'below' | undefined;
        const asset = list.find((x) => x.id === rule.assetId);
        if (!asset) continue;
        if (rule.kind === 'price') {
          if (!Number.isFinite(asset.price) || asset.price <= 0) continue;
          const old = lastPrice.get(rule.id);
          lastPrice.set(rule.id, asset.price);
          const direction = rule.direction ?? 'above';
          if (old !== undefined && crossedPriceLevel(old, asset.price, rule.threshold, direction))
            message = `${asset.symbol}: price ${direction} ${rule.threshold} (current ${asset.price})`;
        }
        if (rule.kind === 'price_range') {
          const previous = lastPrice.get(rule.id);
          if (!Number.isFinite(asset.price) || asset.price <= 0) continue;
          lastPrice.set(rule.id, asset.price);
          const crossed =
            previous === undefined
              ? null
              : priceRangeCrossing(previous, asset.price, rule.lowerPrice, rule.upperPrice);
          if (crossed) {
            boundary = crossed;
            const level = crossed === 'above' ? rule.upperPrice : rule.lowerPrice;
            message = `${asset.symbol}: price crossed ${crossed} ${level} (current ${asset.price})`;
          }
        }
        if (rule.kind === 'volume') {
          const series = await candles(asset.id, '5m', 25);
          const spike = volumeSpikePct(series);
          const barTime = series.at(-1)?.time;
          if (barTime !== undefined && seenVolumeBar.get(rule.id) !== barTime) {
            seenVolumeBar.set(rule.id, barTime);
            if (spike !== null && spike >= rule.threshold)
              message = `${asset.id}: 5m notional volume +${spike.toFixed(1)}% above prior 20-bar average`;
          }
        }
        if (message) {
          const event = await triggered(rule, message, boundary);
          recorded = true;
          if (event) await deliver(event);
        }
      } catch (error) {
        if (!recorded) {
          if (priorPrice === undefined) lastPrice.delete(rule.id);
          else lastPrice.set(rule.id, priorPrice);
          if (priorBar === undefined) seenVolumeBar.delete(rule.id);
          else seenVolumeBar.set(rule.id, priorBar);
        }
        console.error('Alert evaluation failure', rule.id, error);
      }
    }
  } catch (error) {
    console.error('Scan failure', error);
  } finally {
    running = false;
  }
}
export function runAlertScanner() {
  void scanAlerts();
  setInterval(() => void scanAlerts(), 60_000).unref();
}
