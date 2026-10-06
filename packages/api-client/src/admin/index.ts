import { bitocardApi } from '../base';
import { type Patch, settleOptimistic } from '../optimistic';
import type {
  AdminOrder,
  AdminOrderDetail,
  AdminProduct,
  AdminProductFilter,
  AdminProductList,
  AdminSession,
  AuditEntry,
  Country,
  FeatureRule,
  Integration,
  IntegrationTest,
  List,
  MfaChallenge,
  MfaSetup,
  Mode,
  OrderStatus,
  Overview,
  Plan,
  PricingRule,
  ProductFeature,
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
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Reseller', id }, { type: 'Reseller', id: 'LIST' }, 'Overview', 'Activity', 'Fee'],
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
      { id: string; outcome: 'completed' | 'failed'; reason: string; deliveries?: Array<{ kind: 'gift_card' | 'licence_key' | 'token' | 'confirmation' | 'virtual_number'; code?: string; pin?: string; serial?: string }> }
    >({
      query: ({ id, ...body }) => ({ url: `/v1/admin/orders/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Order', id }, { type: 'Order', id: 'LIST' }, 'Overview', 'Activity', 'Fee'],
    }),
    refundOrder: build.mutation<AdminOrderDetail, { id: string; reason: string; supplier_refunded: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/orders/${id}/refund`, method: 'POST', body }),
      // Refunding an own-supplier order refunds BitoCard's fee.
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Order', id }, { type: 'Order', id: 'LIST' }, 'Overview', 'Activity', 'Fee'],
    }),

    // -- Catalogue and suppliers ------------------------------------------------------------------------------------
    suppliers: build.query<List<Supplier>, void>({ query: () => '/v1/admin/suppliers', providesTags: [{ type: 'Supplier', id: 'LIST' }] }),
    supplier: build.query<Supplier, string>({ query: code => `/v1/admin/suppliers/${code}`, providesTags: (_result, _error, code) => [{ type: 'Supplier', id: code }] }),
    /** Shown at once in the list and on the supplier; the saved supplier replaces both, so neither is refetched. */
    updateSupplier: build.mutation<Supplier, { code: string } & Partial<{ enabled: boolean; status: string; notes: string | null; resale_approved: boolean; logo_url: string | null; feature_rules: Partial<Record<ProductFeature, FeatureRule>> }>>({
      query: ({ code, ...body }) => ({ url: `/v1/admin/suppliers/${code}`, method: 'PATCH', body }),
      async onQueryStarted({ code, resale_approved, ...change }, { dispatch, queryFulfilled }) {
        const apply = (supplier: Supplier) => {
          Object.assign(supplier, change as Partial<Supplier>);
          if (resale_approved !== undefined) supplier.funding.resale_approved = resale_approved;
        };
        const saved = await settleOptimistic(patchSupplier(dispatch, code, apply), queryFulfilled, () => dispatch(adminApi.util.invalidateTags([{ type: 'Supplier', id: code }, { type: 'Supplier', id: 'LIST' }])));
        if (saved) patchSupplier(dispatch, code, supplier => void Object.assign(supplier, saved));
      },
      invalidatesTags: ['Overview', 'Activity', 'Media'],
    }),
    /** Shown at once; the saved supplier (with its markets) replaces the cached one. */
    setSupplierMarket: build.mutation<Supplier, { code: string; country: string; category: ProductCategory; enabled: boolean }>({
      query: ({ code, country, category, enabled }) => ({ url: `/v1/admin/suppliers/${code}/markets/${country}/${category}`, method: 'PUT', body: { enabled } }),
      async onQueryStarted({ code, country, category, enabled }, { dispatch, queryFulfilled }) {
        const apply = (supplier: Supplier) => {
          // Only where the markets are loaded (the supplier's own card, not every list).
          const markets = supplier.markets;
          if (!markets) return;
          const market = markets.find(item => item.country === country && item.category === category);
          if (market) market.enabled = enabled;
          else markets.push({ country, category, enabled });
        };
        const saved = await settleOptimistic(patchSupplier(dispatch, code, apply), queryFulfilled, () => dispatch(adminApi.util.invalidateTags([{ type: 'Supplier', id: code }, { type: 'Supplier', id: 'LIST' }])));
        if (saved) patchSupplier(dispatch, code, supplier => void Object.assign(supplier, saved));
      },
      invalidatesTags: ['Activity'],
    }),
    /** `note` says why a sync brought back nothing (what the supplier returned and what was left out). */
    syncSupplier: build.mutation<{ object: 'supplier_sync'; supplier: string; products_created: number; offers_updated: number; offers_withdrawn: number; note: string | null }, string>({
      query: code => ({ url: `/v1/admin/suppliers/${code}/sync`, method: 'POST' }),
      invalidatesTags: (_result, _error, code) => [{ type: 'Supplier', id: code }, { type: 'Supplier', id: 'LIST' }, { type: 'Product', id: 'LIST' }, 'Overview'],
    }),
    products: build.infiniteQuery<AdminProductList, AdminProductFilter, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ queryArg, pageParam }) => ({ url: '/v1/admin/products', params: params({ ...queryArg, limit: 50, starting_after: pageParam }) }),
      providesTags: [{ type: 'Product', id: 'LIST' }],
    }),
    updateProduct: build.mutation<
      { id: string; active: boolean; listed: boolean; name: string; image_url: string | null },
      { id: string; active?: boolean; listed?: boolean; name?: string; description?: string | null; image_url?: string | null }
    >({
      query: ({ id, ...body }) => ({ url: `/v1/admin/products/${id}`, method: 'PATCH', body }),
      // Shown at once in every loaded product list (with the listed count), then the saved fields replace it: one
      // product changing never refetches every page loaded. A product that no longer matches a filter stays in view
      // until the list is next refreshed, so it does not jump away under the pointer.
      async onQueryStarted({ id, ...change }, { dispatch, getState, queryFulfilled }) {
        const patches = patchProducts(dispatch, getState, product => product.id === id, product => void Object.assign(product, change));
        const saved = await settleOptimistic(patches, queryFulfilled, () => dispatch(adminApi.util.invalidateTags([{ type: 'Product', id: 'LIST' }])));
        if (saved) patchProducts(dispatch, getState, product => product.id === id, product => void Object.assign(product, saved));
      },
      invalidatesTags: ['Activity', 'Media'],
    }),
    /** Lists or unlists products on BitoCard's store: these IDs, or everything matching the filters. */
    setProductListing: build.mutation<{ object: 'product_listing'; listed: boolean; updated: number }, { listed: boolean; product_ids?: string[]; filter?: AdminProductFilter }>({
      query: body => ({ url: '/v1/admin/products/listing', method: 'POST', body }),
      // Chosen products show the change at once; "everything matching" cannot be drawn ahead, so the lists refetch.
      async onQueryStarted({ listed, product_ids }, { dispatch, getState, queryFulfilled }) {
        const ids = new Set(product_ids ?? []);
        const patches = ids.size ? patchProducts(dispatch, getState, product => ids.has(product.id), product => void (product.listed = listed)) : [];
        await settleOptimistic(patches, queryFulfilled);
      },
      invalidatesTags: [{ type: 'Product', id: 'LIST' }, 'Activity'],
    }),
    updateOffer: build.mutation<{ id: string; discount_bps: number; priority: number; available: boolean }, { id: string; discount_bps?: number; priority?: number; available?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/supplier-products/${id}`, method: 'PATCH', body }),
      // Shown at once on the product that holds the offer; the saved values replace it, with no list refetch.
      async onQueryStarted({ id, ...change }, { dispatch, getState, queryFulfilled }) {
        const holds = (product: AdminProduct) => product.offers.some(offer => offer.id === id);
        const update = (values: object) => (product: AdminProduct) => void Object.assign(product.offers.find(offer => offer.id === id)!, values);
        const patches = patchProducts(dispatch, getState, holds, update(change));
        const saved = await settleOptimistic(patches, queryFulfilled, () => dispatch(adminApi.util.invalidateTags([{ type: 'Product', id: 'LIST' }])));
        if (saved) patchProducts(dispatch, getState, holds, update(saved));
      },
      invalidatesTags: ['Activity'],
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
    /** Shown at once; `enabled: null` removes the setting at that scope (the wider one applies again). */
    setSwitch: build.mutation<unknown, { key: string; enabled: boolean | null; country_code?: string; reseller_id?: string }>({
      query: ({ key, ...body }) => ({ url: `/v1/admin/switches/${key}`, method: 'PUT', body }),
      async onQueryStarted({ key, enabled, country_code, reseller_id }, { dispatch, queryFulfilled }) {
        const scope = reseller_id ? 'reseller' : country_code ? 'country' : 'global';
        const patch = dispatch(
          adminApi.util.updateQueryData('switches', undefined, draft => {
            const at = draft.data.findIndex(row => row.key === key && row.scope === scope && (row.country_code ?? undefined) === country_code && (row.reseller_id ?? undefined) === reseller_id);
            if (enabled === null) {
              if (at >= 0) draft.data.splice(at, 1);
            } else if (at >= 0) draft.data[at].enabled = enabled;
            else draft.data.push({ object: 'switch', key, scope, country_code: country_code ?? null, reseller_id: reseller_id ?? null, enabled });
          }),
        );
        await settleOptimistic([patch], queryFulfilled);
      },
      // The list is small: refetched after the change (and after a refusal) so it matches the server exactly.
      invalidatesTags: ['Switch', 'Activity'],
    }),
    countries: build.query<List<Country>, void>({ query: () => '/v1/admin/countries', providesTags: ['Country'] }),
    /** Shown at once; the saved country replaces the cached one, so nothing is refetched. */
    updateCountryCategory: build.mutation<Country, { code: string; category: ProductCategory; enabled?: boolean; customer_verification?: boolean; taxable?: boolean }>({
      query: ({ code, category, ...body }) => ({ url: `/v1/admin/countries/${code}/categories/${category}`, method: 'PUT', body }),
      async onQueryStarted({ code, category, ...change }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          adminApi.util.updateQueryData('countries', undefined, draft => {
            const row = draft.data.find(country => country.code === code)?.categories.find(item => item.category === category);
            if (row) Object.assign(row, change);
          }),
        );
        const saved = await settleOptimistic([patch], queryFulfilled, () => dispatch(adminApi.util.invalidateTags(['Country'])));
        if (saved) {
          dispatch(
            adminApi.util.updateQueryData('countries', undefined, draft => {
              const at = draft.data.findIndex(country => country.code === code);
              if (at >= 0) draft.data[at] = saved;
            }),
          );
        }
      },
      invalidatesTags: ['Activity'],
    }),
    integrations: build.query<List<Integration>, void>({ query: () => '/v1/admin/integrations', providesTags: ['Integration'] }),
    /** Sets fields (null clears an admin value). Needs the admin's current authenticator code. */
    updateIntegration: build.mutation<Integration, { id: string; values: Record<string, string | number | boolean | null>; code: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/integrations/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Integration', 'Activity', 'Supplier'],
    }),
    /** Tests the saved credentials at the sandbox or live address; changes nothing. */
    testIntegration: build.mutation<IntegrationTest, string>({
      query: id => ({ url: `/v1/admin/integrations/${id}/test`, method: 'POST' }),
      invalidatesTags: ['Activity'],
    }),
  }),
});

type Dispatch = (action: unknown) => unknown;

/** Changes every loaded product list's matching products (keeping each page's listed count right); returns the patches. */
function patchProducts(dispatch: Dispatch, getState: () => unknown, matches: (product: AdminProduct) => boolean, apply: (product: AdminProduct) => void): Patch[] {
  const state = getState() as Parameters<typeof adminApi.util.selectCachedArgsForQuery>[0];
  return adminApi.util.selectCachedArgsForQuery(state, 'products').map(
    args =>
      dispatch(
        adminApi.util.updateQueryData('products', args, draft => {
          let listedChange = 0;
          for (const product of draft.pages.flatMap(page => page.data)) {
            if (!matches(product)) continue;
            const before = product.listed;
            apply(product);
            listedChange += Number(product.listed) - Number(before);
          }
          if (listedChange) for (const page of draft.pages) page.listed = Math.max(0, page.listed + listedChange);
        }),
      ) as Patch,
  );
}

/** Changes the supplier in the suppliers list and its own detail, where cached; returns the patches. */
function patchSupplier(dispatch: Dispatch, code: string, apply: (supplier: Supplier) => void): Patch[] {
  return [
    dispatch(
      adminApi.util.updateQueryData('suppliers', undefined, draft => {
        const supplier = draft.data.find(item => item.code === code);
        if (supplier) apply(supplier);
      }),
    ) as Patch,
    dispatch(adminApi.util.updateQueryData('supplier', code, apply)) as Patch,
  ];
}

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
  useSetProductListingMutation,
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
  useTestIntegrationMutation,
} = adminApi;
export * from './reseller-integrations';
export * from './fees';
export * from './storefront';
export * from './stock';
