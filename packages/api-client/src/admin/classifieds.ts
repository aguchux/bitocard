import { bitocardApi } from '../base';
import { type Patch, settleOptimistic } from '../optimistic';
import type { List } from './types';

/** BitoCard Shop (classifieds) for admins: moderation, sellers, categories, market rules and Safe pay. */

export const classifiedListingStatuses = ['draft', 'pending_review', 'active', 'sold', 'expired', 'rejected', 'removed', 'deleted'] as const;
export type ClassifiedListingStatus = (typeof classifiedListingStatuses)[number];
export type ClassifiedReviewFlag = 'first_listings' | 'prohibited_words' | 'price_low' | 'photo_reused' | 'posting_fast' | 'reported';
/** `review_pressure`: chats only (Udozo): a refund or discount offered to change a review, or something demanded for one. */
export type ClassifiedReportReason = 'scam' | 'prohibited' | 'wrong_category' | 'duplicate' | 'sold' | 'offensive' | 'other' | 'review_pressure';
export type ClassifiedReportStatus = 'open' | 'dismissed' | 'actioned';

export type ClassifiedListing = {
  object: 'classified_listing';
  id: string;
  ref: number;
  /** Its category's prefix and number (PHN-000123); null until it has a category. */
  sku: string | null;
  status: ClassifiedListingStatus;
  review_reason: string | null;
  /** Udozo: why a moderator sent it back or removed it, as a code (`listingReviewCodes`). */
  review_reason_code?: ListingReviewCode | null;
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
/** Udozo's reasons for sending an ad back or removing it; the seller reads the moderator's note, else the code's own sentence. */
export const listingReviewCodes = ['photos', 'wrong_category', 'prohibited_item', 'misleading', 'contact_details', 'duplicate', 'other'] as const;
export type ListingReviewCode = (typeof listingReviewCodes)[number];
export const listingReviewCodeLabels: Record<ListingReviewCode, string> = {
  photos: 'Photos',
  wrong_category: 'Wrong category',
  prohibited_item: 'Prohibited item',
  misleading: 'Misleading',
  contact_details: 'Contact details in the ad',
  duplicate: 'Duplicate',
  other: 'Other',
};
/** What the seller reads when the moderator writes no note (kept in step with `reviewCodeText` in Udozo's API). */
export const listingReviewCodeText: Record<ListingReviewCode, string> = {
  photos: 'The photos need to show the item clearly: your own photos of it, well lit, nothing else in them.',
  wrong_category: 'This ad is in the wrong category: choose the one that fits the item.',
  prohibited_item: 'This item cannot be sold on Udozo. See the prohibited items in the marketplace terms.',
  misleading: 'The title, price or description does not match the item: say exactly what it is.',
  contact_details: 'Take your phone number, email or links out of the ad: buyers reach you through Udozo.',
  duplicate: 'You already have an ad for this item: keep one ad for it.',
  other: 'This ad needs changes before it can go live.',
};

export type AdminClassifiedListing = ClassifiedListing & {
  /** When a moderator last decided it, and who (an admin's id). */
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  seller: { id: string; name: string; email: string; member_since: string; phone_confirmed: boolean; suspended: boolean; published_listings: number | null };
  open_reports: Array<{ id: string; reason: ClassifiedReportReason; details: string | null; created_at: string }>;
};

/** Why ads are in the queue: all, a new seller's first ads, those the automatic checks flagged, or reported ones. */
export type ClassifiedQueueView = 'all' | 'new_sellers' | 'flagged' | 'reported';
export type ClassifiedQueue = List<AdminClassifiedListing> & {
  /** The whole queue in the market, and today's decisions (UTC). */
  stats: { waiting: number; oldest_submitted_at: string | null; approved_today: number; sent_back_today: number; removed_today: number };
};

export type ClassifiedFeatureDataType = 'text' | 'number' | 'choice' | 'boolean';
/** A registry key as admins see it: switched-off ones too, with the categories suggesting it and how many listings use it. */
export type AdminClassifiedFeature = {
  object: 'classified_feature';
  id: string;
  key: string;
  name: string;
  icon: string;
  data_type: ClassifiedFeatureDataType;
  unit: string | null;
  choices: string[];
  default_value: string | null;
  placeholder: string | null;
  min: number | null;
  max: number | null;
  synonyms: string[];
  filterable: boolean;
  enabled: boolean;
  categories: string[];
  listings: number;
  updated_at: string;
};
export type ClassifiedFeatureInput = Partial<Pick<AdminClassifiedFeature, 'name' | 'icon' | 'unit' | 'choices' | 'default_value' | 'placeholder' | 'min' | 'max' | 'synonyms' | 'filterable' | 'enabled'>>;
export type ClassifiedFeatureCreate = ClassifiedFeatureInput & { key: string; name: string; icon: string; data_type: ClassifiedFeatureDataType; suggestion?: string };
/** Sellers asking for the same missing key, counted together. */
/** Udozo's brand registry, as admins see a brand. */
export type AdminClassifiedBrand = {
  object: 'classified_brand';
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  /** What shows: the upload, else the bundled logo, else none (its initials on its colour). */
  logo_url: string | null;
  logo_source: 'uploaded' | 'bundled' | null;
  bundled_logo_url: string | null;
  uploaded_logo_url: string | null;
  /** The banner across the top of its brand pages on udozo.com (4:1); null for Udozo's drawn one. */
  banner_url: string | null;
  color: string | null;
  enabled: boolean;
  categories: Array<{ id: string; slug: string; name: string }>;
  /** Live ads with it, everywhere. */
  listings: number;
  /** Its models, in every category. */
  models: number;
  updated_at: string;
};
export type ClassifiedBrandInput = { name?: string; aliases?: string[]; color?: string | null; logo_url?: string | null; banner_url?: string | null; category_ids?: string[]; enabled?: boolean };
export type ClassifiedBrandSaved = AdminClassifiedBrand & { listings_renamed: number; suggestions_answered: number };
export type ClassifiedBrandsFilter = { q?: string; category?: string; logo?: 'missing' | 'bundled' | 'uploaded'; status?: 'enabled' | 'disabled'; offset?: number; limit?: number };
/** A brand's model in one category, as admins see it. */
export type AdminClassifiedModel = {
  object: 'classified_brand_model';
  id: string;
  name: string;
  aliases: string[];
  category: { id: string; slug: string; name: string };
  position: number;
  source: 'registry' | 'admin' | 'sellers';
  enabled: boolean;
  /** Live ads with it, everywhere. */
  listings: number;
  updated_at: string;
};
export type ClassifiedModelSaved = AdminClassifiedModel & { listings_renamed: number; suggestions_answered: number };
export type ClassifiedModelsFilter = { slug: string; q?: string; category?: string; source?: AdminClassifiedModel['source']; status?: 'enabled' | 'disabled'; offset?: number; limit?: number };
export type ClassifiedModelsPage = List<AdminClassifiedModel> & { total: number; offset: number; limit: number; brand: { slug: string; name: string }; categories: Array<{ id: string; slug: string; name: string; models: number }> };
export type ClassifiedModelImportResult = { object: 'classified_model_import'; added: number; skipped: Array<{ name: string; reason: string }>; listings_renamed: number };
export type ClassifiedModelSuggestionGroup = { object: 'classified_model_suggestion_group'; brand: { id: string; slug: string; name: string }; category: { id: string; slug: string; name: string }; name_key: string; name: string; sellers: number; last_at: string };
export type ClassifiedBrandSuggestionGroup = { object: 'classified_brand_suggestion_group'; name_key: string; name: string; sellers: number; categories: Array<{ id: string; slug: string; name: string }>; first_at: string; last_at: string };

export type ClassifiedFeatureSuggestionGroup = { object: 'classified_feature_suggestion_group'; name_key: string; name: string; sellers: number; categories: string[]; first_at: string; last_at: string };

export type AdminClassifiedArea = {
  object: 'classified_admin_area';
  id: string;
  country: string;
  kind: 'state' | 'area';
  state_id: string | null;
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  enabled: boolean;
  active_listings: number;
};
export type AdminClassifiedState = AdminClassifiedArea & { areas: AdminClassifiedArea[] };

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
  /** Udozo: their profile photo and the handle of their public seller page (`/<cc>/seller/<handle>`). */
  avatar_url?: string | null;
  /** Their profile cover on their seller page, or null (Udozo's own banner). */
  banner_url?: string | null;
  handle?: string;
  /** Udozo: the username they chose for their seller page (`/<cc>/seller/<username>`), or null. */
  username?: string | null;
  /** Udozo: until when their new buy orders are paused (3 voided in 90 days, or an admin), and why; null when not. */
  buy_orders_paused_until?: string | null;
  buy_orders_paused_reason?: string | null;
  /** They cannot write reviews until then (a fake or extorting reviewer). */
  reviews_blocked_until?: string | null;
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
  /** Three letters starting its new listings' SKUs (PHN). */
  sku_prefix: string;
  /** What people call the things sold here, matched as typed on Post an ad, in search suggestions and by the assistants. */
  keywords: string[];
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
  /** Udozo: ads a customer must have posted before choosing a username for their seller page (0 to 100, default 5). */
  username_min_listings: number;
  /** Udozo buy orders: hours a seller has to answer one (1 to 168, default 48). */
  buy_request_hours?: number;
  /** Days to meet once one is accepted (1 to 30, default 7). */
  buy_meet_days?: number;
  /** Open buy orders a buyer may have at once (1 to 100, default 10). */
  buy_open_per_buyer?: number;
  /** Buy orders a buyer may send a day (1 to 200, default 20). */
  buy_requests_per_day?: number;
  /** Reviews: Neutral offered, days to review a purchase, counted reviews before the positive share shows. */
  reviews_neutral?: boolean;
  review_window_days?: number;
  review_min_shown?: number;
  /** Reminders to finish posting (the `classifieds_post_reminders` switch): hours after an unfinished draft was last
   * changed (one reminder), then for a complete draft not posted, hours to the first reminder and between the next two
   * (1 to 720 each; defaults 24, 24, 72 and 168). */
  unfinished_reminder_hours?: number;
  ready_reminder_1_hours?: number;
  ready_reminder_2_hours?: number;
  ready_reminder_3_hours?: number;
  /** Wanted requests: open requests a buyer may have, requests a day, sellers told per request, requests a seller hears of a day. */
  wanted_open_per_buyer?: number;
  wanted_per_day?: number;
  wanted_sellers_per_request?: number;
  wanted_notices_per_seller_day?: number;
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

export const classifiedOrderStatuses = ['requested', 'declined', 'lapsed', 'awaiting_payment', 'cancelled', 'locked', 'paid', 'sent', 'disputed', 'released', 'refunded', 'partly_refunded'] as const;
export type ClassifiedOrderStatus = (typeof classifiedOrderStatuses)[number];
export type ClassifiedPayoutReview = 'pending' | 'approved' | 'rejected';
export type ClassifiedDisputeDecision = 'refund' | 'partial' | 'release';

export type AdminClassifiedOrder = {
  object: 'classified_order';
  id: string;
  number: string;
  role: 'admin';
  /** `direct` (BitoCard Shop) or `resale` (bought on a reseller's Resale shop: the seller is the supplier). */
  kind: 'direct' | 'resale';
  quantity: number;
  status: ClassifiedOrderStatus;
  listing: { id: string; ref: number; title: string | null; slug: string | null; cover_url: string | null };
  buyer: { id: string; name: string; email: string };
  seller: { id: string; name: string; email: string };
  /** Resale: the store it was bought on. */
  store: { id: string; name: string; subdomain: string; logo_url: string | null } | null;
  mode: 'live' | 'test';
  country: string;
  /** Each side's rate and cap, fixed when the buyer asked (and the reseller's, on a resale order). */
  rates: { buyer_fee_bps: number; buyer_fee_cap: number; seller_fee_bps: number; seller_fee_cap: number; reseller_fee_bps?: number | null; reseller_fee_cap?: number };
  fulfilment: 'meet_up' | 'delivery';
  currency: string;
  price: number;
  delivery_fee: number;
  buyer_fee: number;
  total: number;
  seller_fee: number;
  payout: number;
  /** Resale: the supplier's price, the discount, their net, and the reseller's margin, fee and earnings. */
  resale: { supplier_price: number; discount_bps: number; supplier_net: number; deal_id: string | null; margin: number; reseller_fee: number; earnings: number } | null;
  refund: number | null;
  delivery_address: string | null;
  /** Resale, once accepted: the buyer's details (each view is logged). */
  buyer_details?: { name: string; email: string; phone: string | null; address: string | null } | null;
  tracking_note: string | null;
  shipment: {
    courier: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    delivered_at: string | null;
    events: Array<{ status: 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed_attempt' | 'returned'; note: string | null; reported_by: 'seller' | 'courier' | 'bitocard'; at: string }>;
    dispatch_photos: Array<{ id: string; url: string; content_type: string; width: number | null; height: number | null }>;
  } | null;
  release_tries_left: number | null;
  deadlines: { accept_by: string; pay_by: string | null; handover_by: string | null; confirm_by: string | null };
  timeline: { requested_at: string; locked_at: string | null; accepted_at: string | null; paid_at: string | null; sent_at: string | null; released_at: string | null; refunded_at: string | null; closed_at: string | null };
  ended_by: 'buyer' | 'seller' | 'reseller' | 'bitocard' | null;
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
  /** Whose strike an upheld dispute was (a resale order's store's when its note or claims misled the buyer). */
  fault: 'supplier' | 'reseller' | 'none' | null;
  refund: number | null;
  note: string | null;
  decided_at: string | null;
  created_at: string;
};

export type ClassifiedDisputeMessage = {
  object: 'classified_dispute_message';
  id: string;
  /** `reseller`: the Resale shop's team, on a resale order. */
  from: 'buyer' | 'seller' | 'reseller' | 'bitocard';
  /** Who wrote it: a first name and initial, the store's name, or BitoCard. */
  name: string;
  body: string;
  photo: { url: string; content_type: string | null; size: number | null; width: number | null; height: number | null } | null;
  created_at: string;
};

export type AdminClassifiedOrderDetail = Omit<AdminClassifiedOrder, 'dispute'> & { dispute: (ClassifiedDispute & { messages: ClassifiedDisputeMessage[] }) | null };
export type AdminClassifiedDisputeRow = ClassifiedDispute & { order: AdminClassifiedOrder };
export type AdminClassifiedOrderFilter = { status?: ClassifiedOrderStatus; country?: string; q?: string; payout_review?: ClassifiedPayoutReview; kind?: 'direct' | 'resale'; offset?: number };

/** A courier offered when marking a Safe pay order shipped: its tracking link has `{tracking}` where the number goes. */
export type ClassifiedCourier = { name: string; tracking_url: string | null };

/** A reseller's resale strikes in 90 days (orders their stores cancelled, disputes lost because of a store, reports upheld) against the country's limit. */
export type ResaleStanding = { object: 'resale_standing'; reseller_id: string; strikes: number; strike_limit: number; limited: boolean; cancelled_by_store: number; disputes_lost: number; reports_upheld: number; cleared_at: string | null };

export type ResaleStoreReportReason = 'claims_ownership' | 'misleading' | 'pay_outside' | 'misused_details' | 'other';
/** A buyer's or supplier's report of a Resale shop, for BitoCard to uphold (a strike for the reseller) or dismiss. */
export type AdminResaleStoreReport = {
  object: 'resale_store_report';
  id: string;
  number: string;
  store: { id: string; name: string; subdomain: string };
  reseller: { id: string; name: string };
  reporter: { id: string; name: string; email: string; kind: 'buyer' | 'supplier' };
  reason: ResaleStoreReportReason;
  details: string;
  order_id: string | null;
  status: 'open' | 'upheld' | 'dismissed';
  note: string | null;
  decided_at: string | null;
  created_at: string;
};

/** Safe pay's fees in a period by market and kind (BitoCard Shop's own sales, resale). */
export type ResaleFeesReport = {
  object: 'resale_fees_report';
  mode: 'test' | 'live';
  from: string;
  to: string;
  markets: Array<{ country: string; currency: string; kind: 'direct' | 'resale'; orders: number; sales: number; delivery: number; part_refunds: number; buyer_fees: number; seller_fees: number; reseller_fees: number; fees: number }>;
  refunded: Array<{ country: string; currency: string; kind: 'direct' | 'resale'; orders: number; sales: number }>;
  top_resellers: Array<{ reseller: { id: string; name: string }; currency: string; orders: number; sales: number; reseller_fees: number }>;
};

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
  /** The longest a parcel may take once shipped. */
  transit_days: number;
  /** The couriers sellers choose from when marking an order shipped. */
  couriers: ClassifiedCourier[];
  /** Both fees (rate and cap) set: Safe pay can open where its switch is on. */
  ready: boolean;
};
export type ClassifiedSafePaySettingsInput = Partial<Omit<ClassifiedSafePaySettings, 'object' | 'country' | 'ready'>>;

/** BitoCard's resale limits in a country (B2B reselling), in basis points and the country's minor units. */
export type ClassifiedResaleSettings = {
  object: 'classified_resale_settings';
  country: string;
  discount_min_bps: number;
  discount_max_bps: number;
  markup_max_bps: number;
  /** The country's markup cap (Markup Protection Scheme): the markup limit is never above it. */
  markup_cap_bps: number;
  reseller_fee_bps: number | null;
  reseller_fee_cap: number | null;
  accept_hours: number;
  reseller_strike_limit: number;
  updated_at: string | null;
  /** The `classifieds_resale` switch on and the reseller fee set: suppliers can open listings to resellers. */
  open: boolean;
  /** Why it is closed: the switch off, or Udozo's reseller fee not set. */
  reason?: 'switch_off' | 'not_set_up' | null;
};
export type ClassifiedResaleSettingsInput = Partial<Pick<ClassifiedResaleSettings, 'discount_min_bps' | 'discount_max_bps' | 'markup_max_bps' | 'accept_hours' | 'reseller_strike_limit'>> & {
  reseller_fee_bps?: number;
  reseller_fee_cap?: number;
};

/** The fee on a price in minor units: its rate of the price, rounded down, or the cap when that is lower (as the API). */
export const safePayFee = (price: number, bps: number, cap: number) => Math.min(Math.floor((price * bps) / 10000), cap);

/**
 * Where a disputed order's money goes for each decision, as the API settles it: `refund` returns the price and the
 * buyer's fee; `partial` returns part of the price, pays the seller the rest less their fee on it, and keeps the buyer's
 * fee; `release` pays the seller the price less their fee and keeps both fees.
 */
export function disputeOutcome(order: Pick<AdminClassifiedOrder, 'price' | 'buyer_fee' | 'rates'>, decision: ClassifiedDisputeDecision, refund = 0) {
  if (decision === 'refund') return { buyer_gets: order.price + order.buyer_fee, seller_gets: 0, seller_fee: 0, buyer_fee_kept: 0 };
  const released = decision === 'partial' ? order.price - refund : order.price;
  const sellerFee = safePayFee(released, order.rates.seller_fee_bps, order.rates.seller_fee_cap);
  return { buyer_gets: decision === 'partial' ? refund : 0, seller_gets: released - sellerFee, seller_fee: sellerFee, buyer_fee_kept: order.buyer_fee };
}

type Paged<T> = List<T> & { total: number };

/** Drops empty values so query strings stay clean. */
const params = (values: Record<string, string | number | undefined | null>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));

const listingTags = (id: string) => [{ type: 'ClassifiedListing' as const, id }, { type: 'ClassifiedListing' as const, id: 'LIST' }, { type: 'ClassifiedSeller' as const, id: 'LIST' }, 'Activity' as const];
const orderTags = (id: string) => [{ type: 'ClassifiedOrder' as const, id }, { type: 'ClassifiedOrder' as const, id: 'LIST' }, 'Activity' as const];

export const adminClassifiedsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    // ---- Moderation ----
    classifiedQueue: build.query<ClassifiedQueue, { country?: string; view?: ClassifiedQueueView } | void>({
      query: arg => ({ url: '/v1/admin/classifieds/queue', params: params({ country: arg?.country, view: arg?.view === 'all' ? undefined : arg?.view }) }),
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
    /** Approve (an optional note), or send back or remove: with Udozo's reason code and the note the seller reads (else the code's own sentence). */
    moderateClassifiedListing: build.mutation<AdminClassifiedListing, { id: string; action: 'approve' | 'reject' | 'remove'; note: string; reason_code?: ListingReviewCode }>({
      query: ({ id, action, note, reason_code }) => ({
        url: `/v1/admin/classifieds/listings/${encodeURIComponent(id)}/${action}`,
        method: 'POST',
        body: action === 'approve' ? (note ? { note } : {}) : reason_code ? { reason_code, ...(note.trim() ? { note: note.trim() } : {}) } : { reason: note },
      }),
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
    /** Takes a seller's profile photo off (their initials show again), with why; audited. */
    removeClassifiedSellerAvatar: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/avatar/remove`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ClassifiedSeller', id }, { type: 'ClassifiedSeller', id: 'LIST' }, 'Activity'],
    }),
    /** Takes a seller's profile cover off (Udozo's own banner shows again), with why; audited and the seller told. */
    removeClassifiedSellerBanner: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/banner/remove`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ClassifiedSeller', id }, { type: 'ClassifiedSeller', id: 'LIST' }, 'Activity'],
    }),
    /** Takes a seller's username away (their page goes back to its handle), with why; audited. */
    removeClassifiedSellerUsername: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/classifieds/sellers/${encodeURIComponent(id)}/username/remove`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'ClassifiedSeller', id }, { type: 'ClassifiedSeller', id: 'LIST' }, 'Activity'],
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
    /** Switches a category on or off; shown at once in every market's list; a refusal undoes it and reloads. */
    setClassifiedCategory: build.mutation<unknown, { id: string; enabled: boolean }>({
      query: ({ id, enabled }) => ({ url: `/v1/admin/classifieds/categories/${encodeURIComponent(id)}`, method: 'PATCH', body: { enabled } }),
      async onQueryStarted({ id, enabled }, { dispatch, getState, queryFulfilled }) {
        const markets = adminClassifiedsApi.util.selectCachedArgsForQuery(getState() as Parameters<typeof adminClassifiedsApi.util.selectCachedArgsForQuery>[0], 'classifiedCategories');
        const patches = markets.map(country => patchCategory(dispatch, country, id, category => void (category.enabled = enabled)));
        await settleOptimistic(patches, queryFulfilled, () => dispatch(adminClassifiedsApi.util.invalidateTags(['ClassifiedCategory'])));
      },
      invalidatesTags: ['Activity'],
    }),
    /** A category's SKU prefix: its new listings' SKUs start with it; those given keep theirs. */
    setClassifiedCategorySkuPrefix: build.mutation<{ object: 'classified_admin_category'; id: string; slug: string; enabled: boolean; sku_prefix: string }, { id: string; sku_prefix: string }>({
      query: ({ id, sku_prefix }) => ({ url: `/v1/admin/classifieds/categories/${encodeURIComponent(id)}`, method: 'PATCH', body: { sku_prefix } }),
      invalidatesTags: ['ClassifiedCategory', 'Activity'],
    }),
    /** A category's search words (trimmed, lower case, each once); the saved list is returned. */
    setClassifiedCategoryKeywords: build.mutation<{ object: 'classified_admin_category'; id: string; slug: string; enabled: boolean; sku_prefix: string; keywords: string[] }, { id: string; keywords: string[] }>({
      query: ({ id, keywords }) => ({ url: `/v1/admin/classifieds/categories/${encodeURIComponent(id)}`, method: 'PATCH', body: { keywords } }),
      invalidatesTags: ['ClassifiedCategory', 'Activity'],
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
    classifiedFeatures: build.query<List<AdminClassifiedFeature>, string | void>({
      query: q => ({ url: '/v1/admin/classifieds/features', params: params({ q: q ?? undefined }) }),
      providesTags: [{ type: 'ClassifiedSettings', id: 'FEATURES' }],
    }),
    createClassifiedFeature: build.mutation<AdminClassifiedFeature, ClassifiedFeatureCreate>({
      query: body => ({ url: '/v1/admin/classifieds/features', method: 'POST', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'FEATURES' }, { type: 'ClassifiedSettings', id: 'SUGGESTIONS' }, 'Activity'],
    }),
    updateClassifiedFeature: build.mutation<AdminClassifiedFeature, ClassifiedFeatureInput & { key: string }>({
      query: ({ key, ...body }) => ({ url: `/v1/admin/classifieds/features/${encodeURIComponent(key)}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'FEATURES' }, 'Activity'],
    }),
    classifiedFeatureSuggestions: build.query<List<ClassifiedFeatureSuggestionGroup>, void>({
      query: () => '/v1/admin/classifieds/feature-suggestions',
      providesTags: [{ type: 'ClassifiedSettings', id: 'SUGGESTIONS' }],
    }),
    dismissClassifiedFeatureSuggestion: build.mutation<unknown, string>({
      query: nameKey => ({ url: '/v1/admin/classifieds/feature-suggestions/dismiss', method: 'POST', body: { name_key: nameKey } }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'SUGGESTIONS' }, 'Activity'],
    }),
    classifiedBrands: build.query<List<AdminClassifiedBrand> & { total: number; offset: number; limit: number }, ClassifiedBrandsFilter | void>({
      query: filter => ({ url: '/v1/admin/classifieds/brands', params: params({ ...(filter ?? {}) }) }),
      providesTags: [{ type: 'ClassifiedSettings', id: 'BRANDS' }],
    }),
    createClassifiedBrand: build.mutation<ClassifiedBrandSaved, ClassifiedBrandInput & { name: string }>({
      query: body => ({ url: '/v1/admin/classifieds/brands', method: 'POST', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'BRANDS' }, { type: 'ClassifiedSettings', id: 'BRAND_SUGGESTIONS' }, 'Activity'],
    }),
    updateClassifiedBrand: build.mutation<ClassifiedBrandSaved, ClassifiedBrandInput & { slug: string }>({
      query: ({ slug, ...body }) => ({ url: `/v1/admin/classifieds/brands/${encodeURIComponent(slug)}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'BRANDS' }, { type: 'ClassifiedSettings', id: 'BRAND_SUGGESTIONS' }, 'Activity'],
    }),
    classifiedBrandSuggestions: build.query<List<ClassifiedBrandSuggestionGroup>, void>({
      query: () => '/v1/admin/classifieds/brand-suggestions',
      providesTags: [{ type: 'ClassifiedSettings', id: 'BRAND_SUGGESTIONS' }],
    }),
    dismissClassifiedBrandSuggestion: build.mutation<unknown, string>({
      query: nameKey => ({ url: '/v1/admin/classifieds/brand-suggestions/dismiss', method: 'POST', body: { name_key: nameKey } }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'BRAND_SUGGESTIONS' }, 'Activity'],
    }),
    classifiedModels: build.query<ClassifiedModelsPage, ClassifiedModelsFilter>({
      query: ({ slug, ...filter }) => ({ url: `/v1/admin/classifieds/brands/${encodeURIComponent(slug)}/models`, params: params({ ...filter }) }),
      providesTags: [{ type: 'ClassifiedSettings', id: 'MODELS' }],
    }),
    createClassifiedModel: build.mutation<ClassifiedModelSaved, { slug: string; name: string; aliases?: string[]; category_id: string }>({
      query: ({ slug, ...body }) => ({ url: `/v1/admin/classifieds/brands/${encodeURIComponent(slug)}/models`, method: 'POST', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'MODELS' }, { type: 'ClassifiedSettings', id: 'MODEL_SUGGESTIONS' }, { type: 'ClassifiedSettings', id: 'BRANDS' }, 'Activity'],
    }),
    importClassifiedModels: build.mutation<ClassifiedModelImportResult, { slug: string; category_id: string; models: Array<{ name: string; aliases?: string[] }> }>({
      query: ({ slug, ...body }) => ({ url: `/v1/admin/classifieds/brands/${encodeURIComponent(slug)}/models/import`, method: 'POST', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'MODELS' }, { type: 'ClassifiedSettings', id: 'MODEL_SUGGESTIONS' }, { type: 'ClassifiedSettings', id: 'BRANDS' }, 'Activity'],
    }),
    updateClassifiedModel: build.mutation<ClassifiedModelSaved, { id: string; name?: string; aliases?: string[]; enabled?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/models/${encodeURIComponent(id)}`, method: 'PATCH', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'MODELS' }, { type: 'ClassifiedSettings', id: 'MODEL_SUGGESTIONS' }, 'Activity'],
    }),
    classifiedModelSuggestions: build.query<List<ClassifiedModelSuggestionGroup> & { learn_from: number }, void>({
      query: () => '/v1/admin/classifieds/model-suggestions',
      providesTags: [{ type: 'ClassifiedSettings', id: 'MODEL_SUGGESTIONS' }],
    }),
    dismissClassifiedModelSuggestion: build.mutation<unknown, { brand_id: string; category_id: string; name_key: string }>({
      query: body => ({ url: '/v1/admin/classifieds/model-suggestions/dismiss', method: 'POST', body }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'MODEL_SUGGESTIONS' }, 'Activity'],
    }),
    classifiedAreas: build.query<List<AdminClassifiedState> & { country: string }, string>({
      query: country => ({ url: '/v1/admin/classifieds/areas', params: { country } }),
      providesTags: (_result, _error, country) => [{ type: 'ClassifiedSettings', id: `AREAS:${country}` }],
    }),
    createClassifiedArea: build.mutation<AdminClassifiedArea, { country: string; state_id?: string; name: string; latitude: number; longitude: number }>({
      query: body => ({ url: '/v1/admin/classifieds/areas', method: 'POST', body }),
      invalidatesTags: (_result, _error, { country }) => [{ type: 'ClassifiedSettings', id: `AREAS:${country}` }, 'Activity'],
    }),
    /** `country` names the list to refresh; it is not sent. */
    updateClassifiedArea: build.mutation<AdminClassifiedArea, { id: string; country: string; name?: string; latitude?: number; longitude?: number; enabled?: boolean }>({
      query: ({ id, name, latitude, longitude, enabled }) => ({ url: `/v1/admin/classifieds/areas/${encodeURIComponent(id)}`, method: 'PATCH', body: { name, latitude, longitude, enabled } }),
      invalidatesTags: (_result, _error, { country }) => [{ type: 'ClassifiedSettings', id: `AREAS:${country}` }, 'Activity'],
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
    decideClassifiedDispute: build.mutation<AdminClassifiedOrderDetail, { id: string; decision: ClassifiedDisputeDecision; refund?: number; note: string; fault?: 'supplier' | 'reseller' | 'none' }>({
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
    classifiedResaleSettings: build.query<ClassifiedResaleSettings, string>({
      query: country => `/v1/admin/classifieds/resale-settings/${country}`,
      providesTags: (_result, _error, country) => [{ type: 'ClassifiedSettings', id: `RESALE:${country}` }],
    }),
    updateClassifiedResaleSettings: build.mutation<ClassifiedResaleSettings, ClassifiedResaleSettingsInput & { country: string }>({
      query: ({ country, ...body }) => ({ url: `/v1/admin/classifieds/resale-settings/${country}`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { country }) => [{ type: 'ClassifiedSettings', id: `RESALE:${country}` }, 'Activity'],
    }),
    /** Words a Resale shop's own text may not use (claims of owning, making or stocking what it resells). */
    resaleClaimPhrases: build.query<{ object: 'list'; data: ResaleClaimPhrase[] }, void>({ query: () => '/v1/admin/classifieds/resale-claim-phrases', providesTags: [{ type: 'ClassifiedSettings', id: 'RESALE_PHRASES' }] }),
    addResaleClaimPhrase: build.mutation<ResaleClaimPhrase, string>({
      query: phrase => ({ url: '/v1/admin/classifieds/resale-claim-phrases', method: 'POST', body: { phrase } }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'RESALE_PHRASES' }, 'Activity'],
    }),
    removeResaleClaimPhrase: build.mutation<{ id: string; deleted: true }, string>({
      query: id => ({ url: `/v1/admin/classifieds/resale-claim-phrases/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'ClassifiedSettings', id: 'RESALE_PHRASES' }, 'Activity'],
    }),
    resaleStoreReports: build.query<Paged<AdminResaleStoreReport>, { status?: 'open' | 'upheld' | 'dismissed'; reseller_id?: string; offset?: number }>({
      query: filter => ({ url: '/v1/admin/classifieds/resale-reports', params: params({ limit: 50, ...filter }) }),
      providesTags: [{ type: 'Report', id: 'RESALE' }],
    }),
    resaleStoreReport: build.query<AdminResaleStoreReport, string>({ query: id => `/v1/admin/classifieds/resale-reports/${encodeURIComponent(id)}`, providesTags: (_result, _error, id) => [{ type: 'Report', id }] }),
    decideResaleStoreReport: build.mutation<AdminResaleStoreReport, { id: string; decision: 'upheld' | 'dismissed'; note: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/classifieds/resale-reports/${encodeURIComponent(id)}/decide`, method: 'POST', body }),
      // An upheld report is a strike: the reseller's standing changes too.
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Report', id }, { type: 'Report', id: 'RESALE' }, 'ClassifiedSettings', 'Activity'],
    }),
    resaleFeesReport: build.query<ResaleFeesReport, { mode: 'test' | 'live'; from: string; to: string; country?: string }>({
      query: filter => ({ url: '/v1/admin/reports/resale', params: params(filter) }),
    }),
    resaleStanding: build.query<ResaleStanding, string>({
      query: resellerId => `/v1/admin/classifieds/resellers/${encodeURIComponent(resellerId)}/resale-standing`,
      providesTags: (_result, _error, resellerId) => [{ type: 'ClassifiedSettings', id: `RESALE_STANDING:${resellerId}` }],
    }),
    clearResaleStrikes: build.mutation<ResaleStanding, { resellerId: string; reason: string }>({
      query: ({ resellerId, reason }) => ({ url: `/v1/admin/classifieds/resellers/${encodeURIComponent(resellerId)}/resale-standing/clear`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { resellerId }) => [{ type: 'ClassifiedSettings', id: `RESALE_STANDING:${resellerId}` }, 'Activity'],
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
  useRemoveClassifiedSellerAvatarMutation,
  useRemoveClassifiedSellerBannerMutation,
  useRemoveClassifiedSellerUsernameMutation,
  useClassifiedCategoriesQuery,
  useSetClassifiedCategoryMutation,
  useSetClassifiedCategorySkuPrefixMutation,
  useSetClassifiedCategoryKeywordsMutation,
  useSetClassifiedCategoryCountryMutation,
  useClassifiedFeaturesQuery,
  useCreateClassifiedFeatureMutation,
  useUpdateClassifiedFeatureMutation,
  useClassifiedFeatureSuggestionsQuery,
  useDismissClassifiedFeatureSuggestionMutation,
  useClassifiedBrandsQuery,
  useCreateClassifiedBrandMutation,
  useUpdateClassifiedBrandMutation,
  useClassifiedBrandSuggestionsQuery,
  useDismissClassifiedBrandSuggestionMutation,
  useClassifiedModelsQuery,
  useCreateClassifiedModelMutation,
  useImportClassifiedModelsMutation,
  useUpdateClassifiedModelMutation,
  useClassifiedModelSuggestionsQuery,
  useDismissClassifiedModelSuggestionMutation,
  useClassifiedAreasQuery,
  useCreateClassifiedAreaMutation,
  useUpdateClassifiedAreaMutation,
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
  useClassifiedResaleSettingsQuery,
  useUpdateClassifiedResaleSettingsMutation,
  useResaleClaimPhrasesQuery,
  useAddResaleClaimPhraseMutation,
  useRemoveResaleClaimPhraseMutation,
  useResaleStandingQuery,
  useClearResaleStrikesMutation,
  useResaleStoreReportsQuery,
  useResaleStoreReportQuery,
  useDecideResaleStoreReportMutation,
  useResaleFeesReportQuery,
} = adminClassifiedsApi;
 type ResaleClaimPhrase = { object: 'resale_claim_phrase'; id: string; phrase: string; created_at: string };

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
