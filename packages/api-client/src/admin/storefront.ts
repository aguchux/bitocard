import { bitocardApi } from '../base';
import type { ProductCategory, Section } from '../storefront';
import type { StoreCustomer, StoreCustomerDetail, StoreCustomerFilter, StoreCustomerUpdate } from '../store-customers';
import type { List } from './types';

export type { StoreCustomer, StoreCustomerDetail } from '../store-customers';

/** bitocard.com's store settings. */
export type StorefrontSettings = {
  object: 'storefront_settings';
  /** Customers are asked for the identity check where the market requires it (true), or never. */
  customer_verification: boolean;
  /** Asked only once this many days have passed since the customer's first paid purchase; null asks before buying. */
  grace_days: number | null;
  /** The customer account app's desktop menu; null follows the `customer_app_bottom_bar_desktop` switch. */
  desktop_nav: 'rail' | 'bottom' | null;
  desktop_nav_effective: 'rail' | 'bottom';
  /** From the Customer checkout integration's Sandbox switch. */
  checkout_mode: 'test' | 'live';
};
export type StorefrontSettingsInput = Partial<Pick<StorefrontSettings, 'customer_verification' | 'grace_days' | 'desktop_nav'>>;

export type StorefrontPage = {
  object: 'storefront_page';
  key: string;
  draft: Section[];
  published: Section[] | null;
  /** The draft differs from what visitors see. */
  unpublished_changes: boolean;
  live: boolean;
  version: number;
  published_at: string | null;
  updated_at: string;
  versions: Array<{ version: number; published_at: string }>;
};

/** A brand's storefront presentation (configured once an admin saves it). */
export type AdminBrand = {
  object: 'admin_brand';
  slug: string;
  name: string;
  company: string | null;
  description: string | null;
  logo_url: string | null;
  image_url: string | null;
  color: string | null;
  initials: string;
  tags: string[];
  aliases: string[];
  /** Known to the brand registry, which supplies its defaults until it is set up. */
  in_registry: boolean;
  featured: boolean;
  sort_order: number;
  visible: boolean;
  configured: boolean;
  products: number;
  categories: ProductCategory[];
};

/** A brand registry entry (brand-registry.json) with its logo and card art: an admin upload, the file's own, or none. */
export type BrandRegistryEntry = {
  object: 'brand_registry_entry';
  slug: string;
  name: string;
  company: string | null;
  /** Every product brand slug the entry covers. */
  slugs: string[];
  color: string;
  initials: string;
  aliases: string[];
  tags: string[];
  logo_url: string | null;
  /** upload (Brand registry page), file (the registry's logo), bundled (the icon pack, on the store), or none. */
  logo_source: 'upload' | 'file' | 'bundled' | null;
  card_url: string | null;
  card_source: 'upload' | 'file' | 'bundled' | null;
  products: number;
  updated_at: string | null;
};

/** A category's icon and image on storefronts (labels are fixed). */
export type AdminCategory = { object: 'admin_category'; category: ProductCategory; label: string; icon_url: string | null; image_url: string | null; products: number };

export type BrandInput = {
  name: string;
  company?: string | null;
  description?: string | null;
  logo_url?: string | null;
  image_url?: string | null;
  color?: string | null;
  tags?: string[];
  aliases?: string[];
  featured?: boolean;
  sort_order?: number;
  visible?: boolean;
};

/** The Storefront Manager: bitocard.com's home page layout and brand presentation. */
export const adminStorefrontApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    storefrontHome: build.query<StorefrontPage, void>({ query: () => '/v1/admin/storefront/home', providesTags: ['Storefront'] }),
    saveStorefrontDraft: build.mutation<StorefrontPage, Section[]>({
      query: sections => ({ url: '/v1/admin/storefront/home/draft', method: 'PUT', body: { sections } }),
      // The saved draft comes back with defaults filled in; update the cache without refetching.
      async onQueryStarted(_sections, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(adminStorefrontApi.util.upsertQueryData('storefrontHome', undefined, data));
      },
    }),
    publishStorefront: build.mutation<StorefrontPage, void>({ query: () => ({ url: '/v1/admin/storefront/home/publish', method: 'POST' }), invalidatesTags: ['Storefront', 'Activity'] }),
    unpublishStorefront: build.mutation<StorefrontPage, void>({ query: () => ({ url: '/v1/admin/storefront/home/unpublish', method: 'POST' }), invalidatesTags: ['Storefront', 'Activity'] }),
    restoreStorefront: build.mutation<StorefrontPage, number>({ query: version => ({ url: '/v1/admin/storefront/home/restore', method: 'POST', body: { version } }), invalidatesTags: ['Storefront', 'Activity'] }),
    resetStorefront: build.mutation<StorefrontPage, void>({ query: () => ({ url: '/v1/admin/storefront/home/reset', method: 'POST' }), invalidatesTags: ['Storefront'] }),
    storefrontPreview: build.mutation<{ object: 'storefront_preview'; token: string; expires_at: string }, void>({ query: () => ({ url: '/v1/admin/storefront/home/preview', method: 'POST' }) }),
    storefrontBrands: build.query<List<AdminBrand>, void>({ query: () => '/v1/admin/storefront/brands', providesTags: ['Brand'] }),
    saveStorefrontBrand: build.mutation<AdminBrand, { slug: string; brand: BrandInput }>({
      query: ({ slug, brand }) => ({ url: `/v1/admin/storefront/brands/${encodeURIComponent(slug)}`, method: 'PUT', body: brand }),
      invalidatesTags: ['Brand', 'Media', 'Activity'],
    }),
    brandRegistry: build.query<List<BrandRegistryEntry>, void>({ query: () => '/v1/admin/storefront/registry', providesTags: ['BrandRegistry'] }),
    saveBrandRegistry: build.mutation<BrandRegistryEntry, { slug: string; logo_url?: string | null; card_url?: string | null }>({
      query: ({ slug, ...body }) => ({ url: `/v1/admin/storefront/registry/${encodeURIComponent(slug)}`, method: 'PUT', body }),
      invalidatesTags: ['BrandRegistry', 'Brand', 'Media', 'Activity'],
    }),
    storefrontCategories: build.query<List<AdminCategory>, void>({ query: () => '/v1/admin/storefront/categories', providesTags: ['Category'] }),
    saveStorefrontCategory: build.mutation<AdminCategory, { category: ProductCategory; icon_url: string | null; image_url: string | null }>({
      query: ({ category, ...body }) => ({ url: `/v1/admin/storefront/categories/${category}`, method: 'PUT', body }),
      invalidatesTags: ['Category', 'Media', 'Activity'],
    }),
    storefrontCustomers: build.query<List<StoreCustomer>, StoreCustomerFilter>({ query: params => ({ url: '/v1/admin/storefront/customers', params }), providesTags: ['StoreCustomer'] }),
    storefrontCustomer: build.query<StoreCustomerDetail, string>({ query: id => `/v1/admin/storefront/customers/${id}`, providesTags: ['StoreCustomer'] }),
    /** The identity check off or on (never marks them checked), or the account disabled or re-enabled. Audited. */
    updateStorefrontCustomer: build.mutation<StoreCustomerDetail, { id: string } & StoreCustomerUpdate>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/storefront/customers/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['StoreCustomer', 'Activity'],
    }),
    unlockStorefrontCustomer: build.mutation<StoreCustomerDetail, string>({
      query: id => ({ url: `/v1/admin/storefront/customers/${id}/unlock`, method: 'POST' }),
      invalidatesTags: ['StoreCustomer', 'Activity'],
    }),
    signOutStorefrontCustomer: build.mutation<StoreCustomerDetail, string>({
      query: id => ({ url: `/v1/admin/storefront/customers/${id}/sign-out`, method: 'POST' }),
      invalidatesTags: ['StoreCustomer', 'Activity'],
    }),
    storefrontSettings: build.query<StorefrontSettings, void>({ query: () => '/v1/admin/storefront/settings', providesTags: ['StoreCustomer'] }),
    setStorefrontSettings: build.mutation<StorefrontSettings, StorefrontSettingsInput>({
      query: body => ({ url: '/v1/admin/storefront/settings', method: 'PUT', body }),
      invalidatesTags: ['StoreCustomer', 'Activity'],
    }),
  }),
});

export const {
  useStorefrontCustomersQuery,
  useStorefrontCustomerQuery,
  useUpdateStorefrontCustomerMutation,
  useUnlockStorefrontCustomerMutation,
  useSignOutStorefrontCustomerMutation,
  useStorefrontSettingsQuery,
  useSetStorefrontSettingsMutation,
  useStorefrontHomeQuery,
  useSaveStorefrontDraftMutation,
  usePublishStorefrontMutation,
  useUnpublishStorefrontMutation,
  useRestoreStorefrontMutation,
  useResetStorefrontMutation,
  useStorefrontPreviewMutation,
  useStorefrontBrandsQuery,
  useSaveStorefrontBrandMutation,
  useStorefrontCategoriesQuery,
  useBrandRegistryQuery,
  useSaveBrandRegistryMutation,
  useSaveStorefrontCategoryMutation,
} = adminStorefrontApi;
