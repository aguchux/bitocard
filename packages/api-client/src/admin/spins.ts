import { bitocardApi } from '../base';
import type { List, Mode } from './types';

/** One spin of a customer's one-time $1 Spin and win reward, in US dollars, credited to their spin rewards (spent in the store, never withdrawn). */
export type SpinReward = { id: string; customer: { id: string; email: string }; mode: Mode; number: number; usd: string; segment: number; created_at: string };

/** Won so far in a mode: `usd` in dollars and the number of spins. */
export type SpinRewardTotal = { mode: Mode; usd: string; spins: number };

/** Rewards moved into customers' store wallets, per currency: `amount` in its minor units, `usd` what the rewards were worth. */
export type SpinExchangeTotal = { currency: string; amount: number; usd: string; exchanges: number };

/** `GET /v1/admin/spins`: the latest spins, what they won in all, how many customers have started and what was moved to wallets. */
export type SpinRewardList = List<SpinReward> & { totals: SpinRewardTotal; customers: number; exchanged: SpinExchangeTotal[] };

export const adminSpinsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    spinRewards: build.query<SpinRewardList, { mode?: Mode; customer_id?: string }>({ query: params => ({ url: '/v1/admin/spins', params }), providesTags: ['StoreCustomer'] }),
  }),
});

export const { useSpinRewardsQuery } = adminSpinsApi;
