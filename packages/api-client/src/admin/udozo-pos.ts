import { bitocardApi } from '../base';

// Udozo POS for Udozo's team (Udozo's API only: /v1/admin/pos; apps/udozo-api/src/pos/pos-admin.service.ts).

export const posPlanCodes = ['free', 'premium', 'multi_shop'] as const;
export type PosPlanCode = (typeof posPlanCodes)[number];
export const posLimitKeys = ['products', 'shops', 'tills', 'staff'] as const;
export type PosLimitKey = (typeof posLimitKeys)[number];
/** Each limit's words; null is unlimited. */
export const posLimitLabels: Record<PosLimitKey, string> = { products: 'Products at the till', shops: 'Shops', tills: 'Tills', staff: 'Staff' };
export type PosLimits = Record<PosLimitKey, number | null>;

export type PosAccountStatus = 'free' | 'trial' | 'active' | 'cancelling' | 'past_due';
export const posAccountStatusLabels: Record<PosAccountStatus, string> = { free: 'Free', trial: 'Trial', active: 'Paid', cancelling: 'Cancelling', past_due: 'Payment failed' };

export type PosPlanSummary = {
  object: 'pos_plan';
  code: PosPlanCode;
  name: string;
  description: string | null;
  price: { amount: number; currency: string } | null;
  available: boolean;
  paid: boolean;
  limits: PosLimits;
  trial_days: number;
};

/** A plan as admins see it: its monthly price per market currency (minor units), whether owners can choose it, and how many accounts are on it. */
export type AdminPosPlan = PosPlanSummary & { shown: boolean; prices: Record<string, number>; accounts: number };
export type AdminPosPlans = { object: 'list'; currencies: string[]; data: AdminPosPlan[] };
export type PosPlanChange = { name?: string; description?: string; prices?: Record<string, number | null>; limits?: Partial<PosLimits>; trial_days?: number; shown?: boolean };

export type PosTill = { object: 'pos_till'; id: string; name: string; printer_width: 58 | 80; auto_print: boolean };
export type PosShop = { object: 'pos_shop'; id: string; name: string; address: string | null; phone: string | null; tin: string | null; shop_code: string; vat_bps: number; receipt_footer: string | null; tills: PosTill[] };
export type PosCharge = {
  object: 'pos_charge';
  id: string;
  /** PI-000123 */
  number: string;
  plan: { code: string; name: string };
  kind: 'signup' | 'renewal' | 'upgrade';
  period_start: string;
  period_end: string;
  price: number;
  credit: number;
  amount: number;
  currency: string;
  created_at: string;
};

/** An owner's Udozo POS account. Money is in minor units. */
export type AdminPosAccount = {
  object: 'pos_account';
  id: string;
  country: string;
  currency: string;
  mode: 'live' | 'test';
  status: PosAccountStatus;
  plan: PosPlanSummary;
  next_plan: PosPlanCode | null;
  trial_ends_at: string | null;
  period_start: string | null;
  period_end: string | null;
  past_due_since: string | null;
  drops_to_free_at: string | null;
  lapsed_plan: PosPlanCode | null;
  limits: PosLimits;
  shops: PosShop[];
  created_at: string;
  owner: { id: string; name: string; email: string };
};
export type AdminPosAccountDetail = AdminPosAccount & { charges: PosCharge[] };
export type PosAccountFilter = { q?: string; country?: string; plan?: PosPlanCode; limit?: number; offset?: number };

/** A POS shop's own customer (no Udozo account needed); `udozo` when linked to the account they paid through Udozo with. */
export type AdminPosCustomer = {
  object: 'pos_customer';
  id: string;
  number: string;
  name: string;
  phone: string | null;
  email: string | null;
  udozo: boolean;
  owed: number;
  credit_limit: number | null;
  sales_count: number;
  spent: number;
  last_sale_at: string | null;
};
export type AdminPosCustomerDetail = AdminPosCustomer & {
  address: string | null;
  notes: string | null;
  source: 'shop' | 'udozo';
  udozo_rating: { member_since: string; in_good_standing: boolean; reviews: { positive: number; neutral: number; negative: number; counted: number; positive_pct: number | null } | null; scores: { band?: string | null } | null } | null;
  created_at: string;
  sales: Array<{ id: string; number: string; status: 'completed' | 'refunded'; total: number; currency: string; created_at: string }>;
  entries: Array<{ id: string; kind: 'credit_sale' | 'repayment' | 'refund'; amount: number; owed_after: number; sale: { id: string; number: string | null } | null; method: string | null; reference: string | null; note: string | null; by: string | null; created_at: string }>;
};
export type AdminPosCustomers = { object: 'list'; summary: { owing: number; owed: number }; total: number; has_more: boolean; data: AdminPosCustomer[] };

export const posAppPlatforms = ['android', 'ios', 'windows'] as const;
export type PosAppPlatform = (typeof posAppPlatforms)[number];
export type PosApps = { object: 'pos_apps' } & Record<PosAppPlatform, string | null>;

const clean = <T extends Record<string, unknown>>(filter: T | void) => Object.fromEntries(Object.entries(filter ?? {}).filter(([, value]) => value !== undefined && value !== '')) as Record<string, string | number>;

export const adminUdozoPosApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    posAccounts: build.query<{ object: 'list'; total: number; data: AdminPosAccount[] }, PosAccountFilter | void>({
      query: filter => ({ url: '/v1/admin/pos/accounts', params: clean(filter) }),
      providesTags: ['PosAccounts'],
    }),
    posAccount: build.query<AdminPosAccountDetail, string>({
      query: id => `/v1/admin/pos/accounts/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'PosAccounts', id }],
    }),
    /** A shop's customers under its POS account (support, operations and finance read). */
    posCustomers: build.query<AdminPosCustomers, { account: string; q?: string; owing?: boolean; limit?: number; offset?: number }>({
      query: ({ account, ...filter }) => ({ url: `/v1/admin/pos/accounts/${account}/customers`, params: clean(filter) }),
      providesTags: (_result, _error, { account }) => [{ type: 'PosAccounts', id: account }],
    }),
    posCustomer: build.query<AdminPosCustomerDetail, { account: string; id: string }>({
      query: ({ account, id }) => `/v1/admin/pos/accounts/${account}/customers/${id}`,
      providesTags: (_result, _error, { account }) => [{ type: 'PosAccounts', id: account }],
    }),
    posPlans: build.query<AdminPosPlans, void>({
      query: () => '/v1/admin/pos/plans',
      providesTags: ['PosPlans'],
    }),
    /** Finance only, after step-up; audited `pos.plan_changed`. */
    updatePosPlan: build.mutation<AdminPosPlan, PosPlanChange & { code: PosPlanCode }>({
      query: ({ code, ...body }) => ({ url: `/v1/admin/pos/plans/${code}`, method: 'PATCH', body }),
      invalidatesTags: ['PosPlans', 'PosAccounts', 'Activity'],
    }),
    posApps: build.query<PosApps, void>({
      query: () => '/v1/admin/pos/apps',
      providesTags: [{ type: 'PosPlans', id: 'APPS' }],
    }),
    /** Operations; null puts the button on pos.udozo.com back to Coming soon. */
    setPosApp: build.mutation<PosApps, { platform: PosAppPlatform; url: string | null }>({
      query: ({ platform, url }) => ({ url: `/v1/admin/pos/apps/${platform}`, method: 'PUT', body: { url } }),
      invalidatesTags: [{ type: 'PosPlans', id: 'APPS' }, 'Activity'],
    }),
  }),
});

export const { usePosAccountsQuery, usePosAccountQuery, usePosCustomersQuery, usePosCustomerQuery, usePosPlansQuery, useUpdatePosPlanMutation, usePosAppsQuery, useSetPosAppMutation } = adminUdozoPosApi;
