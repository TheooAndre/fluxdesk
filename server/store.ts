import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AlertRule, AlertEvent } from '../src/types.ts';
export type PushSubscriptionRecord = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Store = { alerts: AlertRule[]; events: AlertEvent[]; subscriptions: PushSubscriptionRecord[] };
const FILE = resolve(process.env.DATA_DIR ?? 'data', 'state.json');
let data: Store = { alerts: [], events: [], subscriptions: [] };
let pending: Promise<void> = Promise.resolve();
export async function load() {
  await pending;
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8')) as Store;
    data = { alerts: raw.alerts ?? [], events: raw.events ?? [], subscriptions: raw.subscriptions ?? [] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
export function snapshot(): Store {
  return structuredClone(data);
}
/** Serialize changes and publish them only after atomic file replacement succeeds. */
function change<T>(action: (next: Store) => T): Promise<T> {
  const task = pending.then(async () => {
    const next = snapshot();
    const result = action(next);
    if (JSON.stringify(next) === JSON.stringify(data)) return result;
    await mkdir(dirname(FILE), { recursive: true });
    const temp = FILE + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(temp, FILE);
      data = next;
    } finally {
      await unlink(temp).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
    return result;
  });
  pending = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
export function addAlert(alert: AlertRule) {
  const copy = structuredClone(alert);
  return change((next) => {
    if (next.alerts.length >= 250) throw Error('Alert limit reached');
    next.alerts.push(copy);
  });
}
export function deleteAlert(id: string) {
  return change((next) => {
    next.alerts = next.alerts.filter((x) => x.id !== id);
  });
}
export function setAlertEnabled(id: string, enabled: boolean): Promise<AlertRule | null> {
  return change((next) => {
    const alert = next.alerts.find((x) => x.id === id);
    if (!alert) return null;
    if (alert.enabled !== enabled) {
      alert.enabled = enabled;
      if (enabled) {
        // A manual rearm is a fresh monitoring window, including both range boundaries.
        delete alert.lastTriggeredAt;
        if (alert.kind === 'price_range') {
          delete alert.lastTriggeredAboveAt;
          delete alert.lastTriggeredBelowAt;
        }
      }
    }
    return structuredClone(alert);
  });
}
export function triggered(rule: AlertRule, message: string, boundary?: 'above' | 'below') {
  return change((next) => {
    const original = next.alerts.find((x) => x.id === rule.id);
    if (!original || !original.enabled) return null;
    const now = Date.now();
    let last = original.lastTriggeredAt;
    if (original.kind === 'price_range') {
      if (!boundary) throw Error('Range alerts require a crossed boundary');
      last = boundary === 'above' ? original.lastTriggeredAboveAt : original.lastTriggeredBelowAt;
    }
    if (last !== undefined && now - last < 300_000) return null;
    if (original.kind === 'price_range') {
      if (boundary === 'above') original.lastTriggeredAboveAt = now;
      else original.lastTriggeredBelowAt = now;
    }
    original.lastTriggeredAt = now;
    if (original.repeat !== true) original.enabled = false;
    const event: AlertEvent = {
      id: randomUUID(),
      assetId: rule.assetId,
      kind: rule.kind,
      time: now,
      message,
    };
    next.events.unshift(event);
    next.events = next.events.slice(0, 150);
    return event;
  });
}
export function subscribe(record: PushSubscriptionRecord) {
  const copy = structuredClone(record);
  return change((next) => {
    // A renewed subscription can retain its endpoint but rotate encryption keys.
    next.subscriptions = [...next.subscriptions.filter((x) => x.endpoint !== copy.endpoint), copy];
  });
}
export function forgetSubscription(endpoint: string) {
  return change((next) => {
    next.subscriptions = next.subscriptions.filter((x) => x.endpoint !== endpoint);
  });
}
