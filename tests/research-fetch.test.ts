import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHistoricalDataset } from '../server/research/fetch.ts';
import { validateHistoricalDataset } from '../server/research/datasets.ts';

const hour = 3_600_000;
const now = Date.UTC(2026, 9, 22, 12, 30);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('historical exchange pagination', () => {
  it('fetches exactly the requested closed Binance bars over page boundaries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const u = new URL(String(input));
      const first = Number(u.searchParams.get('startTime'));
      const count = Number(u.searchParams.get('limit'));
      const last = Number(u.searchParams.get('endTime'));
      expect(last).toBe(first + count * hour - 1);
      const rows = Array.from({ length: count }, (_, i) => {
        const time = first + i * hour;
        return [time, '100', '101', '99', '100', '4', time + hour - 1, '400'];
      });
      return Response.json(rows);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchHistoricalDataset('binance:BTCUSDT', '1h', 520, now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.candles).toHaveLength(520);
    expect(result.candles.at(-1)!.closeTime).toBe(Date.UTC(2026, 9, 22, 12) - 1);
    expect(result.capturedAt).toBe(now);
    expect(() => validateHistoricalDataset(result)).not.toThrow();
  });

  it('rejects incomplete or shifted exchange pages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const u = new URL(String(input));
      const first = Number(u.searchParams.get('startTime'));
      const count = Number(u.searchParams.get('limit')) - 1;
      return Response.json(Array.from({ length: count }, (_, i) => {
        const time = first + i * hour;
        return [time, '100', '101', '99', '100', '4', time + hour - 1, '400'];
      }));
    });
    await expect(fetchHistoricalDataset('binance:BTCUSDT', '1h', 80, now))
      .rejects.toThrow('missing, duplicate or misaligned');
  });

  it('maps Hyperliquid close times and labels estimated historical quote notional in documentation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const mock = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body)) as {
        type: string;
        req: { startTime: number; endTime: number; interval: string };
      };
      expect(request.type).toBe('candleSnapshot');
      expect(request.req.interval).toBe('1h');
      return Response.json(Array.from({ length: 80 }, (_, i) => {
        const time = request.req.startTime + i * hour;
        return { t: time, T: time + hour - 1,
          o: '100', h: '105', l: '95', c: '102', v: '2' };
      }));
    });
    vi.stubGlobal('fetch', mock);
    const result = await fetchHistoricalDataset('hyperliquid:BTC', '1h', 80, now);
    expect(result.candles[0]!.volumeUsd).toBe(202);
    expect(result.venue).toBe('hyperliquid');
    expect(() => validateHistoricalDataset(result)).not.toThrow();
  });

  it('enforces bounded windows and rejects unsupported intervals before fetching', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    await expect(fetchHistoricalDataset('binance:BTCUSDT', '1M', 100, now))
      .rejects.toThrow('supports');
    await expect(fetchHistoricalDataset('binance:BTCUSDT', '1h', 3001, now))
      .rejects.toThrow('80 to 3000');
    expect(mock).not.toHaveBeenCalled();
  });
});
