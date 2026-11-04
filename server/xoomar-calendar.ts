import type { EconomicEvent } from '../src/types.ts';
import { getJson } from './market.ts';

export const XOOMAR_CALENDAR_URL = 'https://xoomar.com/markets/api/calendar';
const API = 'https://xoomar.com/api/markets/calendar';
type Row = {
  source?: unknown;
  eventName?: unknown;
  importance?: unknown;
  scheduledAt?: unknown;
  previous?: unknown;
  forecast?: unknown;
  actual?: unknown;
  unit?: unknown;
  canonicalUrl?: unknown;
};
type Payload = { data?: unknown; updatedAt?: unknown; meta?: { sourceAttribution?: unknown } };

export function parseXoomarCalendar(payload: Payload, now = Date.now()): EconomicEvent[] {
  if (!payload || !Array.isArray(payload.data) || typeof payload.updatedAt !== 'string')
    throw Error('XOOMAR calendar response malformed');
  const updated = /^\d{13}$/.test(payload.updatedAt)
    ? Number(payload.updatedAt)
    : Date.parse(payload.updatedAt);
  if (!Number.isFinite(updated)) throw Error('XOOMAR calendar update timestamp invalid');
  if (updated > now + 5 * 60_000)
    throw Error(`XOOMAR calendar update timestamp future (${Math.ceil((updated - now) / 60_000)}m)`);
  if (now - updated > 14 * 86_400_000)
    throw Error(`XOOMAR calendar update timestamp stale (${Math.floor((now - updated) / 86_400_000)}d)`);
  const events: EconomicEvent[] = [];
  for (const row of payload.data as Row[]) {
    if (!row || typeof row !== 'object') throw Error('XOOMAR calendar event malformed');
    if (row.importance !== 'high') continue;
    if (
      typeof row.eventName !== 'string' ||
      !row.eventName.trim() ||
      typeof row.scheduledAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(row.scheduledAt)
    )
      throw Error('XOOMAR high-impact event incomplete');
    const time = Date.parse(row.scheduledAt);
    if (!Number.isFinite(time)) throw Error('XOOMAR high-impact time invalid');
    if (time < now || time > now + 14 * 86_400_000) continue;
    const source = typeof row.source === 'string' ? row.source : '';
    if (!['bls', 'bea', 'census', 'fed', 'dol', 'treasury'].includes(source))
      throw Error('XOOMAR high-impact event source unknown');
    const canonical =
      typeof row.canonicalUrl === 'string' && /^https:\/\/xoomar\.com\//.test(row.canonicalUrl)
        ? row.canonicalUrl
        : XOOMAR_CALENDAR_URL;
    events.push({
      id: `xoomar:${source}:${row.eventName}:${row.scheduledAt}`,
      time: new Date(time).toISOString(),
      country: 'US',
      title: row.eventName,
      importance: 3,
      forecast: '',
      previous: typeof row.previous === 'string' ? row.previous : '',
      actual: typeof row.actual === 'string' ? row.actual : '',
      status: 'confirmed',
      sourceName: 'XOOMAR calendar',
      sourceUrl: XOOMAR_CALENDAR_URL,
      eventUrl: canonical,
      licenseCredit: 'Data: XOOMAR',
      licenseUrl: XOOMAR_CALENDAR_URL,
      rightsCredit:
        typeof payload.meta?.sourceAttribution === 'string' ? payload.meta.sourceAttribution : '',
    });
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchXoomarCalendar(now: number): Promise<EconomicEvent[]> {
  // The default window spans the previous week through the next month. Filter
  // locally so the provider's filtered response cannot hide a newer update.
  return parseXoomarCalendar(await getJson<Payload>(API), now);
}
