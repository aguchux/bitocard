import { bitocardApi } from '../base';

// udozo.com's hero reel (Udozo's API only: /v1/admin/classifieds/hero-slides).

/** How a column is split, top to bottom: one banner, a third over two thirds, two thirds over a third, or three thirds. */
export type HeroLayout = 'full' | 'third_two_thirds' | 'two_thirds_third' | 'thirds';
/** Banners each split holds. */
export const heroTileCount: Record<HeroLayout, number> = { full: 1, third_two_thirds: 2, two_thirds_third: 2, thirds: 3 };
/** Where a banner links: a listing, a brand's page, a seller's page, a category or any address. */
export type HeroLinkKind = 'listing' | 'brand' | 'seller' | 'category' | 'url';
/** A suggestion for a link as the admin types: `value` goes in the link's target. */
export type HeroTarget = { value: string; label: string; detail: string | null; image_url: string | null };
export type HeroState = 'showing' | 'off' | 'scheduled' | 'ended';

export type HeroTile = {
  id: string;
  slot: number;
  image_url: string;
  alt: string;
  /** Labelled Ad on udozo.com. */
  ad: boolean;
  /** `target`: the listing's number, brand's slug, seller's username or handle, category's slug, or the address; `href`: where it goes now (null when gone). */
  link: { kind: HeroLinkKind; target: string; label: string | null; href: string | null };
};

export type HeroSlide = {
  object: 'hero_slide';
  id: string;
  /** A market's code, or null for every market. */
  country: string | null;
  layout: HeroLayout;
  position: number;
  tiles: HeroTile[];
  enabled: boolean;
  state: HeroState;
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type HeroTileInput = { image_url: string; alt: string; link: { kind: HeroLinkKind; target: string }; ad?: boolean };
export type HeroSlideInput = { country?: string | null; layout?: HeroLayout; tiles?: HeroTileInput[]; enabled?: boolean; starts_at?: string | null; ends_at?: string | null; note?: string | null };

const tag = { type: 'Settings' as const, id: 'HERO_SLIDES' };

export const adminUdozoHeroSlidesApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    heroSlides: build.query<{ object: 'list'; scope: string; data: HeroSlide[] }, string>({
      query: scope => ({ url: '/v1/admin/classifieds/hero-slides', params: { scope } }),
      providesTags: [tag],
    }),
    createHeroSlide: build.mutation<HeroSlide, HeroSlideInput>({
      query: body => ({ url: '/v1/admin/classifieds/hero-slides', method: 'POST', body }),
      invalidatesTags: [tag, 'Activity'],
    }),
    updateHeroSlide: build.mutation<HeroSlide, HeroSlideInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/hero-slides/${id}`, method: 'PATCH', body }),
      invalidatesTags: [tag, 'Activity'],
    }),
    deleteHeroSlide: build.mutation<{ object: 'hero_slide'; id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/admin/classifieds/hero-slides/${id}`, method: 'DELETE' }),
      invalidatesTags: [tag, 'Activity'],
    }),
    heroTargets: build.query<{ object: 'list'; kind: string; data: HeroTarget[] }, { kind: Exclude<HeroLinkKind, 'url'>; q: string; scope: string }>({
      query: params => ({ url: '/v1/admin/classifieds/hero-slides/targets', params }),
      keepUnusedDataFor: 30,
    }),
    reorderHeroSlides: build.mutation<{ object: 'list'; scope: string; data: HeroSlide[] }, { scope: string; ids: string[] }>({
      query: body => ({ url: '/v1/admin/classifieds/hero-slides/order', method: 'POST', body }),
      invalidatesTags: [tag, 'Activity'],
    }),
  }),
});

export const { useHeroSlidesQuery, useLazyHeroTargetsQuery, useCreateHeroSlideMutation, useUpdateHeroSlideMutation, useDeleteHeroSlideMutation, useReorderHeroSlidesMutation } = adminUdozoHeroSlidesApi;
