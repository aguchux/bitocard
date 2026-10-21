import { bitocardApi } from '../base';
import type { List, Page } from './common';

export type InvoiceLine = {
  object: 'invoice_line';
  id: string;
  kind: 'subscription' | 'domain' | 'platform_fee' | 'usage';
  description: string;
  amount: number;
  paid: number;
  owed: number;
  created_at: string;
};

/** A month's invoice for a store (`store_id`) or the account's own usage (null), in one currency. Amounts in minor units. */
export type Invoice = {
  object: 'invoice';
  id: string;
  number: string;
  store_id: string | null;
  currency: string;
  period_start: string;
  period_end: string;
  status: 'open' | 'closed' | 'paid';
  total: number;
  paid: number;
  owed: number;
  closed_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  overdue: boolean;
  lines?: InvoiceLine[];
};

export type Credit = {
  object: 'credit';
  limit_usd_cents: number;
  steps: number[];
  owed: Array<{ currency: string; amount: number; limit: number }>;
  next_limit_usd_cents: number | null;
  can_raise: boolean;
  raise_blocked_by: 'maximum' | 'owing' | 'no_paid_month' | null;
};

/** Invoices and the credit limit (live mode only: `/v1/invoices`, `/v1/billing/credit`). */
export const resellerInvoicesApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    invoices: build.query<List<Invoice>, Page & { store_id?: string; status?: Invoice['status'] }>({ query: params => ({ url: '/v1/invoices', params }), providesTags: ['Invoice'] }),
    invoice: build.query<Invoice, string>({ query: id => `/v1/invoices/${id}`, providesTags: ['Invoice'] }),
    payInvoice: build.mutation<Invoice, string>({ query: id => ({ url: `/v1/invoices/${id}/pay`, method: 'POST', body: {} }), invalidatesTags: ['Invoice', 'Wallet'] }),
    credit: build.query<Credit, void>({ query: () => '/v1/billing/credit', providesTags: ['Invoice'] }),
    raiseCredit: build.mutation<Credit, void>({ query: () => ({ url: '/v1/billing/credit/raise', method: 'POST', body: {} }), invalidatesTags: ['Invoice'] }),
  }),
});

export const { useInvoicesQuery, useInvoiceQuery, usePayInvoiceMutation, useCreditQuery, useRaiseCreditMutation } = resellerInvoicesApi;
