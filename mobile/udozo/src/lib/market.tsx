import type { ShopMarkets } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';

const key = 'udozo.market';

type MarketState = {
  /** The market being browsed: the account's own country, else the one chosen, else the first open one. */
  country: string | null;
  markets: ShopMarkets['data'];
  /** Signed in, the market is the account's country and cannot be changed (as on udozo.com). */
  fixed: boolean;
  choose: (country: string) => Promise<void>;
};

const MarketContext = createContext<MarketState | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  const { customer } = useAccount();
  const [chosen, setChosen] = useState<string | null>(null);
  const markets = useQuery({ queryKey: ['markets'], queryFn: () => api<ShopMarkets>('/v1/classifieds/markets'), staleTime: 10 * 60_000 });

  useEffect(() => {
    SecureStore.getItemAsync(key).then(value => setChosen(value), () => undefined);
  }, []);

  const choose = useCallback(async (country: string) => {
    setChosen(country);
    await SecureStore.setItemAsync(key, country).catch(() => undefined);
  }, []);

  const list = useMemo(() => markets.data?.data ?? [], [markets.data]);
  const open = (code: string | null | undefined) => (code && list.some(market => market.country === code) ? code : null);
  const own = open(customer?.country);
  const country = own ?? open(chosen) ?? list[0]?.country ?? null;
  const value = useMemo(() => ({ country, markets: list, fixed: Boolean(own), choose }), [country, list, own, choose]);
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const value = useContext(MarketContext);
  if (!value) throw new Error('useMarket outside MarketProvider');
  return value;
}
