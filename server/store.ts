import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { AlertRule, AlertEvent, PushDelivery } from '../src/types.ts';
import { visibleTo, publicMode, ownerId } from './identity.ts';
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
export const pushDeviceId = (endpoint: string) =>
  createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
function enqueueEvent(next: Store, event: AlertEvent) {
  event.delivery = {
    expiresAt: event.time + 300_000,
    devices: next.subscriptions
      .filter((s) => visibleTo(s.ownerId, event.ownerId ?? ownerId()))
      .map((s) => ({
        deviceId: pushDeviceId(s.endpoint),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: event.time,
      })),
  };
  next.events.unshift(event);
}
/** Claim on disk before sending. Never repeat an ambiguous send after a process crash. */
export function claimPush(eventId: string, deviceId: string) {
  return change((next) => {
    const event = next.events.find((e) => e.id === eventId);
    const device = event?.delivery?.devices.find((d) => d.deviceId === deviceId);
    const now = Date.now();
    if (!event || !device || !['pending', 'retrying'].includes(device.status) || device.nextAttemptAt > now)
      return null;
    if (now >= event.delivery!.expiresAt) {
      device.status = 'expired';
      return null;
    }
    const subscription = next.subscriptions.find(
      (s) => pushDeviceId(s.endpoint) === deviceId && visibleTo(s.ownerId, event.ownerId ?? ownerId()),
    );
    if (!subscription) {
      device.status = 'expired';
      device.error = 'Device unsubscribed';
      return null;
    }
    device.status = 'sending';
    device.attempts++;
    device.attemptedAt = now;
    delete device.error;
    return { event: structuredClone(event), subscription: structuredClone(subscription) };
  });
}
export function finishPush(
  eventId: string,
  deviceId: string,
  result: { status: PushDelivery['status']; error?: string; retryAfterMs?: number },
) {
  return change((next) => {
    const event = next.events.find((e) => e.id === eventId);
    const device = event?.delivery?.devices.find((d) => d.deviceId === deviceId);
    if (!device || device.status !== 'sending') return;
    const now = Date.now();
    device.status = result.status;
    if (result.error) device.error = result.error;
    if (result.status === 'accepted') device.acceptedAt = now;
    if (result.status === 'retrying') {
      device.nextAttemptAt =
        now + Math.max(10_000, result.retryAfterMs ?? 10_000 * 2 ** (device.attempts - 1));
      if (device.attempts >= 3) device.status = 'failed';
      else if (device.nextAttemptAt >= event!.delivery!.expiresAt) device.status = 'expired';
    }
  });
}
export function recoverPushClaims(before = Infinity) {
  return change((next) => {
    for (const event of next.events)
      for (const device of event.delivery?.devices ?? []) {
        if (device.status === 'sending' && (device.attemptedAt ?? 0) <= before) {
          device.status = 'interrupted';
          device.error = 'Send interrupted; outcome unknown';
        }
      }
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
      if (!enabled) alert.disabledReason = 'paused';
      if (enabled) {
        delete alert.disabledReason;
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
      if (rule.repeat !== true) {
        rule.enabled = false;
        rule.disabledReason = 'triggered';
      }
      const event: AlertEvent = {
        id: randomUUID(),
        assetId: evaluation.assetId,
        kind: 'technical',
        message: evaluation.message,
        time: now,
        ruleId: rule.id,
        ...(rule.ownerId ? { ownerId: rule.ownerId } : {}),
      };
      events.push(event);
      enqueueEvent(next, event);
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
export function triggered(
  rule: AlertRule,
  message: string,
  boundary?: 'above' | 'below',
  eventId?: string,
  macro?: AlertEvent['macro'],
) {
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
    if (original.repeat !== true) {
      original.enabled = false;
      original.disabledReason = 'triggered';
    }
    const event: AlertEvent = {
      id: randomUUID(),
      assetId: rule.assetId,
      kind: rule.kind,
      time: now,
      message,
      ruleId: original.id,
      ...(macro ? { macro } : {}),
      ...(original.ownerId ? { ownerId: original.ownerId } : {}),
    };
    enqueueEvent(next, event);
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
