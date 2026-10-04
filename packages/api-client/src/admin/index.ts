import { bitocardApi } from '../base';
import type {
  AdminOrder,
  AdminOrderDetail,
  AdminProduct,
  AdminSession,
  AuditEntry,
  Country,
  Integration,
  List,
  MfaChallenge,
  MfaSetup,
  Mode,
  OrderStatus,
  Overview,
  Plan,
  PricingRule,
  ProductCategory,
  ResellerDetail,
  ResellerStatus,
  ResellerSummary,
  ResellerWallet,
  StartupAllowance,
  Supplier,
  SupplierWebhook,
  SupplierWebhookStatus,
  Switches,
  Verification,
  VerificationStatus,
} from './types';

export * from './types';

/** Drops empty values so query strings stay clean. */
const params = (values: Record<string, string | number | boolean | undefined | null>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));

/** Cursor pages: the next page starts after the last item, while the API says there is more. */
const cursorPages = {
  initialPageParam: '',
  getNextPageParam: (last: { data: Array<{ id: string }>; has_more?: boolean }) => (last.has_more ? last.data.at(-1)?.id : undefined),
};

/** Every admin endpoint, as RTK Query hooks. Mutations invalidate the lists and details they change. */
export const adminApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    // -- Sign-in ----------------------------------------------------------------------------------------------------
    adminSession: build.query<AdminSession, void>({ query: () => '/v1/admin/auth/session', providesTags: ['Session'] }),
    adminSignIn: build.mutation<MfaChallenge, { email: string; password: string }>({ query: body => ({ url: '/v1/admin/auth/signin', method: 'POST', body }) }),
    adminMfaSetup: build.mutation<MfaSetup, { challenge_token: string }>({ query: body => ({ url: '/v1/admin/auth/mfa/setup', method: 'POST', body }) }),
    adminMfaVerify: build.mutation<AdminSession, { challenge_token: string; code: string }>({
      query: body => ({ url: '/v1/admin/auth/mfa/verify', method: 'POST', body }),
      invalidatesTags: ['Session'],
    }),
    adminSignOut: build.mutation<void, void>({ query: () => ({ url: '/v1/admin/auth/signout', method: 'POST' }), invalidatesTags: ['Session'] }),

    // -- Overview and activity --------------------------------------------------------------------------------------
    overview: build.query<Overview, { days: number; mode: Mode }>({ query: args => ({ url: '/v1/admin/overview', params: args }), providesTags: ['Overview'] }),
    activity: build.infiniteQuery<List<AuditEntry>, { target_type?: string }, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/admin/activity', params: params({ ...queryArg, limit: 50, starting_after: pageParam }) }),
      providesTags: ['Activity'],
    }),

    // -- Resellers and identity checks ------------------------------------------------------------------------------
    resellers: build.query<List<ResellerSummary>, { status?: ResellerStatus; country?: string }>({
      query: args => ({ url: '/v1/admin/resellers', params: params(args) }),
      providesTags: result => [...(result?.data.map(reseller => ({ type: 'Reseller' as const, id: reseller.id })) ?? []), { type: 'Reseller', id: 'LIST' }],
    }),
    reseller: build.query<ResellerDetail, string>({ query: id => `/v1/admin/resellers/${id}`, providesTags: (_result, _error, id) => [{ type: 'Reseller', id }] }),
    resellerHistory: build.query<List<Omit<AuditEntry, 'id' | 'target_type' | 'target_id' | 'actor'> & { actor_id: string | null }>, string>({
      query: id => `/v1/admin/resellers/${id}/history`,
      providesTags: (_result, _error, id) => [{ type: 'Reseller', id }],
    }),
    updateReseller: build.mutation<ResellerDetail, { id: string; status?: ResellerStatus; plan?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/resellers/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Reseller', id }, { type: 'Reseller', id: 'LIST' }, 'Overview', 'Activity'],
    }),
    resellerWallet: build.query<ResellerWallet, string>({ query: id => `/v1/admin/resellers/${id}/wallet`, providesTags: (_result, _error, id) => [{ type: 'Reseller', id }] }),
    /** Finance: grants the startup allowance (verified reseller, switch on, once only). */
    grantStartupAllowance: build.mutation<StartupAllowance, string>({
      query: id => ({ url: `/v1/admin/resellers/${id}/startup-allowance`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Reseller', id }, 'Activity'],
    }),
    /** Finance: takes back what remains, with a reason. */
    revokeStartupAllowance: build.mutation<StartupAllowance, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/resellers/${id}/startup-allowance/revoke`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Reseller', id }, 'Activity'],
    }),
    plans: build.query<List<Plan>, void>({ query: () => '/v1/plans', providesTags: ['Plan'] }),

    verifications: build.infiniteQuery<List<Verification>, { status?: VerificationStatus; subject?: 'reseller' | 'customer'; reseller_id?: string }, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/admin/verifications', params: params({ ...queryArg, limit: 50, starting_after: pageParam }) }),
      providesTags: [{ type: 'Verification', id: 'LIST' }],
    }),
    decideVerification: build.mutation<Verification, { id: string; decision: 'approved' | 'declined'; reason: string; verified_name?: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/verifications/${id}/decide`, method: 'POST', body }),
      invalidatesTags: [{ type: 'Verification', id: 'LIST' }, { type: 'Reseller', id: 'LIST' }, 'Overview', 'Activity'],
    }),

    // -- Orders -----------------------------------------------------------------------------------------------------
    orders: build.infiniteQuery<List<AdminOrder>, { status?: OrderStatus; needs_review?: boolean; reseller_id?: string }, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/admin/orders', params: params({ ...queryArg, limit: 50, starting_after: pageParam }) }),
      providesTags: [{ type: 'Order', id: 'LIST' }],
    }),
    supplierWebhooks: build.infiniteQuery<List<SupplierWebhook>, { status?: SupplierWebhookStatus; supplier?: string; connection_id?: string }, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/admin/supplier-webhooks', params: params({ ...queryArg, limit: 50, starting_after: pageParam }) }),
      providesTags: [{ type: 'Order', id: 'NOTIFICATIONS' }],
    }),
    retrySupplierWebhook: build.mutation<SupplierWebhook, string>({
      query: id => ({ url: `/v1/admin/supplier-webhooks/${id}/retry`, method: 'POST' }),
      invalidatesTags: [{ type: 'Order', id: 'NOTIFICATIONS' }, { type: 'Order', id: 'LIST' }, 'Activity'],
    }),
    order: build.query<AdminOrderDetail, string>({ query: id => `/v1/admin/orders/${id}`, providesTags: (_result, _error, id) => [{ type: 'Order', id }] }),
    requeryOrder: build.mutation<AdminOrderDetail, string>({
      query: id => ({ url: `/v1/admin/orders/${id}/requery`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Order', id }, { type: 'Order', id: 'LIST' }, 'Overview'],
    }),
    resolveOrder: build.mutation<
      AdminOrderDetail,
      { id: string; outcome: 'completed' | 'failed'; reason: string; deliveries?: Array<{ kind: 'gift_card' | 'token' | 'confirmation' | 'virtual_number'; code?: string; pin?: string; serial?: string }> }
    >({
      query: ({ id, ...body }) => ({ url: `/v1/admin/orders/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Order', id }, { type: 'Order', id: 'LIST' }, 'Overview', 'Activity'],
    }),
    refundOrder: build.mutation<AdminOrderDetail, { id: string; reason: string; supplier_refunded: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/orders/${id}/refund`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Order', id }, { type: 'Order', id: 'LIST' }, 'Overview', 'Activity'],
    }),

    // -- Catalogue and suppliers ------------------------------------------------------------------------------------
    suppliers: build.query<List<Supplier>, void>({ query: () => '/v1/admin/suppliers', providesTags: [{ type: 'Supplier', id: 'LIST' }] }),
    supplier: build.query<Supplier, string>({ query: code => `/v1/admin/suppliers/${code}`, providesTags: (_result, _error, code) => [{ type: 'Supplier', id: code }] }),
    updateSupplier: build.mutation<Supplier, { code: string } & Partial<{ enabled: boolean; status: string; notes: string | null; resale_approved: boolean }>>({
      query: ({ code, ...body }) => ({ url: `/v1/admin/suppliers/${code}`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { code }) => [{ type: 'Supplier', id: code }, { type: 'Supplier', id: 'LIST' }, 'Overview', 'Activity'],
    }),
    setSupplierMarket: build.mutation<Supplier, { code: string; country: string; category: ProductCategory; enabled: boolean }>({
      query: ({ code, country, category, enabled }) => ({ url: `/v1/admin/suppliers/${code}/markets/${country}/${category}`, method: 'PUT', body: { enabled } }),
      invalidatesTags: (_result, _error, { code }) => [{ type: 'Supplier', id: code }, 'Activity'],
    }),
    syncSupplier: build.mutation<{ object: 'supplier_sync'; supplier: string; products_created: number; offers_updated: number; offers_withdrawn: number }, string>({
      query: code => ({ url: `/v1/admin/suppliers/${code}/sync`, method: 'POST' }),
      invalidatesTags: (_result, _error, code) => [{ type: 'Supplier', id: code }, { type: 'Supplier', id: 'LIST' }, { type: 'Product', id: 'LIST' }, 'Overview'],
    }),
    products: build.infiniteQuery<List<AdminProduct>, { category?: ProductCategory; country?: string; q?: string }, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/admin/products', params: params({ ...queryArg, limit: 50, starting_after: pageParam }) }),
      providesTags: [{ type: 'Product', id: 'LIST' }],
    }),
    updateProduct: build.mutation<{ id: string; active: boolean; name: string }, { id: string; active?: boolean; name?: string; description?: string | null }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/products/${id}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'Product', id: 'LIST' }, 'Activity'],
    }),
    updateOffer: build.mutation<{ id: string; discount_bps: number; priority: number; available: boolean }, { id: string; discount_bps?: number; priority?: number; available?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/supplier-products/${id}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'Product', id: 'LIST' }, 'Activity'],
    }),
    pricingRules: build.query<List<PricingRule>, void>({ query: () => '/v1/admin/pricing-rules', providesTags: [{ type: 'PricingRule', id: 'LIST' }] }),
    setPricingRule: build.mutation<PricingRule, { category?: ProductCategory; country?: string; product_id?: string; margin_bps: number; reseller_discount_bps?: number }>({
      query: body => ({ url: '/v1/admin/pricing-rules', method: 'PUT', body }),
      invalidatesTags: [{ type: 'PricingRule', id: 'LIST' }, 'Activity'],
    }),
    deletePricingRule: build.mutation<{ id: string; removed: true }, string>({
      query: id => ({ url: `/v1/admin/pricing-rules/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'PricingRule', id: 'LIST' }, 'Activity'],
    }),

    // -- Settings ---------------------------------------------------------------------------------------------------
    switches: build.query<Switches, void>({ query: () => '/v1/admin/switches', providesTags: ['Switch'] }),
    setSwitch: build.mutation<unknown, { key: string; enabled: boolean | null; country_code?: string; reseller_id?: string }>({
      query: ({ key, ...body }) => ({ url: `/v1/admin/switches/${key}`, method: 'PUT', body }),
      invalidatesTags: ['Switch', 'Activity'],
    }),
    countries: build.query<List<Country>, void>({ query: () => '/v1/admin/countries', providesTags: ['Country'] }),
    updateCountryCategory: build.mutation<Country, { code: string; category: ProductCategory; enabled?: boolean; customer_verification?: boolean; taxable?: boolean }>({
      query: ({ code, category, ...body }) => ({ url: `/v1/admin/countries/${code}/categories/${category}`, method: 'PUT', body }),
      invalidatesTags: ['Country', 'Activity'],
    }),
    integrations: build.query<List<Integration>, void>({ query: () => '/v1/admin/integrations', providesTags: ['Integration'] }),
    /** Sets fields (null clears an admin value). Needs the admin's current authenticator code. */
    updateIntegration: build.mutation<Integration, { id: string; values: Record<string, string | number | boolean | null>; code: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/integrations/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Integration', 'Activity'],
    }),
  }),
});

export const {
  useResellerWalletQuery,
  useGrantStartupAllowanceMutation,
  useRevokeStartupAllowanceMutation,
  useAdminSessionQuery,
  useAdminSignInMutation,
  useAdminMfaSetupMutation,
  useAdminMfaVerifyMutation,
  useAdminSignOutMutation,
  useOverviewQuery,
  useActivityInfiniteQuery,
  useResellersQuery,
  useResellerQuery,
  useResellerHistoryQuery,
  useUpdateResellerMutation,
  usePlansQuery,
  useVerificationsInfiniteQuery,
  useDecideVerificationMutation,
  useOrdersInfiniteQuery,
  useOrderQuery,
  useSupplierWebhooksInfiniteQuery,
  useRetrySupplierWebhookMutation,
  useRequeryOrderMutation,
  useResolveOrderMutation,
  useRefundOrderMutation,
  useSuppliersQuery,
  useSupplierQuery,
  useUpdateSupplierMutation,
  useSetSupplierMarketMutation,
  useSyncSupplierMutation,
  useProductsInfiniteQuery,
  useUpdateProductMutation,
  useUpdateOfferMutation,
  usePricingRulesQuery,
  useSetPricingRuleMutation,
  useDeletePricingRuleMutation,
  useSwitchesQuery,
  useSetSwitchMutation,
  useCountriesQuery,
  useUpdateCountryCategoryMutation,
  useIntegrationsQuery,
  useUpdateIntegrationMutation,
} = adminApi;
export * from './reseller-integrations';
export * from './fees';
