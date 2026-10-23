# Charts, favorites and categories

The selected market uses TradingView Lightweight Charts 5.2.1 with FluxDesk's existing venue-specific, completed trade candles. The library is lazy loaded after candles arrive. Candles and line mode, a separate base-volume pane, OHLC crosshair, EMA 20/50 overlays, zoom/pan/fit and expanded view are available. Data refresh preserves the visible time range; changing contract or interval resets the chart. Times are UTC. Latest 20 candles are also available as an accessible table. Current last/mark quotes remain separate from completed trade candles.

Lightweight Charts is Apache 2.0; its license and exact upstream notice are in `public/legal`, with the TradingView attribution link in the chart. This library does not include TradingView account access, Pine Script or the full TradingView product.

“My TradingView” opens the actual TradingView site, where the owner may sign in and choose saved indicators. An optional HTTPS TradingView layout URL can be saved locally on the current device; credentials are never requested or transmitted to FluxDesk. That layout retains its own instrument/timeframe. The separate contract link uses Binance's perpetual symbol convention, preserving contract multipliers; only explicitly verified Hyperliquid mappings are preselected. Unverified Hyperliquid contracts open symbol search without substituting another exchange. TradingView account synchronization inside FluxDesk is out of scope.

The shared watchlist stores up to 50 exact venue contract IDs on the API's persistent volume. Use the star in the market table to add/remove a favorite; the Saved markets panel opens the exact contract. The server must be on the matching branch for `/api/watchlist` to work. Unlike the TradingView shortcut, favorites are shared across authenticated devices.

The Categories tab sits beside Chart and shares category/search/venue filters with the market table. Available themes: L1, AI, Memecoins, Infra, Dino Coins, Staking, DEX, Yield, RWA, Perps, DePIN, Gaming, NFT, L2 and DeFi. Tags overlap. Counts are venue contracts, not distinct assets or whole-market sector coverage. Perps identifies derivatives-platform project tokens, not every traded perpetual. Dino Coins is an explicitly subjective legacy-project grouping. Staking identifies staking protocols, not every PoS asset.

Classification is a versioned curated map reviewed 23 October 2026. It uses exact supported venue IDs and explicit multiplier aliases. Unknown or ambiguous symbols remain Uncategorized. It is not a live CoinGecko category feed, and it does not calculate whole-market category returns, token market cap or protocol revenue from exchange volume.

Product references reviewed:

| Reference | Useful pattern / follow-up |
| --- | --- |
| [CoinGecko](https://www.coingecko.com/en/categories) and [CoinMarketCap](https://coinmarketcap.com/cryptocurrency-category/) | Overlapping asset themes and drill-down discovery; implemented curated contract filtering |
| [DEX Screener](https://dexscreener.com/) | Fast search, favorites, venue/pair context and filters; implemented exact-contract favorites and selection |
| [CoinGlass](https://www.coinglass.com/currencies/BTC/futures) | Separate funding, open interest and liquidation metrics; current terminal keeps reported intervals and coverage visible |
| [Velo chart docs](https://velodata.gitbook.io/velo-data/chart-page/chart) | Price/volume panes, indicator controls, chart expansion and explicit funding units |
| [Token Terminal metric definitions](https://tokenterminal.com/explorer/metrics) | Fundamentals require their own definitions and data source; future fees/revenue work must not infer these from trading volume |

Technical references:

- https://tradingview.github.io/lightweight-charts/
- https://github.com/tradingview/lightweight-charts/releases/tag/v5.2.1
- https://www.tradingview.com/charting-library-docs/latest/resources/Frequently-Asked-Questions/
- https://www.tradingview.com/widget-docs/faq/general/

Production builds render only the actual empty/loading UI into HTML, with network fetch disabled during rendering. Browser hydration preserves this markup, then restores a validated deep link and fetches authenticated data. No market snapshots, saved favorites, account layout URLs or environment secrets are embedded in built HTML. Dedicated production browser tests verify HTML appears before the entry script loads and hydrates without replacing the heading.
