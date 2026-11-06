import type { EconomicEvent } from '../src/types.ts';
import { getJson } from './market.ts';

const BASE = 'https://showmytrades.com/api/public/calendar/v1';
export const SHOWMYTRADES_CALENDAR_URL = 'https://showmytrades.com/tools/economic-calendar';
export const RECENT_RELEASE_WINDOW_MS = 6 * 60 * 60_000;

type RawEvent = {
  ts?: unknown;
  time?: unknown;
  currency?: unknown;
  impact?: unknown;
  title?: unknown;
  forecast?: unknown;
  previous?: unknown;
  actual?: unknown;
  id?: unknown;
  status?: unknown;
  moved_from?: unknown;
  confidence?: unknown;
};

type Payload = {
  server_time?: unknown;
  server_time_iso?: unknown;
  generated_at?: unknown;
  count?: unknown;
  events?: unknown;
};

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timestamp(value: unknown): number {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
    ? Date.parse(value)
    : NaN;
}

export function parseShowMyTradesCalendar(payload: unknown, now = Date.now()): EconomicEvent[] {
  if (!payload || typeof payload !== 'object') throw Error('ShowMyTrades response malformed');
  const source = payload as Payload;
  if (
    !Array.isArray(source.events) ||
    !Number.isSafeInteger(source.count) ||
    source.count !== source.events.length ||
    !Number.isSafeInteger(source.server_time)
  )
    throw Error('ShowMyTrades response incomplete');

  const serverTime = (source.server_time as number) * 1000;
  const serverTimeIso = timestamp(source.server_time_iso);
  const generatedAt = timestamp(source.generated_at);
  if (
    !Number.isFinite(serverTimeIso) ||
    Math.abs(serverTimeIso - serverTime) > 1_000 ||
    Math.abs(serverTime - now) > 5 * 60_000 ||
    !Number.isFinite(generatedAt) ||
    generatedAt > now + 5 * 60_000 ||
    now - generatedAt > 2 * 60 * 60_000
  )
    throw Error('ShowMyTrades response stale or invalid');

  const events: EconomicEvent[] = [];
  for (const value of source.events) {
    if (!value || typeof value !== 'object') throw Error('ShowMyTrades event malformed');
    const raw = value as RawEvent;
    if (raw.currency !== 'USD' || raw.impact !== 'high') continue;
    const id = string(raw.id),
      title = string(raw.title),
      time = string(raw.time);
    const timeMs = timestamp(time),
      seconds = raw.ts;
    if (
      !id ||
      !title ||
      !Number.isSafeInteger(seconds) ||
      !Number.isFinite(timeMs) ||
      Math.abs(timeMs - (seconds as number) * 1000) > 1_000
    )
      throw Error('ShowMyTrades event incomplete');
    if (timeMs < now - RECENT_RELEASE_WINDOW_MS || timeMs > now + 31 * 86_400_000) continue;
    const status = string(raw.status);
    if (!['scheduled', 'moved', 'tentative'].includes(status))
      throw Error('ShowMyTrades event status invalid');
    if (status === 'moved' && !Number.isFinite(timestamp(raw.moved_from)))
      throw Error('ShowMyTrades moved event incomplete');
    const confidence = string(raw.confidence);
    if (
      confidence &&
      !['official', 'sources_agree', 'single_source', 'sources_disagree'].includes(confidence)
    )
      throw Error('ShowMyTrades event confidence invalid');
    for (const field of [raw.forecast, raw.previous, raw.actual])
      if (field !== undefined && typeof field !== 'string') throw Error('ShowMyTrades event value invalid');
    events.push({
      id: `showmytrades:${id}`,
      time: new Date(timeMs).toISOString(),
      country: 'US',
      title,
      importance: 3,
      forecast: string(raw.forecast),
      previous: string(raw.previous),
      actual: string(raw.actual),
      status,
      sourceName: 'ShowMyTrades Economic Calendar',
      sourceUrl: SHOWMYTRADES_CALENDAR_URL,
      eventUrl: SHOWMYTRADES_CALENDAR_URL,
      licenseCredit: 'Economic calendar by ShowMyTrades',
      licenseUrl: SHOWMYTRADES_CALENDAR_URL,
      licenseNotice: confidence ? `Schedule confidence: ${confidence.replaceAll('_', ' ')}` : undefined,
    });
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchShowMyTradesCalendar(now: number): Promise<EconomicEvent[]> {
  const url = new URL(BASE);
  url.searchParams.set('currency', 'USD');
  url.searchParams.set('impact', 'high');
  url.searchParams.set('days', '30');
  const payload = await getJson<Payload>(url.href, { redirect: 'error' });
  return parseShowMyTradesCalendar(payload, now);
}
