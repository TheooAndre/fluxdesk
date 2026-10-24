export type JournalFill = {
  id: string;
  kind: 'entry' | 'exit';
  time: string;
  quantity: number;
  price: number;
  feeUsd: number;
};
export type JournalLeg = {
  assetId: string;
  instrument: 'linear_perp' | 'spot';
  direction: 'long' | 'short';
  leverage: number;
  stop: number | null;
  target: number | null;
  fills: JournalFill[];
};
export type JournalTrade = {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  date: string;
  title: string;
  account: string;
  strategy: string;
  timeframe: string;
  tags: string[];
  mistakes: string[];
  emotions: string[];
  confidence: number;
  rating: number;
  mfeUsd?: number | null;
  maeUsd?: number | null;
  riskUsd: number | null;
  accountEquityUsd: number | null;
  fundingUsd: number;
  otherCostsUsd: number;
  thesis: string;
  invalidation: string;
  plan: string;
  review: string;
  lessons: string;
  rulesFollowed: boolean;
  screenshotUrls: string[];
  scannerContext: string;
  legs: JournalLeg[];
};
export type JournalDay = {
  date: string;
  revision: number;
  plan: string;
  review: string;
  mood: string;
  lessons: string;
  updatedAt: number;
};
export type JournalData = { schemaVersion: 1; trades: JournalTrade[]; days: JournalDay[] };
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function isDate(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function legMetrics(leg: JournalLeg) {
  let quantity = 0,
    basis = 0,
    gross = 0,
    fees = 0,
    entries = 0,
    exits = 0,
    entryNotional = 0,
    exitNotional = 0;
  const fills = leg.fills
    .map((f, index) => ({ ...f, index }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.index - b.index);
  for (const f of fills) {
    fees += f.feeUsd;
    if (f.kind === 'entry') {
      quantity += f.quantity;
      basis += f.quantity * f.price;
      entries += f.quantity;
      entryNotional += f.quantity * f.price;
    } else {
      if (quantity <= 0 || f.quantity > quantity * (1 + 1e-12))
        throw Error('Exit quantity exceeds the open position');
      const priorQuantity = quantity;
      const average = basis / quantity;
      gross += (leg.direction === 'long' ? 1 : -1) * (f.price - average) * f.quantity;
      basis -= average * f.quantity;
      quantity -= f.quantity;
      exits += f.quantity;
      exitNotional += f.quantity * f.price;
      if (Math.abs(quantity) <= priorQuantity * 1e-12) {
        quantity = 0;
        basis = 0;
      }
    }
  }
  return {
    quantity,
    gross,
    fees,
    entries,
    exits,
    remainingAverage: quantity > 0 ? basis / quantity : null,
    entryAverage: entries ? entryNotional / entries : null,
    exitAverage: exits ? exitNotional / exits : null,
  };
}
export function tradeMetrics(trade: JournalTrade) {
  const legs = trade.legs.map(legMetrics);
  const gross = legs.reduce((s, l) => s + l.gross, 0),
    fees = legs.reduce((s, l) => s + l.fees, 0),
    net = gross - fees + trade.fundingUsd - trade.otherCostsUsd;
  const status = legs.every((l) => !l.entries)
    ? 'planned'
    : legs.every((l) => l.quantity === 0)
      ? 'closed'
      : 'open';
  return {
    gross,
    fees,
    net,
    status,
    rMultiple: trade.riskUsd && status === 'closed' ? net / trade.riskUsd : null,
  };
}
export function validateTrade(input: unknown): JournalTrade {
  const t = input as JournalTrade;
  if (!t || typeof t !== 'object' || !isDate(t.date)) throw Error('Invalid journal date');
  for (const [key, max] of Object.entries({
    title: 160,
    account: 80,
    strategy: 80,
    timeframe: 20,
    thesis: 4000,
    invalidation: 2000,
    plan: 4000,
    review: 6000,
    lessons: 4000,
    scannerContext: 2000,
  }))
    if (typeof t[key as keyof JournalTrade] !== 'string' || String(t[key as keyof JournalTrade]).length > max)
      throw Error('Invalid journal ' + key);
  if (!t.title.trim() || !t.account.trim()) throw Error('Title and account are required');
  for (const list of [t.tags, t.mistakes, t.emotions])
    if (!Array.isArray(list) || list.length > 20 || list.some((x) => typeof x !== 'string' || x.length > 60))
      throw Error('Invalid journal tags');
  if (
    ![t.confidence, t.rating].every((n) => Number.isInteger(n) && n >= 0 && n <= 5) ||
    typeof t.rulesFollowed !== 'boolean'
  )
    throw Error('Invalid journal review score');
  for (const n of [t.mfeUsd, t.maeUsd])
    if (n !== undefined && n !== null && (!Number.isFinite(n) || n < 0 || n > 1e12))
      throw Error('Invalid recorded excursion');
  for (const n of [t.riskUsd, t.accountEquityUsd])
    if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1e12))
      throw Error('Invalid risk/equity amount');
  if (
    !Number.isFinite(t.fundingUsd) ||
    Math.abs(t.fundingUsd) > 1e12 ||
    !Number.isFinite(t.otherCostsUsd) ||
    t.otherCostsUsd < 0 ||
    t.otherCostsUsd > 1e12
  )
    throw Error('Invalid costs/funding');
  if (
    !Array.isArray(t.screenshotUrls) ||
    t.screenshotUrls.length > 6 ||
    t.screenshotUrls.some((s) => {
      try {
        const u = new URL(s);
        return u.protocol !== 'https:' || !!u.username || !!u.password || s.length > 2048;
      } catch {
        return true;
      }
    })
  )
    throw Error('Use HTTPS screenshot links (up to six)');
  if (!Array.isArray(t.legs) || t.legs.length < 1 || t.legs.length > 4)
    throw Error('A trade requires one to four legs');
  for (const l of t.legs) {
    if (
      !l ||
      !/^(binance|hyperliquid|other):[A-Za-z0-9_.-]{1,40}$/.test(l.assetId) ||
      !['linear_perp', 'spot'].includes(l.instrument) ||
      !['long', 'short'].includes(l.direction) ||
      (l.instrument === 'spot' && l.direction === 'short') ||
      !Number.isFinite(l.leverage) ||
      l.leverage < 1 ||
      l.leverage > 200
    )
      throw Error('Invalid journal contract/direction/leverage');
    for (const n of [l.stop, l.target])
      if (n !== null && (!Number.isFinite(n) || n <= 0 || n > 1e15)) throw Error('Invalid stop/target');
    if (!Array.isArray(l.fills) || l.fills.length > 100) throw Error('At most 100 fills per leg');
    const ids = new Set<string>();
    for (const f of l.fills) {
      if (
        !f ||
        typeof f.id !== 'string' ||
        f.id.length > 80 ||
        ids.has(f.id) ||
        !['entry', 'exit'].includes(f.kind) ||
        typeof f.time !== 'string' ||
        !/(Z|[+-]\d\d:\d\d)$/.test(f.time) ||
        !Number.isFinite(Date.parse(f.time)) ||
        ![f.quantity, f.price].every(
          (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e15,
        ) ||
        !Number.isFinite(f.feeUsd) ||
        Math.abs(f.feeUsd) > 1e12
      )
        throw Error('Invalid journal fill');
      ids.add(f.id);
    }
    legMetrics(l);
  }
  return t;
}
export function validateDay(input: unknown): JournalDay {
  const d = input as JournalDay;
  if (!d || !isDate(d.date)) throw Error('Invalid journal date');
  for (const key of ['plan', 'review', 'mood', 'lessons'] as const)
    if (typeof d[key] !== 'string' || d[key].length > 6000) throw Error('Invalid daily note');
  return d;
}
export function validateJournal(data: unknown): JournalData {
  const d = data as JournalData;
  if (
    !d ||
    d.schemaVersion !== 1 ||
    !Array.isArray(d.trades) ||
    d.trades.length > 2000 ||
    !Array.isArray(d.days) ||
    d.days.length > 3660
  )
    throw Error('Invalid journal archive');
  const ids = new Set<string>(),
    dates = new Set<string>();
  for (const t of d.trades) {
    validateTrade(t);
    if (
      typeof t.id !== 'string' ||
      !/^[-a-zA-Z0-9]{1,80}$/.test(t.id) ||
      ids.has(t.id) ||
      !Number.isSafeInteger(t.revision) ||
      t.revision < 1 ||
      ![t.createdAt, t.updatedAt].every(Number.isSafeInteger)
    )
      throw Error('Invalid journal identity');
    ids.add(t.id);
  }
  for (const day of d.days) {
    validateDay(day);
    if (
      dates.has(day.date) ||
      !Number.isSafeInteger(day.revision) ||
      day.revision < 1 ||
      !Number.isSafeInteger(day.updatedAt)
    )
      throw Error('Invalid daily identity');
    dates.add(day.date);
  }
  return d;
}
export function journalAnalytics(trades: JournalTrade[]) {
  const closed = trades
    .map((t) => ({ trade: t, ...tradeMetrics(t) }))
    .filter((t) => t.status === 'closed')
    .sort(
      (a, b) =>
        Math.max(
          ...a.trade.legs.flatMap((l) =>
            l.fills.filter((f) => f.kind === 'exit').map((f) => Date.parse(f.time)),
          ),
        ) -
          Math.max(
            ...b.trade.legs.flatMap((l) =>
              l.fills.filter((f) => f.kind === 'exit').map((f) => Date.parse(f.time)),
            ),
          ) || a.trade.id.localeCompare(b.trade.id),
    );
  let cumulative = 0,
    peak = 0,
    drawdown = 0,
    wins = 0,
    losses = 0,
    winPnl = 0,
    lossPnl = 0,
    fees = 0,
    funding = 0;
  const curve = closed.map((x) => {
    cumulative += x.net;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
    if (x.net > 0) {
      wins++;
      winPnl += x.net;
    }
    if (x.net < 0) {
      losses++;
      lossPnl -= x.net;
    }
    fees += x.fees;
    funding += x.trade.fundingUsd;
    return { value: cumulative };
  });
  const r = closed.map((x) => x.rMultiple).filter((x): x is number => x !== null);
  const groups = (key: (t: JournalTrade) => string | string[]) => {
    const rows = new Map<string, { name: string; count: number; net: number }>();
    for (const x of closed) {
      const keys = key(x.trade);
      for (const name of new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean))) {
        const row = rows.get(name) ?? { name, count: 0, net: 0 };
        row.count++;
        row.net += x.net;
        rows.set(name, row);
      }
    }
    return [...rows.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  };
  return {
    count: closed.length,
    wins,
    losses,
    breakEven: closed.length - wins - losses,
    averageWin: wins ? winPnl / wins : null,
    averageLoss: losses ? -lossPnl / losses : null,
    bestTrade: closed.length ? Math.max(...closed.map((t) => t.net)) : null,
    worstTrade: closed.length ? Math.min(...closed.map((t) => t.net)) : null,
    rulesFollowedRate: closed.length
      ? closed.filter((x) => x.trade.rulesFollowed).length / closed.length
      : null,
    net: cumulative,
    winRate: closed.length ? wins / closed.length : null,
    profitFactor: lossPnl ? winPnl / lossPnl : null,
    expectancy: closed.length ? cumulative / closed.length : null,
    averageR: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null,
    fees,
    funding,
    maxDrawdownUsd: drawdown,
    curve,
    byStrategy: groups((t) => t.strategy || 'Unspecified'),
    byInstruments: groups((t) => t.legs.map((l) => l.assetId).join(' / ')),
    byTags: groups((t) => t.tags),
    byMistakes: groups((t) => t.mistakes),
    byEmotions: groups((t) => t.emotions),
    byRules: groups((t) => (t.rulesFollowed ? 'Followed rules' : 'Rule deviation')),
    byAccount: groups((t) => t.account),
    byWeekday: groups((t) =>
      new Date(t.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    ),
    byDirection: groups((t) => (t.legs.length > 1 ? 'Multi-leg' : t.legs[0]!.direction)),
  };
}
export function newTrade(date = localDate(), assetId = 'binance:BTCUSDT'): JournalTrade {
  return {
    id: '',
    revision: 0,
    createdAt: 0,
    updatedAt: 0,
    date,
    title: '',
    account: 'Main',
    strategy: '',
    timeframe: '1h',
    tags: [],
    mistakes: [],
    emotions: [],
    confidence: 3,
    rating: 0,
    mfeUsd: null,
    maeUsd: null,
    riskUsd: null,
    accountEquityUsd: null,
    fundingUsd: 0,
    otherCostsUsd: 0,
    thesis: '',
    invalidation: '',
    plan: '',
    review: '',
    lessons: '',
    rulesFollowed: true,
    screenshotUrls: [],
    scannerContext: '',
    legs: [
      {
        assetId,
        instrument: 'linear_perp',
        direction: 'long',
        leverage: 1,
        stop: null,
        target: null,
        fills: [],
      },
    ],
  };
}
