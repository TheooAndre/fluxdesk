import type { CandlestickData, HistogramData, LineData, UTCTimestamp } from 'lightweight-charts';
import type { Candle, Market } from '../types.ts';

/** Quote overlay only: never replace a trade candle with a last/mark snapshot. */
export function chartQuote(quote: Market | undefined, assetId: string, now: number, available: boolean) {
  if (
    !quote ||
    quote.id !== assetId ||
    !Number.isFinite(quote.price) ||
    quote.price <= 0 ||
    !Number.isFinite(quote.asOf) ||
    now - quote.asOf < -5000 ||
    now - quote.asOf > 45000 ||
    !available ||
    (quote.priceBasis !== 'last' && quote.priceBasis !== 'mark')
  )
    return null;
  return { price: quote.price, label: quote.priceBasis === 'mark' ? 'Mark' : 'Last trade', asOf: quote.asOf };
}

export function prepareChartData(bars: Candle[]) {
  let previous = -1;
  const candles: CandlestickData<UTCTimestamp>[] = [];
  const line: LineData<UTCTimestamp>[] = [];
  const volume: HistogramData<UTCTimestamp>[] = [];
  for (const bar of bars) {
    const time = Math.floor(bar.time / 1000) as UTCTimestamp;
    if (
      ![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volumeBase].every(Number.isFinite) ||
      bar.time < 0 ||
      time <= previous ||
      Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.volumeBase < 0
    )
      throw Error('Chart candles are invalid or not in strictly increasing order');
    previous = time;
    candles.push({ time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    line.push({ time, value: bar.close });
    volume.push({ time, value: bar.volumeBase, color: bar.close >= bar.open ? '#47e5b477' : '#ff637a77' });
  }
  return { candles, line, volume };
}
/** Fixed-period EMA, seeded only after a full past window. No future samples. */
export function chartEma(data: LineData<UTCTimestamp>[], period: number): LineData<UTCTimestamp>[] {
  if (!Number.isInteger(period) || period < 1) throw Error('Invalid EMA period');
  if (data.length < period) return [];
  let value = data.slice(0, period).reduce((sum, point) => sum + point.value, 0) / period;
  const output: LineData<UTCTimestamp>[] = [{ time: data[period - 1]!.time, value }];
  const weight = 2 / (period + 1);
  for (let i = period; i < data.length; i++) {
    value += weight * (data[i]!.value - value);
    output.push({ time: data[i]!.time, value });
  }
  return output;
}
