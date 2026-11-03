import { bitocardApi } from '../base';

// udozo.com's banner ads (Udozo's API only: /v1/admin/classifieds/banners).

/** Where a banner shows: `account_rail`, the account pages, above the menu on the left. */
export type BannerPosition = 'account_rail';
export type BannerState = 'showing' | 'off' | 'scheduled' | 'ended';
export type Banner = {
  object: 'banner';
  id: string;
  position: BannerPosition;
  /** A market's code, or null for every market (a market's own banners win). */
  country: string | null;
  image_url: string;
  /** A page on udozo.com (`/…`) or an https address. */
  href: string;
  alt: string;
  /** The gate: off, it never shows. */
  enabled: boolean;
  state: BannerState;
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
export type BannerInput = Partial<Pick<Banner, 'position' | 'country' | 'image_url' | 'href' | 'alt' | 'enabled' | 'starts_at' | 'ends_at' | 'note'>>;

const tag = { type: 'Settings' as const, id: 'BANNERS' };

export const adminUdozoBannersApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    banners: build.query<{ object: 'list'; data: Banner[] }, { position?: BannerPosition; country?: string } | void>({
      query: filter => ({ url: '/v1/admin/classifieds/banners', params: { ...(filter?.position ? { position: filter.position } : {}), ...(filter?.country ? { country: filter.country } : {}) } }),
      providesTags: [tag],
    }),
    createBanner: build.mutation<Banner, BannerInput>({
      query: body => ({ url: '/v1/admin/classifieds/banners', method: 'POST', body }),
      invalidatesTags: [tag, 'Activity'],
    }),
    updateBanner: build.mutation<Banner, BannerInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/banners/${id}`, method: 'PATCH', body }),
      invalidatesTags: [tag, 'Activity'],
    }),
    deleteBanner: build.mutation<{ object: 'banner'; id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/admin/classifieds/banners/${id}`, method: 'DELETE' }),
      invalidatesTags: [tag, 'Activity'],
    }),
  }),
});

export const { useBannersQuery, useCreateBannerMutation, useUpdateBannerMutation, useDeleteBannerMutation } = adminUdozoBannersApi;
