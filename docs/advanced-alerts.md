# Advanced alerts

The Alerts tab separates Quick, Advanced and Macro rules. Advanced rules use the same authenticated, per-account alert storage and existing push delivery. Existing price, range, volume, liquidation and macro rules retain their behavior.

## Builder

- 32 supported indicator families. Every selectable signal has an executable local implementation; no paid indicator API, Drakdoo account, subscription, or external script evaluation is used.
- Up to five conditions with AND or OR matching. Each condition has its own timeframe: 1m, 5m, 15m, 30m, 1h, 4h, or 1d.
- A selected market or a saved basket of up to 20 Binance/Hyperliquid markets. Top-20 shortcuts take the highest 24h-volume markets at creation time; these are fixed baskets, not an automatically changing whole-exchange subscription.
- RSI reversal, trend-plus-momentum, and volume-backed breakout presets. All settings remain editable.
- One shot by default; a triggered rule is disabled and can be reactivated. Keep-active rules use independent per-market cooldowns of 1m, 5m, 15m, 30m, 1h, 4h, or one day.
- Up to 20 advanced rules per account, within the existing total alert cap.

## Signal semantics

Only completed, contiguous candles returned by the existing validated market connector are evaluated. The first successful observation arms the rule without alerting on an existing condition. State conditions trigger on false-to-true transitions. Event conditions trigger on a new matching closed candle. A multi-timeframe event keeps its identity when faster filters change; the same slow crossover is not sent again.

Rule observations, event identity and per-market cooldowns persist atomically with recorded notifications in `state.json`. Restarting retains dedupe state; manual reactivation clears it and begins a new arming window. A failed/stale history fetch preserves the previous matched state and records a visible data-unavailable status. It never becomes a false condition or a fabricated recovery crossover.

The scanner runs about once per minute. A scan shares histories across rules, starts at most 40 distinct histories, allows at most four upstream requests concurrently, and starts no additional requests after its 40-second work budget. Oldest unchecked markets are prioritized on the next scan. Large baskets or many users may wait for later scans. These are closed-candle alerts, not tick-level execution guarantees.

## Calculations and bounds

RSI and ATR use Wilder smoothing, EMA starts with a simple average, and Bollinger bands use population standard deviation. Stochastic RSI uses RSI followed by a stochastic window and K/D simple smoothing. MACD uses fast and slow EMAs. Ichimoku cloud breakouts compare against spans displaced by the base length, never future data. DMI/ADX uses Wilder smoothing. Volume change uses base volume against the prior closed-bar average; Hyperliquid's estimated notional volume is not treated as an exact trade total.

Support/resistance and Fibonacci use rolling prior-window highs/lows. RSI divergence uses two strict price pivots, each confirmed by two subsequent closed candles, within an 80-bar search. TD setup reports exactly nine closes relative to four bars earlier; this is the setup count, not the separate 13-count countdown. Candlestick shapes are mechanical OHLC patterns without an additional prior-trend filter. These definitions are documented FluxDesk implementations and can differ from another provider's settings.

Parameter limits, signal IDs, timeframes, market IDs, condition/basket size, and combined warm-up length are validated on the server before saving. Unknown parameters and client-supplied monitoring state are rejected or discarded. Numeric values must be finite. No notification webhooks or arbitrary scripts were introduced.

## Reference reviewed

Drakdoo's official [plan comparison](https://www.drakdoo.com/pricing/), [alert catalog](https://www.drakdoo.com/alerts/), and [condition builder description](https://www.drakdoo.com/faq/scripting/basics/) were reviewed on 2026-11-13. Its current public top plan is Whale. FluxDesk implements the listed subset with its existing crypto feeds and delivery, rather than claiming identical proprietary indicators, Forex coverage, or delivery-channel parity.
