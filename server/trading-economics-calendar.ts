import type { EconomicEvent } from '../src/types.ts';
import { getJson } from './market.ts';
import { RECENT_RELEASE_WINDOW_MS } from './showmytrades-calendar.ts';

const BASE = 'https://api.tradingeconomics.com/calendar/country/united%20states';
export const TRADING_ECONOMICS_CALENDAR_URL = 'https://tradingeconomics.com/calendar';
type Row = {
  CalendarId?: unknown; Date?: unknown; Country?: unknown; Event?: unknown; Actual?: unknown;
  Previous?: unknown; Forecast?: unknown; TEForecast?: unknown; Importance?: unknown; DateSpan?: unknown;
  Source?: unknown; SourceURL?: unknown; URL?: unknown;
};

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
function httpsUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value, 'https://tradingeconomics.com');
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
function utcTime(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const normalized = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value) ? `${value}Z` : value;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(normalized)) return NaN;
  return Date.parse(normalized);
}

export function parseTradingEconomicsCalendar(payload: unknown, now = Date.now()): EconomicEvent[] {
  if (!Array.isArray(payload) || payload.length > 1000) throw Error('Trading Economics calendar response malformed');
  const events: EconomicEvent[] = [];
  for (const raw of payload as Row[]) {
    if (!raw || typeof raw !== 'object') throw Error('Trading Economics calendar event malformed');
    if (raw.Country !== 'United States' || raw.Importance !== 3 || text(raw.DateSpan) !== '0') continue;
    const id = text(raw.CalendarId), title = text(raw.Event), time = utcTime(raw.Date);
    if (!id || !title || !Number.isFinite(time)) throw Error('Trading Economics high-impact event incomplete');
    if (time < now - RECENT_RELEASE_WINDOW_MS || time > now + 14 * 86_400_000) continue;
    events.push({
      id: `tradingeconomics:${id}`, time: new Date(time).toISOString(), country: 'US', title, importance: 3,
      forecast: text(raw.Forecast), providerForecast: text(raw.TEForecast), previous: text(raw.Previous),
      actual: text(raw.Actual), status: 'confirmed', sourceName: text(raw.Source) || 'Trading Economics',
      sourceUrl: httpsUrl(raw.SourceURL), eventUrl: httpsUrl(raw.URL),
      licenseCredit: 'Calendar data: Trading Economics', licenseUrl: TRADING_ECONOMICS_CALENDAR_URL,
    });
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchTradingEconomicsCalendar(key: string, now: number): Promise<EconomicEvent[]> {
  const from = new Date(now - RECENT_RELEASE_WINDOW_MS).toISOString().slice(0, 10),
    to = new Date(now + 14 * 86_400_000).toISOString().slice(0, 10),
    url = `${BASE}/${from}/${to}?importance=3`;
  return parseTradingEconomicsCalendar(await getJson<unknown>(url, {
    headers: { Authorization: key }, redirect: 'error',
  }), now);
}
