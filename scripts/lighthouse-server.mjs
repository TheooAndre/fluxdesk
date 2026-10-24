// Deterministic production-build Lighthouse harness. This is NOT a live feed.
// It serves the compiled PWA and explicitly unavailable market-data fixtures,
// avoiding misleading fabricated quotes and missing-API console errors.
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('dist');
const port = 4179;
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
};
const emptyMarkets = {
  assets: [], benchmarks: {}, asOf: null, checkedAt: Date.now(),
  feeds: ['binance', 'hyperliquid'].map((venue) => ({
    venue, status: 'unavailable', markets: 0, ageMs: null,
    lastSuccessAt: null, lastAttemptAt: null,
    message: 'Live data deliberately disabled during Lighthouse audit',
  })),
};
const emptyAsset = {
  id: 'binance:BTCUSDT', tf: '1h', openInterestUsd: null, benchmarkOI: null,
  liquidationPriceClusters: [], levels: [], signals: [], candles: [],
  liquidations: { observedUsd: null, count: 0, events: [],
    available: false, windowCovered: false, coverage: 'unavailable' },
};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  res.setHeader('cache-control', 'no-store');
  if (pathname.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    const body = pathname === '/api/markets' ? emptyMarkets
      : pathname === '/api/asset' ? emptyAsset
      : pathname === '/api/watchlist' ? { assetIds: [] }
      : pathname === '/api/alerts' ? { alerts: [], events: [] }
      : pathname === '/api/calendar' ? { configured: false, events: [], message: 'Not configured' }
      : pathname === '/api/signals' ? { asset: emptyAsset.id, checkedAt: Date.now(), inspected: [], failed: [], signals: [] }
      : pathname === '/api/correlations' ? { asset: emptyAsset.id, checkedAt: Date.now(), candidates: [], screened: 0, checked: 0, failed: [] }
      : { error: 'Not provided by audit fixture' };
    res.end(JSON.stringify(body));
    return;
  }
  try {
    const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!target.startsWith(root + sep)) throw new Error('Invalid path');
    const info = await stat(target);
    if (!info.isFile()) throw new Error('Not a file');
    res.setHeader('content-type', contentTypes[extname(target)] ?? 'application/octet-stream');
    const bytes = await readFile(target);
    res.setHeader('vary', 'Accept-Encoding');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && /\.(html|js|css|json|svg|webmanifest)$/.test(target)) {
      res.setHeader('content-encoding', 'gzip');
      res.end(gzipSync(bytes));
    } else res.end(bytes);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log('Lighthouse fixture ready at http://127.0.0.1:' + port);
});
