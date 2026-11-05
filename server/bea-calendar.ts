import { fetchOfficialCalendar, parseOfficialCalendar, type OfficialCalendar } from './official-calendar.ts';

// Official schedule-only backup. Only national GDP, PCE and trade releases
// belong in this high-impact view; regional GDP and annual revisions do not.
export const BEA_CALENDAR_URL = 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics';
const source: OfficialCalendar = {
  id: 'bea',
  name: 'U.S. Bureau of Economic Analysis',
  host: 'bea.gov',
  url: BEA_CALENDAR_URL,
  highImpact: [
    /^gross domestic product(?:,|\s*\()/i,
    /^gdp\s*\(/i,
    /^personal income and outlays\b/i,
    /^u\.s\. international trade in goods and services, (?!annual update)/i,
  ],
};

export function parseBeaCalendar(ical: string, now = Date.now()) {
  return parseOfficialCalendar(ical, source, now);
}

export function fetchBeaCalendar(now: number) {
  return fetchOfficialCalendar(source, now);
}
