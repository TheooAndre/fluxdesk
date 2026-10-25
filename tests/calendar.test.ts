import { afterEach, expect, it, vi } from 'vitest';
import { calendar, parseCalendar } from '../server/calendar.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const instant = '2026-10-28T18:00:00+00:00';
const event = { id: 'fed-decision', title: 'Fed decision', country: 'US', category: 'central-banks-monetary-policy',
  impact: 'high', status: 'confirmed', release_at_utc: instant, consensus: null, prior: null, actual: null,
  source_name: 'Federal Reserve', source_url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' };

it('maps a provider release without inventing a consensus and retains source provenance', () => {
  const [result] = parseCalendar({ total: 1, events: [event] }, Date.parse('2026-10-25T00:00:00Z'));
  expect(result).toMatchObject({ time: instant, forecast: '', previous: '', actual: '', sourceName: 'Federal Reserve',
    sourceUrl: event.source_url, importance: 3 });
});

it('omits untimed, cancelled, elapsed, unrelated or unsafe calendar rows', () => {
  const events = [event, { ...event, id: 'untimed', release_at_utc: null },
    { ...event, id: 'cancelled', status: 'cancelled' }, { ...event, id: 'old', release_at_utc: '2026-10-20T00:00:00Z' },
    { ...event, id: 'other-country', country: 'GB' }, { ...event, id: 'holiday', category: 'market-holidays' }];
  expect(parseCalendar({ total: events.length, events }, Date.parse('2026-10-25T00:00:00Z')).map(e => e.id)).toEqual(['fed-decision']);
  const [safe] = parseCalendar({ total: 1, events: [{ ...event, source_url: 'javascript:alert(1)' }] }, Date.parse('2026-10-25T00:00:00Z'));
  expect(safe?.sourceUrl).toBe('');
});

it('fails closed on truncated pages or malformed responses', () => {
  expect(() => parseCalendar({ total: 2, events: [event] })).toThrow('incomplete');
  expect(() => parseCalendar({ total: 0, events: null })).toThrow('incomplete');
  expect(() => parseCalendar({ total: 1, events: [null] })).toThrow('malformed');
});

it('fetches the free endpoint without a key and caches the result', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://www.financecalendar.com');
    expect(url.searchParams.get('country')).toBe('US');
    expect(url.searchParams.get('impact')).toBe('high');
    expect(url.searchParams.has('api_key')).toBe(false);
    return Response.json({ total: 1, events: [event] });
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await calendar();
  expect(response.events).toHaveLength(1);
  expect((await calendar()).events).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
