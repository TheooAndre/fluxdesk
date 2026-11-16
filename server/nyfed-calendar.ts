import type { EconomicEvent } from '../src/types.ts';
import { utcForEastern } from './official-calendar.ts';
import { UpstreamError } from './market.ts';

export const NYFED_CALENDAR_URL = 'https://www.newyorkfed.org/research/calendars/nationalecon_cal';
const TERMS = 'https://www.newyorkfed.org/privacy/termsofuse';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
// Replace the four BLS schedule families. Other feeds still supply released values/consensus.
const SELECTED = /^(?:Consumer Price Index|Employment Situation|Producer Price Index(?: \(PPI\))?|JOLTS)$/i;

export function parseNyFedCalendar(html: string, now = Date.now()): EconomicEvent[] {
  const heading = html.match(
    />\s*(January|February|March|April|May|June|July|August|September|October|November|December) (20\d{2})\s*</,
  );
  if (
    !heading ||
    !html.includes('ts-accordion-content') ||
    (!html.includes('All Eastern Time') && !html.includes('all Eastern Time'))
  )
    throw Error('New York Fed calendar response malformed');
  const month = MONTHS.indexOf(heading[1]!) + 1;
  const year = Number(heading[2]);
  const expected = new Date(now);
  const monthAt = Date.UTC(year, month - 1);
  const current = Date.UTC(expected.getUTCFullYear(), expected.getUTCMonth());
  const next = Date.UTC(expected.getUTCFullYear(), expected.getUTCMonth() + 1);
  if (monthAt !== current && monthAt !== next) throw Error('New York Fed calendar month is stale');
  const events: EconomicEvent[] = [];
  let recognized = 0;
  for (const cell of html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    const day = cell[1]!.match(/<div[^>]*>\s*(\d{1,2})\s*<br\s*\/?\s*>/i)?.[1];
    if (!day) continue;
    for (const entry of cell[1]!.matchAll(
      /<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>\s*(?:<img\b[^>]*>\s*)?<br\s*\/?\s*>\s*\((\d{2}):(\d{2})\)/gi,
    )) {
      const [, href, title, hour, minute] = entry;
      if (!SELECTED.test(title!)) continue;
      recognized++;
      const wall = `${year}${String(month).padStart(2, '0')}${day.padStart(2, '0')}T${hour}${minute}00`;
      const time = utcForEastern(wall);
      if (time === null) throw Error('New York Fed release time malformed');
      if (time < now || time > now + 14 * 86_400_000) continue;
      const eventUrl = new URL(href!, NYFED_CALENDAR_URL);
      if (eventUrl.protocol !== 'https:') throw Error('New York Fed event URL malformed');
      events.push({
        id: `nyfed:${title}:${time}`,
        title: title!,
        time: new Date(time).toISOString(),
        country: 'US',
        importance: 3,
        forecast: '',
        previous: '',
        actual: '',
        status: 'confirmed',
        sourceName: 'Federal Reserve Bank of New York',
        sourceUrl: NYFED_CALENDAR_URL,
        eventUrl: eventUrl.href,
        licenseCredit: `© ${year} Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org.`,
        licenseUrl: TERMS,
        licenseNotice: 'FluxDesk selects releases and converts Eastern times. Dates are subject to change.',
      });
    }
  }
  // A changed page or challenge must not masquerade as a valid empty calendar.
  if (!recognized) throw Error('New York Fed calendar contains no recognized timed releases');
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchNyFedCalendar(now: number): Promise<EconomicEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  async function read(url: string) {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html',
        'user-agent': 'FluxDesk/0.4 (+https://github.com/TheooAndre/fluxdesk)',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new UpstreamError(`Calendar HTTP ${response.status}`, response.status);
    return response.text();
  }
  try {
    const html = await read(NYFED_CALENDAR_URL);
    const events = parseNyFedCalendar(html, now);
    const end = new Date(now + 14 * 86_400_000);
    if (end.getUTCMonth() !== new Date(now).getUTCMonth()) {
      const next = html.match(/href="(\/research\/calendars\/i-[a-z]{3}\d{2}\.html)">NEXT MONTH/i)?.[1];
      if (!next) throw Error('New York Fed next month link missing');
      events.push(...parseNyFedCalendar(await read(new URL(next, NYFED_CALENDAR_URL).href), now));
    }
    return [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) =>
      a.time.localeCompare(b.time),
    );
  } finally {
    clearTimeout(timeout);
  }
}
