import type { Market } from '../types.ts';

export const CATEGORY_REVIEWED_AT = '2026-11-04';
export const LOW_FLOAT_HIGH_FDV_CRITERIA = {
  marketCapToFdvExclusive: 0.5,
  minimumFdvUsdInclusive: 1_000_000_000,
  finiteMaxSupplyOnly: true,
} as const;

// Dated market-data screen, deliberately separate from the project's thematic
// tags below. Values are a CoinGecko snapshot reviewed on CATEGORY_REVIEWED_AT
// and must be refreshed as prices, circulating supply and unlocks change.
export const LOW_FLOAT_HIGH_FDV_SNAPSHOT = [
  {
    symbol: 'HYPE',
    coingeckoId: 'hyperliquid',
    marketCapToFdv: 0.25,
    fdvUsd: 81_927_000_000,
    maxSupply: 1_000_000_000,
  },
  {
    symbol: 'BTW',
    coingeckoId: 'bitway',
    marketCapToFdv: 0.15,
    fdvUsd: 9_655_000_000,
    maxSupply: 10_000_000_000,
  },
  {
    symbol: 'SUI',
    coingeckoId: 'sui',
    marketCapToFdv: 0.41,
    fdvUsd: 8_921_000_000,
    maxSupply: 10_000_000_000,
  },
  {
    symbol: 'ASTER',
    coingeckoId: 'aster-2',
    marketCapToFdv: 0.32,
    fdvUsd: 5_436_000_000,
    maxSupply: 8_000_000_000,
  },
  {
    symbol: 'WLFI',
    coingeckoId: 'world-liberty-financial',
    marketCapToFdv: 0.32,
    fdvUsd: 5_093_000_000,
    maxSupply: 100_000_000_000,
  },
  {
    symbol: 'M',
    coingeckoId: 'memecore',
    marketCapToFdv: 0.42,
    fdvUsd: 4_696_000_000,
    maxSupply: 10_000_000_000,
  },
  {
    symbol: 'ONDO',
    coingeckoId: 'ondo',
    marketCapToFdv: 0.49,
    fdvUsd: 3_867_000_000,
    maxSupply: 10_000_000_000,
  },
  {
    symbol: 'WLD',
    coingeckoId: 'worldcoin',
    marketCapToFdv: 0.37,
    fdvUsd: 3_687_000_000,
    maxSupply: 10_000_000_000,
  },
  {
    symbol: 'LIT',
    coingeckoId: 'lighter',
    marketCapToFdv: 0.255,
    fdvUsd: 3_252_000_000,
    maxSupply: 1_000_000_000,
  },
  {
    symbol: 'ZRO',
    coingeckoId: 'layerzero',
    marketCapToFdv: 0.4,
    fdvUsd: 1_882_000_000,
    maxSupply: 1_000_000_000,
  },
  {
    symbol: 'JUP',
    coingeckoId: 'jupiter-exchange-solana',
    marketCapToFdv: 0.484,
    fdvUsd: 1_694_000_000,
    maxSupply: 7_000_000_000,
  },
  {
    symbol: 'KITE',
    coingeckoId: 'kite-2',
    marketCapToFdv: 0.24,
    fdvUsd: 1_176_000_000,
    maxSupply: 10_000_000_000,
  },
  {
    symbol: 'UB',
    coingeckoId: 'unibase',
    marketCapToFdv: 0.25,
    fdvUsd: 1_043_000_000,
    maxSupply: 10_000_000_000,
  },
] as const;

const dilutionEvidence = new Map<string, (typeof LOW_FLOAT_HIGH_FDV_SNAPSHOT)[number]>();
for (const entry of LOW_FLOAT_HIGH_FDV_SNAPSHOT) {
  dilutionEvidence.set(`binance:${entry.symbol}USDT`, entry);
  dilutionEvidence.set(`hyperliquid:${entry.symbol}`, entry);
}
export function lowFloatEvidence(market: Pick<Market, 'id' | 'floatScreen'>) {
  if (market.floatScreen) return market.floatScreen.evidence;
  return dilutionEvidence.get(market.id);
}

export const CATEGORIES = [
  { id: 'l1', label: 'L1', description: 'Base-layer blockchain networks.' },
  { id: 'ai', label: 'AI', description: 'AI networks, applications and compute.' },
  { id: 'memecoins', label: 'Memecoins', description: 'Community and meme-themed tokens.' },
  {
    id: 'low-float-high-fdv',
    label: 'Low Float / High FDV',
    description:
      'Dated risk screen: finite-supply assets with market cap / FDV below 0.50 and FDV of at least $1B. Unlock timing still needs separate review.',
  },
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
  l1: 'BTC ETH SOL BNB ADA AVAX DOT NEAR ATOM SUI APT SEI TON TRX XRP HBAR ICP INJ KAS ALGO XLM EGLD VET FTM S EOS NEO ETC BCH LTC DOGE XTZ ROSE IOTA ZEC XMR DASH QTUM FLOW CFX IOST ONE ZIL MINA BERA MON 0G INIT XPL PARTI KAIA LSK FOGO PLUME CC M KITE GRAM LUNC',
  ai: 'TAO FET RENDER RNDR VIRTUAL AIXBT ARKM IO AIOZ NMR AKT AGT AIN UAI AIOT FLOCK VVV KAITO GRASS KITE UB 0G PHA RLC CLANKER JCT',
  memecoins:
    'DOGE SHIB PEPE WIF BONK FLOKI BRETT POPCAT MEW PNUT TRUMP MELANIA BOME TURBO PENGU MOG NEIRO FARTCOIN SPX ACT USELESS MUBARAK BIRB PEOPLE CAT M MARSCOIN PIPPIN GIGGLE BULLA GOAT MOODENG HIPPO CHILLGUY MEME DEGEN MYRO SLERF BABYDOGE LADYS RATS SATS ORDI LUNC',
  'low-float-high-fdv': LOW_FLOAT_HIGH_FDV_SNAPSHOT.map(({ symbol }) => symbol).join(' '),
  infra:
    'LINK GRT PYTH TIA AR FIL ICP DOT ATOM EIGEN SSV AKT AIOZ RENDER RNDR IO ZRO W AXL QNT TRB API3 BAND AVAIL ALT DYM ZAMA IRYS WAL 2Z PARTI SOON ERA ENS ICNT JCT UB 0G RLC PHA BMT HOT NIL SYN',
  dino: 'BTC ETH LTC XRP BCH ETC ADA XLM TRX NEO DASH ZEC XMR IOTA QTUM DOGE BAT ZIL IOST ONE LUNC',
  staking: 'LDO RPL JTO ETHFI EIGEN SSV REZ SWELL PUFFER ANKR HAEDAL SOLV BR APR BABY BARD',
  dex: 'UNI CAKE CRV BAL SUSHI RAY JUP AERO OSMO HYPE DYDX GMX GNS PERP DRIFT ASTER RUNE 1INCH COW KNC ZRX ORCA WOO FLUID MAV DODO JOE QUICK VELO LIT MYX',
  yield:
    'PENDLE YFI CVX CRV ENA BIFI FARM FXS AAVE COMP MORPHO SYRUP KMNO USUAL LISTA SOLV FLUID HAEDAL BTW SPK RESOLV FF BR',
  rwa: 'ONDO CFG POLYX OM MANTRA PAXG XAUT PLUME HUMA CPOOL MPL GFI TRU LUMIA CC',
  perps: 'HYPE DYDX GMX GNS PERP DRIFT SNX ASTER AEVO JUP LIT ORDER MYX APEX BLUEFIN ZEX GRVT WOO',
  depin:
    'RENDER RNDR FIL AR HNT IOTX AKT AIOZ IO GRASS ICNT HOT WAL PHA RLC THETA LPT FLUX GLM MOBILE DIMO JASMY 2Z JCT AIOT XPIN POWR',
  gaming:
    'IMX GALA AXS SAND MANA ILV YGG ENJ RON MAGIC PIXEL APE XAI MAVIA BIGTIME PORTAL NAKA ALICE ACE GUN PRIME SUPER ESPORTS BEAT',
  nft: 'APE BLUR LOOKS RARE TNSR PENGU ENJ IMX MANA SAND GALA FLOW DOOD ME ZORA',
  l2: 'ARB OP STRK ZK MANTA METIS MNT POL MATIC IMX LRC STX CELO BLAST MODE SCR LINEA ZORA BOBA MEGA ERA SOON SOPH MOVE TAIKO XAI',
  defi: 'AAVE COMP MORPHO MKR SKY ENA PENDLE CRV CVX SNX UNI CAKE BAL SUSHI RAY JUP AERO DYDX GMX HYPE DRIFT LDO JTO ETHFI EIGEN SSV FRAX FXS RUNE OSMO GNS PERP ASTER AEVO YFI BIFI FARM 1INCH COW KNC ZRX ORCA WOO FLUID MAV DODO JOE QUICK VELO LIT ORDER MYX GRVT SYRUP KMNO USUAL LISTA SOLV HAEDAL BTW SPK RESOLV FF EVAA CPOOL MPL GFI TRU REZ WLFI HUMA ONDO APR BR JST DEXE',
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
  'binance:1000CATUSDT': 'CAT',
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
export function marketCategories(market: Pick<Market, 'id' | 'floatScreen'>): readonly CategoryId[] {
  const canonical = aliases[market.id];
  const categories = assignments.get(canonical ? `binance:${canonical}USDT` : market.id) ?? [];
  if (!market.floatScreen) return categories; // Legacy independently deployed backend: dated snapshot UI.
  const current: CategoryId[] = categories.filter((c) => c !== 'low-float-high-fdv');
  const evidence = market.floatScreen.evidence;
  if (
    market.floatScreen.status === 'fresh' &&
    evidence &&
    evidence.maxSupply > 0 &&
    evidence.marketCapToFdv < LOW_FLOAT_HIGH_FDV_CRITERIA.marketCapToFdvExclusive &&
    evidence.fdvUsd >= LOW_FLOAT_HIGH_FDV_CRITERIA.minimumFdvUsdInclusive
  )
    current.push('low-float-high-fdv');
  return current;
}
export function matchesCategory(market: Pick<Market, 'id' | 'floatScreen'>, filter: CategoryFilter): boolean {
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
