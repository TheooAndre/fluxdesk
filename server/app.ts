import { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { authenticateGateway, GatewayAuthError } from './gateway.ts';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { marketSnapshot, candles, assetIdentity, enrichedOpenInterest, perpetualQuote } from './market.ts';
import { pairStats, priceLevels } from '../src/engine/stats.ts';
import { detectSignals } from '../src/engine/signals.ts';
import { cachedSignalScan, cachedCorrelationScan } from './scanners.ts';
import type { AlertKind, AlertRule, Market } from '../src/types.ts';
import { snapshot, addAlert, deleteAlert, subscribe } from './store.ts';
import { liqEvents, liqSummary, liquidityStatus } from './liquidations.ts';
import { calendar } from './calendar.ts';
import { vapidKey } from './notifications.ts';
import { ResearchRequestError, listResearchDatasets, fetchAndSaveResearchDataset, executeResearchBacktest } from './research/api.ts';
const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
};
async function body(req: IncomingMessage) {
  let raw = '';
  for await (const c of req) {
    raw += c;
    if (raw.length > 16_384) throw Error('Request too large');
  }
  try {
    const value: unknown = JSON.parse(raw || '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error();
    return value as Record<string, unknown>;
  } catch {
    throw Error('Invalid JSON request body');
  }
}
function validatedId(id: string) {
  assetIdentity(id);
  return id;
}
function positiveNumber(s: unknown, max = 1e15) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > max) throw Error('Invalid positive threshold');
  return n;
}
function writeSecurityHeaders(res: ServerResponse) {
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}
function checkOrigin(req: IncomingMessage, expectedHost: string, gatewayProtected: boolean) {
  if (!['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method ?? '')) return;
  const o = req.headers.origin;
  // For gateway-protected remote APIs, browser mutations MUST come from the
  // Vercel HTTPS origin. Local CLI / LAN clients retain the v0.3 behavior.
  if (gatewayProtected && !o) throw Error('Cross-origin mutation blocked');
  if (o) {
    const parsed = new URL(o);
    if (parsed.host !== expectedHost || (gatewayProtected && parsed.protocol !== 'https:'))
      throw Error('Cross-origin mutation blocked');
  }
}
export async function handler(req: IncomingMessage, res: ServerResponse) {
  writeSecurityHeaders(res);
  let path = '';
  try {
    const access = authenticateGateway(req);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    path = url.pathname;
    if (path.startsWith('/api/')) {
      const allowed =
        path === '/api/research/datasets'
          ? ['GET', 'POST']
          : path === '/api/research/backtests'
            ? ['POST']
            : path === '/api/alerts'
              ? ['GET', 'POST']
          : path.startsWith('/api/alerts/')
            ? ['DELETE']
            : path === '/api/push/subscribe'
              ? ['POST']
              : ['GET'];
      if (!allowed.includes(req.method ?? '')) {
        res.setHeader('allow', allowed.join(', '));
        return json(res, { error: 'Method not allowed' }, 405);
      }
    }
    checkOrigin(req, access.originHost, access.gatewayProtected);
    if (path === '/api/research/datasets' && req.method === 'GET')
      return json(res, await listResearchDatasets());
    if (path === '/api/research/datasets' && req.method === 'POST')
      return json(res, { dataset: await fetchAndSaveResearchDataset(await body(req)) }, 201);
    if (path === '/api/research/backtests' && req.method === 'POST')
      return json(res, await executeResearchBacktest(await body(req)));
    if (path === '/api/health')
      return json(res, { ok: true, at: Date.now(), liquidations: liquidityStatus() });
    if (path === '/api/markets') {
      const snapshot = await marketSnapshot();
      const list = snapshot.assets;
      const benchmarks: Record<string, Market> = Object.fromEntries(list.map((market) => [market.id, market]));
      return json(res, { ...snapshot, benchmarks });
    }
    if (path === '/api/perpetual')
      return json(res, await perpetualQuote(validatedId(url.searchParams.get('asset') ?? '')));
    if (path === '/api/candles') {
      const asset = validatedId(url.searchParams.get('asset') ?? '');
      const tf = url.searchParams.get('tf') ?? '1h';
      return json(res, {
        asset,
        tf,
        candles: await candles(asset, tf, Number(url.searchParams.get('limit') ?? 140)),
      });
    }
    if (path === '/api/asset') {
      const id = validatedId(url.searchParams.get('asset') ?? ''),
        tf = url.searchParams.get('tf') ?? '1h';
      const major = url.searchParams.get('major') ?? 'binance:BTCUSDT';
      if (major !== 'USD') validatedId(major);
      const { venue } = assetIdentity(id);
      const assets = (await marketSnapshot()).assets;
      const majorAsset = major === 'USD' ? null : assets.find((x) => x.id === major);
      if (major !== 'USD' && !majorAsset) throw Error('Benchmark not available in current market universe');
      const [bars, oi, referenceOI] = await Promise.all([
        candles(id, tf, 150),
        enrichedOpenInterest(id),
        majorAsset ? enrichedOpenInterest(majorAsset.id) : Promise.resolve(null),
      ]);
      const histogram = new Map<number, { notionalUsd: number; count: number }>();
      for (const e of liqEvents(id, 60)) {
        const binWidth = Math.max(0.00001, (bars.at(-1)?.close ?? e.price) * 0.0025);
        const bin = Math.round(e.price / binWidth) * binWidth;
        const item = histogram.get(bin) ?? { notionalUsd: 0, count: 0 };
        item.notionalUsd += e.notionalUsd;
        item.count++;
        histogram.set(bin, item);
      }
      const liquidationPriceClusters = [...histogram]
        .map(([price, v]) => ({ price, ...v }))
        .sort((a, b) => b.notionalUsd - a.notionalUsd)
        .slice(0, 8);
      return json(res, {
        id,
        tf,
        openInterestUsd: oi,
        benchmarkOI: majorAsset
          ? {
              id: majorAsset.id,
              usd: referenceOI,
              ratio: oi !== null && referenceOI ? oi / referenceOI : null,
              venueMatched: majorAsset.venue === venue,
            }
          : null,
        liquidationPriceClusters,
        levels: priceLevels(bars),
        signals: detectSignals(bars),
        candles: bars,
        liquidations: liqSummary(id),
      });
    }
    if (path === '/api/signals')
      return json(res, await cachedSignalScan(validatedId(url.searchParams.get('asset') ?? '')));
    if (path === '/api/pair') {
      const a = validatedId(url.searchParams.get('a') ?? ''),
        b = validatedId(url.searchParams.get('b') ?? ''),
        tf = url.searchParams.get('tf') ?? '1h';
      if (a === b) throw Error('Choose distinct assets');
      if (assetIdentity(a).venue !== assetIdentity(b).venue)
        throw Error('Choose same-venue assets for pair analysis');
      const [aa, bb] = await Promise.all([candles(a, tf, 160), candles(b, tf, 160)]);
      return json(res, { stats: pairStats(a, b, aa, bb, 80) });
    }
    if (path === '/api/correlations') {
      const asset = validatedId(url.searchParams.get('asset') ?? ''),
        tf = url.searchParams.get('tf') ?? '1h',
        min = Number(url.searchParams.get('minimum') ?? 0.87);
      if (!Number.isFinite(min) || min < 0.5 || min > 0.999) throw Error('Invalid correlation threshold');
      return json(res, await cachedCorrelationScan(asset, tf, min));
    }
    if (path === '/api/liquidations') {
      const asset = url.searchParams.get('asset');
      const minutes = Number(url.searchParams.get('minutes') ?? 5);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) throw Error('Invalid liquidation window');
      if (asset) return json(res, liqSummary(validatedId(asset), minutes));
      return json(res, { events: liqEvents(undefined, minutes).slice(-100), status: liquidityStatus() });
    }
    if (path === '/api/calendar') return json(res, await calendar());
    if (path === '/api/alerts' && req.method === 'GET')
      return json(res, { alerts: snapshot().alerts, events: snapshot().events });
    if (path === '/api/alerts' && req.method === 'POST') {
      const o = await body(req),
        kind = o.kind as AlertKind;
      if (!['price', 'volume', 'liquidation'].includes(kind)) throw Error('Invalid alert type');
      const assetId = validatedId(String(o.assetId ?? ''));
      if (kind === 'liquidation' && !assetId.startsWith('binance:'))
        throw Error('Public market-wide Hyperliquid liquidations are not available from this connector');
      const threshold = positiveNumber(o.threshold);
      if (kind === 'volume' && threshold > 100_000) throw Error('Volume threshold too high');
      if (o.direction !== undefined && o.direction !== 'above' && o.direction !== 'below')
        throw Error('Invalid alert direction');
      const direction = o.direction === 'below' ? 'below' : 'above';
      const a: AlertRule = {
        id: randomUUID(),
        assetId,
        kind,
        threshold,
        direction,
        enabled: true,
        createdAt: Date.now(),
      };
      await addAlert(a);
      return json(res, { alert: a }, 201);
    }
    if (path.startsWith('/api/alerts/') && req.method === 'DELETE') {
      const id = path.slice('/api/alerts/'.length);
      if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid alert ID');
      await deleteAlert(id);
      return json(res, { ok: true });
    }
    if (path === '/api/push/key') return json(res, { key: vapidKey() });
    if (path === '/api/push/subscribe' && req.method === 'POST') {
      if (!vapidKey()) throw Error('VAPID is not configured');
      const data = await body(req);
      const keys = data.keys as { p256dh?: unknown; auth?: unknown } | undefined;
      const endpoint = String(data.endpoint ?? '');
      if (
        !endpoint.startsWith('https://') ||
        endpoint.length > 2048 ||
        typeof keys?.p256dh !== 'string' ||
        typeof keys.auth !== 'string'
      )
        throw Error('Invalid PushSubscription');
      await subscribe({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
      return json(res, { ok: true }, 201);
    }
    if (path.startsWith('/api/')) return json(res, { error: 'Unknown endpoint' }, 404);
    // Serve compiled Vite app under the same origin in self-hosted deployment.
    const root = resolve('dist'),
      target = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
    if (!target.startsWith(root + sep) && target !== root) throw Error('Invalid path');
    let file = target;
    try {
      const info = await stat(file);
      if (!info.isFile()) file = resolve(root, 'index.html');
    } catch {
      file = resolve(root, 'index.html');
    }
    const ext = extname(file),
      mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.woff2': 'font/woff2',
      };
    res.setHeader('content-type', mime[ext] ?? 'application/octet-stream');
    res.setHeader(
      'cache-control',
      file.includes('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache',
    );
    res.end(await readFile(file));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Request failed', req.method, path, message);
    return json(
      res,
      { error: message },
      error instanceof GatewayAuthError
        ? error.status
        : error instanceof ResearchRequestError
        ? error.status
        : /Invalid|Unsupported|Choose|threshold|Too |limit|blocked|Cross-origin|requires|not available|large/i.test(
        message,
      )
        ? 400
        : 503,
    );
  }
}
