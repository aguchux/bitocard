import { bitocardApi } from '../base';
import type { List, Mode } from './types';

export type FundingSource = 'gateway' | 'static_account' | 'manual' | 'bank_deposit';
export type FundingStatus = 'pending' | 'succeeded' | 'failed';

/** One way money entered, or attempted to enter, a reseller or customer wallet. Amounts are minor units. */
export type AdminFunding = {
  object: 'funding';
  id: string;
  record_id: string;
  source: FundingSource;
  mode: Mode;
  status: FundingStatus;
  provider_status: string;
  owner: { type: 'reseller' | 'customer'; id: string; name: string; email: string | null; reseller: string | null };
  amount: number;
  credited_amount: number | null;
  currency: string;
  provider: string;
  reference: string;
  external_reference: string | null;
  failure_reason: string | null;
  static_account: { id: string; bank_name: string; account_number: string; account_name: string } | null;
  created_at: string;
  completed_at: string | null;
};

export type FundingsFilter = {
  mode?: Mode;
  owner?: 'reseller' | 'customer';
  reseller_id?: string;
  customer_id?: string;
  source?: FundingSource;
  status?: FundingStatus;
  q?: string;
};

export const adminFundingsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    adminFundings: build.query<List<AdminFunding>, FundingsFilter>({
      query: filter => ({ url: '/v1/admin/fundings', params: { ...Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined && value !== '')), limit: 100 } }),
      providesTags: ['TopUp', 'BankDeposit', 'ReservedAccount'],
    }),
  }),
});

export const { useAdminFundingsQuery } = adminFundingsApi;
