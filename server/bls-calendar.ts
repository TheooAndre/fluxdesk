import { fetchOfficialCalendar, parseOfficialCalendar, type OfficialCalendar } from './official-calendar.ts';

// Schedule-only: no forecasts, prior values or non-BLS releases.
export const BLS_CALENDAR_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';
const source: OfficialCalendar = {
  id: 'bls',
  name: 'U.S. Bureau of Labor Statistics',
  host: 'bls.gov',
  url: BLS_CALENDAR_URL,
  highImpact: [
    /^consumer price index\b/i,
    /^employment situation\b/i,
    /^producer price index\b/i,
    /^job openings and labor turnover survey\b/i,
  ],
};

export function parseBlsCalendar(ical: string, now = Date.now()) {
  return parseOfficialCalendar(ical, source, now);
}

export function fetchBlsCalendar(now: number) {
  return fetchOfficialCalendar(source, now);
}
