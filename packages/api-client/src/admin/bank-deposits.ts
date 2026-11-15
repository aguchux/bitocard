import { bitocardApi } from '../base';
import type { List } from './types';

export type BankDepositStatus = 'awaiting_payment' | 'sent' | 'credited' | 'rejected' | 'cancelled' | 'expired';

/** One of Golojan's bank accounts customers in a market pay into (`presentAccount`). */
export type DepositBankAccount = {
  object: 'deposit_bank_account';
  id: string;
  country: string;
  currency: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  details: string | null;
  active: boolean;
  position: number;
};

export type DepositBankAccountInput = {
  currency?: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  details?: string | null;
  active?: boolean;
  position?: number;
};

/** A customer's bank deposit as admins see it (`BankDepositsService.presentAdmin`). Amounts in minor units. */
export type AdminBankDeposit = {
  object: 'bank_deposit';
  id: string;
  /** BD-000123. */
  number: string;
  mode: 'live' | 'test';
  status: BankDepositStatus;
  country: string;
  currency: string;
  amount: number;
  credited_amount: number | null;
  /** What the customer writes on the slip or transfer. */
  reference: string;
  account: { bank_name: string; account_name: string; account_number: string; details: string | null };
  method: 'cash' | 'transfer' | null;
  sender_name: string | null;
  note: string | null;
  decision_note: string | null;
  external_reference: string | null;
  expires_at: string;
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  customer: { id: string; name: string; email: string; store: string } | null;
  decided_by: { id: string; name: string | null } | null;
};

/** Golojan's receiving accounts (finance changes them after step-up) and customers' bank deposits to check. */
export const adminBankDepositsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    depositBankAccounts: build.query<List<DepositBankAccount>, { country?: string } | void>({
      query: params => ({ url: '/v1/admin/bank-deposit-accounts', params: params ?? {} }),
      providesTags: ['BankDeposit'],
    }),
    createDepositBankAccount: build.mutation<DepositBankAccount, DepositBankAccountInput & { country: string; bank_name: string; account_name: string; account_number: string }>({
      query: body => ({ url: '/v1/admin/bank-deposit-accounts', method: 'POST', body }),
      invalidatesTags: ['BankDeposit', 'Activity'],
    }),
    updateDepositBankAccount: build.mutation<DepositBankAccount, { id: string } & DepositBankAccountInput>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/bank-deposit-accounts/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['BankDeposit', 'Activity'],
    }),
    deleteDepositBankAccount: build.mutation<{ id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/admin/bank-deposit-accounts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['BankDeposit', 'Activity'],
    }),
    bankDeposits: build.query<List<AdminBankDeposit>, { status?: BankDepositStatus; country?: string; q?: string }>({
      query: params => ({ url: '/v1/admin/bank-deposits', params }),
      providesTags: ['BankDeposit'],
    }),
    /** Finance, after step-up: credits what arrived (the amount asked by default). */
    creditBankDeposit: build.mutation<AdminBankDeposit, { id: string; amount?: number; external_reference?: string; note?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/bank-deposits/${id}/credit`, method: 'POST', body }),
      invalidatesTags: ['BankDeposit', 'StoreCustomer', 'Activity', 'Overview'],
    }),
    rejectBankDeposit: build.mutation<AdminBankDeposit, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/bank-deposits/${id}/reject`, method: 'POST', body: { reason } }),
      invalidatesTags: ['BankDeposit', 'Activity'],
    }),
  }),
});

export const {
  useDepositBankAccountsQuery,
  useCreateDepositBankAccountMutation,
  useUpdateDepositBankAccountMutation,
  useDeleteDepositBankAccountMutation,
  useBankDepositsQuery,
  useCreditBankDepositMutation,
  useRejectBankDepositMutation,
} = adminBankDepositsApi;
