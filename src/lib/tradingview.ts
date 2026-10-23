// Saved layouts stay on TradingView. Never accept credentials or arbitrary hosts.
export function tradingViewLayout(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (
      url.protocol !== 'https:' ||
      !['www.tradingview.com', 'tradingview.com'].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/chart\/[A-Za-z0-9]+\/?$/.test(url.pathname)
    )
      return null;
    return `https://www.tradingview.com${url.pathname.replace(/\/?$/, '/')}`;
  } catch {
    return null;
  }
}
export function tradingViewChart(assetId: string, interval: string): string {
  const url = new URL('https://www.tradingview.com/chart/');
  const binance = /^binance:([A-Z0-9]+USDT)$/.exec(assetId);
  // Retain multiplier symbols exactly. Other Hyperliquid listings need explicit
  // provider mapping; do not silently substitute another venue or spot market.
  const symbol = binance
    ? `BINANCE:${binance[1]}.P`
    : assetId === 'hyperliquid:BTC'
      ? 'HYPERLIQUID:BTCUSDC.P'
      : null;
  if (symbol) url.searchParams.set('symbol', symbol);
  const minutes = /^(\d+)(m|h)$/.exec(interval);
  if (minutes) url.searchParams.set('interval', String(Number(minutes[1]) * (minutes[2] === 'h' ? 60 : 1)));
  else if (/^1[dDMW]$/.test(interval)) url.searchParams.set('interval', interval.toUpperCase());
  return url.href;
}
