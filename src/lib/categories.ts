import type { Market } from '../types.ts';

export const CATEGORY_REVIEWED_AT = '2026-10-23';
export const CATEGORIES = [
  { id: 'l1', label: 'L1', description: 'Base-layer blockchain networks.' },
  { id: 'ai', label: 'AI', description: 'AI networks, applications and compute.' },
  { id: 'memecoins', label: 'Memecoins', description: 'Community and meme-themed tokens.' },
  { id: 'infra', label: 'Infra', description: 'Oracles, data, interoperability and network infrastructure.' },
  {
    id: 'dino',
    label: 'Dino Coins',
    description:
      'Selected long-established projects from earlier crypto cycles. A subjective community label.',
  },
  {
    id: 'staking',
    label: 'Staking',
    description: 'Staking, liquid-staking and restaking protocols; not every proof-of-stake chain.',
  },
  { id: 'dex', label: 'DEX', description: 'Decentralized trading platforms and aggregators.' },
  { id: 'yield', label: 'Yield', description: 'Yield markets, optimizers and yield-focused protocols.' },
  { id: 'rwa', label: 'RWA', description: 'Asset tokenization and asset-backed token projects.' },
  {
    id: 'perps',
    label: 'Perps',
    description: 'Perpetual/derivatives platforms. This tags the project, not every perpetual contract.',
  },
  {
    id: 'depin',
    label: 'DePIN',
    description: 'Distributed physical infrastructure, storage and compute networks.',
  },
  { id: 'gaming', label: 'Gaming', description: 'Games, virtual worlds and gaming infrastructure.' },
  { id: 'nft', label: 'NFT', description: 'NFT ecosystems, marketplaces and infrastructure.' },
  { id: 'l2', label: 'L2', description: 'Scaling networks and rollup ecosystems.' },
  {
    id: 'defi',
    label: 'DeFi',
    description: 'Decentralized trading, lending, collateral and financial applications.',
  },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]['id'];
export type CategoryFilter = CategoryId | 'all' | 'uncategorized';

// A versioned, curated theme map, not a real-time provider feed or an exhaustive
// market taxonomy. Unknown/new listings stay unclassified. No fuzzy symbol match.
// Definitions/review references: CoinGecko categories and project descriptions.
const groups: Record<CategoryId, string> = {
  l1: 'BTC ETH SOL BNB ADA AVAX DOT NEAR ATOM SUI APT SEI TON TRX XRP HBAR ICP INJ KAS ALGO XLM EGLD VET FTM S EOS NEO ETC BCH LTC DOGE XTZ ROSE IOTA ZEC XMR DASH QTUM FLOW',
  ai: 'TAO FET RENDER RNDR NEAR ICP VIRTUAL AIXBT ARKM WLD IO AIOZ NMR AKT',
  memecoins: 'DOGE SHIB PEPE WIF BONK FLOKI BRETT POPCAT MEW PNUT TRUMP MELANIA BOME TURBO PENGU MOG NEIRO',
  infra: 'LINK GRT PYTH TIA AR FIL ICP NEAR DOT ATOM EIGEN SSV AKT AIOZ RENDER RNDR IO',
  dino: 'BTC ETH LTC XRP BCH ETC ADA XLM TRX NEO DASH ZEC XMR IOTA QTUM DOGE',
  staking: 'LDO RPL JTO ETHFI EIGEN SSV',
  dex: 'UNI CAKE CRV BAL SUSHI RAY JUP AERO OSMO HYPE DYDX GMX GNS PERP DRIFT ASTER RUNE',
  yield: 'PENDLE YFI CVX CRV ENA BIFI FARM FXS',
  rwa: 'ONDO CFG POLYX OM PAXG XAUT',
  perps: 'HYPE DYDX GMX GNS PERP DRIFT SNX ASTER AEVO JUP',
  depin: 'RENDER RNDR FIL AR HNT IOTX AKT AIOZ IO',
  gaming: 'IMX GALA AXS SAND MANA ILV YGG ENJ RON MAGIC PIXEL APE',
  nft: 'APE BLUR LOOKS RARE TNSR PENGU ENJ IMX MANA SAND GALA FLOW',
  l2: 'ARB OP STRK ZK MANTA METIS MNT POL MATIC IMX LRC STX',
  defi: 'AAVE COMP MORPHO MKR SKY ENA PENDLE CRV CVX SNX UNI CAKE BAL SUSHI RAY JUP AERO DYDX GMX HYPE DRIFT LDO JTO ETHFI EIGEN SSV FRAX FXS RUNE OSMO GNS PERP ASTER AEVO YFI BIFI FARM',
};
const aliases: Record<string, string> = {
  'binance:1000PEPEUSDT': 'PEPE',
  'hyperliquid:kPEPE': 'PEPE',
  'binance:1000BONKUSDT': 'BONK',
  'hyperliquid:kBONK': 'BONK',
  'binance:1000SHIBUSDT': 'SHIB',
  'hyperliquid:kSHIB': 'SHIB',
  'binance:1000FLOKIUSDT': 'FLOKI',
  'hyperliquid:kFLOKI': 'FLOKI',
  'binance:1000RATSUSDT': 'RATS',
  'binance:1000SATSUSDT': 'SATS',
  'binance:1000LUNCUSDT': 'LUNC',
};
const assignments = new Map<string, CategoryId[]>();
for (const category of CATEGORIES)
  for (const token of groups[category.id].split(' ')) {
    for (const id of [`binance:${token}USDT`, `hyperliquid:${token}`])
      assignments.set(id, [...(assignments.get(id) ?? []), category.id]);
  }
// Explicit handling of the gaming BEAM ticker; do not classify the different
// privacy project's generic BEAM symbol through a global symbol substitution.
assignments.set('binance:BEAMXUSDT', ['gaming']);
export function marketCategories(market: Pick<Market, 'id'>): readonly CategoryId[] {
  const canonical = aliases[market.id];
  return assignments.get(canonical ? `binance:${canonical}USDT` : market.id) ?? [];
}
export function matchesCategory(market: Pick<Market, 'id'>, filter: CategoryFilter): boolean {
  const categories = marketCategories(market);
  return (
    filter === 'all' || (filter === 'uncategorized' ? categories.length === 0 : categories.includes(filter))
  );
}
export function categoryLabel(filter: CategoryFilter): string {
  return filter === 'all'
    ? 'All sectors'
    : filter === 'uncategorized'
      ? 'Uncategorized'
      : (CATEGORIES.find((c) => c.id === filter)?.label ?? 'Uncategorized');
}
