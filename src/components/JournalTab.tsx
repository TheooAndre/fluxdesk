import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import {
  newTrade,
  localDate,
  tradeMetrics,
  journalAnalytics,
  validateTrade,
  type JournalTrade,
  type JournalDay,
} from '../journal/model.ts';
import {
  downloadJson,
  downloadText,
  importJournalFile,
  csvTemplate,
  exportSummaryCsv,
} from '../journal/files.ts';
import { money } from '../lib/format.ts';
import { Card } from './UiPrimitives.tsx';
import JournalTradeEditor from './JournalTradeEditor.tsx';
import LineChart from './LineChart.tsx';
import './Workspaces.css';
const DRAFT = 'fluxdesk.journal.draft.v1';
function initialDraft() {
  try {
    const seed = sessionStorage.getItem('fluxdesk.journal.pair');
    if (seed) {
      sessionStorage.removeItem('fluxdesk.journal.pair');
      const s = JSON.parse(seed);
      const t = newTrade(localDate(), s.y);
      t.title = `${s.y.split(':')[1]} / ${s.x.split(':')[1]} stat-arb`;
      t.strategy = 'Stat-arb';
      t.timeframe = s.timeframe;
      t.legs[0]!.direction = s.z >= 0 ? 'short' : 'long';
      t.legs.push({ ...t.legs[0]!, assetId: s.x, direction: s.z >= 0 ? 'long' : 'short', fills: [] });
      t.scannerContext = `z=${s.z}, beta=${s.beta}, EG=${s.level}, signal UTC=${new Date(s.signalTime).toISOString()}. Notional y:x=1:${s.beta}. Quantity/risk must be supplied.`;
      return t;
    }
    const raw = localStorage.getItem(DRAFT);
    return raw ? (JSON.parse(raw) as JournalTrade) : null;
  } catch {
    return null;
  }
}
const loadDay = (date: string) => {
  try {
    return JSON.parse(localStorage.getItem('fluxdesk.journal.day.' + date) ?? 'null') as JournalDay | null;
  } catch {
    return null;
  }
};
const emptyDay = (date: string): JournalDay => ({
  date,
  revision: 0,
  plan: '',
  review: '',
  mood: '',
  lessons: '',
  updatedAt: 0,
});
export default function JournalTab() {
  const qc = useQueryClient(),
    query = useQuery({ queryKey: ['journal'], queryFn: api.journal, retry: 0, refetchOnWindowFocus: true });
  const [date, setDate] = useState(localDate()),
    [draft, setDraft] = useState<JournalTrade | null>(initialDraft),
    [dayDraft, setDay] = useState<JournalDay | null>(() => loadDay(localDate())),
    [message, setMessage] = useState(''),
    [search, setSearch] = useState(''),
    [account, setAccount] = useState('all'),
    [status, setStatus] = useState('all'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [strategy, setStrategy] = useState('all'),
    [onlyDate, setOnlyDate] = useState(false),
    [view, setView] = useState<'trades' | 'analytics' | 'calendar'>('trades'),
    [limit, setLimit] = useState(30);
  const data = query.data,
    trades = data?.trades ?? [],
    day = dayDraft?.date === date ? dayDraft : (data?.days.find((d) => d.date === date) ?? emptyDay(date));
  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(DRAFT, JSON.stringify(draft));
    } catch {
      setMessage('Device draft could not be saved. Keep this page open until you save to the server.');
    }
  }, [draft]);
  useEffect(() => {
    if (!dayDraft) return;
    try {
      localStorage.setItem('fluxdesk.journal.day.' + dayDraft.date, JSON.stringify(dayDraft));
    } catch {
      setMessage('Daily draft could not be saved on this device. Save before leaving.');
    }
  }, [dayDraft]);
  const changeDate = (value: string) => {
    setDate(value);
    setDay(loadDay(value));
  };

  const save = useMutation({
    mutationFn: api.saveJournalTrade,
    onSuccess: () => {
      setDraft(null);
      localStorage.removeItem(DRAFT);
      setMessage('Trade saved on your server.');
      void qc.invalidateQueries({ queryKey: ['journal'] });
    },
    onError: (e) => setMessage(e.message),
  });
  const saveDaily = useMutation({
    mutationFn: api.saveJournalDay,
    onSuccess: ({ day: saved }) => {
      localStorage.removeItem('fluxdesk.journal.day.' + saved.date);
      setDay(null);
      setMessage('Daily note saved.');
      void qc.invalidateQueries({ queryKey: ['journal'] });
    },
    onError: (e) => setMessage(e.message),
  });
  const remove = useMutation({
    mutationFn: (t: JournalTrade) => api.deleteJournalTrade(t.id, t.revision),
    onSuccess: () => {
      setMessage('Trade deleted.');
      void qc.invalidateQueries({ queryKey: ['journal'] });
    },
    onError: (e) => setMessage(e.message),
  });
  const importing = useMutation({
    mutationFn: api.importJournal,
    onSuccess: (r) => {
      setMessage(`Imported ${r.imported}; skipped ${r.skipped} identical records.`);
      void qc.invalidateQueries({ queryKey: ['journal'] });
    },
    onError: (e) => setMessage(e.message),
  });
  const filtered = useMemo(
    () =>
      trades
        .filter(
          (t) =>
            (!onlyDate || t.date === date) &&
            (!from || t.date >= from) &&
            (!to || t.date <= to) &&
            (account === 'all' || t.account === account) &&
            (strategy === 'all' || t.strategy === strategy) &&
            (status === 'all' || tradeMetrics(t).status === status) &&
            (!search ||
              [
                t.title,
                t.strategy,
                t.review,
                t.tags.join(' '),
                t.mistakes.join(' '),
                t.emotions.join(' '),
                ...t.legs.map((l) => l.assetId),
              ]
                .join(' ')
                .toLowerCase()
                .includes(search.toLowerCase())),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt),
    [trades, onlyDate, date, from, to, account, strategy, status, search],
  );
  const stats = useMemo(() => journalAnalytics(filtered), [filtered]);
  const busy =
    save.isPending || saveDaily.isPending || remove.isPending || importing.isPending || !navigator.onLine;
  const edit = (t: JournalTrade) => {
    if (draft && !window.confirm('Replace the editor draft?')) return;
    setDraft(structuredClone(t));
  };
  const month = date.slice(0, 7),
    firstDay = new Date(month + '-01T12:00:00Z'),
    daysInMonth = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, 0)).getUTCDate();
  const dailyPnl = trades.reduce<Record<string, { net: number; count: number }>>((out, t) => {
    const r = tradeMetrics(t);
    const d = (out[t.date] ??= { net: 0, count: 0 });
    d.count++;
    if (r.status === 'closed') d.net += r.net;
    return out;
  }, {});
  return (
    <div className="content-stack workspace">
      <Card title="Crypto trade journal">
        <p>
          Dated trades, multi-leg positions, execution costs, habits and daily reviews. Stored on your
          persistent server and included in encrypted backups.
        </p>
        <div className="workspace-controls">
          <label>
            Selected journal date
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) {
                  changeDate(e.target.value);
                }
              }}
            />
          </label>
          <button className="primary" onClick={() => edit(newTrade(date))}>
            New trade
          </button>
          <button
            className="secondary"
            onClick={() => {
              changeDate(localDate());
            }}
          >
            Today
          </button>
          <button className="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Refresh journal
          </button>
        </div>
        {query.isPending && <p>Loading journal…</p>}
        {query.error && (
          <p role="alert" className="notice warning">
            {query.error.message}. Existing device drafts are preserved.
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <div className="workspace-controls">
          <button onClick={() => setView('trades')} aria-pressed={view === 'trades'}>
            Trade log
          </button>
          <button onClick={() => setView('analytics')} aria-pressed={view === 'analytics'}>
            Journal analytics
          </button>
          <button onClick={() => setView('calendar')} aria-pressed={view === 'calendar'}>
            P&L calendar
          </button>
        </div>
      </Card>
      {draft && (
        <button
          className="subtle"
          onClick={() => {
            if (window.confirm('Discard the saved device trade draft?')) {
              setDraft(null);
              localStorage.removeItem(DRAFT);
            }
          }}
        >
          Discard device draft
        </button>
      )}
      {draft?.id && (
        <button
          className="secondary"
          disabled={query.isFetching}
          onClick={async () => {
            if (!window.confirm('Replace your draft with the latest saved trade?')) return;
            const fresh = await query.refetch();
            const latest = fresh.data?.trades.find((t) => t.id === draft.id);
            if (latest) setDraft(structuredClone(latest));
            else setMessage('Trade is unavailable; your draft is preserved.');
          }}
        >
          Reload saved trade
        </button>
      )}
      {draft && (
        <JournalTradeEditor
          key={`${draft.id}:${draft.revision}`}
          trade={draft}
          setTrade={setDraft}
          busy={busy || query.isError || query.isPending}
          onCancel={() => setDraft(null)}
          onSave={() => {
            try {
              const clean = {
                ...draft,
                tags: draft.tags.map((s) => s.trim()).filter(Boolean),
                mistakes: draft.mistakes.map((s) => s.trim()).filter(Boolean),
                emotions: draft.emotions.map((s) => s.trim()).filter(Boolean),
                screenshotUrls: draft.screenshotUrls.map((s) => s.trim()).filter(Boolean),
              };
              validateTrade(clean);
              save.mutate(clean);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        />
      )}
      <Card title={`Daily journal · ${date}`}>
        <div className="workspace-grid">
          {(['plan', 'mood', 'review', 'lessons'] as const).map((key) => (
            <label key={key}>
              {
                {
                  plan: 'Daily plan / risk rules',
                  mood: 'Mood / mental state',
                  review: 'Daily review',
                  lessons: 'Daily lessons / next action',
                }[key]
              }
              <textarea value={day[key]} onChange={(e) => setDay({ ...day, [key]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="primary" disabled={busy || !data} onClick={() => saveDaily.mutate(day)}>
          Save daily note
        </button>
        <button
          className="subtle"
          disabled={query.isFetching}
          onClick={async () => {
            if (!window.confirm('Replace the device daily draft with the saved note?')) return;
            const fresh = await query.refetch();
            if (fresh.data) {
              localStorage.removeItem('fluxdesk.journal.day.' + date);
              setDay(null);
            }
          }}
        >
          Reload saved daily note
        </button>
        <p className="footnote">
          Dates use the device’s calendar; fill timestamps are stored with UTC offsets. Daily notes save
          separately from trades.
        </p>
      </Card>
      <Card title="Filter journal">
        <div className="workspace-controls">
          <label>
            Search trades
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(30);
              }}
            />
          </label>
          <label>
            Account filter
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="all">All accounts</option>
              {[...new Set(trades.map((t) => t.account))].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            Strategy filter
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="all">All strategies</option>
              {[...new Set(trades.map((t) => t.strategy).filter(Boolean))].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            Status filter
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="planned">Planned</option>
              <option value="open">Open / partial</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label>
            From date
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To date
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            <span>
              <input type="checkbox" checked={onlyDate} onChange={(e) => setOnlyDate(e.target.checked)} />{' '}
              Selected day only
            </span>
          </label>
        </div>
      </Card>
      {view === 'trades' && (
        <Card title={`Trade log · ${filtered.length}`}>
          {filtered.slice(0, limit).map((t) => {
            const m = tradeMetrics(t);
            return (
              <article className="journal-trade" key={t.id}>
                <header>
                  <div>
                    <strong>{t.title}</strong>
                    <p>
                      {t.date} · {t.account} · {t.strategy || 'No setup'} · {m.status.toUpperCase()}
                    </p>
                    <small>{t.legs.map((l) => `${l.assetId} ${l.direction}`).join(' / ')}</small>
                  </div>
                  <div>
                    <b className={m.net >= 0 ? 'positive' : 'negative'}>{money(m.net, false)}</b>
                    <small className="small-label">
                      {m.status === 'closed' ? 'Net P&L' : 'Recorded realized cash only'} · R{' '}
                      {m.rMultiple?.toFixed(2) ?? 'N/A'}
                    </small>
                  </div>
                </header>
                <p>{t.tags.join(' · ')}</p>
                <details>
                  <summary>Trade notes and cost breakdown</summary>
                  <dl>
                    <dt>Gross realized</dt>
                    <dd>{money(m.gross, false)}</dd>
                    <dt>Fees / funding / other costs</dt>
                    <dd>
                      {money(m.fees, false)} / {money(t.fundingUsd, false)} / {money(t.otherCostsUsd, false)}
                    </dd>
                    <dt>Recorded MFE / MAE (USD)</dt>
                    <dd>
                      {t.mfeUsd == null ? 'N/A' : money(t.mfeUsd, false)} /{' '}
                      {t.maeUsd == null ? 'N/A' : money(t.maeUsd, false)}
                    </dd>
                    <dt>Rules followed / rating</dt>
                    <dd>
                      {t.rulesFollowed ? 'Yes' : 'No'} / {t.rating}/5
                    </dd>
                  </dl>
                  {[t.thesis, t.invalidation, t.plan, t.review, t.lessons].filter(Boolean).map((text, i) => (
                    <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
                      {text}
                    </p>
                  ))}
                  <p>
                    Mistakes: {t.mistakes.join(', ') || 'None recorded'} · Emotions:{' '}
                    {t.emotions.join(', ') || 'None recorded'}
                  </p>
                  {t.screenshotUrls.map((url, i) => (
                    <p key={url}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        Screenshot / chart {i + 1}
                      </a>
                    </p>
                  ))}
                </details>
                <div className="workspace-controls">
                  <button className="secondary" onClick={() => edit(t)}>
                    Edit trade
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      edit({
                        ...structuredClone(t),
                        id: '',
                        revision: 0,
                        createdAt: 0,
                        updatedAt: 0,
                        date,
                        title: t.title + ' · copy',
                      })
                    }
                  >
                    Duplicate trade
                  </button>
                  <button
                    className="subtle"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Delete this trade permanently?')) remove.mutate(t);
                    }}
                  >
                    Delete trade
                  </button>
                </div>
              </article>
            );
          })}
          {!filtered.length && (
            <p className="empty">No journal trades match. Add a trade or import your journal.</p>
          )}
          {filtered.length > limit && (
            <button onClick={() => setLimit((n) => n + 30)}>Show more journal trades</button>
          )}
        </Card>
      )}
      {view === 'analytics' && (
        <Card title="Closed-trade performance">
          <div className="workspace-metrics">
            {Object.entries({
              'Closed trades': String(stats.count),
              'Net P&L': money(stats.net, false),
              'Win rate': stats.winRate === null ? 'N/A' : (stats.winRate * 100).toFixed(1) + '%',
              'Profit factor': stats.profitFactor?.toFixed(2) ?? 'N/A (no losses)',
              'Expectancy / trade': stats.expectancy === null ? 'N/A' : money(stats.expectancy, false),
              'Average R': stats.averageR?.toFixed(2) ?? 'N/A',
              'Max P&L drawdown': money(stats.maxDrawdownUsd, false),
              'Recorded fees': money(stats.fees, false),
              'Funding cash flow': money(stats.funding, false),
              'Average win': stats.averageWin === null ? 'N/A' : money(stats.averageWin, false),
              'Average loss': stats.averageLoss === null ? 'N/A' : money(stats.averageLoss, false),
              'Best / worst trade':
                stats.bestTrade === null
                  ? 'N/A'
                  : money(stats.bestTrade, false) + ' / ' + money(stats.worstTrade!, false),
              'Rules followed':
                stats.rulesFollowedRate === null ? 'N/A' : (stats.rulesFollowedRate * 100).toFixed(1) + '%',
            }).map(([name, value]) => (
              <div key={name}>
                <small>{name}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <h4>Cumulative closed-trade net P&L</h4>
          <LineChart data={[{ value: 0 }, ...stats.curve]} height={180} />
          <p className="footnote">
            Closed trades only, ordered by final exit time. P&L curve and USD drawdown are not account
            equity/returns: deposits, withdrawals and open-position marks are excluded. Calendar buckets use
            your chosen journal date. Filters apply to these statistics. Tags/mistakes/emotions can overlap,
            so those rows are not additive. MFE/MAE are optional manual observations, not inferred from fills.
          </p>
          <div className="workspace-grid">
            {Object.entries({
              'By strategy': stats.byStrategy,
              'By instruments': stats.byInstruments,
              'By tag': stats.byTags,
              'By mistake': stats.byMistakes,
              'By emotion': stats.byEmotions,
              'By discipline': stats.byRules,
              'By account': stats.byAccount,
              'By weekday': stats.byWeekday,
              'By direction': stats.byDirection,
            }).map(([label, rows]) => (
              <div key={label}>
                <h4>{label}</h4>
                {rows.map((r) => (
                  <p key={r.name}>
                    {r.name}: {r.count} trade(s) · {money(r.net, false)}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
      {view === 'calendar' && (
        <Card title={`P&L calendar · ${month}`}>
          <p className="footnote">
            All recorded accounts; journal-date buckets. Closed P&L only; counts include plans/open trades.
            Choose a day for its notes, then use Selected day only in the log.
          </p>
          <div className="journal-calendar">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <b key={d}>{d}</b>
            ))}
            {Array.from({ length: firstDay.getUTCDay() }, (_, i) => (
              <span key={'blank' + i} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = month + '-' + String(i + 1).padStart(2, '0'),
                row = dailyPnl[d];
              return (
                <button
                  key={d}
                  aria-label={`Journal day ${d}`}
                  aria-pressed={d === date}
                  onClick={() => {
                    changeDate(d);
                  }}
                >
                  {i + 1}
                  <small className={(row?.net ?? 0) >= 0 ? 'positive' : 'negative'}>
                    {row ? money(row.net) : '—'}
                  </small>
                  <small>{row?.count ?? 0} trades</small>
                </button>
              );
            })}
          </div>
        </Card>
      )}
      <Card title="Import, export & backup">
        <div className="workspace-controls">
          <button
            className="secondary"
            disabled={!data}
            onClick={() => downloadJson('fluxdesk-journal-' + localDate() + '.json', data, true)}
          >
            Export complete journal JSON
          </button>
          <button
            className="secondary"
            disabled={!data}
            onClick={() => downloadText('fluxdesk-journal-summary.csv', exportSummaryCsv(filtered))}
          >
            Export filtered summary CSV
          </button>
          <button
            className="secondary"
            onClick={() => downloadText('fluxdesk-journal-import-template.csv', csvTemplate())}
          >
            Download trade CSV template
          </button>
          <label>
            Import journal JSON / template CSV
            <input
              type="file"
              accept=".json,.csv"
              disabled={busy || !data}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  if (file.size > 4 * 1024 * 1024) throw Error('Import limit is 4 MiB');
                  const value = await importJournalFile(await file.text(), file.name);
                  if (
                    window.confirm(
                      `Import ${value.trades.length} trades and ${value.days.length} daily notes? Existing differing IDs/dates will be rejected.`,
                    )
                  )
                    importing.mutate(value);
                } catch (err) {
                  setMessage((err as Error).message);
                }
              }}
            />
          </label>
        </div>
        <p className="footnote">
          JSON is a complete portable backup; CSV summary is for analysis, not restoration. Imports are atomic
          and duplicate-aware. CSV uses the supplied single-leg schema; use JSON for multi-leg trades. Limits:
          2000 trades, 3660 daily notes, 4 MiB journal, 4 MiB per import. Exchange API auto-sync and image
          uploads are not connected; use HTTPS chart/screenshot links. Save failures keep your device trade
          draft.
        </p>
      </Card>
    </div>
  );
}
