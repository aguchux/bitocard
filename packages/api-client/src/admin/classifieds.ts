import { bitocardApi } from '../base';
import { type Patch, settleOptimistic } from '../optimistic';
import type { List } from './types';

/** BitoCard Shop (classifieds) for admins: moderation, sellers, categories, market rules and Safe pay. */

export const classifiedListingStatuses = ['draft', 'pending_review', 'active', 'sold', 'expired', 'rejected', 'removed', 'deleted'] as const;
export type ClassifiedListingStatus = (typeof classifiedListingStatuses)[number];
export type ClassifiedReviewFlag = 'first_listings' | 'prohibited_words' | 'price_low' | 'photo_reused' | 'posting_fast' | 'reported';
export type ClassifiedReportReason = 'scam' | 'prohibited' | 'wrong_category' | 'duplicate' | 'sold' | 'offensive' | 'other';
export type ClassifiedReportStatus = 'open' | 'dismissed' | 'actioned';

export type ClassifiedListing = {
  object: 'classified_listing';
  id: string;
  ref: number;
  status: ClassifiedListingStatus;
  review_reason: string | null;
  review_flags: ClassifiedReviewFlag[];
  title: string | null;
  description: string | null;
  price: { kind: 'fixed' | 'negotiable' | 'on_request'; amount: number | null; currency: string };
  condition: 'new' | 'used' | 'untested' | 'parts' | null;
  category: { id: string; slug: string; name: string; parent: { id: string; slug: string; name: string } | null } | null;
  country: string;
  area: { id: string; slug: string; name: string; state: { id: string; slug: string; name: string } | null } | null;
  features: Array<{ key: string; name: string; icon: string; unit: string | null; value: string | number | boolean | null }>;
  photos: Array<{ id: string; url: string; width: number | null; height: number | null; status: string }>;
  video: { id: string; url: string | null; poster_url: string | null; duration_ms: number | null; status: string; failure_reason: string | null } | null;
  delivery: 'none' | 'state' | 'nationwide';
  contact: 'chat' | 'phone' | 'both';
  views: number;
  leads: number;
  url: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  published_at: string | null;
  expires_at: string | null;
  sold_at: string | null;
};

/** A listing as moderators see it: with its seller (email included) and open reports. */
export type AdminClassifiedListing = ClassifiedListing & {
  seller: { id: string; name: string; email: string; member_since: string; phone_confirmed: boolean; suspended: boolean; published_listings: number | null };
  open_reports: Array<{ id: string; reason: ClassifiedReportReason; details: string | null; created_at: string }>;
};

export type AdminClassifiedListingFilter = { status?: ClassifiedListingStatus; country?: string; customer_id?: string; q?: string; offset?: number };

export type AdminClassifiedReport = {
  object: 'classified_report';
  id: string;
  listing_id: string | null;
  reported_customer_id: string | null;
  conversation_id: string | null;
  reason: ClassifiedReportReason;
  details: string | null;
  status: ClassifiedReportStatus;
  note: string | null;
  decided_at: string | null;
  created_at: string;
  listing: { id: string; ref: number; title: string | null; status: ClassifiedListingStatus; country: string } | null;
  reporter: { id: string; name: string; email: string };
};

export type ClassifiedSeller = {
  object: 'classified_seller';
  id: string;
  name: string;
  email: string;
  country: string | null;
  member_since: string;
  phone_confirmed: boolean;
  suspended: boolean;
  suspended_reason: string | null;
  suspended_at: string | null;
  listings: { active: number; pending_review: number; sold: number; removed: number; total: number };
  open_reports: number;
  safe_pay_sales: number;
};

export type ClassifiedSafePayStanding = {
  strikes: number;
  strike_limit: number | null;
  limited: boolean;
  cancelled_after_accepting: number;
  not_handed_over: number;
  disputes_lost: number;
  cleared_at: string | null;
};

export type ClassifiedSellerDetail = ClassifiedSeller & {
  safe_pay: ClassifiedSafePayStanding & { bought: number };
  reports: Array<{ id: string; reason: ClassifiedReportReason; details: string | null; status: ClassifiedReportStatus; note: string | null; listing: { id: string; ref: number; title: string | null } | null; conversation_id: string | null; created_at: string }>;
};

export type AdminClassifiedCategory = {
  object: 'classified_admin_category';
  id: string;
  slug: string;
  name: string;
  icon: string;
  b2b: boolean;
  /** Off: no new listings in it anywhere. */
  enabled: boolean;
  /** Open in the country asked for. */
  open: boolean;
  active_listings: number;
};
export type AdminClassifiedCategoryTop = AdminClassifiedCategory & { children: AdminClassifiedCategory[] };

export type ClassifiedProhibitedWord = { object: 'classified_prohibited_word'; id: string; country: string | null; phrase: string; action: 'block' | 'review' };

export type ClassifiedMarketSettings = {
  object: 'classified_market_settings';
  country: string;
  listing_days: number;
  monthly_listing_limit: number;
  first_listings_reviewed: number;
  min_photos: number;
  max_photos: number;
};

/** A reported chat, read in full (every read is audited). */
export type ClassifiedConversationReview = {
  object: 'classified_conversation_review';
  id: string;
  listing: { id: string; ref: number; title: string | null; slug: string | null; status: ClassifiedListingStatus; country: string; price: ClassifiedListing['price']; cover_url: string | null };
  buyer: { id: string; name: string; email: string };
  seller: { id: string; name: string; email: string };
  blocked: { by_buyer: boolean; by_seller: boolean };
  reports: Array<{ id: string; reason: ClassifiedReportReason; details: string | null; status: ClassifiedReportStatus; by: 'buyer' | 'seller'; created_at: string }>;
  messages: Array<{
    id: string;
    kind: 'text' | 'photo' | 'offer' | 'system';
    from: 'buyer' | 'seller' | 'bitocard';
    body: string;
    photo: { url: string; content_type: string | null; width: number | null; height: number | null } | null;
    /** `made_by` is the customer's ID here. */
    offer: { id: string; price: { amount: number; currency: string }; status: string; made_by: string; expires_at: string } | null;
    created_at: string;
  }>;
  created_at: string;
};

export const classifiedOrderStatuses = ['requested', 'declined', 'lapsed', 'awaiting_payment', 'cancelled', 'paid', 'sent', 'disputed', 'released', 'refunded', 'partly_refunded'] as const;
export type ClassifiedOrderStatus = (typeof classifiedOrderStatuses)[number];
export type ClassifiedPayoutReview = 'pending' | 'approved' | 'rejected';
export type ClassifiedDisputeDecision = 'refund' | 'partial' | 'release';

export type AdminClassifiedOrder = {
  object: 'classified_order';
  id: string;
  number: string;
  role: 'admin';
  status: ClassifiedOrderStatus;
  listing: { id: string; ref: number; title: string | null; slug: string | null; cover_url: string | null };
  buyer: { id: string; name: string; email: string };
  seller: { id: string; name: string; email: string };
  mode: 'live' | 'test';
  country: string;
  fulfilment: 'meet_up' | 'delivery';
  currency: string;
  price: number;
  buyer_fee: number;
  total: number;
  seller_fee: number;
  payout: number;
  refund: number | null;
  delivery_address: string | null;
  tracking_note: string | null;
  release_tries_left: number | null;
  deadlines: { accept_by: string; pay_by: string | null; handover_by: string | null; confirm_by: string | null };
  timeline: { requested_at: string; accepted_at: string | null; paid_at: string | null; sent_at: string | null; released_at: string | null; refunded_at: string | null; closed_at: string | null };
  ended_by: 'buyer' | 'seller' | 'bitocard' | null;
  end_reason: string | null;
  payout_review: ClassifiedPayoutReview | null;
  dispute: { id: string; status: 'open' | 'decided'; reason: string; decision: ClassifiedDisputeDecision | null } | null;
};

export type ClassifiedDispute = {
  object: 'classified_dispute';
  id: string;
  reason: 'not_received' | 'not_as_described' | 'damaged' | 'other';
  status: 'open' | 'decided';
  decision: ClassifiedDisputeDecision | null;
  refund: number | null;
  note: string | null;
  decided_at: string | null;
  created_at: string;
};

export type ClassifiedDisputeMessage = {
  object: 'classified_dispute_message';
  id: string;
  from: 'buyer' | 'seller' | 'bitocard';
  body: string;
  photo: { url: string; content_type: string | null; size: number | null; width: number | null; height: number | null } | null;
  created_at: string;
};

export type AdminClassifiedOrderDetail = Omit<AdminClassifiedOrder, 'dispute'> & { dispute: (ClassifiedDispute & { messages: ClassifiedDisputeMessage[] }) | null };
export type AdminClassifiedDisputeRow = ClassifiedDispute & { order: AdminClassifiedOrder };
export type AdminClassifiedOrderFilter = { status?: ClassifiedOrderStatus; country?: string; q?: string; payout_review?: ClassifiedPayoutReview; offset?: number };

export type ClassifiedSafePaySettings = {
  object: 'classified_safe_pay_settings';
  country: string;
  buyer_fee_bps: number | null;
  buyer_fee_cap: number | null;
  seller_fee_bps: number | null;
  seller_fee_cap: number | null;
  new_seller_order_limit: number | null;
  accept_hours: number;
  pay_hours: number;
  handover_days: number;
  confirm_days: number;
  strike_limit: number;
  /** Both fees (rate and cap) set: Safe pay can open where its switch is on. */
  ready: boolean;
};
export type ClassifiedSafePaySettingsInput = Partial<Omit<ClassifiedSafePaySettings, 'object' | 'country' | 'ready'>>;

type Paged<T> = List<T> & { total: number };

/** Drops empty values so query strings stay clean. */
const params = (values: Record<string, string | number | undefined | null>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));

const listingTags = (id: string) => [{ type: 'ClassifiedListing' as const, id }, { type: 'ClassifiedListing' as const, id: 'LIST' }, { type: 'ClassifiedSeller' as const, id: 'LIST' }, 'Activity' as const];
const orderTags = (id: string) => [{ type: 'ClassifiedOrder' as const, id }, { type: 'ClassifiedOrder' as const, id: 'LIST' }, 'Activity' as const];

export const adminClassifiedsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    // ---- Moderation ----
    classifiedQueue: build.query<List<AdminClassifiedListing>, { country?: string } | void>({
      query: arg => ({ url: '/v1/admin/classifieds/queue', params: params({ country: arg?.country }) }),
      providesTags: [{ type: 'ClassifiedListing', id: 'LIST' }],
    }),
    classifiedListings: build.query<Paged<AdminClassifiedListing>, AdminClassifiedListingFilter>({
      query: filter => ({ url: '/v1/admin/classifieds/listings', params: params({ limit: 50, ...filter }) }),
      providesTags: [{ type: 'ClassifiedListing', id: 'LIST' }],
    }),
    classifiedListing: build.query<AdminClassifiedListing, string>({
      query: id => `/v1/admin/classifieds/listings/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [{ type: 'ClassifiedListing', id }],
    }),
    moderateClassifiedListing: build.mutation<AdminClassifiedListing, { id: string; action: 'approve' | 'reject' | 'remove'; note: string }>({
      query: ({ id, action, note }) => ({ url: `/v1/admin/classifieds/listings/${encodeURIComponent(id)}/${action}`, method: 'POST', body: action === 'approve' ? (note ? { note } : {}) : { reason: note } }),
      invalidatesTags: (_result, _error, { id }) => [...listingTags(id), { type: 'ClassifiedReport', id: 'LIST' }],
    }),
    classifiedReports: build.query<List<AdminClassifiedReport>, { status?: ClassifiedReportStatus; offset?: number }>({
      query: filter => ({ url: '/v1/admin/classifieds/reports', params: params({ limit: 50, ...filter }) }),
      providesTags: [{ type: 'ClassifiedReport', id: 'LIST' }],
    }),
    resolveClassifiedReport: build.mutation<AdminClassifiedReport, { id: string; action: 'dismiss' | 'remove_listing'; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/reports/${encodeURIComponent(id)}/resolve`, method: 'POST', body }),
      invalidatesTags: [{ type: 'ClassifiedReport', id: 'LIST' }, { type: 'ClassifiedListing', id: 'LIST' }, 'ClassifiedListing', 'ClassifiedSeller', 'Activity'],
    }),
    classifiedConversation: build.query<ClassifiedConversationReview, string>({
      query: id => `/v1/admin/classifieds/conversations/${encodeURIComponent(id)}`,
      // Every read is audited: never refetched in the background.
      keepUnusedDataFor: 0,
    }),

    // ---- Sellers ----
    classifiedSellers: build.query<Paged<ClassifiedSeller>, { country?: string; q?: string; status?: 'all' | 'suspended'; offset?: number }>({
      query: filter => ({ url: '/v1/admin/classifieds/sellers', params: params({ limit: 50, ...filter }) }),
      providesTags: [{ type: 'ClassifiedSeller', id: 'LIST' }],
    }),
    classifiedSeller: build.query<ClassifiedSellerDetail, string>({
      query: id => `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [{ type: 'ClassifiedSeller', id }],
    }),
    setClassifiedSellerSuspended: build.mutation<unknown, { id: string; suspended: boolean; reason: string }>({
      query: ({ id, suspended, reason }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/${suspended ? 'suspend' : 'unsuspend'}`, method: 'POST', body: { reason } }),
      // Suspending removes the seller's live and waiting listings.
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ClassifiedSeller', id }, { type: 'ClassifiedSeller', id: 'LIST' }, { type: 'ClassifiedListing', id: 'LIST' }, 'ClassifiedListing', 'Activity'],
    }),
    clearClassifiedStrikes: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/safe-pay/clear`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ClassifiedSeller', id }, 'Activity'],
    }),

    // ---- Categories and market rules ----
    classifiedCategories: build.query<List<AdminClassifiedCategoryTop> & { country: string }, string>({
      query: country => ({ url: '/v1/admin/classifieds/categories', params: { country } }),
      providesTags: (_result, _error, country) => [{ type: 'ClassifiedCategory', id: country }],
    }),
    /** Shown at once in every market's list; a refusal undoes it and reloads. */
    setClassifiedCategory: build.mutation<unknown, { id: string; enabled: boolean }>({
      query: ({ id, enabled }) => ({ url: `/v1/admin/classifieds/categories/${encodeURIComponent(id)}`, method: 'PATCH', body: { enabled } }),
      async onQueryStarted({ id, enabled }, { dispatch, getState, queryFulfilled }) {
        const markets = adminClassifiedsApi.util.selectCachedArgsForQuery(getState() as Parameters<typeof adminClassifiedsApi.util.selectCachedArgsForQuery>[0], 'classifiedCategories');
        const patches = markets.map(country => patchCategory(dispatch, country, id, category => void (category.enabled = enabled)));
        await settleOptimistic(patches, queryFulfilled, () => dispatch(adminClassifiedsApi.util.invalidateTags(['ClassifiedCategory'])));
      },
      invalidatesTags: ['Activity'],
    }),
    /** Shown at once; a refusal undoes it and reloads the market's list. */
    setClassifiedCategoryCountry: build.mutation<unknown, { id: string; country: string; open: boolean }>({
      query: ({ id, country, open }) => ({ url: `/v1/admin/classifieds/categories/${encodeURIComponent(id)}/countries/${country}`, method: 'PUT', body: { open } }),
      async onQueryStarted({ id, country, open }, { dispatch, queryFulfilled }) {
        const patch = patchCategory(dispatch, country, id, category => void (category.open = open));
        await settleOptimistic([patch], queryFulfilled, () => dispatch(adminClassifiedsApi.util.invalidateTags([{ type: 'ClassifiedCategory', id: country }])));
      },
      invalidatesTags: ['Activity'],
    }),
    classifiedWords: build.query<List<ClassifiedProhibitedWord>, string | void>({
      query: country => ({ url: '/v1/admin/classifieds/prohibited-words', params: params({ country: country ?? undefined }) }),
      providesTags: [{ type: 'ClassifiedSettings', id: 'WORDS' }],
    }),
    addClassifiedWord: build.mutation<ClassifiedProhibitedWord, { phrase: string; action: 'block' | 'review'; country: string | null }>({
      query: body => ({ url: '/v1/admin/classifieds/prohibited-words', method: 'POST', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'WORDS' }, 'Activity'],
    }),
    removeClassifiedWord: build.mutation<void, string>({
      query: id => ({ url: `/v1/admin/classifieds/prohibited-words/${encodeURIComponent(id)}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'WORDS' }, 'Activity'],
    }),
    classifiedMarketSettings: build.query<ClassifiedMarketSettings, string>({
      query: country => `/v1/admin/classifieds/market-settings/${country}`,
      providesTags: (_result, _error, country) => [{ type: 'ClassifiedSettings', id: `MARKET:${country}` }],
    }),
    updateClassifiedMarketSettings: build.mutation<ClassifiedMarketSettings, Partial<Omit<ClassifiedMarketSettings, 'object'>> & { country: string }>({
      query: ({ country, ...body }) => ({ url: `/v1/admin/classifieds/market-settings/${country}`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { country }) => [{ type: 'ClassifiedSettings', id: `MARKET:${country}` }, 'Activity'],
    }),

    // ---- Safe pay ----
    classifiedOrders: build.query<Paged<AdminClassifiedOrder>, AdminClassifiedOrderFilter>({
      query: filter => ({ url: '/v1/admin/classifieds/orders', params: params({ limit: 50, ...filter }) }),
      providesTags: [{ type: 'ClassifiedOrder', id: 'LIST' }],
    }),
    classifiedOrder: build.query<AdminClassifiedOrderDetail, string>({
      query: id => `/v1/admin/classifieds/orders/${encodeURIComponent(id)}`,
      providesTags: (_result, _error, id) => [{ type: 'ClassifiedOrder', id }],
    }),
    classifiedDisputes: build.query<List<AdminClassifiedDisputeRow>, { status?: 'open' | 'decided'; offset?: number }>({
      query: filter => ({ url: '/v1/admin/classifieds/disputes', params: params({ limit: 50, ...filter }) }),
      providesTags: [{ type: 'ClassifiedOrder', id: 'LIST' }],
    }),
    writeClassifiedDispute: build.mutation<ClassifiedDisputeMessage, { id: string; body: string }>({
      query: ({ id, body }) => ({ url: `/v1/admin/classifieds/orders/${encodeURIComponent(id)}/dispute/messages`, method: 'POST', body: { body } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ClassifiedOrder', id }],
    }),
    decideClassifiedDispute: build.mutation<AdminClassifiedOrderDetail, { id: string; decision: ClassifiedDisputeDecision; refund?: number; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/orders/${encodeURIComponent(id)}/dispute/decide`, method: 'POST', body }),
      // A refund or release moves money and may limit the seller.
      invalidatesTags: (_result, _error, { id }) => [...orderTags(id), 'ClassifiedSeller', 'Report'],
    }),
    decideClassifiedPayoutReview: build.mutation<AdminClassifiedOrderDetail, { id: string; decision: 'approve' | 'reject'; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/orders/${encodeURIComponent(id)}/payout-review`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => orderTags(id),
    }),
    classifiedSafePaySettings: build.query<ClassifiedSafePaySettings, string>({
      query: country => `/v1/admin/classifieds/safe-pay-settings/${country}`,
      providesTags: (_result, _error, country) => [{ type: 'ClassifiedSettings', id: `SAFE_PAY:${country}` }],
    }),
    updateClassifiedSafePaySettings: build.mutation<ClassifiedSafePaySettings, ClassifiedSafePaySettingsInput & { country: string }>({
      query: ({ country, ...body }) => ({ url: `/v1/admin/classifieds/safe-pay-settings/${country}`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { country }) => [{ type: 'ClassifiedSettings', id: `SAFE_PAY:${country}` }, 'Activity'],
    }),
  }),
});

export const {
  useClassifiedQueueQuery,
  useClassifiedListingsQuery,
  useClassifiedListingQuery,
  useModerateClassifiedListingMutation,
  useClassifiedReportsQuery,
  useResolveClassifiedReportMutation,
  useClassifiedConversationQuery,
  useClassifiedSellersQuery,
  useClassifiedSellerQuery,
  useSetClassifiedSellerSuspendedMutation,
  useClearClassifiedStrikesMutation,
  useClassifiedCategoriesQuery,
  useSetClassifiedCategoryMutation,
  useSetClassifiedCategoryCountryMutation,
  useClassifiedWordsQuery,
  useAddClassifiedWordMutation,
  useRemoveClassifiedWordMutation,
  useClassifiedMarketSettingsQuery,
  useUpdateClassifiedMarketSettingsMutation,
  useClassifiedOrdersQuery,
  useClassifiedOrderQuery,
  useClassifiedDisputesQuery,
  useWriteClassifiedDisputeMutation,
  useDecideClassifiedDisputeMutation,
  useDecideClassifiedPayoutReviewMutation,
  useClassifiedSafePaySettingsQuery,
  useUpdateClassifiedSafePaySettingsMutation,
} = adminClassifiedsApi;

/** Changes one category (top or sub) in a market's cached list. */
function patchCategory(dispatch: (action: unknown) => unknown, country: string, id: string, change: (category: AdminClassifiedCategory) => void): Patch {
  return dispatch(
    adminClassifiedsApi.util.updateQueryData('classifiedCategories', country, list => {
      for (const top of list.data) {
        if (top.id === id) change(top);
        for (const child of top.children) if (child.id === id) change(child);
      }
    }),
  ) as Patch;
}
