import type { EconomicEvent } from '../src/types.ts';
import { UpstreamError } from './market.ts';

export type OfficialCalendar = {
  id: string;
  name: string;
  host: string;
  url: string;
  highImpact: RegExp[];
};

function utcForEastern(value: string): number | null {
  if (!/^\d{8}T\d{6}$/.test(value)) return null;
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(4, 6)),
    day = Number(value.slice(6, 8));
  const hour = Number(value.slice(9, 11)),
    minute = Number(value.slice(11, 13)),
    second = Number(value.slice(13, 15));
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  if (
    !Number.isFinite(target) ||
    new Date(target).toISOString().slice(0, 10) !==
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let timestamp = target + 5 * 3_600_000;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(format.formatToParts(timestamp).map((p) => [p.type, p.value]));
    const wall = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    timestamp += target - wall;
  }
  const parts = Object.fromEntries(format.formatToParts(timestamp).map((p) => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}` === value
    ? timestamp
    : null;
}

function releaseTime(key: string, value: string): number | null {
  if (/(?:^|;)VALUE=DATE(?:;|$)/.test(key)) return null; // Never invent midnight for an untimed release.
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const time = Date.parse(
      value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
    );
    return Number.isFinite(time) &&
      new Date(time).toISOString().replace(/[-:]/g, '').replace('.000', '') === value
      ? time
      : null;
  }
  if (key === 'DTSTART' || /TZID=(?:America\/New_York|US-Eastern)(?:;|$)/i.test(key))
    return utcForEastern(value);
  return null;
}

export function parseOfficialCalendar(
  ical: string,
  source: OfficialCalendar,
  now = Date.now(),
): EconomicEvent[] {
  if (!ical.trim().startsWith('BEGIN:VCALENDAR') || !ical.trim().endsWith('END:VCALENDAR'))
    throw Error('Official calendar response malformed');
  const lines = ical
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const events: EconomicEvent[] = [];
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      if (current) throw Error('Official calendar event incomplete');
      current = {};
      continue;
    }
    if (line !== 'END:VEVENT') {
      if (current && line.includes(':')) {
        const index = line.indexOf(':');
        current[line.slice(0, index).toUpperCase()] = line.slice(index + 1);
      }
      continue;
    }
    if (!current) throw Error('Official calendar event malformed');
    const raw = current;
    current = null;
    const title = raw.SUMMARY?.replace(/\\([,;\\])/g, '$1').trim() ?? '';
    if (!source.highImpact.some((pattern) => pattern.test(title)) || raw.STATUS === 'CANCELLED') continue;
    const start = Object.entries(raw).find(([key]) => key === 'DTSTART' || key.startsWith('DTSTART;'));
    const time = start ? releaseTime(...start) : null;
    if (time === null || time < now || time > now + 14 * 86_400_000) continue;
    const id = raw.UID?.trim() || `${title}:${time}`;
    let url = source.url;
    if (raw.URL) {
      try {
        const candidate = new URL(raw.URL);
        if (
          candidate.protocol === 'https:' &&
          (candidate.hostname === source.host || candidate.hostname.endsWith(`.${source.host}`))
        )
          url = candidate.href;
      } catch {
        /* Keep the official feed link for malformed event URLs. */
      }
    }
    events.push({
      id: `${source.id}:${id}`,
      time: new Date(time).toISOString(),
      country: 'US',
      title,
      importance: 3,
      forecast: '',
      previous: '',
      actual: '',
      status: 'confirmed',
      sourceName: source.name,
      sourceUrl: source.url,
      eventUrl: url,
    });
  }
  if (current) throw Error('Official calendar response incomplete');
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export async function fetchOfficialCalendar(source: OfficialCalendar, now: number): Promise<EconomicEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(source.url, {
      headers: {
        accept: 'text/calendar',
        'user-agent': 'FluxDesk/0.4 (+https://github.com/TheooAndre/fluxdesk)',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new UpstreamError(`Calendar HTTP ${response.status}`, response.status);
    return parseOfficialCalendar(await response.text(), source, now);
  } finally {
    clearTimeout(timeout);
  }
}
