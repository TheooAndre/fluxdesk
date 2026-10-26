import { useQuery } from '@tanstack/react-query';
import { CircleHelp } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Pill, ErrorText, Loading, Card } from './UiPrimitives.tsx';

function CalendarTab() {
  const feed = useQuery({
    queryKey: ['calendar'],
    queryFn: api.calendar,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  return (
    <div className="content-stack">
      <div className="section-intro">
        <h2>High-impact economic calendar</h2>
        <p>
          Major US releases over the next two weeks, shown in your local timezone.
        </p>
      </div>
      <Card title="Upcoming releases" aside={<Pill tone="red">HIGH IMPACT ONLY</Pill>}>
        <button type="button" disabled={feed.isFetching} onClick={() => void feed.refetch()}>
          {feed.isFetching ? 'Refreshing calendar…' : 'Refresh calendar'}
        </button>
        {feed.error && <ErrorText error={feed.error} />}
        {feed.error && feed.data && (
          <p role="status">Refresh failed. Showing the last loaded calendar; dates may have changed.</p>
        )}
        {feed.isLoading ? (
          <Loading />
        ) : !feed.data ? (
          null
        ) : (
          <>
            {feed.data?.message && (
              <div className="notice">
                <CircleHelp size={17} />
                {feed.data.message}
              </div>
            )}
            {feed.data?.events.length ? (
              feed.data.events.map((e) => (
                <div className="event" key={e.id}>
                  <div className="event-date">
                    <strong>
                      {new Date(e.time).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                    </strong>
                    <small>
                      {new Date(e.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </div>
                  <div className="event-info">
                    <b>{e.eventUrl ? <a href={e.eventUrl} target="_blank" rel="noopener noreferrer">{e.title}</a> : e.title}</b>
                    <small>{e.country}{e.status === 'estimated' ? ' · Estimated date' : ''}{e.stale ? ' · Source update delayed' : ''}</small>
                    {e.sourceUrl && <small>Source: <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceName || 'Official release schedule'}</a></small>}
                    {e.licenseCredit && <small>Credit: {e.licenseUrl ? <a href={e.licenseUrl} target="_blank" rel="noopener noreferrer">{e.licenseCredit}</a> : e.licenseCredit}</small>}
                    {e.licenseNotice && <small>{e.licenseNotice}</small>}
                    {e.rightsCredit && <small>Source credit: {e.rightsUrl ? <a href={e.rightsUrl} target="_blank" rel="noopener noreferrer">{e.rightsCredit}</a> : e.rightsCredit}</small>}
                    {e.rightsNotice && <small>{e.rightsNotice}</small>}
                  </div>
                  <div className="event-data">
                    <small>Consensus</small>
                    <strong>{e.forecast || '—'}</strong>
                  </div>
                  <div className="event-data">
                    <small>Prior</small>
                    <strong>{e.previous || '—'}</strong>
                  </div>
                  <Pill tone="red">HIGH</Pill>
                </div>
              ))
            ) : (
              <div className="empty">
                No timed, high-impact US releases available in this window.
              </div>
            )}
          </>
        )}
        <p className="footnote">
          Free calendar data by <a href="https://www.financecalendar.com" target="_blank" rel="noopener noreferrer">Finance Calendar</a>.
          Coverage is selective; consensus is generally unavailable. Check the linked official source before trading.
        </p>
      </Card>
    </div>
  );
}

export default CalendarTab;
