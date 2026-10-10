import { bitocardApi } from '../base';
import type { StoreCustomer, StoreCustomerFilter } from '../store-customers';
import type { List, ResellerStatus } from './common';

export type { StoreCustomer } from '../store-customers';

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
  /** Customer checkout: `test` (sandbox: simulated payments and orders) until switched `live` (needs a verified business). */
  checkout_mode: 'test' | 'live';
  /** The customer account app's menu on desktop; null follows BitoCard's default. */
  desktop_nav: 'rail' | 'bottom' | null;
  /** Customers are asked for the identity check where BitoCard's market rules require one (true), or never. */
  customer_verification: boolean;
  published_at: string | null;
  created_at: string;
};
/** `reason` explains why an address cannot be used (format, reserved or taken). Your own store's address reads as taken. */
export type SubdomainCheck = { object: 'subdomain_availability'; subdomain: string; available: boolean; reason: string | null };
export type StoreInput = { name?: string; subdomain?: string; logo_url?: string | null; primary_color?: string; accent_color?: string; checkout_mode?: 'test' | 'live'; desktop_nav?: 'rail' | 'bottom' | null; customer_verification?: boolean };

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
    /** Turns the identity check off or on for one customer of the store. Never marks them checked. */
    setStoreCustomerCheck: build.mutation<StoreCustomer, { storeId: string; id: string; identity_check: boolean }>({
      query: ({ storeId, id, identity_check }) => ({ url: `/v1/stores/${storeId}/customers/${id}`, method: 'PATCH', body: { identity_check } }),
      invalidatesTags: ['StoreCustomer'],
    }),
    publicCountries: build.query<List<Country>, void>({ query: () => '/v1/countries', providesTags: ['Country'] }),
    publicCountry: build.query<Country, string>({ query: code => `/v1/countries/${encodeURIComponent(code)}`, providesTags: ['Country'] }),
  }),
});

export const {
  useStoresQuery,
  useCreateStoreMutation,
  useUpdateStoreMutation,
  usePublishStoreMutation,
  useUnpublishStoreMutation,
  useSubdomainCheckQuery,
  useUpdateBusinessMutation,
  useResellerSettingsQuery,
  useSetSettingsOptionMutation,
  useStoreCustomersQuery,
  useSetStoreCustomerCheckMutation,
  usePublicCountriesQuery,
  usePublicCountryQuery,
} = resellerStoreApi;
