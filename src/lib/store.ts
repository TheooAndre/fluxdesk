import { create } from 'zustand';
import type { Interval, BenchmarkId, SignalModel } from '../types.ts';
import type { CategoryFilter } from './categories.ts';
import { intervalsFor } from '../engine/intervals.ts';
export type Tab = 'overview' | 'signals' | 'pairs' | 'research' | 'alerts' | 'calendar' | 'journal' | 'statarb';
type Ui = {
  tab: Tab;
  assetId: string;
  benchmark: BenchmarkId;
  tf: Interval;
  search: string;
  category: CategoryFilter;
  sort: 'volume' | 'relative' | 'oi';
  descending: boolean;
  venue: 'all' | 'binance' | 'hyperliquid';
  model: SignalModel | 'all';
  setTab: (t: Tab) => void;
  setAsset: (id: string) => void;
  setBenchmark: (x: BenchmarkId) => void;
  setTf: (tf: Interval) => void;
  setSearch: (s: string) => void;
  setCategory: (category: CategoryFilter) => void;
  setSort: (s: Ui['sort']) => void;
  setDescending: (s: boolean) => void;
  setVenue: (s: Ui['venue']) => void;
  setModel: (s: Ui['model']) => void;
};
export const useUi = create<Ui>((set) => ({
  tab: 'overview',
  assetId: 'binance:BTCUSDT',
  benchmark: 'binance:BTCUSDT',
  tf: '1h',
  search: '',
  category: 'all',
  sort: 'volume',
  descending: true,
  venue: 'all',
  model: 'all',
  setTab: (tab) => set({ tab }),
  setAsset: (assetId) => {
    history.replaceState(null, '', `/?asset=${encodeURIComponent(assetId)}`);
    set((old) => ({
      assetId,
      tf: intervalsFor(assetId.startsWith('hyperliquid:') ? 'hyperliquid' : 'binance').includes(old.tf)
        ? old.tf
        : '1h',
    }));
  },
  setBenchmark: (benchmark) => set({ benchmark }),
  setTf: (tf) => set({ tf }),
  setSearch: (search) => set({ search }),
  setCategory: (category) => set({ category }),
  setSort: (sort) => set({ sort }),
  setDescending: (descending) => set({ descending }),
  setVenue: (venue) => set({ venue }),
  setModel: (model) => set({ model }),
}));

/** Apply deep links after hydration so build HTML and the first browser render
 * have identical state. Queries are enabled only after this runs. */
export function restoreAssetFromLocation() {
  if (typeof window === 'undefined') return;
  const id = new URLSearchParams(window.location.search).get('asset');
  if (id && /^(binance|hyperliquid):[A-Za-z0-9_]{1,32}$/.test(id) && id !== useUi.getState().assetId)
    useUi.getState().setAsset(id);
}
