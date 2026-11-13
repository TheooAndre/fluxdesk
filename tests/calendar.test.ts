import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseCalendar } from '../server/calendar.ts';
import { parseBlsCalendar } from '../server/bls-calendar.ts';
import { parseBeaCalendar } from '../server/bea-calendar.ts';
import { parseXoomarCalendar } from '../server/xoomar-calendar.ts';
import {
  fetchTradingEconomicsCalendar,
  parseTradingEconomicsCalendar,
} from '../server/trading-economics-calendar.ts';
import { fetchShowMyTradesCalendar, parseShowMyTradesCalendar } from '../server/showmytrades-calendar.ts';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('FLUXDESK_FINANCE_CALENDAR_API_KEY', 'test-only-calendar-key');
});
const calendar = async () => (await import('../server/calendar.ts')).calendar();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const instant = '2026-10-28T18:00:00+00:00';
const event = {
  id: 'fed-decision',
  title: 'Fed decision',
  country: 'US',
  category: 'central-banks-monetary-policy',
  impact: 'high',
  status: 'confirmed',
  release_at_utc: instant,
  consensus: null,
  prior: null,
  actual: null,
  source_name: 'Federal Reserve',
  source_url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
};

it('maps a provider release without inventing a consensus and retains source provenance', () => {
  const [result] = parseCalendar({ total: 1, events: [event] }, Date.parse('2026-10-25T00:00:00Z'));
  expect(result).toMatchObject({
    time: instant,
    forecast: '',
    previous: '',
    actual: '',
    sourceName: 'Federal Reserve',
    sourceUrl: event.source_url,
    importance: 3,
  });
});

it('omits untimed, cancelled, elapsed, unrelated or unsafe calendar rows', () => {
  const events = [
    event,
    { ...event, id: 'untimed', release_at_utc: null },
    { ...event, id: 'cancelled', status: 'cancelled' },
    { ...event, id: 'old', release_at_utc: '2026-10-20T00:00:00Z' },
    { ...event, id: 'other-country', country: 'GB' },
    { ...event, id: 'holiday', category: 'market-holidays' },
  ];
  expect(
    parseCalendar({ total: events.length, events }, Date.parse('2026-10-25T00:00:00Z')).map((e) => e.id),
  ).toEqual(['fed-decision']);
  const [safe] = parseCalendar(
    { total: 1, events: [{ ...event, source_url: 'javascript:alert(1)' }] },
    Date.parse('2026-10-25T00:00:00Z'),
  );
  expect(safe?.sourceUrl).toBe('');
});

it('fails closed on truncated pages or malformed responses', () => {
  expect(() => parseCalendar({ total: 2, events: [event] })).toThrow('incomplete');
  expect(() => parseCalendar({ total: 0, events: null })).toThrow('incomplete');
  expect(() => parseCalendar({ total: 1, events: [null] })).toThrow('malformed');
});

it('authenticates with a header, checks backups and bounds cached recovery', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  let financeOffline = false;
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(input);
    if (url.origin === 'https://showmytrades.com') throw new Error('ShowMyTrades offline');
    if (url.origin === 'https://www.bls.gov') throw new Error('BLS offline');
    if (url.origin === 'https://xoomar.com') throw new Error('XOOMAR offline');
    if (url.origin === 'https://www.bea.gov') throw new Error('BEA offline');
    expect(url.origin).toBe('https://www.financecalendar.com');
    if (financeOffline) throw new Error('Finance Calendar offline');
    expect(url.searchParams.get('country')).toBe('US');
    expect(url.searchParams.get('impact')).toBe('high');
    expect(url.searchParams.has('api_key')).toBe(false);
    expect(options?.headers).toMatchObject({ 'X-API-Key': 'test-only-calendar-key' });
    expect(options?.redirect).toBe('error');
    return Response.json({ total: 1, events: [event] });
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await calendar();
  expect(response.events).toHaveLength(1);
  expect((await calendar()).events).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(5);
  vi.advanceTimersByTime(11 * 60_000);
  financeOffline = true;
  const unavailable = await calendar();
  expect(unavailable.message).toContain('showing earlier results');
  expect(unavailable.events).toHaveLength(1);
  expect((await calendar()).message).toContain('unavailable');
  expect(fetcher).toHaveBeenCalledTimes(10);
  vi.advanceTimersByTime(2 * 60 * 60_000);
  const expired = await calendar();
  expect(expired.source).toBe('unavailable');
  expect(expired.events).toEqual([]);
});

const blsIcs = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:bls-cpi\r
SUMMARY:Consumer Price Index\r
DTSTART;TZID=America/New_York:20261105T083000\r
URL:https://www.bls.gov/news.release/cpi.htm\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:bls-untimed\r
SUMMARY:Employment Situation\r
DTSTART;VALUE=DATE:20261106\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:bls-other\r
SUMMARY:Regional wage report\r
DTSTART;TZID=America/New_York:20261107T083000\r
END:VEVENT\r
END:VCALENDAR`;

it('parses only timed, selected BLS releases and converts Eastern time across DST', () => {
  const [result] = parseBlsCalendar(blsIcs, Date.parse('2026-11-04T00:00:00Z'));
  expect(result).toMatchObject({
    id: 'bls:bls-cpi',
    title: 'Consumer Price Index',
    time: '2026-11-05T13:30:00.000Z',
    forecast: '',
    sourceName: 'U.S. Bureau of Labor Statistics',
  });
  expect(
    parseBlsCalendar(
      blsIcs.replace('20261105T083000', '20260705T083000'),
      Date.parse('2026-07-04T00:00:00Z'),
    )[0]?.time,
  ).toBe('2026-07-05T12:30:00.000Z');
  expect(() => parseBlsCalendar('BEGIN:VCALENDAR\nBEGIN:VEVENT')).toThrow('malformed');
});

it('uses the official partial schedule and marks the failed primary source', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  const fetcher = vi.fn(async (input: string) => {
    if (input.includes('showmytrades.com')) return new Response('unavailable', { status: 503 });
    if (input.includes('financecalendar.com')) return new Response('unauthorized', { status: 401 });
    if (!input.includes('bls.gov')) return new Response('unavailable', { status: 503 });
    return new Response(blsIcs, { status: 200, headers: { 'content-type': 'text/calendar' } });
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await calendar();
  expect(response).toMatchObject({
    configured: true,
    source: 'bls',
    staleSources: ['showmytrades', 'financecalendar', 'bea', 'xoomar'],
  });
  expect(response.events).toHaveLength(1);
  expect(response.message).toContain('partial official BLS');
  expect((await calendar()).events).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it('validates the attributed third-source schedule and rejects stale or untimed rows', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const payload = {
    updatedAt: '2026-11-09T12:00:00Z',
    meta: { sourceAttribution: 'Release dates and figures: official agencies.' },
    data: [
      {
        source: 'bls',
        eventName: 'Consumer Price Index',
        importance: 'high',
        scheduledAt: '2026-11-11T13:30:00Z',
        previous: '3.0%',
        forecast: '3.1%',
      },
      { source: 'fed', eventName: 'Minor speech', importance: 'low', scheduledAt: '2026-11-11T15:00:00Z' },
    ],
  };
  expect(parseXoomarCalendar(payload, now)).toMatchObject([
    {
      title: 'Consumer Price Index',
      time: '2026-11-11T13:30:00.000Z',
      forecast: '3.1%',
      previous: '3.0%',
      licenseCredit: 'Data: XOOMAR',
      rightsCredit: 'Release dates and figures: official agencies.',
    },
  ]);
  expect(() => parseXoomarCalendar({ ...payload, updatedAt: '2026-10-01T00:00:00Z' }, now)).toThrow('stale');
  expect(parseXoomarCalendar({ ...payload, updatedAt: String(now - 86_400_000) }, now)).toHaveLength(1);
  expect(() => parseXoomarCalendar({ ...payload, updatedAt: 'not-a-date' }, now)).toThrow('invalid');
  expect(() => parseXoomarCalendar({ ...payload, updatedAt: '2026-11-11T00:00:00Z' }, now)).toThrow('future');
  expect(() =>
    parseXoomarCalendar({ ...payload, data: [{ ...payload.data[0], scheduledAt: null }] }, now),
  ).toThrow('incomplete');
});

it('keeps survey consensus, provider forecast and previous values separate', () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  expect(
    parseTradingEconomicsCalendar(
      [
        {
          CalendarId: '123',
          Date: '2026-11-06T13:30:00',
          Country: 'United States',
          Event: 'Non Farm Payrolls',
          Actual: '',
          Previous: '175K',
          Forecast: '180K',
          TEForecast: '182K',
          Importance: 3,
          DateSpan: '0',
          Source: 'U.S. Bureau of Labor Statistics',
          SourceURL: 'http://www.bls.gov/',
          URL: '/united-states/non-farm-payrolls',
        },
      ],
      now,
    ),
  ).toMatchObject([
    {
      id: 'tradingeconomics:123',
      time: '2026-11-06T13:30:00.000Z',
      title: 'Non Farm Payrolls',
      forecast: '180K',
      providerForecast: '182K',
      previous: '175K',
      sourceUrl: 'https://www.bls.gov/',
      eventUrl: 'https://tradingeconomics.com/united-states/non-farm-payrolls',
    },
  ]);
  expect(() => parseTradingEconomicsCalendar({}, now)).toThrow('malformed');
});

it('keeps the Trading Economics credential out of the URL', async () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    expect(input).not.toContain('test-trading-economics-key');
    expect(new URL(input).searchParams.get('importance')).toBe('3');
    expect(options?.headers).toMatchObject({ Authorization: 'test-trading-economics-key' });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchTradingEconomicsCalendar('test-trading-economics-key', now)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

const showMyTradesNow = Date.parse('2026-11-05T12:00:00Z');
const showMyTradesPayload = {
  server_time: showMyTradesNow / 1000,
  server_time_iso: '2026-11-05T12:00:00Z',
  generated_at: '2026-11-05T11:55:00Z',
  count: 2,
  events: [
    {
      ts: Date.parse('2026-11-05T11:00:00Z') / 1000,
      time: '2026-11-05T11:00:00Z',
      currency: 'USD',
      impact: 'high',
      title: 'Initial Jobless Claims',
      forecast: '220K',
      previous: '218K',
      actual: '216K',
      id: 'usd-initial-jobless-claims.20261105T1100',
      status: 'scheduled',
      moved_from: '',
      confidence: 'official',
    },
    {
      ts: Date.parse('2026-11-06T13:30:00Z') / 1000,
      time: '2026-11-06T13:30:00Z',
      currency: 'USD',
      impact: 'high',
      title: 'Nonfarm Payrolls',
      forecast: '180K',
      previous: '175K',
      actual: '',
      id: 'usd-nonfarm-payrolls.20261106T1330',
      status: 'scheduled',
      moved_from: '',
      confidence: 'sources_agree',
    },
  ],
};

it('maps the free calendar consensus, previous and actual values and retains recent releases', () => {
  expect(parseShowMyTradesCalendar(showMyTradesPayload, showMyTradesNow)).toMatchObject([
    {
      id: 'showmytrades:usd-initial-jobless-claims.20261105T1100',
      forecast: '220K',
      previous: '218K',
      actual: '216K',
      sourceName: 'ShowMyTrades Economic Calendar',
    },
    {
      id: 'showmytrades:usd-nonfarm-payrolls.20261106T1330',
      forecast: '180K',
      previous: '175K',
      actual: '',
    },
  ]);
  expect(() => parseShowMyTradesCalendar({ ...showMyTradesPayload, count: 3 }, showMyTradesNow)).toThrow(
    'incomplete',
  );
  expect(() =>
    parseShowMyTradesCalendar(
      { ...showMyTradesPayload, server_time_iso: '2026-11-05T13:00:00Z' },
      showMyTradesNow,
    ),
  ).toThrow('stale or invalid');
});

it('requests the free high-impact USD calendar without credentials', async () => {
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://showmytrades.com');
    expect(url.searchParams.get('currency')).toBe('USD');
    expect(url.searchParams.get('impact')).toBe('high');
    expect(url.searchParams.get('days')).toBe('30');
    expect(options?.redirect).toBe('error');
    return Response.json({ ...showMyTradesPayload, count: 0, events: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchShowMyTradesCalendar(showMyTradesNow)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('prefers the free consensus feed when paid providers are not configured', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(showMyTradesNow);
  vi.stubEnv('FLUXDESK_FINANCE_CALENDAR_API_KEY', '');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('showmytrades.com')) return Response.json(showMyTradesPayload);
      if (input.includes('bls.gov')) return new Response('forbidden', { status: 403 });
      if (input.includes('bea.gov')) return new Response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
      return Response.json({ updatedAt: '2026-11-05T12:00:00Z', data: [] });
    }),
  );
  const result = await calendar();
  expect(result).toMatchObject({ source: 'showmytrades' });
  expect(result.events).toHaveLength(2);
  expect(result.sources.find((source) => source.id === 'showmytrades')).toMatchObject({
    status: 'live',
    eventCount: 2,
  });
});

it('refreshes pending actuals near release instead of waiting ten minutes, sharing concurrent polls', async () => {
  vi.useFakeTimers(); vi.setSystemTime(showMyTradesNow);
  vi.stubEnv('FLUXDESK_FINANCE_CALENDAR_API_KEY', '');
  const releaseTime = showMyTradesNow + 60_000;
  let actual = '';
  const fetcher = vi.fn(async (input: string) => {
    if (input.includes('showmytrades.com')) return Response.json({ ...showMyTradesPayload,
      server_time: Date.now() / 1000, server_time_iso: new Date(Date.now()).toISOString(), generated_at: new Date(Date.now()).toISOString(), count: 1,
      events: [{ ...showMyTradesPayload.events[0], time: new Date(releaseTime).toISOString(), ts: releaseTime / 1000, actual }] });
    if (input.includes('bea.gov')) return new Response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
    return new Response('unavailable', { status: 503 });
  });
  vi.stubGlobal('fetch', fetcher);
  const module = await import('../server/calendar.ts');
  await module.calendar();
  expect(fetcher).toHaveBeenCalledTimes(4);
  vi.advanceTimersByTime(60_000); actual = '0.3%';
  const results = await Promise.all([module.calendar({ releaseWatch: true }), module.calendar({ releaseWatch: true })]);
  expect(results[0]!.events[0]!.actual).toBe('0.3%');
  expect(results[1]).toEqual(results[0]);
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it('keeps recently released paid-provider data across midnight for actual-value alerts', () => {
  const now = Date.parse('2026-11-06T00:05:00Z');
  expect(parseCalendar({ total: 1, events: [{ ...event, release_at_utc: '2026-11-05T23:59:00Z', actual: '3.1%' }] }, now)[0]?.actual).toBe('3.1%');
  expect(parseTradingEconomicsCalendar([{ CalendarId: 1, Date: '2026-11-05T23:59:00Z', Country: 'United States', Event: 'CPI', Importance: 3, DateSpan: 0, Actual: 0, Forecast: 0.1, Previous: 0.2 }], now)[0]?.actual).toBe('0');
});

it('uses XOOMAR after both first sources reject and reports the source flags', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  const fetcher = vi.fn(async (input: string) => {
    if (input.includes('showmytrades.com')) return new Response('unavailable', { status: 503 });
    if (input.includes('financecalendar.com')) return new Response('unauthorized', { status: 401 });
    if (input.includes('bls.gov')) return new Response('forbidden', { status: 403 });
    if (input.includes('bea.gov')) return new Response('unavailable', { status: 503 });
    expect(input).toBe('https://xoomar.com/api/markets/calendar');
    return Response.json({
      updatedAt: '2026-11-09T12:00:00Z',
      data: [
        {
          source: 'bls',
          eventName: 'Consumer Price Index',
          importance: 'high',
          scheduledAt: '2026-11-11T13:30:00Z',
        },
      ],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await calendar();
  expect(response).toMatchObject({
    configured: true,
    source: 'xoomar',
    staleSources: ['showmytrades', 'financecalendar', 'bls', 'bea'],
  });
  expect(response.events).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(5);
});

const beaIcs = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:bea-gdp\r
SUMMARY:Gross Domestic Product\\, 3rd Quarter (Second Estima\r
 te)\r
DTSTART;VALUE=DATE-TIME:20261112T133000Z\r
URL:https://www.bea.gov/news/schedule\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:bea-pce\r
SUMMARY:Personal Income and Outlays\\, October\r
DTSTART;TZID=America/New_York:20261113T083000\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:regional\r
SUMMARY:Gross Domestic Product by State\r
DTSTART:20261113T133000Z\r
END:VEVENT\r
END:VCALENDAR`;

it('validates the official BEA schedule, folded lines, UTC and Eastern times', () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const events = parseBeaCalendar(beaIcs, now);
  expect(events.map((event) => event.time)).toEqual(['2026-11-12T13:30:00.000Z', '2026-11-13T13:30:00.000Z']);
  expect(events[0]).toMatchObject({
    title: 'Gross Domestic Product, 3rd Quarter (Second Estimate)',
    forecast: '',
    sourceName: 'U.S. Bureau of Economic Analysis',
  });
  expect(parseBeaCalendar(beaIcs.replace('20261112T133000Z', '20260230T133000Z'), now)).toHaveLength(1);
  expect(parseBeaCalendar(beaIcs.replace('20261112T133000Z', '20261112'), now)).toHaveLength(1);
  expect(() => parseBeaCalendar(beaIcs.replace('END:VCALENDAR', ''), now)).toThrow('malformed');
});

it('keeps an empty official backup available and skips an unconfigured keyed provider', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
  vi.stubEnv('FLUXDESK_FINANCE_CALENDAR_API_KEY', '');
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    expect(input).not.toContain('financecalendar.com');
    if (input.includes('showmytrades.com')) return new Response('unavailable', { status: 503 });
    if (input.includes('bls.gov')) return new Response('forbidden', { status: 403 });
    if (input.includes('bea.gov')) {
      expect(options?.headers).toMatchObject({
        accept: 'text/calendar',
        'user-agent': expect.stringContaining('FluxDesk/'),
      });
      return new Response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
    }
    return Response.json({ updatedAt: '2026-11-05T00:00:00Z', data: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  const result = await calendar();
  expect(result).toMatchObject({ source: 'xoomar', events: [], staleSources: ['showmytrades', 'bls'] });
  expect(result.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'financecalendar', status: 'not_configured' }),
      expect.objectContaining({ id: 'bea', status: 'live', eventCount: 0 }),
      expect.objectContaining({ id: 'bls', status: 'unavailable', message: 'HTTP 403' }),
    ]),
  );
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('serves official BLS and BEA schedules if the broad feed fails and redacts credential errors', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
  const secret = 'test-only-secret-not-for-response';
  vi.stubEnv('FLUXDESK_FINANCE_CALENDAR_API_KEY', secret);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('showmytrades.com')) return new Response('unavailable', { status: 503 });
      if (input.includes('financecalendar.com')) throw Error(`header value ${secret} rejected`);
      if (input.includes('bls.gov')) return new Response(blsIcs);
      if (input.includes('bea.gov')) return new Response(beaIcs);
      return new Response('unavailable', { status: 503 });
    }),
  );
  const result = await calendar();
  expect(result.source).toBe('official');
  expect(result.events).toHaveLength(3);
  expect(result.events.map((event) => event.id)).toEqual(['bls:bls-cpi', 'bea:bea-gdp', 'bea:bea-pce']);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(result.sources.find((source) => source.id === 'financecalendar')).toMatchObject({
    status: 'unavailable',
    message: 'Request or response validation failed',
  });
});
