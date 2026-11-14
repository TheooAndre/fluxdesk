import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';

/** Authentication mutations that consume password or recovery proof work. */
export const AUTH_LIMITED_ROUTES = new Set([
  'auth/login',
  'auth/register',
  'auth/register-owner',
  'auth/recover',
  'auth/change-password',
]);

type Counter = { count: number; until: number };
const memory = new Map<string, Counter>();
let lastSweep = 0;
let warnedStorage = false;

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number) {
  const value = Number(raw ?? fallback);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function settings() {
  return {
    nameMax: boundedInteger(process.env.FLUXDESK_RL_NAME_MAX, 8, 1, 100),
    ipMax: boundedInteger(process.env.FLUXDESK_RL_IP_MAX, 30, 1, 1_000),
    windowMs: boundedInteger(process.env.FLUXDESK_RL_WINDOW_MS, 60_000, 1_000, 86_400_000),
    redisUrl: process.env.UPSTASH_REDIS_REST_URL,
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    failClosed: process.env.FLUXDESK_RL_FAIL_CLOSED === '1',
  };
}

function sweepMemory(now: number) {
  if (now - lastSweep < 30_000) return;
  lastSweep = now;
  for (const [key, counter] of memory) if (counter.until <= now) memory.delete(key);
}

function memoryHit(key: string, windowMs: number, now: number): [number, number] {
  sweepMemory(now);
  const existing = memory.get(key);
  if (!existing || existing.until <= now) {
    const until = now + windowMs;
    memory.set(key, { count: 1, until });
    return [1, until];
  }
  existing.count += 1;
  return [existing.count, existing.until];
}

function redisReady(url: string | undefined, token: string | undefined): url is string {
  if (typeof url !== 'string' || typeof token !== 'string' || !token) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
    );
  } catch {
    return false;
  }
}

/** Fixed-window counter. Redis failures degrade to a local counter unless fail-closed is selected. */
async function hit(key: string, windowMs: number): Promise<[number, number] | null> {
  const now = Date.now();
  const { redisUrl, redisToken, failClosed } = settings();
  if (redisReady(redisUrl, redisToken)) {
    try {
      const windowEnd = now - (now % windowMs) + windowMs;
      const ttlMs = Math.max(1, windowEnd - now);
      const response = await fetch(`${redisUrl.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        cache: 'no-store',
        signal: AbortSignal.timeout(2_500),
        headers: {
          authorization: `Bearer ${redisToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', key],
          ['PEXPIRE', key, String(ttlMs)],
        ]),
      });
      if (!response.ok) throw Error(`Redis returned HTTP ${response.status}`);
      const entries = (await response.json()) as Array<{ result?: unknown }>;
      const count = Number(entries?.[0]?.result);
      if (!Number.isFinite(count) || count < 1) throw Error('Redis returned an invalid counter');
      return [count, windowEnd];
    } catch (error) {
      if (!warnedStorage) {
        warnedStorage = true;
        console.warn(
          '[rate-limit] shared storage unavailable:',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
      if (failClosed) return null;
    }
  }
  if (failClosed) return null;
  return memoryHit(key, windowMs, now);
}

function clientIp(req: IncomingMessage): string | null {
  const forwarded = req.headers['x-vercel-forwarded-for'];
  return typeof forwarded === 'string' && isIP(forwarded) ? forwarded : null;
}

function normalized(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = [...value.toLowerCase().trim()]
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .slice(0, 254);
  return clean || null;
}

function accountKeys(rawBody: string | undefined): string[] {
  if (!rawBody) return [];
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const data = parsed as Record<string, unknown>;
    return [
      ...new Set([normalized(data.name), normalized(data.email)].filter((value): value is string => !!value)),
    ];
  } catch {
    return [];
  }
}

function reply429(res: ServerResponse, windowEnd: number) {
  const retryAfter = Math.max(1, Math.ceil((windowEnd - Date.now()) / 1_000));
  res.writeHead(429, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'retry-after': String(retryAfter),
  });
  res.end(JSON.stringify({ error: 'Too many account attempts. Try again later.' }));
}

export async function enforceAuthRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  requestedPath: string,
  rawBody: string | undefined,
): Promise<boolean> {
  if (!AUTH_LIMITED_ROUTES.has(requestedPath)) return true;
  const { nameMax, ipMax, windowMs, failClosed } = settings();
  const evaluations: Array<{ key: string; maximum: number }> = [];
  const ip = clientIp(req);
  if (ip) evaluations.push({ key: `fdrl:ip:${ip}`, maximum: ipMax });
  for (const account of accountKeys(rawBody))
    evaluations.push({ key: `fdrl:account:${account}`, maximum: nameMax });
  for (const { key, maximum } of evaluations) {
    const result = await hit(key, windowMs);
    if (!result) {
      if (failClosed) {
        reply429(res, Date.now() + windowMs);
        return false;
      }
      continue;
    }
    const [count, windowEnd] = result;
    if (count > maximum) {
      reply429(res, windowEnd);
      return false;
    }
  }
  return true;
}

export function validAuthJson(rawBody: string | undefined): boolean {
  if (!rawBody) return false;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
