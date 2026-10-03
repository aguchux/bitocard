import { bitocardApi } from '../base';
import { cursorPages, type List, type Mode, params } from './common';
import type { Plan } from './session';

/**
 * Withdrawals of earnings (`/v1/payouts`), the bank accounts they go to (`/v1/bank-accounts`, `/v1/banks`) and the
 * reseller plan (`/v1/plans`, `/v1/subscription`). Adding accounts, withdrawing and changing plan are dashboard-only.
 */
export type Bank = { code: string; name: string };

export type BankAccount = {
  object: 'bank_account';
  id: string;
  mode: Mode;
  country: string;
  currency: string;
  bank_code: string;
  bank_name: string;
  account_number_last4: string;
  /** Supplied by the bank, never by the reseller. */
  account_name: string;
  /** Live payouts to a new account start 24 hours after it is added (at once in the sandbox). */
  payouts_available_from: string;
  created_at: string;
};

export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export type Payout = {
  object: 'payout';
  id: string;
  mode: Mode;
  status: PayoutStatus;
  amount: number;
  currency: string;
  bank_account_id: string;
  /** The account paid into; still named after the account is removed. Not in webhook payloads. */
  bank_account?: { bank_name: string; account_number_last4: string; removed: boolean };
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

export type Subscription = {
  object: 'subscription';
  plan: Plan;
  /** Null when the plan is not billed (Standard, or set by BitoCard). */
  renews_at: string | null;
  /** Premium ends (back to Standard) when the paid month ends. */
  cancel_at_period_end: boolean;
  /** A renewal failed; the plan stays on for a grace period. */
  past_due_since: string | null;
};

export const resellerPayoutsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    banks: build.query<List<Bank>, void>({ query: () => '/v1/banks' }),
    bankAccounts: build.query<List<BankAccount>, void>({ query: () => '/v1/bank-accounts', providesTags: ['BankAccount'] }),
    /** The bank confirms the account and supplies its name. */
    addBankAccount: build.mutation<BankAccount, { bank_code: string; account_number: string }>({
      query: body => ({ url: '/v1/bank-accounts', method: 'POST', body }),
      invalidatesTags: ['BankAccount'],
    }),
    removeBankAccount: build.mutation<BankAccount & { removed: true }, string>({
      query: id => ({ url: `/v1/bank-accounts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['BankAccount'],
    }),

    payouts: build.infiniteQuery<List<Payout>, void, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ pageParam }) => ({ url: '/v1/payouts', params: params({ limit: 25, starting_after: pageParam }) }),
      providesTags: [{ type: 'Payout', id: 'LIST' }],
    }),
    payout: build.query<Payout, string>({ query: id => `/v1/payouts/${id}`, providesTags: (_result, _error, id) => [{ type: 'Payout', id }] }),
    /** Withdraws earnings past the payout hold, at least the country minimum. */
    createPayout: build.mutation<Payout, { amount: number; bank_account_id: string }>({
      query: body => ({ url: '/v1/payouts', method: 'POST', body }),
      invalidatesTags: [{ type: 'Payout', id: 'LIST' }, 'Wallet'],
    }),
    /** Sandbox only. */
    simulatePayout: build.mutation<Payout, { id: string; outcome: 'paid' | 'failed' }>({
      query: ({ id, ...body }) => ({ url: `/v1/payouts/${id}/simulate`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Payout', id }, { type: 'Payout', id: 'LIST' }, 'Wallet'],
    }),

    /** Named apart from the admin app's `plans` endpoint, which shares this API slice. */
    resellerPlans: build.query<List<Plan>, void>({ query: () => '/v1/plans', providesTags: ['Plan'] }),
    subscription: build.query<Subscription, void>({ query: () => '/v1/subscription', providesTags: ['Subscription'] }),
    /** Upgrading charges the first month from the live wallet at once; moving to Standard keeps Premium to the end of the paid month. */
    changePlan: build.mutation<Subscription, { plan: string }>({
      query: body => ({ url: '/v1/subscription', method: 'POST', body }),
      invalidatesTags: ['Subscription', 'Account', 'Wallet'],
    }),
  }),
});

export const {
  useBanksQuery,
  useBankAccountsQuery,
  useAddBankAccountMutation,
  useRemoveBankAccountMutation,
  usePayoutsInfiniteQuery,
  usePayoutQuery,
  useCreatePayoutMutation,
  useSimulatePayoutMutation,
  useResellerPlansQuery,
  useSubscriptionQuery,
  useChangePlanMutation,
} = resellerPayoutsApi;
