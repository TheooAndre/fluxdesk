# Charts, favorites and categories

The selected market uses TradingView Lightweight Charts 5.2.1 with FluxDesk's existing venue-specific, completed trade candles. The library is lazy loaded after candles arrive. Candles and line mode, a separate base-volume pane, OHLC crosshair, EMA 20/50 overlays, zoom/pan/fit and expanded view are available. Data refresh preserves the visible time range; changing contract or interval resets the chart. Times are UTC. Latest 20 candles are also available as an accessible table. Current last/mark quotes remain separate from completed trade candles.

Lightweight Charts is Apache 2.0; its license and exact upstream notice are in `public/legal`, with the TradingView attribution link in the chart. This library does not include TradingView account access, Pine Script or the full TradingView product.

“My TradingView” opens the actual TradingView site, where the owner may sign in and choose saved indicators. An optional HTTPS TradingView layout URL can be saved locally on the current device; credentials are never requested or transmitted to FluxDesk. That layout retains its own instrument/timeframe. The separate contract link uses Binance's perpetual symbol convention, preserving contract multipliers; only explicitly verified Hyperliquid mappings are preselected. Unverified Hyperliquid contracts open symbol search without substituting another exchange. TradingView account synchronization inside FluxDesk is out of scope.

The shared watchlist stores up to 50 exact venue contract IDs on the API's persistent volume. Use the star in the market table to add/remove a favorite; the Saved markets panel opens the exact contract. The server must be on the matching branch for `/api/watchlist` to work. Unlike the TradingView shortcut, favorites are shared across authenticated devices.

The Categories tab sits beside Chart and shares category/search/venue filters with the market table. Available themes: L1, AI, Memecoins, Low Float / High FDV, Infra, Dino Coins, Staking, DEX, Yield, RWA, Perps, DePIN, Gaming, NFT, L2 and DeFi. Tags overlap. Counts are venue contracts, not distinct assets or whole-market sector coverage. Perps identifies derivatives-platform project tokens, not every traded perpetual. Dino Coins is an explicitly subjective legacy-project grouping. Staking identifies staking protocols, not every PoS asset.

Classification is a versioned curated map reviewed 4 November 2026. It uses exact supported venue IDs and explicit multiplier aliases. Unknown or ambiguous symbols remain Uncategorized. It is not a live CoinGecko category feed, and it does not calculate whole-market category returns, token market cap or protocol revenue from exchange volume. Category overlap follows the project's primary functions: for example, a generic L1 is not tagged AI merely because AI applications run on it.

### Low Float / High FDV screen

This category is a dated supply-risk screen rather than a permanent project theme. A supported asset is included when all of the following were true in the 4 November 2026 CoinGecko snapshot:

- market cap / fully diluted valuation was below `0.50`;
- fully diluted valuation was at least `$1 billion`; and
- the asset had a finite maximum supply, avoiding false precision for uncapped issuance.

| Symbol | Market cap / FDV | FDV snapshot |
| ------ | ---------------: | -----------: |
| HYPE   |            0.250 |     $81.927B |
| BTW    |            0.150 |      $9.655B |
| SUI    |            0.410 |      $8.921B |
| ASTER  |            0.320 |      $5.436B |
| WLFI   |            0.320 |      $5.093B |
| M      |            0.420 |      $4.696B |
| ONDO   |            0.490 |      $3.867B |
| WLD    |            0.370 |      $3.687B |
| LIT    |            0.255 |      $3.252B |
| ZRO    |            0.400 |      $1.882B |
| JUP    |            0.484 |      $1.694B |
| KITE   |            0.240 |      $1.176B |
| UB     |            0.250 |      $1.043B |

The ratio shows supply overhang, not the timing, recipient or market impact of future unlocks. The snapshot must be reviewed periodically; an asset can enter or leave after price or circulating-supply changes. CoinMarketCap's unlocked-supply metrics and CoinGlass's unlock schedule are cross-checks, not substitutes for current project vesting disclosures. Public X posts and project profiles are discovery signals only; social sentiment alone is not accepted as classification evidence.

Product references reviewed:

| Reference                                                                                                                                                                                                                                      | Useful pattern / follow-up                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [CoinGecko categories](https://www.coingecko.com/en/categories), [category methodology](https://support.coingecko.com/articles/4724540263-categories-tags-methodology) and [CoinMarketCap](https://coinmarketcap.com/cryptocurrency-category/) | Overlapping asset themes and primary-function classification; implemented curated exact-contract filtering                    |
| [CoinGecko low-float study](https://www.coingecko.com/research/publications/low-vs-high-float-crypto) and [current unlocks](https://www.coingecko.com/en/highlights/incoming-token-unlocks)                                                    | Defined low float as market cap / FDV below 0.50 and supplied the dated valuation/unlock cross-check                          |
| [CoinMarketCap unlocked-supply metrics](https://coinmarketcap.com/academy/article/coinmarketcap-adds-new-metrics-to-empower-user-decisions) and [CoinGlass unlock API](https://docs.coinglass.com/reference/coin-unlock-list)                  | Confirmed that unlocked supply and vesting schedules must be reviewed separately from the headline FDV ratio                  |
| [DEX Screener](https://dexscreener.com/)                                                                                                                                                                                                       | Fast search, favorites, venue/pair context and filters; implemented exact-contract favorites and selection                    |
| [CoinGlass](https://www.coinglass.com/currencies/BTC/futures)                                                                                                                                                                                  | Separate funding, open interest and liquidation metrics; current terminal keeps reported intervals and coverage visible       |
| [Velo chart docs](https://velodata.gitbook.io/velo-data/chart-page/chart)                                                                                                                                                                      | Price/volume panes, indicator controls, chart expansion and explicit funding units                                            |
| [Token Terminal metric definitions](https://tokenterminal.com/explorer/metrics)                                                                                                                                                                | Fundamentals require their own definitions and data source; future fees/revenue work must not infer these from trading volume |

Technical references:

- https://tradingview.github.io/lightweight-charts/
- https://github.com/tradingview/lightweight-charts/releases/tag/v5.2.1
- https://www.tradingview.com/charting-library-docs/latest/resources/Frequently-Asked-Questions/
- https://www.tradingview.com/widget-docs/faq/general/

Production builds render only the actual empty/loading UI into HTML, with network fetch disabled during rendering. Vite's compiled entry CSS is embedded before PWA revisions are generated, removing a render-blocking stylesheet request. Browser hydration preserves this markup, then restores a validated deep link and fetches authenticated data. No market snapshots, saved favorites, account layout URLs or environment secrets are embedded in built HTML. Dedicated production browser tests verify the styled HTML appears before the entry script loads and hydrates without replacing the heading.

## Drawing tools (24 October 2026)

Choose Horizontal level and tap/click once in the candle pane; choose Trend line or Rectangle and tap/click two points. Cursor or Escape cancels an unfinished drawing. Colors, individual deletion, Undo and Clear are available. Up to 50 drawings are stored on this device per exact venue contract and timeframe; storage failures are shown. Chart annotations use UTC candle times and prices and redraw with zoom, pan and resize. Both endpoints of a line/rectangle must remain in loaded history to render. They do not sync to a TradingView account or server backups.

Implemented through native Lightweight Charts series primitives, with native pointer taps to avoid the library's double-click suppression dropping rapid drawing points. No paid TradingView product or account access is needed. Reference: https://tradingview.github.io/lightweight-charts/docs/plugins/series-primitives
