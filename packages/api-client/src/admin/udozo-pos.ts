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
export type AdminPosPlan = PosPlanSummary & { shown: boolean; prices: Record<string, number>; /** Yearly prices (none: monthly only there). */ yearly_prices?: Record<string, number>; accounts: number };
export type AdminPosPlans = { object: 'list'; currencies: string[]; data: AdminPosPlan[] };
export type PosPlanChange = { name?: string; description?: string; prices?: Record<string, number | null>; yearly_prices?: Record<string, number | null>; limits?: Partial<PosLimits>; trial_days?: number; shown?: boolean };

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

/** A transfer into a till's Udozo collection account (milestone 4). */
export type AdminPosCollection = {
  object: 'pos_collection';
  id: string;
  number: string;
  status: 'matched' | 'unmatched' | 'kept';
  mode: 'live' | 'test';
  currency: string;
  amount: number;
  fee: number;
  collected: number;
  payer_name: string | null;
  till: { id: string | null; name: string } | null;
  sale: { id: string; number: string } | null;
  settlement: { id: string; number: string } | null;
  note: string | null;
  decided_by: string | null;
  received_at: string;
  account?: { id: string; shop: string | null };
};
export type AdminPosCollections = { object: 'list'; total: number; has_more: boolean; totals: Array<{ currency: string; mode: 'live' | 'test'; amount: number; fees: number }>; data: AdminPosCollection[] };
export type AdminPosSettlement = {
  object: 'pos_settlement';
  id: string;
  number: string;
  day: string;
  mode: 'live' | 'test';
  currency: string;
  collections: number;
  gross: number;
  fees: number;
  amount: number;
  status: 'paying' | 'kept';
  kept_reason: string | null;
  bank_account: { bank_name: string; last4: string } | null;
  payout: { id: string; status: 'pending' | 'processing' | 'paid' | 'failed'; completed_at: string | null } | null;
  created_at: string;
};
export type AdminPosAccountCollections = {
  object: 'pos_account_collections';
  currency: string;
  collected: number;
  unmatched: number;
  held: { at: string; reason: string | null; by: string | null } | null;
  accounts: Array<{ id: string; status: 'opening' | 'active' | 'refused' | 'closed'; till: string | null; bank_name: string | null; account_number: string | null; account_name: string | null; attempts: number; last_error: string | null; opened_at: string | null; closed_at: string | null; created_at: string }>;
  settlements: AdminPosSettlement[];
};
export type AdminPosMarketSetting = { country: string; name: string; currency: string; collection_fee_bps: number; collection_fee_min: number; collection_fee_cap: number | null };

/** A POS account's staff, roles, tills' devices and managers' approvals, as Udozo's admins read them (never PINs). */
export type AdminPosPermissionLevel = 'yes' | 'approval' | 'no' | 'cashiers';
export type AdminPosStaffMember = {
  id: string;
  name: string;
  initials: string;
  phone_hint: string;
  role: { id: string; key: string | null; name: string };
  all_tills: boolean;
  tills: Array<{ id: string; name: string; shop_id: string }>;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  locked_until: string | null;
  last_active_at: string | null;
  invited_by: string;
  created_at: string;
};
export type AdminPosAccountStaff = {
  object: 'pos_account_staff';
  staff: { object: 'list'; limit: number | null; used: number; data: AdminPosStaffMember[] };
  roles: { object: 'list'; data: Array<{ id: string; key: string | null; name: string; system: boolean; permissions: Record<string, AdminPosPermissionLevel>; discount_limit_bps: number | null; staff: number }> };
  devices: Array<{ id: string; name: string | null; platform: string | null; till: { id: string; name: string }; linked_at: string | null; last_seen_at: string | null; revoked_at: string | null; linked_by: string }>;
  approvals: Array<{ id: string; action: string; subject_id: string | null; requested_by: string; approved_by: string; till_id: string | null; created_at: string }>;
};

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
    /** Transfers into every owner's collection accounts (or one account's), newest first. */
    posCollections: build.query<AdminPosCollections, { account?: string; status?: AdminPosCollection['status']; limit?: number; offset?: number } | void>({
      query: filter => ({ url: '/v1/admin/pos/collections', params: clean(filter ?? {}) }),
      providesTags: [{ type: 'PosAccounts', id: 'COLLECTIONS' }],
    }),
    /** An account's staff, roles, devices and approvals (support, operations and finance read). */
    posAccountStaff: build.query<AdminPosAccountStaff, string>({
      query: id => `/v1/admin/pos/accounts/${id}/staff`,
      providesTags: (_result, _error, id) => [{ type: 'PosAccounts', id }],
    }),
    posAccountCollections: build.query<AdminPosAccountCollections, string>({
      query: id => `/v1/admin/pos/accounts/${id}/collections`,
      providesTags: (_result, _error, id) => [{ type: 'PosAccounts', id }],
    }),
    /** Finance or operations: nothing is paid out while held (collections keep coming in). */
    holdPosSettlements: build.mutation<AdminPosAccountCollections, { account: string; reason: string }>({
      query: ({ account, reason }) => ({ url: `/v1/admin/pos/accounts/${account}/settlements/hold`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { account }) => [{ type: 'PosAccounts', id: account }, 'Activity'],
    }),
    /** Finance, after step-up. */
    releasePosSettlements: build.mutation<AdminPosAccountCollections, { account: string; reason: string }>({
      query: ({ account, reason }) => ({ url: `/v1/admin/pos/accounts/${account}/settlements/release`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { account }) => [{ type: 'PosAccounts', id: account }, 'Activity'],
    }),
    posMarketSettings: build.query<{ object: 'list'; data: AdminPosMarketSetting[] }, void>({
      query: () => '/v1/admin/pos/market-settings',
      providesTags: [{ type: 'PosPlans', id: 'MARKETS' }],
    }),
    /** Finance, after step-up: Udozo's margin on each transfer, on top of the gateway's fee. */
    setPosMarketSettings: build.mutation<{ object: 'list'; data: AdminPosMarketSetting[] }, { country: string; collection_fee_bps: number; collection_fee_min: number; collection_fee_cap: number | null }>({
      query: ({ country, ...body }) => ({ url: `/v1/admin/pos/market-settings/${country}`, method: 'PUT', body }),
      invalidatesTags: [{ type: 'PosPlans', id: 'MARKETS' }, 'Activity'],
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

export const {
  usePosAccountsQuery,
  usePosAccountQuery,
  usePosCustomersQuery,
  usePosCustomerQuery,
  usePosCollectionsQuery,
  usePosAccountCollectionsQuery,
  usePosAccountStaffQuery,
  useHoldPosSettlementsMutation,
  useReleasePosSettlementsMutation,
  usePosMarketSettingsQuery,
  useSetPosMarketSettingsMutation,
  usePosPlansQuery,
  useUpdatePosPlanMutation,
  usePosAppsQuery,
  useSetPosAppMutation,
} = adminUdozoPosApi;
