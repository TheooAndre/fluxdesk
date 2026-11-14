export type Venue = 'binance' | 'hyperliquid';
export type FeedStatus = {
  venue: Venue;
  status: 'live' | 'stale' | 'unavailable';
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  ageMs: number | null;
  markets: number;
  message?: string;
};
export type MarketSnapshot = {
  assets: Market[];
  feeds: FeedStatus[];
  asOf: number | null;
  checkedAt: number;
};
export type BenchmarkId = 'USD' | string;
export type { CandleInterval as Interval } from './engine/intervals.ts';
export type PerpetualQuote = {
  assetId: string;
  status: 'live' | 'stale' | 'unavailable';
  markPrice: number | null;
  referencePrice: number | null;
  referenceKind: 'index' | 'oracle';
  premiumPct: number | null;
  fundingRate: number | null;
  intervalHours: number | null;
  nextFundingAt: number | null;
  nextFundingSource: 'exchange' | 'hourly_schedule' | null;
  asOf: number | null;
  timestampBasis: 'exchange' | 'received';
};
export type FloatEvidence = {
  coingeckoId: string;
  marketCapToFdv: number;
  fdvUsd: number;
  maxSupply: number;
  asOf: number;
};
export type Market = {
  floatScreen?: { status: 'fresh' | 'stale' | 'unavailable' | 'unknown'; evidence?: FloatEvidence };
  id: string;
  venue: Venue;
  symbol: string;
  base: string;
  price: number;
  // Optional for compatibility with an older independently deployed backend.
  priceBasis?: 'last' | 'mark';
  timestampBasis?: 'exchange' | 'received';
  previous24h: number;
  return24h: number;
  volumeUsd24h: number;
  oiUsd: number | null;
  asOf: number;
};
export type Candle = {
  time: number;
  closeTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBase: number;
  volumeUsd: number;
};
export type PriceLevel = {
  kind: 'support' | 'resistance' | 'observed_liquidation' | 'indicative_leverage';
  price: number;
  note: string;
  notionalUsd?: number;
};
export type SignalModel = 'sfp' | 'msb' | 'pullback' | 'range';
export type ScannedSignal = EntrySignal & { timeframe: import('./engine/intervals.ts').CandleInterval };
export type EntrySignal = {
  model: SignalModel;
  direction: 'long' | 'short';
  label: string;
  detail: string;
  trigger: number;
  stop: number;
  target: number;
  rr: number;
  barTime: number;
  barCloseTime?: number;
  status: 'candidate';
};
export type PairStats = {
  a: string;
  b: string;
  correlation: number;
  beta: number;
  zScore: number;
  halfLifeBars: number | null;
  points: number;
  spreadSeries: { time: number; z: number }[];
  note: string;
};
export type PairCandidate = { id: string; correlation: number; zScore: number; beta: number; points: number };
export type AlertKind = 'price' | 'price_range' | 'volume' | 'liquidation' | 'macro' | 'technical';
export type AlertCondition =
  | {
      kind: 'technical';
      name: string;
      assetIds: string[];
      match: 'all' | 'any';
      conditions: import('./lib/advanced-alert.ts').TechnicalCondition[];
      cooldownMinutes: number;
      technicalState?: Record<string, import('./lib/advanced-alert.ts').TechnicalObservation>;
    }
  | {
      kind: 'price_range';
      lowerPrice: number;
      upperPrice: number;
      lastTriggeredAboveAt?: number;
      lastTriggeredBelowAt?: number;
    }
  | {
      kind: 'macro';
      /** Missing on legacy rules, which remain advance reminders. */
      timing?: 'before' | 'release';
      leadMinutes: import('./lib/macro-alert.ts').MacroLeadMinutes | 0;
      lastTriggeredEventId?: string;
      triggeredEvents?: { id: string; at: number }[];
      armedAt?: number;
    }
  | {
      kind: Exclude<AlertKind, 'price_range' | 'macro' | 'technical'>;
      threshold: number;
      direction?: 'above' | 'below';
      referencePrice?: number;
    };
export type AlertInput = { assetId: string; repeat?: boolean } & AlertCondition;
export type AlertRule = AlertCondition & {
  id: string;
  assetId: string;
  enabled: boolean;
  /** Repeating alerts keep monitoring after a trigger. Missing means one shot. */
  repeat?: boolean;
  ownerId?: string;
  createdAt: number;
  lastTriggeredAt?: number;
};
export type AlertEvent = {
  id: string;
  assetId: string;
  kind: AlertKind;
  message: string;
  time: number;
  ownerId?: string;
  ruleId?: string;
  macro?: { scheduledAt: number; firstActualObservedAt?: number };
  delivery?: { expiresAt: number; devices: PushDelivery[] };
};
export type PushDelivery = {
  deviceId: string;
  status: 'pending' | 'sending' | 'retrying' | 'accepted' | 'failed' | 'expired' | 'interrupted';
  attempts: number;
  nextAttemptAt: number;
  attemptedAt?: number;
  acceptedAt?: number;
  error?: string;
};
export type EconomicEvent = {
  id: string;
  time: string;
  country: string;
  title: string;
  importance: 3;
  /** Survey consensus forecast. */
  forecast: string;
  /** Provider/model forecast when it is distinct from survey consensus. */
  providerForecast?: string;
  previous: string;
  actual: string;
  /** First observed supplied actual; not the agency publication time. */
  firstActualObservedAt?: number;
  status?: string;
  stale?: boolean;
  sourceName?: string;
  sourceUrl?: string;
  eventUrl?: string;
  licenseCredit?: string;
  licenseUrl?: string;
  licenseNotice?: string;
  rightsCredit?: string;
  rightsUrl?: string;
  rightsNotice?: string;
};
export type LiquidationEvent = {
  id: string;
  assetId: string;
  time: number;
  price: number;
  notionalUsd: number;
  side: 'longs' | 'shorts';
  source: 'binance_snapshot';
};
