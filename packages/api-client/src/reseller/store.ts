import { bitocardApi } from '../base';
import type { StoreCustomer, StoreCustomerDetail, StoreCustomerFilter, StoreCustomerUpdate } from '../store-customers';
import type { StoreSection, StoreSectionType, StoreTemplateKey, StoreThemeColors, StoreVariantStyle } from '../storefront';
import type { List, ResellerStatus } from './common';

export type { StoreCustomer, StoreCustomerDetail } from '../store-customers';

export type StoreStatus = 'draft' | 'published' | 'suspended';
export type StoreBranding = { logo_url: string | null; primary_color: string | null; accent_color: string | null };
export type Store = {
  object: 'store';
  id: string;
  name: string;
  subdomain: string;
  /** Always https://<subdomain>.bitocard.com. */
  url: string;
  status: StoreStatus;
  branding: StoreBranding;
  /** The store's template (what it sells), design variant and colour theme (`GET /v1/store-templates`). */
  template: StoreTemplateKey;
  variant: string;
  theme: string;
  /** Single product stores: the product key it sells. */
  focus: string | null;
  home: { version: number | null; published_at: string | null };
  /** Customer checkout: `test` (sandbox: simulated payments and orders) until switched `live` (needs a verified business). */
  checkout_mode: 'test' | 'live';
  /** The customer account app's menu on desktop; null follows BitoCard's default. */
  desktop_nav: 'rail' | 'bottom' | null;
  /** Beyond the month's AI replies: `stop` (people answer) or `pay` (billed as it goes). */
  ai_overage: 'stop' | 'pay';
  /** Customers are asked for the identity check where BitoCard's market rules require one (true), or never. */
  customer_verification: boolean;
  published_at: string | null;
  created_at: string;
};
/** `reason` explains why an address cannot be used (format, reserved or taken). Your own store's address reads as taken. */
export type SubdomainCheck = { object: 'subdomain_availability'; subdomain: string; available: boolean; reason: string | null };
export type StoreInput = {
  name?: string;
  subdomain?: string;
  logo_url?: string | null;
  primary_color?: string;
  accent_color?: string;
  checkout_mode?: 'test' | 'live';
  desktop_nav?: 'rail' | 'bottom' | null;
  ai_overage?: 'stop' | 'pay';
  customer_verification?: boolean;
  template?: StoreTemplateKey;
  variant?: string;
  theme?: string;
  focus?: string | null;
};

/** A store template with its design variants and their colour themes; `available` says whether it can be used now. */
export type StoreTemplate = {
  object: 'store_template';
  key: StoreTemplateKey;
  name: string;
  tagline: string;
  description: string;
  categories: string[] | null;
  single_product: boolean;
  crypto: boolean;
  /** The Resale shop: sells BitoCard Shop suppliers' resale listings, never catalogue products. */
  resale?: boolean;
  sections: StoreSectionType[];
  available: boolean;
  reason: string | null;
  variants: Array<{ key: string; name: string; description: string; style: StoreVariantStyle; themes: Array<{ key: string; name: string; colors: StoreThemeColors }> }>;
};
/** A store's home page in the editor (`/v1/stores/:id/home`). */
export type StoreHomeEditor = {
  object: 'store_home_editor';
  store_id: string;
  template: StoreTemplateKey;
  variant: string;
  sections_allowed: StoreSectionType[];
  draft: StoreSection[];
  published: boolean;
  version: number | null;
  published_at: string | null;
  updated_at: string;
};
export type StoreHomeVersion = { object: 'store_home_version'; version: number; template: StoreTemplateKey; variant: string; sections: number; restorable: boolean; published_at: string };

/** The business details (`PATCH /v1/reseller`). The country can only be set once. */
export type ResellerProfile = { object: 'reseller'; id: string; name: string; country: string | null; status: ResellerStatus };

/** Settings chain: what the country allows and the reseller's effective choice. */
export type SettingsOptionKey = 'gift_card_payout';
export type SettingsOption = { value: string | null; allowed: string[]; source: 'reseller' | 'country_default' };
export type SettingsOptions = Record<SettingsOptionKey, SettingsOption>;
export type ResellerSettings = { object: 'settings'; options: SettingsOptions; features: Record<string, boolean> };

export type Country = {
  object: 'country';
  code: string;
  name: string;
  currency: string;
  reseller_signup: boolean;
  /** Bank transfer (reserved) accounts are offered here. */
  reserved_accounts: boolean;
  /** The Markup Protection Scheme cap. */
  markup_cap_percent: number;
  /** Days a sale's profit is held before it can be withdrawn. */
  payout_hold_days: number;
  /** The smallest withdrawal, in minor units of the currency. */
  min_withdrawal_minor: number;
  categories: Array<{ category: string; customer_verification: boolean }>;
};

/** Visits to the store, counted without cookies (`GET /v1/stores/:id/traffic`). */
export type TrafficCounts = { views: number; visitors: number };
export type StoreTraffic = TrafficCounts & {
  object: 'store_traffic';
  days: number;
  from: string;
  to: string;
  hosts: Array<TrafficCounts & { host: string }>;
  daily: Array<TrafficCounts & { date: string }>;
};

/** The reseller's hosted store, business details, settings options and the public list of markets. */
export const resellerStoreApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    stores: build.query<List<Store>, void>({ query: () => '/v1/stores', providesTags: ['Store'] }),
    createStore: build.mutation<Store, StoreInput & { name: string; subdomain: string }>({
      query: body => ({ url: '/v1/stores', method: 'POST', body }),
      invalidatesTags: ['Store'],
    }),
    updateStore: build.mutation<Store, { id: string } & StoreInput>({
      query: ({ id, ...body }) => ({ url: `/v1/stores/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Store'],
    }),
    publishStore: build.mutation<Store, string>({ query: id => ({ url: `/v1/stores/${id}/publish`, method: 'POST' }), invalidatesTags: ['Store'] }),
    storeTraffic: build.query<StoreTraffic, { id: string; days?: number }>({ query: ({ id, days = 30 }) => `/v1/stores/${id}/traffic?days=${days}`, keepUnusedDataFor: 300 }),
    storeTemplates: build.query<List<StoreTemplate>, void>({ query: () => '/v1/store-templates', providesTags: ['Store'] }),
    storeHome: build.query<StoreHomeEditor, string>({ query: id => `/v1/stores/${id}/home`, providesTags: (_result, _error, id) => [{ type: 'Store', id: `home:${id}` }] }),
    saveStoreHome: build.mutation<StoreHomeEditor, { id: string; sections: StoreSection[] }>({ query: ({ id, sections }) => ({ url: `/v1/stores/${id}/home/draft`, method: 'PUT', body: { sections } }) }),
    publishStoreHome: build.mutation<StoreHomeEditor, string>({
      query: id => ({ url: `/v1/stores/${id}/home/publish`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => ['Store', { type: 'Store', id: `home:${id}` }],
    }),
    resetStoreHome: build.mutation<StoreHomeEditor, string>({ query: id => ({ url: `/v1/stores/${id}/home/reset`, method: 'POST' }), invalidatesTags: (_result, _error, id) => [{ type: 'Store', id: `home:${id}` }] }),
    storeHomeVersions: build.query<List<StoreHomeVersion>, string>({ query: id => `/v1/stores/${id}/home/versions`, providesTags: (_result, _error, id) => [{ type: 'Store', id: `home:${id}` }] }),
    restoreStoreHome: build.mutation<StoreHomeEditor, { id: string; version: number }>({
      query: ({ id, version }) => ({ url: `/v1/stores/${id}/home/restore`, method: 'POST', body: { version } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Store', id: `home:${id}` }],
    }),
    previewStoreHome: build.mutation<{ object: 'store_home_preview'; url: string; token: string; expires_at: string }, string>({ query: id => ({ url: `/v1/stores/${id}/home/preview`, method: 'POST' }) }),
    unpublishStore: build.mutation<Store, string>({ query: id => ({ url: `/v1/stores/${id}/unpublish`, method: 'POST' }), invalidatesTags: ['Store'] }),
    subdomainCheck: build.query<SubdomainCheck, string>({ query: subdomain => `/v1/stores/subdomains/${encodeURIComponent(subdomain)}`, keepUnusedDataFor: 10 }),
    updateBusiness: build.mutation<ResellerProfile, { name?: string; country?: string }>({
      query: body => ({ url: '/v1/reseller', method: 'PATCH', body }),
      invalidatesTags: ['Session', 'Account', 'Settings', 'IdentityCheck'],
    }),
    resellerSettings: build.query<ResellerSettings, void>({ query: () => '/v1/settings', providesTags: ['Settings'] }),
    setSettingsOption: build.mutation<{ object: 'settings'; options: SettingsOptions }, { key: SettingsOptionKey; value: string }>({
      query: ({ key, value }) => ({ url: `/v1/settings/options/${key}`, method: 'PUT', body: { value } }),
      invalidatesTags: ['Settings'],
    }),
    storeCustomers: build.query<List<StoreCustomer>, { storeId: string } & StoreCustomerFilter>({
      query: ({ storeId, ...params }) => ({ url: `/v1/stores/${storeId}/customers`, params }),
      providesTags: ['StoreCustomer'],
    }),
    storeCustomer: build.query<StoreCustomerDetail, { storeId: string; id: string }>({
      query: ({ storeId, id }) => `/v1/stores/${storeId}/customers/${id}`,
      providesTags: ['StoreCustomer'],
    }),
    /** The identity check off or on (never marks them checked), or the account disabled or re-enabled. */
    updateStoreCustomer: build.mutation<StoreCustomerDetail, { storeId: string; id: string } & StoreCustomerUpdate>({
      query: ({ storeId, id, ...body }) => ({ url: `/v1/stores/${storeId}/customers/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['StoreCustomer'],
    }),
    unlockStoreCustomer: build.mutation<StoreCustomerDetail, { storeId: string; id: string }>({
      query: ({ storeId, id }) => ({ url: `/v1/stores/${storeId}/customers/${id}/unlock`, method: 'POST' }),
      invalidatesTags: ['StoreCustomer'],
    }),
    signOutStoreCustomer: build.mutation<StoreCustomerDetail, { storeId: string; id: string }>({
      query: ({ storeId, id }) => ({ url: `/v1/stores/${storeId}/customers/${id}/sign-out`, method: 'POST' }),
      invalidatesTags: ['StoreCustomer'],
    }),
    publicCountries: build.query<List<Country>, void>({ query: () => '/v1/countries', providesTags: ['Country'] }),
    publicCountry: build.query<Country, string>({ query: code => `/v1/countries/${encodeURIComponent(code)}`, providesTags: ['Country'] }),
  }),
});

export const {
  useStoresQuery,
  useStoreTemplatesQuery,
  useStoreHomeQuery,
  useSaveStoreHomeMutation,
  usePublishStoreHomeMutation,
  useResetStoreHomeMutation,
  useStoreHomeVersionsQuery,
  useRestoreStoreHomeMutation,
  usePreviewStoreHomeMutation,
  useStoreTrafficQuery,
  useCreateStoreMutation,
  useUpdateStoreMutation,
  usePublishStoreMutation,
  useUnpublishStoreMutation,
  useSubdomainCheckQuery,
  useUpdateBusinessMutation,
  useResellerSettingsQuery,
  useSetSettingsOptionMutation,
  useStoreCustomersQuery,
  useStoreCustomerQuery,
  useUpdateStoreCustomerMutation,
  useUnlockStoreCustomerMutation,
  useSignOutStoreCustomerMutation,
  usePublicCountriesQuery,
  usePublicCountryQuery,
} = resellerStoreApi;
