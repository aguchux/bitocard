import { bitocardApi } from '../base';
import type { ShopListingCard } from '../classifieds';
import type { HomeBlockType, HomeLayoutKey, HomeLook, HomeRow, HomeSection, HomeSectionType, HomeStoreCard, ResolvedHomeRow } from '../home';

// udozo.com's home pages and their Sponsored placements (Udozo's API only: /v1/admin/classifieds/home and /sponsored).

export type HomeLayoutInfo = { key: HomeLayoutKey; name: string; description: string; look: HomeLook };

/** A home page as the editor works on it: the draft's layout and rows, what is live, and its versions. */
export type HomePage = {
  object: 'home_page';
  /** `global`, or the country's code. */
  page: string;
  name: string;
  scope: 'global' | 'country';
  layout: HomeLayoutKey;
  /** The draft's rows of blocks. */
  rows: HomeRow[];
  published_layout: HomeLayoutKey | null;
  published_rows: HomeRow[] | null;
  /** Every block of the draft as one list (the editor of before). */
  draft: HomeSection[];
  published: HomeSection[] | null;
  unpublished_changes: boolean;
  live: boolean;
  version: number;
  published_at: string | null;
  updated_at: string;
  versions: Array<{ version: number; published_at: string; layout: HomeLayoutKey | null }>;
  layouts: HomeLayoutInfo[];
  blocks_allowed: HomeBlockType[];
  sections_allowed: HomeSectionType[];
};

/** Rows filled as visitors would see them, for the editor's cards (nothing saved). */
export type ResolvedHomePage = { object: 'home_page_resolved'; page: string; rows: ResolvedHomeRow[] };

export type HomePageSummary = { object: 'home_page_summary'; page: string; name: string; scope: 'global' | 'country'; layout: HomeLayoutKey; live: boolean; version: number; unpublished_changes: boolean };

/** A link showing a page's draft on udozo.com (`/home-preview?page=&token=`), valid for 30 minutes. */
export type HomePreview = { object: 'home_preview'; page: string; token: string; expires_at: string };

export type SponsoredState = 'active' | 'scheduled' | 'ended';
export type SponsoredPlacement = {
  object: 'sponsored_placement';
  id: string;
  /** The country's page; null: the page across countries. */
  country: string | null;
  state: SponsoredState;
  position: number;
  starts_at: string;
  ends_at: string;
  ended_at: string | null;
  note: string | null;
  listing: { ref: number; title: string | null; country: string; live: boolean; card: ShopListingCard | null };
  created_at: string;
  updated_at: string;
};
export type SponsoredInput = { listing_ref?: number; country?: string | null; starts_at?: string; ends_at?: string; position?: number; note?: string | null };

const pageTag = (page: string) => ({ type: 'Settings' as const, id: `HOME-${page.toUpperCase()}` });
const pagesTag = { type: 'Settings' as const, id: 'HOME' };

export const adminUdozoHomeApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    homePages: build.query<{ object: 'list'; data: HomePageSummary[] }, void>({ query: () => '/v1/admin/classifieds/home', providesTags: [pagesTag] }),
    homePage: build.query<HomePage, string>({ query: page => `/v1/admin/classifieds/home/${page}`, providesTags: (_result, _error, page) => [pageTag(page)] }),
    saveHomeDraft: build.mutation<HomePage, { page: string; sections: HomeSection[] }>({
      query: ({ page, sections }) => ({ url: `/v1/admin/classifieds/home/${page}/draft`, method: 'PUT', body: { sections } }),
      // The editor keeps its own working copy: only the list's "unpublished changes" needs reading again.
      invalidatesTags: [pagesTag],
    }),
    saveHomeRows: build.mutation<HomePage, { page: string; rows: HomeRow[] }>({
      query: ({ page, rows }) => ({ url: `/v1/admin/classifieds/home/${page}/draft`, method: 'PUT', body: { rows } }),
      invalidatesTags: [pagesTag],
    }),
    /** The rows filled as visitors would see them (never cached, nothing saved). */
    resolveHomeRows: build.mutation<ResolvedHomePage, { page: string; rows: HomeRow[] }>({
      query: ({ page, rows }) => ({ url: `/v1/admin/classifieds/home/${page}/resolve`, method: 'POST', body: { rows } }),
    }),
    /** Resellers' stores live on their own domain, to pick for a stores marquee on this page. */
    homeStores: build.query<{ object: 'list'; data: HomeStoreCard[] }, { page: string; q?: string }>({
      query: ({ page, q }) => ({ url: `/v1/admin/classifieds/home/${page}/stores`, params: q ? { q } : {} }),
    }),
    setHomeLayout: build.mutation<HomePage, { page: string; layout: HomeLayoutKey; replace: boolean }>({
      query: ({ page, ...body }) => ({ url: `/v1/admin/classifieds/home/${page}/layout`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { page }) => [pageTag(page), pagesTag, 'Activity'],
    }),
    homePreview: build.mutation<HomePreview, string>({ query: page => ({ url: `/v1/admin/classifieds/home/${page}/preview`, method: 'POST' }) }),
    publishHome: build.mutation<HomePage, string>({ query: page => ({ url: `/v1/admin/classifieds/home/${page}/publish`, method: 'POST' }), invalidatesTags: (_result, _error, page) => [pageTag(page), pagesTag, 'Activity'] }),
    unpublishHome: build.mutation<HomePage, string>({ query: page => ({ url: `/v1/admin/classifieds/home/${page}/unpublish`, method: 'POST' }), invalidatesTags: (_result, _error, page) => [pageTag(page), pagesTag, 'Activity'] }),
    restoreHome: build.mutation<HomePage, { page: string; version: number }>({
      query: ({ page, version }) => ({ url: `/v1/admin/classifieds/home/${page}/restore`, method: 'POST', body: { version } }),
      invalidatesTags: [pagesTag, 'Activity'],
    }),
    resetHome: build.mutation<HomePage, string>({ query: page => ({ url: `/v1/admin/classifieds/home/${page}/reset`, method: 'POST' }), invalidatesTags: [pagesTag, 'Activity'] }),

    sponsoredPlacements: build.query<{ object: 'list'; data: SponsoredPlacement[] }, { country?: string; state?: SponsoredState }>({
      query: ({ country, state }) => ({ url: '/v1/admin/classifieds/sponsored', params: { ...(country ? { country } : {}), ...(state ? { state } : {}) } }),
      providesTags: [{ type: 'Settings', id: 'SPONSORED' }],
    }),
    createSponsored: build.mutation<SponsoredPlacement, SponsoredInput>({
      query: body => ({ url: '/v1/admin/classifieds/sponsored', method: 'POST', body }),
      invalidatesTags: [{ type: 'Settings', id: 'SPONSORED' }, 'Activity'],
    }),
    updateSponsored: build.mutation<SponsoredPlacement, SponsoredInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/sponsored/${id}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'Settings', id: 'SPONSORED' }, 'Activity'],
    }),
    endSponsored: build.mutation<SponsoredPlacement, string>({
      query: id => ({ url: `/v1/admin/classifieds/sponsored/${id}/end`, method: 'POST' }),
      invalidatesTags: [{ type: 'Settings', id: 'SPONSORED' }, 'Activity'],
    }),
  }),
});

export const {
  useHomePagesQuery,
  useHomePageQuery,
  useSaveHomeDraftMutation,
  useSaveHomeRowsMutation,
  useResolveHomeRowsMutation,
  useHomeStoresQuery,
  useSetHomeLayoutMutation,
  useHomePreviewMutation,
  usePublishHomeMutation,
  useUnpublishHomeMutation,
  useRestoreHomeMutation,
  useResetHomeMutation,
  useSponsoredPlacementsQuery,
  useCreateSponsoredMutation,
  useUpdateSponsoredMutation,
  useEndSponsoredMutation,
} = adminUdozoHomeApi;
