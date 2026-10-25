import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type AutoscaleInfo,
} from 'lightweight-charts';
import ChartDrawings from './ChartDrawings.tsx';
import type { Candle, Market } from '../types.ts';
import { chartEma, prepareChartData, chartQuote } from '../lib/chart-data.ts';
import { price } from '../lib/format.ts';

type ChartApis = {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  line: ISeriesApi<'Line'>;
  volume: ISeriesApi<'Histogram'>;
  ema20: ISeriesApi<'Line'>;
  ema50: ISeriesApi<'Line'>;
  annotations: ISeriesApi<'Line'>;
  initialized: boolean;
};
export default function TradingChart({
  data,
  assetId,
  base,
  interval,
  quote,
  now,
  quoteAvailable,
}: {
  data: Candle[];
  quote?: Market;
  now: number;
  quoteAvailable: boolean;
  assetId: string;
  base: string;
  interval: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<ChartApis | null>(null);
  const [drawingApi, setDrawingApi] = useState<ChartApis | null>(null);
  const byTime = useRef(new Map<number, Candle>());
  const [mode, setMode] = useState<'candles' | 'line'>('candles');
  const [indicators, setIndicators] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState<Candle | undefined>();
  const prepared = useMemo(() => {
    try {
      return { data: prepareChartData(data), error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : 'Invalid chart data' };
    }
  }, [data]);
  const valid = prepared.data !== null;
  const live = chartQuote(quote, assetId, now, quoteAvailable);
  useEffect(() => {
    if (!container.current || !valid) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#121c2b' },
        textColor: '#9aafc6',
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { color: '#223044' }, horzLines: { color: '#223044' } },
      rightPriceScale: { borderColor: '#34465b' },
      timeScale: { borderColor: '#34465b', timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#47e5b4',
      downColor: '#ff637a',
      borderVisible: false,
      wickUpColor: '#47e5b4',
      wickDownColor: '#ff637a',
    });
    const line = chart.addSeries(LineSeries, { color: '#47e5b4', lineWidth: 2, visible: false });
    const ema20 = chart.addSeries(LineSeries, {
      color: '#ffc856',
      lineWidth: 1,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const ema50 = chart.addSeries(LineSeries, {
      color: '#bc9cff',
      lineWidth: 1,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const annotations = chart.addSeries(LineSeries, {
      color: 'transparent',
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false },
      1,
    );
    chart.panes()[0]?.setStretchFactor(4);
    chart.panes()[1]?.setStretchFactor(1);
    api.current = { chart, candles, line, volume, ema20, ema50, annotations, initialized: false };
    setDrawingApi(api.current);
    const move = (event: { time?: unknown }) =>
      setHover(typeof event.time === 'number' ? byTime.current.get(event.time) : undefined);
    chart.subscribeCrosshairMove(move);
    return () => {
      chart.unsubscribeCrosshairMove(move);
      // Allow child drawing subscriptions to detach before destroying the chart.
      queueMicrotask(() => chart.remove());
      setDrawingApi(null);
      api.current = null;
    };
  }, [assetId, interval, valid]);
  useEffect(() => {
    const current = api.current,
      points = prepared.data;
    if (!current || !points) return;
    byTime.current = new Map(data.map((bar) => [Math.floor(bar.time / 1000), bar]));
    const range = current.initialized ? current.chart.timeScale().getVisibleRange() : null;
    current.candles.setData(points.candles);
    current.line.setData(points.line);
    current.annotations.setData(points.line);
    current.volume.setData(points.volume);
    current.ema20.setData(chartEma(points.line, 20));
    current.ema50.setData(chartEma(points.line, 50));
    if (range) current.chart.timeScale().setVisibleRange(range);
    else if (points.candles.length) current.chart.timeScale().fitContent();
    current.initialized = true;
  }, [data, prepared, assetId, interval]);
  useEffect(() => {
    api.current?.candles.applyOptions({ visible: mode === 'candles' });
    api.current?.line.applyOptions({ visible: mode === 'line' });
    api.current?.ema20.applyOptions({ visible: indicators });
    api.current?.ema50.applyOptions({ visible: indicators });
  }, [mode, indicators, valid, assetId, interval]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [expanded]);
  const latestLogical = data.length - 1;
  const lastClosedPrice = data.at(-1)?.close ?? 1;
  const livePrice = live?.price,
    liveLabel = live?.label;
  useEffect(() => {
    const current = api.current;
    if (!current) return;
    const currentPrice = livePrice ?? lastClosedPrice;
    const precision = currentPrice >= 100 ? 2 : currentPrice >= 1 ? 4 : currentPrice >= 0.01 ? 5 : 8;
    const format = { type: 'price' as const, precision, minMove: 10 ** -precision };
    current.candles.applyOptions({ priceFormat: format });
    current.line.applyOptions({ priceFormat: format });
    const priceLines: Array<[ISeriesApi<'Candlestick'> | ISeriesApi<'Line'>, IPriceLine]> = [];
    for (const series of [current.candles, current.line]) {
      series.applyOptions({
        lastValueVisible: livePrice === undefined,
        priceLineVisible: livePrice === undefined,
        title: livePrice === undefined ? 'Closed' : '',
      });
      if (livePrice !== undefined)
        priceLines.push([
          series,
          series.createPriceLine({
            price: livePrice,
            color: '#ffc856',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: liveLabel ?? 'Quote',
          }),
        ]);
    }
    current.annotations.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        if (
          !info?.priceRange ||
          livePrice === undefined ||
          (current.chart.timeScale().getVisibleLogicalRange()?.to ?? -1) < latestLogical
        )
          return info;
        return {
          ...info,
          priceRange: {
            minValue: Math.min(info.priceRange.minValue, livePrice),
            maxValue: Math.max(info.priceRange.maxValue, livePrice),
          },
        };
      },
    });
    return () => {
      for (const [series, line] of priceLines) series.removePriceLine(line);
    };
  }, [livePrice, liveLabel, valid, assetId, interval, latestLogical, lastClosedPrice]);
  const shiftRange = (zoom: number, shift = 0) => {
    const chart = api.current?.chart,
      range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !range) return;
    const width = (range.to - range.from) * zoom,
      center = (range.from + range.to) / 2 + shift * (range.to - range.from);
    chart.timeScale().setVisibleLogicalRange({ from: center - width / 2, to: center + width / 2 });
  };
  const candle = hover ?? data.at(-1);
  if (prepared.error)
    return (
      <p className="notice warning" role="alert">
        {prepared.error}. Chart unavailable.
      </p>
    );
  return (
    <div className={'trading-chart ' + (expanded ? 'chart-expanded' : '')}>
      <div className="chart-toolbar" role="group" aria-label="Chart controls">
        <button className="subtle" aria-pressed={mode === 'candles'} onClick={() => setMode('candles')}>
          Candles
        </button>
        <button className="subtle" aria-pressed={mode === 'line'} onClick={() => setMode('line')}>
          Line
        </button>
        <label>
          <input
            type="checkbox"
            checked={indicators}
            onChange={(event) => setIndicators(event.target.checked)}
          />{' '}
          EMA 20 / 50
        </label>
        <button className="subtle" aria-label="Zoom in chart" onClick={() => shiftRange(0.7)}>
          +
        </button>
        <button className="subtle" aria-label="Zoom out chart" onClick={() => shiftRange(1.4)}>
          −
        </button>
        <button className="subtle" aria-label="Pan chart earlier" onClick={() => shiftRange(1, -0.25)}>
          ←
        </button>
        <button className="subtle" aria-label="Pan chart later" onClick={() => shiftRange(1, 0.25)}>
          →
        </button>
        <button className="subtle" onClick={() => api.current?.chart.timeScale().fitContent()}>
          Fit chart
        </button>
        <button className="subtle" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Close expanded chart' : 'Expand chart'}
        </button>
      </div>
      {drawingApi && (
        <ChartDrawings
          key={assetId + ':' + interval}
          chart={drawingApi.chart}
          series={drawingApi.annotations}
          assetId={assetId}
          interval={interval}
        />
      )}
      <div className="chart-live-quote" aria-label="Chart current quote">
        {live ? (
          <>
            <strong>
              {live.label} {price(live.price)}
            </strong>
            <small> · {new Date(live.asOf).toLocaleTimeString()}</small>
          </>
        ) : (
          <span>Live quote unavailable</span>
        )}
      </div>
      <div className="chart-ohlc" aria-label="Candle OHLC values">
        <b>
          {base} · {interval} · {hover ? 'Selected candle' : 'Last closed candle'}
        </b>
        {candle && (
          <>
            <span>O {price(candle.open)}</span>
            <span>H {price(candle.high)}</span>
            <span>L {price(candle.low)}</span>
            <span>C {price(candle.close)}</span>
          </>
        )}
      </div>
      <div
        ref={container}
        className="trading-chart-canvas"
        role="img"
        aria-label={`${base} ${interval} interactive price and volume chart`}
      />
      <p className="chart-caption">
        Completed trade candles · UTC · Volume in {base} units
        {indicators ? ' · EMA 20 / 50' : ''}
      </p>
      <details className="chart-data-table">
        <summary>View candle data · latest 20 bars</summary>
        <div className="market-scroller">
          <table aria-label="Chart candle data">
            <thead>
              <tr>
                <th>UTC open</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Close</th>
                <th>Volume · {base}</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(-20).map((bar) => (
                <tr key={bar.time}>
                  <td>{new Date(bar.time).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{price(bar.open)}</td>
                  <td>{price(bar.high)}</td>
                  <td>{price(bar.low)}</td>
                  <td>{price(bar.close)}</td>
                  <td>{bar.volumeBase.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="chart-attribution">
        TradingView Lightweight Charts™ · Copyright (с) 2025{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
          TradingView, Inc.
        </a>{' '}
        ·{' '}
        <a href="/legal/lightweight-charts-LICENSE.txt" target="_blank" rel="noopener noreferrer">
          Apache 2.0 license
        </a>
      </p>
    </div>
  );
}
