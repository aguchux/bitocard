import { bitocardApi } from '../base';
import type { List, Mode } from './types';

export type ReservedAccountRequestStatus = 'pending' | 'active' | 'refused';

/** A request to open a wallet's reserved bank accounts, with the numbers it opened (`GET /v1/admin/reserved-accounts`). */
export type AdminReservedAccountRequest = {
  object: 'reserved_account_request';
  id: string;
  provider: string;
  /** Our reference at the provider: every transfer into its accounts carries it. */
  reference: string;
  mode: Mode;
  currency: string;
  /** pending: no clear answer yet (the bank may have opened it); active: numbers saved; refused: the provider said no. */
  status: ReservedAccountRequestStatus;
  attempts: number;
  last_error: string | null;
  owner: { type: 'reseller' | 'customer'; id: string; name: string | null; email: string | null; seller: string | null };
  accounts: Array<{ id: string; bank_name: string; account_number: string; account_name: string; created_at: string }>;
  created_at: string;
  updated_at: string;
};

export type ReservedDepositSweep = { object: 'reserved_deposit_sweep'; pages?: number; checked?: number; credited?: number; failed?: number; skipped?: string; error?: string };

export type ReservedAccountsFilter = { mode?: Mode; status?: ReservedAccountRequestStatus; owner?: 'reseller' | 'customer'; q?: string };

/** Reserved bank accounts across every wallet (operations, finance, support), and the deposit sweep (finance, operations). */
export const adminReservedAccountsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    reservedAccounts: build.query<List<AdminReservedAccountRequest>, ReservedAccountsFilter>({
      query: filter => ({ url: '/v1/admin/reserved-accounts', params: { ...Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined && value !== '')), limit: 100 } }),
      providesTags: ['ReservedAccount'],
    }),
    sweepReservedDeposits: build.mutation<ReservedDepositSweep, void>({
      query: () => ({ url: '/v1/admin/reserved-accounts/sweep', method: 'POST' }),
      invalidatesTags: ['ReservedAccount', 'Activity'],
    }),
  }),
});

export const { useReservedAccountsQuery, useSweepReservedDepositsMutation } = adminReservedAccountsApi;
