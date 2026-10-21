import { marketSnapshot } from '../server/market.ts';
import { scanSignals } from '../server/scanners.ts';

// Public market data only. No credentials, exchange orders, or persisted alert rules.
const snapshot = await marketSnapshot();
const asset =
  process.argv[2] ??
  snapshot.assets.find(
    (x) => x.base === 'BTC' && snapshot.feeds.some((f) => f.venue === x.venue && f.status === 'live'),
  )?.id;
const scan = asset ? await scanSignals(asset) : null;
const report = {
  checkedAt: new Date().toISOString(),
  feeds: snapshot.feeds,
  asset: asset ?? null,
  intervals: scan?.inspected ?? [],
  failedIntervals: scan?.failed ?? [],
  note: 'Connectivity and input-integrity check only. Does not validate a trading edge or order execution.',
};
console.log(JSON.stringify(report, null, 2));
if (snapshot.feeds.some((x) => x.status !== 'live') || !scan || scan.failed.length) process.exitCode = 1;
