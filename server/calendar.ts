import type { EconomicEvent } from '../src/types.ts';
import { getJson } from './market.ts';

const BASE = 'https://www.financecalendar.com/wp-json/fc/v1/calendar';
const TTL = 10 * 60_000;
type SourceEvent = {
  id?: unknown; title?: unknown; name?: unknown; country?: unknown; impact?: unknown;
  category?: unknown; status?: unknown; data_stale?: unknown; release_at_utc?: unknown;
  consensus?: unknown; prior?: unknown; actual?: unknown; source_name?: unknown;
  source_url?: unknown; url?: unknown;
  source_license?: { attribution?: unknown; attribution_url?: unknown; notice?: unknown; url?: unknown } | null;
  source_rights?: { attribution?: unknown; source_url?: unknown; notice?: unknown } | null;
};
type SourceResponse = { events?: unknown; total?: unknown };
type CalendarResponse = { configured: boolean; events: EconomicEvent[]; message?: string };
let cache: { at: number; day: string; value: CalendarResponse } | null = null;
let pending: Promise<CalendarResponse> | null = null;

function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function httpsUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}

export function parseCalendar(json: SourceResponse, now = Date.now()): EconomicEvent[] {
  if (!Array.isArray(json.events) || !Number.isSafeInteger(json.total) || (json.total as number) < 0 || json.total !== json.events.length) {
    throw Error('Calendar response incomplete or malformed');
  }
  const events: EconomicEvent[] = [];
  for (const raw of json.events as SourceEvent[]) {
    if (!raw || typeof raw !== 'object') throw Error('Calendar event malformed');
    // Missing precise release times cannot be safely represented as midnight.
    if (raw.country !== 'US' || raw.impact !== 'high' ||
      !['confirmed', 'estimated', 'rescheduled'].includes(string(raw.status)) ||
      !['economic-indicators', 'central-banks-monetary-policy'].includes(string(raw.category))) continue;
    const time = string(raw.release_at_utc);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(time) ||
      !Number.isFinite(Date.parse(time)) || Date.parse(time) < now) continue;
    const id = string(raw.id), title = string(raw.title) || string(raw.name);
    if (!id || !title) continue;
    events.push({
      id, time, country: 'US', title, importance: 3,
      forecast: string(raw.consensus), previous: string(raw.prior), actual: string(raw.actual),
      status: string(raw.status), stale: raw.data_stale === true,
      sourceName: string(raw.source_name), sourceUrl: httpsUrl(raw.source_url), eventUrl: httpsUrl(raw.url),
      licenseCredit: string(raw.source_license?.attribution), licenseUrl: httpsUrl(raw.source_license?.attribution_url || raw.source_license?.url),
      licenseNotice: string(raw.source_license?.notice),
      rightsCredit: string(raw.source_rights?.attribution), rightsUrl: httpsUrl(raw.source_rights?.source_url),
      rightsNotice: string(raw.source_rights?.notice),
    });
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

async function refresh(day: string, now: number): Promise<CalendarResponse> {
  try {
    const url = new URL(BASE);
    url.searchParams.set('country', 'US'); url.searchParams.set('impact', 'high');
    url.searchParams.set('from', day);
    url.searchParams.set('to', new Date(now + 14 * 86_400_000).toISOString().slice(0, 10));
    url.searchParams.set('limit', '500');
    const result = await getJson<SourceResponse>(url.href);
    const value = { configured: true, events: parseCalendar(result, now) };
    cache = { at: Date.now(), day, value };
    return value;
  } catch (e) {
    // A bounded last-good response stays visible, but is never represented as fresh.
    const recent = cache?.day === day && Date.now() - cache.at < 2 * 60 * 60_000;
    return { configured: true, events: recent ? cache!.value.events.filter(x => Date.parse(x.time) >= now) : [],
      message: `Calendar source unavailable${recent ? '; showing earlier results (may have changed)' : ''}: ${(e as Error).message}` };
  }
}

export async function calendar(): Promise<CalendarResponse> {
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  if (cache?.day === day && now - cache.at < TTL) return { ...cache.value, events: cache.value.events.filter(x => Date.parse(x.time) >= now) };
  if (!pending) pending = refresh(day, now).finally(() => { pending = null; });
  return pending;
}
