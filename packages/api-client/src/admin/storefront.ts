import { bitocardApi } from '../base';
import type { ProductCategory, Section } from '../storefront';
import type { List } from './types';

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
  tags: string[];
  aliases: string[];
  featured: boolean;
  sort_order: number;
  visible: boolean;
  configured: boolean;
  products: number;
  categories: ProductCategory[];
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
    storefrontCategories: build.query<List<AdminCategory>, void>({ query: () => '/v1/admin/storefront/categories', providesTags: ['Category'] }),
    saveStorefrontCategory: build.mutation<AdminCategory, { category: ProductCategory; icon_url: string | null; image_url: string | null }>({
      query: ({ category, ...body }) => ({ url: `/v1/admin/storefront/categories/${category}`, method: 'PUT', body }),
      invalidatesTags: ['Category', 'Media', 'Activity'],
    }),
  }),
});

export const {
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
  useSaveStorefrontCategoryMutation,
} = adminStorefrontApi;
