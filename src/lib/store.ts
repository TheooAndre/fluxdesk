import { create } from 'zustand';
import type { Interval, Major, SignalModel } from '../types.ts';
import { intervalsFor } from '../engine/intervals.ts';
export type Tab = 'overview' | 'signals' | 'pairs' | 'alerts' | 'calendar';
type Ui = {
  tab: Tab;
  assetId: string;
  benchmark: Major;
  tf: Interval;
  search: string;
  sort: 'volume' | 'relative' | 'oi';
  descending: boolean;
  venue: 'all' | 'binance' | 'hyperliquid';
  model: SignalModel | 'all';
  setTab: (t: Tab) => void;
  setAsset: (id: string) => void;
  setBenchmark: (x: Major) => void;
  setTf: (tf: Interval) => void;
  setSearch: (s: string) => void;
  setSort: (s: Ui['sort']) => void;
  setDescending: (s: boolean) => void;
  setVenue: (s: Ui['venue']) => void;
  setModel: (s: Ui['model']) => void;
};
const initial = new URLSearchParams(window.location.search).get('asset');
export const useUi = create<Ui>((set) => ({
  tab: 'overview',
  assetId: initial ?? 'binance:BTCUSDT',
  benchmark: 'BTC',
  tf: '1h',
  search: '',
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
  setSort: (sort) => set({ sort }),
  setDescending: (descending) => set({ descending }),
  setVenue: (venue) => set({ venue }),
  setModel: (model) => set({ model }),
}));
