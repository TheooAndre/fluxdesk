import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AlertRule, AlertEvent } from '../src/types.ts';
import { visibleTo, publicMode } from './identity.ts';
export type PushSubscriptionRecord = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ownerId?: string;
};
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
export function snapshotFor(viewer?: string): Store {
  const saved = snapshot();
  return {
    alerts: saved.alerts.filter((a) => visibleTo(a.ownerId, viewer)),
    events: saved.events.filter((e) => visibleTo(e.ownerId, viewer)),
    subscriptions: saved.subscriptions.filter((s) => visibleTo(s.ownerId, viewer)),
  };
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
    if (next.alerts.length >= 5000) throw Error('Global alert limit reached');
    if (next.alerts.filter((x) => x.ownerId === copy.ownerId).length >= 250)
      throw Error('Alert limit reached');
    if (
      copy.kind === 'technical' &&
      next.alerts.filter((x) => x.kind === 'technical' && x.ownerId === copy.ownerId).length >= 20
    )
      throw Error('Advanced alert limit reached (20 rules)');
    next.alerts.push(copy);
  });
}
export function deleteAlert(id: string, viewer?: string) {
  return change((next) => {
    next.alerts = next.alerts.filter((x) => x.id !== id || !visibleTo(x.ownerId, viewer));
  });
}
export function setAlertEnabled(id: string, enabled: boolean, viewer?: string): Promise<AlertRule | null> {
  return change((next) => {
    const alert = next.alerts.find((x) => x.id === id && visibleTo(x.ownerId, viewer));
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
        if (alert.kind === 'macro') {
          delete alert.lastTriggeredEventId;
          delete alert.triggeredEvents;
          alert.armedAt = Date.now();
        }
        if (alert.kind === 'technical') delete alert.technicalState;
      }
    }
    return structuredClone(alert);
  });
}
export type TechnicalEvaluation = { assetId: string } & (
  | { key: string; matched: boolean; eventKey?: string; message: string }
  | { error: string }
);
/** Persist arming, closed-bar dedupe and per-market cooldowns atomically with notifications. */
export function recordTechnicalEvaluations(
  ruleId: string,
  evaluations: TechnicalEvaluation[],
): Promise<AlertEvent[]> {
  return change((next) => {
    const rule = next.alerts.find((x) => x.id === ruleId);
    if (!rule || rule.kind !== 'technical' || !rule.enabled) return [];
    const now = Date.now(),
      events: AlertEvent[] = [];
    rule.technicalState ??= {};
    for (const evaluation of evaluations) {
      if (!rule.enabled || !rule.assetIds.includes(evaluation.assetId)) continue;
      const previous = rule.technicalState[evaluation.assetId];
      if ('error' in evaluation) {
        rule.technicalState[evaluation.assetId] = {
          key: '',
          matched: false,
          ...previous,
          evaluatedAt: now,
          error: evaluation.error.slice(0, 160),
        };
        continue;
      }
      const state = {
        key: evaluation.key,
        matched: evaluation.matched,
        evaluatedAt: now,
        ...(previous?.lastTriggeredAt !== undefined ? { lastTriggeredAt: previous.lastTriggeredAt } : {}),
        ...(evaluation.eventKey
          ? { lastEventKey: evaluation.eventKey }
          : previous?.lastEventKey
            ? { lastEventKey: previous.lastEventKey }
            : {}),
      };
      rule.technicalState[evaluation.assetId] = state;
      // First observation seeds the rule. A restart retains the previous observation on disk.
      if (!previous?.key || evaluation.key === previous.key || !evaluation.matched) continue;
      if (evaluation.eventKey && evaluation.eventKey === previous.lastEventKey) continue;
      if (previous.matched && !evaluation.eventKey) continue;
      if (
        previous.lastTriggeredAt !== undefined &&
        now - previous.lastTriggeredAt < rule.cooldownMinutes * 60_000
      )
        continue;
      state.lastTriggeredAt = now;
      rule.lastTriggeredAt = now;
      if (rule.repeat !== true) rule.enabled = false;
      const event: AlertEvent = {
        id: randomUUID(),
        assetId: evaluation.assetId,
        kind: 'technical',
        message: evaluation.message,
        time: now,
        ...(rule.ownerId ? { ownerId: rule.ownerId } : {}),
      };
      events.push(event);
      next.events.unshift(event);
    }
    const counts = new Map<string | undefined, number>();
    next.events = next.events
      .filter((entry) => {
        const count = counts.get(entry.ownerId) ?? 0;
        counts.set(entry.ownerId, count + 1);
        return count < 150;
      })
      .slice(0, 5000);
    return events;
  });
}
export function triggered(rule: AlertRule, message: string, boundary?: 'above' | 'below', eventId?: string) {
  return change((next) => {
    const original = next.alerts.find((x) => x.id === rule.id);
    if (!original || !original.enabled) return null;
    const now = Date.now();
    let last = original.lastTriggeredAt;
    if (original.kind === 'macro') {
      if (!eventId) throw Error('Macro alerts require an event ID');
      const seen = (original.triggeredEvents ?? []).filter((event) => now - event.at <= 7 * 86_400_000);
      if (original.lastTriggeredEventId === eventId || seen.some((event) => event.id === eventId))
        return null;
      original.triggeredEvents = [...seen, { id: eventId, at: now }].slice(-512);
      original.lastTriggeredEventId = eventId;
    } else if (original.kind === 'price_range') {
      if (!boundary) throw Error('Range alerts require a crossed boundary');
      last = boundary === 'above' ? original.lastTriggeredAboveAt : original.lastTriggeredBelowAt;
    }
    if (original.kind !== 'macro' && last !== undefined && now - last < 300_000) return null;
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
      ...(original.ownerId ? { ownerId: original.ownerId } : {}),
    };
    next.events.unshift(event);
    const counts = new Map<string | undefined, number>();
    next.events = next.events
      .filter((entry) => {
        const count = counts.get(entry.ownerId) ?? 0;
        counts.set(entry.ownerId, count + 1);
        return count < 150;
      })
      .slice(0, 5000);
    return event;
  });
}
export function subscribe(record: PushSubscriptionRecord) {
  const copy = structuredClone(record);
  return change((next) => {
    // A renewed subscription can retain its endpoint but rotate encryption keys.
    const retained = next.subscriptions.filter((x) => x.endpoint !== copy.endpoint);
    if (retained.length >= 5000 || retained.filter((x) => x.ownerId === copy.ownerId).length >= 10)
      throw Error('Push subscription limit reached');
    next.subscriptions = [...retained, copy];
  });
}
export function forgetSubscription(endpoint: string, viewer?: string) {
  return change((next) => {
    next.subscriptions = next.subscriptions.filter(
      (x) =>
        x.endpoint !== endpoint || (publicMode() && viewer !== undefined && !visibleTo(x.ownerId, viewer)),
    );
  });
}
