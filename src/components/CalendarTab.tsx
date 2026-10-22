import { useQuery } from '@tanstack/react-query';
import { CircleHelp } from 'lucide-react';
import { api } from '../lib/api.ts';
import { short } from '../lib/format.ts';
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
          Major macro events only. Default scope: United States; scheduled releases shown in your local
          timezone.
        </p>
      </div>
      <Card title="Upcoming releases" aside={<Pill tone="red">HIGH IMPACT ONLY</Pill>}>
        {feed.isLoading ? (
          <Loading />
        ) : feed.error ? (
          <ErrorText error={feed.error} />
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
                    <b>{e.title}</b>
                    <small>{e.country}</small>
                  </div>
                  <div className="event-data">
                    <small>Forecast</small>
                    <strong>{e.forecast || '—'}</strong>
                  </div>
                  <div className="event-data">
                    <small>Previous</small>
                    <strong>{e.previous || '—'}</strong>
                  </div>
                  <Pill tone="red">HIGH</Pill>
                </div>
              ))
            ) : (
              <div className="empty">
                No verified upcoming high-impact events from your configured source.
              </div>
            )}
          </>
        )}
        <p className="footnote">
          Calendar data requires a provider key, stored server-side. The application intentionally never
          inserts hard-coded upcoming releases. Source: Trading Economics API (Importance = 3).
        </p>
      </Card>
    </div>
  );
}

export default CalendarTab;
