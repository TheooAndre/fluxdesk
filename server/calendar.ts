import type { EconomicEvent } from '../src/types.ts';
import { getJson, UpstreamError } from './market.ts';
import { fetchBlsCalendar } from './bls-calendar.ts';
import { fetchBeaCalendar } from './bea-calendar.ts';
import { fetchXoomarCalendar } from './xoomar-calendar.ts';
import { fetchTradingEconomicsCalendar } from './trading-economics-calendar.ts';

const BASE = 'https://www.financecalendar.com/wp-json/fc/v1/calendar';
const TTL = 10 * 60_000;
type SourceEvent = {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  country?: unknown;
  impact?: unknown;
  category?: unknown;
  status?: unknown;
  data_stale?: unknown;
  release_at_utc?: unknown;
  consensus?: unknown;
  prior?: unknown;
  actual?: unknown;
  source_name?: unknown;
  source_url?: unknown;
  url?: unknown;
  source_license?: {
    attribution?: unknown;
    attribution_url?: unknown;
    notice?: unknown;
    url?: unknown;
  } | null;
  source_rights?: { attribution?: unknown; source_url?: unknown; notice?: unknown } | null;
};
type SourceResponse = { events?: unknown; total?: unknown };
export type CalendarResponse = {
  configured: boolean;
  events: EconomicEvent[];
  source: 'tradingeconomics' | 'financecalendar' | 'bls' | 'bea' | 'official' | 'xoomar' | 'cached' | 'unavailable';
  staleSources: string[];
  sources: CalendarSourceCheck[];
  message?: string;
};
export type CalendarSourceCheck = {
  id: 'tradingeconomics' | 'financecalendar' | 'bls' | 'bea' | 'xoomar';
  name: string;
  status: 'live' | 'unavailable' | 'not_configured';
  checkedAt: number;
  eventCount?: number;
  message?: string;
};
let cache: { at: number; day: string; value: CalendarResponse } | null = null;
let failure: { at: number; day: string; value: CalendarResponse } | null = null;
let pending: Promise<CalendarResponse> | null = null;

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function httpsUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function parseCalendar(json: SourceResponse, now = Date.now()): EconomicEvent[] {
  if (
    !Array.isArray(json.events) ||
    !Number.isSafeInteger(json.total) ||
    (json.total as number) < 0 ||
    json.total !== json.events.length
  ) {
    throw Error('Calendar response incomplete or malformed');
  }
  const events: EconomicEvent[] = [];
  for (const raw of json.events as SourceEvent[]) {
    if (!raw || typeof raw !== 'object') throw Error('Calendar event malformed');
    // Missing precise release times cannot be safely represented as midnight.
    if (
      raw.country !== 'US' ||
      raw.impact !== 'high' ||
      !['confirmed', 'estimated', 'rescheduled'].includes(string(raw.status)) ||
      !['economic-indicators', 'central-banks-monetary-policy'].includes(string(raw.category))
    )
      continue;
    const time = string(raw.release_at_utc);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(time) ||
      !Number.isFinite(Date.parse(time)) ||
      Date.parse(time) < now
    )
      continue;
    const id = string(raw.id),
      title = string(raw.title) || string(raw.name);
    if (!id || !title) continue;
    events.push({
      id,
      time,
      country: 'US',
      title,
      importance: 3,
      forecast: string(raw.consensus),
      previous: string(raw.prior),
      actual: string(raw.actual),
      status: string(raw.status),
      stale: raw.data_stale === true,
      sourceName: string(raw.source_name),
      sourceUrl: httpsUrl(raw.source_url),
      eventUrl: httpsUrl(raw.url),
      licenseCredit: string(raw.source_license?.attribution),
      licenseUrl: httpsUrl(raw.source_license?.attribution_url || raw.source_license?.url),
      licenseNotice: string(raw.source_license?.notice),
      rightsCredit: string(raw.source_rights?.attribution),
      rightsUrl: httpsUrl(raw.source_rights?.source_url),
      rightsNotice: string(raw.source_rights?.notice),
    });
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

type SourceResult = { check: CalendarSourceCheck; events: EconomicEvent[] | null };

async function checkSource(
  id: CalendarSourceCheck['id'],
  name: string,
  fetchEvents: () => Promise<EconomicEvent[]>,
): Promise<SourceResult> {
  try {
    const events = await fetchEvents();
    return { check: { id, name, status: 'live', checkedAt: Date.now(), eventCount: events.length }, events };
  } catch (error) {
    // Never return arbitrary exceptions: header validation errors can contain a credential.
    const message =
      error instanceof UpstreamError
        ? `HTTP ${error.status}`
        : error instanceof Error &&
            (error.name === 'AbortError' || error.message.endsWith('request timed out'))
          ? 'Request timed out'
          : 'Request or response validation failed';
    return { check: { id, name, status: 'unavailable', checkedAt: Date.now(), message }, events: null };
  }
}

async function financeCalendar(day: string, now: number): Promise<SourceResult> {
  const key = process.env.FLUXDESK_FINANCE_CALENDAR_API_KEY?.trim();
  if (!key)
    return {
      check: {
        id: 'financecalendar',
        name: 'Finance Calendar',
        status: 'not_configured',
        checkedAt: Date.now(),
        message: 'Optional API key not configured',
      },
      events: null,
    };
  return checkSource('financecalendar', 'Finance Calendar', async () => {
    if (!/^[\x21-\x7e]+$/.test(key)) throw Error('Invalid API key format');
    const url = new URL(BASE);
    url.searchParams.set('country', 'US');
    url.searchParams.set('impact', 'high');
    url.searchParams.set('from', day);
    url.searchParams.set('to', new Date(now + 14 * 86_400_000).toISOString().slice(0, 10));
    url.searchParams.set('limit', '500');
    const result = await getJson<SourceResponse>(url.href, {
      headers: { 'X-API-Key': key },
      redirect: 'error',
    });
    return parseCalendar(result, now);
  });
}

async function tradingEconomics(now: number): Promise<SourceResult> {
  const key = process.env.TRADING_ECONOMICS_API_KEY?.trim();
  if (!key)
    return {
      check: {
        id: 'tradingeconomics', name: 'Trading Economics', status: 'not_configured',
        checkedAt: Date.now(), message: 'Optional API key not configured',
      },
      events: null,
    };
  return checkSource('tradingeconomics', 'Trading Economics', async () => {
    if (!/^[\x21-\x7e]+$/.test(key)) throw Error('Invalid API key format');
    return fetchTradingEconomicsCalendar(key, now);
  });
}

async function refresh(day: string, now: number): Promise<CalendarResponse> {
  // Check independent schedules together so one denied/slow provider cannot
  // hide a working backup or multiply the nine-second request deadline.
  const [economics, finance, bls, bea, xoomar] = await Promise.all([
    tradingEconomics(now),
    financeCalendar(day, now),
    checkSource('bls', 'BLS', () => fetchBlsCalendar(now)),
    checkSource('bea', 'BEA', () => fetchBeaCalendar(now)),
    checkSource('xoomar', 'XOOMAR', () => fetchXoomarCalendar(now)),
  ]);
  const sources = [economics, finance, bls, bea, xoomar].map((result) => result.check);
  // An optional provider without a key is not an attempted failed request.
  const staleSources = sources.filter((source) => source.status === 'unavailable').map((source) => source.id);
  const failures = sources
    .filter((source) => source.status === 'unavailable')
    .map((source) => `${source.name}: ${source.message}`)
    .join('; ');
  let source: CalendarResponse['source'], events: EconomicEvent[];
  if (economics.events !== null) {
    source = 'tradingeconomics';
    events = economics.events;
  } else if (finance.events !== null) {
    source = 'financecalendar';
    events = finance.events;
  } else if (xoomar.events !== null) {
    source = 'xoomar';
    events = xoomar.events;
  } else if (bls.events !== null || bea.events !== null) {
    source = bls.events !== null && bea.events !== null ? 'official' : bls.events !== null ? 'bls' : 'bea';
    events = [...(bls.events ?? []), ...(bea.events ?? [])].sort((a, b) => a.time.localeCompare(b.time));
  } else {
    const recent = cache?.day === day && now - cache.at < 2 * 60 * 60_000;
    const value: CalendarResponse = {
      configured: true,
      events: recent
        ? cache!.value.events
            .filter((event) => Date.parse(event.time) >= now)
            .map((event) => ({ ...event, stale: true }))
        : [],
      source: recent ? 'cached' : 'unavailable',
      sources,
      staleSources,
      message: `Calendar sources unavailable${recent ? '; showing earlier results (may have changed)' : ''}: ${failures}`,
    };
    failure = { at: Date.now(), day, value };
    return value;
  }
  const description =
    source === 'tradingeconomics'
      ? 'Showing Trading Economics survey consensus, proprietary forecast and prior values.'
      : source === 'financecalendar'
      ? ''
      : source === 'xoomar'
        ? 'Showing the attributed XOOMAR US schedule; verify release times with the originating agency.'
        : `Showing a partial official ${source === 'official' ? 'BLS and BEA' : source.toUpperCase()} release schedule; other agencies, forecasts and prior values are not covered.`;
  const value: CalendarResponse = {
    configured: true,
    events,
    source,
    sources,
    staleSources,
    message:
      [failures ? `Unavailable calendar sources: ${failures}.` : '', description].filter(Boolean).join(' ') ||
      undefined,
  };
  cache = { at: Date.now(), day, value };
  failure = null;
  return value;
}

export async function calendar(): Promise<CalendarResponse> {
  const now = Date.now(),
    day = new Date(now).toISOString().slice(0, 10);
  if (cache?.day === day && now - cache.at < TTL)
    return { ...cache.value, events: cache.value.events.filter((x) => Date.parse(x.time) >= now) };
  if (failure?.day === day && now - failure.at < TTL)
    return { ...failure.value, events: failure.value.events.filter((x) => Date.parse(x.time) >= now) };
  if (!pending)
    pending = refresh(day, now).finally(() => {
      pending = null;
    });
  return pending;
}
