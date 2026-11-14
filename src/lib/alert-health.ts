import type { AlertEvent, AlertRule } from '../types.ts';
export function deliveryLabel(event: AlertEvent): string {
  const devices = event.delivery?.devices;
  if (!devices) return 'Delivery not tracked';
  if (!devices.length) return 'No push devices';
  const accepted = devices.filter((d) => d.status === 'accepted').length;
  const pending = devices.filter((d) => ['pending', 'sending', 'retrying'].includes(d.status)).length;
  if (accepted === devices.length)
    return `Push service accepted · ${accepted} device${accepted === 1 ? '' : 's'}`;
  return `${accepted}/${devices.length} accepted${pending ? ` · ${pending} pending` : ' · delivery issue'}`;
}
export function technicalHealth(rule: Extract<AlertRule, { kind: 'technical' }>, now = Date.now()) {
  let unchecked = 0,
    delayed = 0,
    failed = 0;
  let oldest = Infinity;
  for (const id of rule.assetIds) {
    const state = rule.technicalState?.[id];
    if (!state || !Number.isFinite(state.evaluatedAt) || state.evaluatedAt <= 0 || state.evaluatedAt > now) {
      unchecked++;
      continue;
    }
    oldest = Math.min(oldest, state.evaluatedAt);
    if (now - state.evaluatedAt > 120_000) delayed++;
    if (state.error) failed++;
  }
  return { unchecked, delayed, failed, oldest: Number.isFinite(oldest) ? oldest : null };
}
