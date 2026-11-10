/**
 * BitoCard Shop (classifieds) for customers: the public `/v1/classifieds` shapes and the signed-in buyer's, typed by hand
 * against the API presenters (`apps/api/src/classifieds`), with the pure helpers shop.bitocard.com and the storefront's
 * Shop tab share (addresses, prices, labels, the description's limited Markdown). Types only, no RTK Query client.
 * Amounts are minor units (kobo).
 */

export type ShopCondition = 'new' | 'used' | 'untested' | 'parts';
export type ShopPriceKind = 'fixed' | 'negotiable' | 'on_request';
export type ShopDelivery = 'none' | 'state' | 'nationwide';

/** A listing's shipping through Udozo Connect, as its seller sees it. */
export type ShopListingConnectOwn = {
  enabled: boolean;
  states: { state: { id: string; slug: string; name: string }; shipping: number }[];
  /** Every active centre in the ticked states (new ones too); false: only `centres`. */
  all_centres: boolean;
  centres: { id: string; number: string; name: string; state_id: string; active: boolean }[];
};

/** Where a listing ships through Udozo Connect, as buyers see it: each state with its charge and how many open centres. */
export type ShopListingConnect = { states: { id: string; slug: string; name: string; shipping: number; centres: number }[] };
export type ShopSort = 'relevant' | 'newest' | 'price_asc' | 'price_desc';
export type ShopBadge = 'phone_confirmed' | 'id_checked';
export type ShopTier = 'area' | 'nearby' | 'state' | 'country';
export type ShopReportReason = 'scam' | 'prohibited' | 'wrong_category' | 'duplicate' | 'sold' | 'offensive' | 'other';
/** Chats are also reported for pressure over a review (Udozo). */
export type ShopChatReportReason = ShopReportReason | 'review_pressure';
export type ShopOrderStatus = 'requested' | 'declined' | 'lapsed' | 'awaiting_payment' | 'cancelled' | 'locked' | 'paid' | 'sent' | 'at_centre' | 'disputed' | 'released' | 'refunded' | 'partly_refunded';
export type ShopFeatureType = 'text' | 'number' | 'choice' | 'boolean';

export type ShopPrice = { kind: ShopPriceKind; amount: number | null; currency: string };
export type ShopPlace = { slug: string; name: string; state: { slug: string; name: string } };

/**
 * `safe_pay`: open there (its switch on and both fees set); a buyer's own wallet is checked when they ask.
 * `install_prompt`: the site asks visitors there to install it as an app (an admin switch).
 */
export type ShopMarket = { object: 'classified_market'; country: string; name: string; currency: string; listings: number; safe_pay: boolean; install_prompt: boolean; buy_orders?: boolean; /** Sellers ship through Udozo Connect there. */ connect_shipping?: boolean; /** Sellers may sell by auction there. */ auctions?: boolean };

/** How a listing is sold: at its price, or by auction (its price the starting price). */
export type ShopSaleMethod = 'fixed' | 'auction';
/** A listing's auction as cards show it: the bid to beat and when it ends. */
export type ShopAuctionCard = { status: string; current_price: number | null; bids: number; ends_at: string };
/** A listing's auction as its page shows it; signed in, `viewer` is the reader's own place in it. */
export type ShopListingAuction = {
  object: 'listing_auction';
  /** AU-000123, and its number alone (for paying and collecting a lot of Udozo's). */
  number: string;
  ref: string;
  /** listing (a seller's: the winner pays with UdozoPay) or abandoned (Udozo's: paid from the wallet, collected at its warehouse). */
  kind: 'listing' | 'abandoned';
  /** Where a lot of Udozo's is collected. */
  warehouse: { name: string; address: string; hours: string; state: string } | null;
  status: 'scheduled' | 'live' | 'awaiting_payment' | 'sold' | 'unsold' | 'cancelled';
  start_price: number;
  current_price: number | null;
  /** The least the next bid may be, while bidding is open. */
  next_bid: number | null;
  bids: number;
  /** Whether the seller's hidden reserve is met (null: they set none). */
  reserve_met: boolean | null;
  starts_at: string;
  ends_at: string;
  rules: { step_pct: number; step_min: number; extend_minutes: number; pay_hours: number };
  recent_bids: Array<{ name: string; amount: number; at: string }>;
  viewer?: {
    highest: number | null;
    leading: boolean;
    to_pay: { amount: number; pay_by: string | null; order_id: string | null } | null;
    won: boolean;
    seller: boolean;
    /** Udozo's own lots, for their buyer once paid: collected yet, and its move to a Connect Centre near them (null: none). */
    collected?: boolean;
    transfer?: ShopLotTransfer | null;
  };
};

/** A won lot sent from Udozo's warehouse to a Connect Centre near its buyer. */
export type ShopLotTransfer = ShopReturnTransfer & { fee: number };

/** What sending a won lot to a Connect Centre costs, and the open centres to choose. */
export type ShopLotShipOptions = {
  object: 'list';
  currency: string;
  shipping: number;
  fee: number;
  total: number;
  data: { centre: ShopReturnShipOption['centre'] }[];
};
export type ShopMarkets = { object: 'list'; data: ShopMarket[]; showcase: boolean };

export type ShopFeature = {
  object: 'classified_feature';
  key: string;
  name: string;
  /** A lucide icon name. */
  icon: string;
  data_type: ShopFeatureType;
  unit: string | null;
  choices: string[];
  default_value: string | null;
  placeholder: string | null;
  min: number | null;
  max: number | null;
  synonyms: string[];
  filterable: boolean;
};

/** The feature key the brand registry answers (the listing form suggests brands, the filters show their logos). */
export const brandFeatureKey = 'brand';
/** The feature key the brands' models answer (the listing form suggests the brand's models, the filters narrow by them). */
export const modelFeatureKey = 'model';

/** A brand in Udozo's registry; `listings` (live ones in the country asked for) only when a country was given. */
export type ShopBrand = { object: 'classified_brand'; slug: string; name: string; logo_url: string | null; color: string | null; listings?: number };

/**
 * A brand's public page in a market (Udozo, `/<cc>/brand/<slug>`): the registry's brand with what is for sale under it
 * there. `categories` are where its live listings are, or the categories it sells in while it has none (each 0). Its
 * listings come from the search with `brand=<slug>`.
 */
export type ShopBrandPage = Omit<ShopBrand, 'object' | 'listings'> & {
  object: 'classified_brand_page';
  country: string;
  url: string;
  /** The banner Udozo's admins gave it (4:1, up to 1600 × 400), else null for the page's drawn one. */
  banner_url?: string | null;
  listings: number;
  sellers: number;
  updated_at: string | null;
  categories: Array<{ slug: string; name: string; icon: string; parent: { slug: string; name: string } | null; listings: number }>;
  models: Array<{ name: string; listings: number }>;
  states: Array<{ slug: string; name: string; listings: number }>;
};

/** A brand's model in a category; `brand` when searched across brands, `listings` when a country was given. */
export type ShopModel = { object: 'classified_model'; name: string; brand?: ShopBrand; listings?: number };

/** The brand and model a listing's title names, for the form to offer; never saved unless the seller chooses it. */
export type ShopModelMatch = { object: 'classified_model_match'; brand: ShopBrand | null; model: string | null };

/** A brand's initials where it has no logo: "Samsung" S, "Mercedes-Benz" MB, "LG" LG. */
export function brandInitials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s-]/gu, '').split(/[\s-]+/).filter(Boolean);
  if (words.length === 1) return words[0].length <= 3 && words[0] === words[0].toUpperCase() ? words[0] : words[0][0].toUpperCase();
  return words.slice(0, 2).map(word => word[0].toUpperCase()).join('');
}

const brandTints = ['#1E3A8A', '#9D174D', '#065F46', '#7C2D12', '#4C1D95', '#155E75', '#3F6212', '#831843', '#1F2937', '#92400E'];

/** The colour behind a brand's initials: its own, else one of Udozo's dark tints, always the same for the brand. */
export function brandTint(brand: { slug: string; color: string | null }) {
  if (brand.color) return brand.color;
  let hash = 0;
  for (const char of brand.slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return brandTints[hash % brandTints.length];
}

/** Light text on a dark colour, dark text on a light one. */
export function brandInk(color: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111827' : '#FFFFFF';
}

export type ShopCategory = {
  object: 'classified_category';
  id: string;
  slug: string;
  name: string;
  icon: string;
  b2b: boolean;
  /** What people call the things sold here ("plastic chair", "carpet"), matched as typed. */
  keywords?: string[];
  /** A top category's banner across the top of its pages (4:1); null for subcategories and when none is uploaded. */
  banner_url?: string | null;
  /** A top category's spotlight image: a cut-out of what is sold there, drawn on a circle beside its name. */
  spotlight_url?: string | null;
  safety_checklist: string[];
  /** The keys the category suggests, in order; `filter` marks those buyers filter by. */
  features: Array<ShopFeature & { filter: boolean }>;
};
export type ShopTopCategory = ShopCategory & { children: ShopCategory[] };

/**
 * How well what someone typed fits a subcategory, 0 for not at all: its name (or its top category's) holding the words
 * is best, then a search word starting with them or one of its words doing so ("carp" is "carpet"), then the words
 * holding a whole search word ("plastic chairs for events" holds "plastic chair"), then every word found somewhere.
 */
export function categoryMatch(category: Pick<ShopCategory, 'name' | 'keywords'>, parentName: string, typed: string): number {
  const words = typed.trim().toLowerCase().replace(/\s+/g, ' ');
  if (words.length < 2) return 0;
  const name = `${category.name} ${parentName}`.toLowerCase();
  if (name.includes(words)) return 4;
  const keywords = (category.keywords ?? []).map(word => word.toLowerCase());
  if (keywords.some(word => word.startsWith(words) || word.includes(` ${words}`))) return 3;
  const padded = ` ${words} `;
  if (keywords.some(word => word.length >= 3 && padded.includes(` ${word}`))) return 2;
  const haystack = `${name} ${keywords.join(' ')}`;
  const parts = words.split(' ').filter(part => part.length >= 2);
  return parts.length > 1 && parts.every(part => haystack.includes(part)) ? 1 : 0;
}

/** Where what fits no category goes: goods under Everything else, and Services' last place. */
export const catchAllCategories = ['other-items', 'other-services'] as const;

/** The catch-all subcategories open in the market, goods first, for when nothing typed finds a category. */
export function catchAllsOf<T extends ShopTopCategory>(categories: T[]): Array<{ parent: T; child: T['children'][number] }> {
  return catchAllCategories.flatMap(slug => {
    for (const parent of categories) {
      const child = parent.children.find(candidate => candidate.slug === slug);
      if (child) return [{ parent, child }];
    }
    return [];
  });
}

/** The subcategories that fit what was typed, best first, keeping the menu's order among equals. */
export function matchCategories<T extends ShopTopCategory>(categories: T[], typed: string, limit = 20): Array<{ parent: T; child: T['children'][number] }> {
  const found: Array<{ parent: T; child: T['children'][number]; score: number; order: number }> = [];
  let order = 0;
  for (const parent of categories) {
    for (const child of parent.children) {
      const score = categoryMatch(child, parent.name, typed);
      if (score) found.push({ parent, child, score, order });
      order += 1;
    }
  }
  return found.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map(({ parent, child }) => ({ parent, child }));
}

/** A country's category for bitocard.com's Shop band: its live listings and a random live listing's cover photo. */
export type ShopCategoryCover = {
  object: 'classified_category_cover';
  slug: string;
  name: string;
  icon: string;
  listings: number;
  /** The category on shop.bitocard.com. */
  url: string;
  photo: { url: string; width: number | null; height: number | null; alt: string } | null;
};
export type ShopCategoryCovers = { object: 'list'; country: string; url: string; data: ShopCategoryCover[] };

export type ShopArea = { object: 'classified_area'; id: string; slug: string; name: string; kind: 'state' | 'area'; latitude: number; longitude: number };
export type ShopState = ShopArea & { kind: 'state'; areas: ShopArea[] };

export type ShopListingCard = {
  object: 'classified_listing_card';
  id: string;
  ref: number;
  title: string;
  slug: string;
  country: string;
  url: string;
  price: ShopPrice;
  condition: ShopCondition | null;
  category: { slug: string; name: string } | null;
  area: ShopPlace;
  cover: { url: string; width: number | null; height: number | null } | null;
  photo_count: number;
  has_video: boolean;
  /** The first few feature values, as people read them ("256 GB"). */
  highlights: string[];
  delivery: ShopDelivery;
  /** Sold at its price or by auction (Udozo), with the auction's bid to beat. */
  sale_method?: ShopSaleMethod;
  auction?: ShopAuctionCard | null;
  /** Some to buy (Udozo); out of stock, buying is closed and it comes after those in stock. */
  in_stock?: boolean;
  /** The seller by their public name; `handle` names their seller page (Udozo). */
  seller: { name: string; handle?: string; username?: string | null; badges: ShopBadge[]; rating?: { positive_pct: number; counted: number } | null };
  published_at: string | null;
};
/** A search result: its tier (from the buyer's area outwards) when an area or state was given. */
export type ShopResult = ShopListingCard & { tier: ShopTier | null; delivers_to_you: boolean };
export type ShopSearch = { object: 'list'; data: ShopResult[]; total: number; tiers: Record<ShopTier, number> | null; offset: number; limit: number; sort: ShopSort };

export type ShopListingPage = {
  object: 'classified_listing_page';
  id: string;
  ref: number;
  /** Its category's prefix and number (PHN-000123). */
  sku: string | null;
  status: 'active' | 'sold';
  title: string;
  slug: string;
  url: string;
  description: string | null;
  price: ShopPrice;
  /** Sold at its price or by auction (Udozo): then `auction` is its bidding as anyone sees it. */
  sale_method?: ShopSaleMethod;
  auction?: ShopListingAuction | null;
  condition: ShopCondition | null;
  category: { slug: string; name: string; parent: { slug: string; name: string } | null; safety_checklist: string[] };
  area: ShopPlace;
  features: Array<{ key: string; name: string; icon: string; unit: string | null; value: string | number | boolean | null }>;
  /** The brand feature's brand in Udozo's registry (its logo), when it is there. */
  brand?: ShopBrand | null;
  photos: Array<{ url: string; width: number | null; height: number | null }>;
  video: { url: string; poster_url: string | null; duration_ms: number | null; width: number | null; height: number | null } | null;
  delivery: ShopDelivery;
  /** Ships to a Udozo Connect Centre: the states it reaches now; null when it does not. */
  connect?: ShopListingConnect | null;
  reserved: boolean;
  /** Units still to be had: its stock less those held for buyers (UdozoPay, or buy orders the seller accepted). */
  available?: number;
  /** The seller has some (Udozo); out of stock, nobody can buy it until they restock. */
  in_stock?: boolean;
  contact: { chat: boolean; phone: boolean };
  seller: { name: string; handle?: string; username?: string | null; avatar_url?: string | null; member_since: string; badges: ShopBadge[]; active_listings: number; response_rate: number | null; reviews?: ShopReviewSummary | null };
  /** Udozo: the latest reviews of this product (same brand and model) from this seller, when reviews are open. */
  product_reviews?: ShopReview[];
  published_at: string | null;
  sold_at: string | null;
};

/**
 * A seller's public page (Udozo, `/<cc>/seller/<handle>`): only what their listings already show, gathered, with their
 * live listings' categories and states and their sales. Their listings come from the search with `seller=<handle>`.
 */
export type ShopSellerProfile = {
  object: 'classified_seller';
  handle: string;
  /** Their chosen username (Udozo): their page's address once set, else `handle`. */
  username?: string | null;
  /** Set when the address asked for is an old username still held: where the page is now (Udozo). */
  redirect?: string | null;
  name: string;
  /** Their profile photo (a face, logo or icon), or null for their initials. */
  avatar_url?: string | null;
  /** Their profile cover across the top of the page (4:1), or null for Udozo's own banner. */
  banner_url?: string | null;
  country: string;
  url: string;
  member_since: string;
  badges: ShopBadge[];
  response_rate: number | null;
  active_listings: number;
  sold_listings: number;
  safe_pay_sales: number;
  last_listed_at: string | null;
  categories: Array<{ slug: string; name: string; icon: string; parent: { slug: string; name: string } | null; listings: number }>;
  states: Array<{ slug: string; name: string; listings: number }>;
  contact: { chat: boolean; phone: boolean };
  /** Their newest live listings taking chats or calls: what a buyer contacting them from their page asks about. */
  contact_listings: Array<{ id: string; ref: number; title: string; slug: string; currency: string; chat: boolean; phone: boolean }>;
  /** Udozo: their reviews' summary, when reviews are open in the market (null otherwise). */
  reviews?: ShopReviewSummary | null;
  /** Udozo: Anjio's view in words, where scores are public in the market (null otherwise). Never put in metadata. */
  scores?: ShopPublicScores | null;
};

/** A showcase card: never a price (prices belong to each country's pages). */
export type ShopShowcaseCard = Omit<ShopListingCard, 'price'>;
export type ShopShowcase = {
  object: 'classified_showcase';
  markets: ShopMarket[];
  category: { slug: string; name: string; icon: string; banner_url?: string | null; spotlight_url?: string | null } | null;
  categories: Array<{ slug: string; name: string; icon: string; countries: string[]; listings: Record<string, number> }>;
  recent: ShopShowcaseCard[];
  trending: ShopShowcaseCard[];
  sections: Array<{ country: string; name: string; listings: number; cards: ShopShowcaseCard[] }> | null;
};

/** What a country's sitemap lists, each with its live listings and when they last changed. */
export type ShopSitemap = {
  object: 'classified_sitemap';
  country: string;
  updated_at: string | null;
  categories: Array<{ slug: string; listings: number; updated_at: string | null }>;
  places: Array<{ state: string; area: string | null; listings: number; updated_at: string | null }>;
  /** A category in a state or area, once it has enough listings there to be indexed. */
  category_places: Array<{ state: string; area: string | null; category: string; listings: number; updated_at: string | null }>;
  /** The files its listings come in: each starts after a listing number. */
  listing_pages: Array<{ after: number; listings: number; updated_at: string }>;
  /** Udozo: sellers of this market with a live listing here (their page is indexed only then), with that count and their newest listing change. */
  sellers?: Array<{ handle: string; username?: string | null; listings: number; updated_at: string }>;
  /** Udozo: registry brands with live listings here (their brand pages), with that count and their newest listing change. */
  brands?: Array<{ slug: string; listings: number; updated_at: string }>;
};

/** One file of a country's listings, each with its title and up to five photos (for the image sitemap). */
export type ShopSitemapListings = {
  object: 'classified_sitemap_listings';
  country: string;
  listings: Array<{ ref: number; slug: string; updated_at: string; title?: string; images?: string[] }>;
  next_after: number | null;
};

export type ShopSuggestions = { object: 'list'; categories: Array<{ slug: string; name: string; parent: { slug: string; name: string } | null }>; queries: string[] };

/** What the signed-in buyer already has with a listing. */
export type ShopViewer = {
  object: 'classified_listing_viewer';
  listing_id: string;
  own: boolean;
  favourite: boolean;
  conversation_id: string | null;
  order: { id: string; number: string; status: ShopOrderStatus } | null;
  can_contact: boolean;
  /** Sold by auction: the lot as this reader sees it (Udozo). */
  auction?: ShopListingAuction | null;
  /** The seller's contact details once they shared them with this buyer, else the buyer's request (Udozo). */
  contact?: ShopContactState | null;
  /** A call back the buyer asked for about this listing (Udozo). */
  callback?: { available: boolean; request: { id: string; status: ShopContactStatus; created_at: string } | null } | null;
  /** The seller had Udozo open in the last minute, and whether calls can be made (Udozo). */
  seller_online?: boolean;
  calls?: boolean;
  /** Udozo: whether buy orders are open in the market, and the buyer's open (or last completed) buy order for it. */
  buy_orders?: boolean;
  buy_order?: ShopBuyOrderSummary | null;
};

export type ShopContactStatus = 'pending' | 'accepted' | 'declined' | 'done' | 'dismissed' | 'cancelled';

/** What the buyer has of a seller's contact details: shared (phone and email), or their latest request. */
export type ShopContactState = {
  available: boolean;
  shared: { phone: string | null; email: string } | null;
  request: { id: string; status: ShopContactStatus; ask_again_at: string | null } | null;
};

/**
 * A request about a listing: `contact` (the seller's details) or `callback` (the seller phones the buyer). The seller
 * sees a call back's requester in full while it waits; anything else only by their public name.
 */
export type ShopContactRequest = {
  object: 'classified_contact_request';
  id: string;
  kind: 'contact' | 'callback';
  status: ShopContactStatus;
  role: 'buyer' | 'seller';
  note: string | null;
  listing: { id: string; title: string | null; path: string };
  with: { name: string; phone: string | null; email: string | null };
  ask_again_at: string | null;
  answered_at: string | null;
  created_at: string;
};

export type ShopContactShare = { object: 'classified_contact_share'; buyer: { id: string; name: string }; since: string };

export type ShopCallStatus = 'ringing' | 'answered' | 'ended' | 'missed' | 'declined' | 'cancelled' | 'lost';

/** A call in the browser between a buyer and a seller, the other side by their public name only. */
export type ShopCall = {
  object: 'classified_call';
  id: string;
  status: ShopCallStatus;
  role: 'caller' | 'callee';
  with: { name: string };
  listing: { id: string; title: string | null; path: string };
  ring_until: string | null;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
};

/** The relay servers a call connects through (never peer to peer). */
export type ShopIceServer = { urls: string[]; username?: string; credential?: string };
export type ShopCallSignal = { id: string; kind: 'offer' | 'answer' | 'candidate'; payload: Record<string, unknown> };
export type ShopPresence = { object: 'classified_presence'; calls: boolean; incoming: ShopCall | null };

export type ShopOffer = {
  object: 'classified_offer';
  id: string;
  price: { amount: number; currency: string };
  status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
  made_by: 'me' | 'them';
  expires_at: string;
  decided_at: string | null;
  created_at: string;
};
export type ShopMessage = {
  object: 'classified_message';
  id: string;
  kind: 'text' | 'photo' | 'offer' | 'system' | 'buy_order';
  from: 'me' | 'them' | 'bitocard';
  body: string;
  photo: { url: string; content_type: string | null; size: number | null; width: number | null; height: number | null } | null;
  offer: ShopOffer | null;
  /** A buy order's step (Udozo): the order as it stands now, so the card shows its buttons. */
  buy_order?: ShopBuyOrderSummary | null;
  created_at: string;
};
export type ShopConversation = {
  object: 'classified_conversation';
  id: string;
  role: 'buyer' | 'seller';
  listing: { id: string; ref: number; title: string | null; slug: string | null; status: string; country: string; price: ShopPrice; cover_url: string | null };
  /** Their public name, and (Udozo) whether they have Udozo open now. */
  with: { name: string; online?: boolean };
  last_message: { kind: string; body: string; from: 'me' | 'them' | 'bitocard'; created_at: string } | null;
  unread: number;
  open_offer: ShopOffer | null;
  blocked: { by_me: boolean; by_them: boolean };
  /** Udozo: whether a call can be made from this chat (calls set up, nobody blocked, never a buyer to a messages-only seller). */
  can_call?: boolean;
  last_message_at: string;
  created_at: string;
};
export type ShopChat = ShopConversation & { messages: ShopMessage[]; has_more: boolean };


export type ShopSafePayQuote = {
  object: 'classified_safe_pay_quote';
  listing_id: string;
  offer_id: string | null;
  currency: string;
  price: number;
  buyer_fee: number;
  total: number;
  fulfilment: Array<ShopFulfilment>;
  /** Collect at a Udozo Connect Centre (null: not offered for this item). */
  connect?: ShopConnectCheckout | null;
  /** The delivery charge on top: within the seller's state, and elsewhere (null where they do not deliver). */
  delivery: ShopDeliveryCharges | null;
  reserved: boolean;
  accept_hours: number;
  pay_hours: number;
  covers: string[];
};

export type ShopDeliveryCharges = { state_id: string | null; within_state: number; nationwide: number | null };

/** What a seller reports about a parcel after shipping it. */
export type ShopShipmentStatus = 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed_attempt' | 'returned' | 'received' | 'refused' | 'ready' | 'collected' | 'collection_refused' | 'note';
export type ShopShipment = {
  courier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  delivered_at: string | null;
  events: Array<{ status: ShopShipmentStatus; note: string | null; reported_by: 'seller' | 'courier' | 'bitocard' | 'centre'; at: string }>;
  dispatch_photos: Array<{ id: string; url: string; content_type: string; width: number | null; height: number | null }>;
};
export const shipmentLabels: Record<ShopShipmentStatus, string> = {
  shipped: 'Shipped',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed_attempt: 'Delivery attempt failed',
  returned: 'Returned to the seller',
  received: 'Received at the Connect Centre',
  refused: 'Refused at the Connect Centre',
  ready: 'Ready to collect',
  collected: 'Collected',
  collection_refused: 'Refused at the counter',
  note: 'Update from the Connect Centre',
};

/** How an order is handed over: in person, delivered, or collected at a Udozo Connect Centre. */
export type ShopFulfilment = 'meet_up' | 'delivery' | 'connect';

/** A Connect Centre a buyer can collect an item at, as checkout lists it. */
export type ShopCheckoutCentre = { id: string; number: string; name: string; area: { id: string; name: string; latitude: number; longitude: number }; address: string; landmark: string | null; hours: string; phone: string };

/** Collecting at a Connect Centre at checkout: each state's centres, its shipping charge and the Connect fee there. */
export type ShopConnectCheckout = {
  fee: { kind: 'percent'; bps: number } | { kind: 'fixed'; amount: number };
  /** How long the buyer may collect it free once it is ready. */
  free_hours: number;
  states: Array<{ id: string; name: string; slug: string; shipping: number; connect_fee: number; centres: ShopCheckoutCentre[] }>;
};

/** An order's Connect Centre and its steps there, as the buyer and seller see them. */
export type ShopOrderConnect = {
  centre: { id: string; number: string; name: string; address: string; landmark: string | null; area: string; state: string; hours: string; phone: string };
  /** The buyer's and Udozo's view only. */
  connect_fee?: number;
  received_at: string | null;
  ready_at: string | null;
  collect_by: string | null;
  /** Storage owed by the reader's side: the buyer's demurrage, or the seller's (with Loss of care penalties). */
  storage_owed?: number;
  /** When the item went into Loss of care (its seller did not collect a return in time). */
  loss_of_care_at?: string | null;
  /** Its return to the seller, once the centre asked. */
  return?: ShopConnectReturn | null;
  /** Abandoned and sold at a Udozo auction (the seller's view): what it raised, what is left over and their claim to it. */
  auction?: ShopConnectAuction | null;
};

/** An abandoned item's Udozo auction on its seller's order: what is left over is theirs only on a claim within the days. */
export type ShopConnectAuction = {
  /** AU-000123 */
  number: string;
  sale: number | null;
  left_over: number | null;
  claim_by: string | null;
  /** When what nobody claimed became Udozo's. */
  unclaimed_at: string | null;
  claim: { number: string; status: 'requested' | 'paid' | 'rejected'; amount: number; decision_note: string | null; decided_at: string | null } | null;
};

/** A Connect item's return to its seller, as the buyer and seller see it. */
export type ShopConnectReturn = {
  id: string;
  /** RT-000123 */
  number: string;
  reason: 'not_collected' | 'refused_at_check_in' | 'refused_at_counter' | 'damaged';
  status: 'requested' | 'accepted' | 'collected' | 'cancelled';
  answer_by: string;
  decided_by: 'seller' | 'admin' | 'auto' | null;
  collect_by: string | null;
  collected_at: string | null;
  /** When it was abandoned (a month into Loss of care), and where it is: still at the centre, waiting for or with Udozo's pickup, or at Udozo's warehouse. */
  abandoned_at?: string | null;
  place?: 'centre' | 'awaiting_pickup' | 'in_transit' | 'udozo_warehouse' | 'auctioned';
  /** Udozo's warehouse holding it, once it is there: where the seller collects it. */
  warehouse?: { name: string; address: string; state: string; hours: string; phone: string } | null;
  /** The seller's view: the return fee they paid. */
  return_fee?: number;
  /** The seller's view: their choice to have it sent on to a Connect Centre near them, and where that stands. */
  transfer?: ShopReturnTransfer | null;
};

/** A return sent on to a centre near its seller: waiting to be sent (`paid`), on its way, there to collect, or collected. */
export type ShopReturnTransfer = {
  /** TF-000123 */
  number: string;
  status: 'paid' | 'sent' | 'arrived' | 'collected';
  to: { name: string; address: string; state: string; hours: string; phone: string };
  shipping: number;
  courier: string | null;
  tracking_number: string | null;
  sent_at: string | null;
  arrived_at: string | null;
};

/** A Connect Centre a seller may have their return sent to, with what the shipping costs. */
export type ShopReturnShipOption = {
  centre: { id: string; number: string; name: string; address: string; landmark: string | null; area: string; state: string; hours: string; phone: string };
  shipping: number;
};
export type ShopCourier = { name: string; tracking_url: string | null };
/** A message in a resale order's threads, as one side reads it (the buyer sees the store's side as the store). */
export type ShopOrderMessage = {
  object: 'resale_order_message';
  id: string;
  thread: 'order' | 'trade';
  from: 'me' | 'store' | 'buyer' | 'supplier' | 'reseller' | 'bitocard';
  name: string;
  body: string;
  created_at: string;
};

/** A resale buyer's details, for the supplier and the reseller once the order is accepted. */
export type ShopBuyerDetails = { name: string; email: string; phone: string | null; address: string | null };

/** A UdozoPay order as one side sees it: the buyer their fee and total, the seller their fee and payout, never the other's. */
export type ShopOrder = {
  object: 'classified_order';
  id: string;
  number: string;
  role: 'buyer' | 'seller';
  /** `direct` (BitoCard Shop) or `resale` (bought on a reseller's Resale shop). */
  kind: 'direct' | 'resale';
  quantity: number;
  status: ShopOrderStatus;
  listing: { id: string; ref: number; title: string | null; slug: string | null; cover_url: string | null };
  /** The other side: on a resale order, the buyer sees the store. */
  with: { name: string };
  /** Resale: the store it was bought on. */
  store: { id: string; name: string; subdomain: string; logo_url: string | null } | null;
  /** Resale, to the buyer: the supplier (the seller of record). */
  supplier: { name: string } | null;
  fulfilment: ShopFulfilment;
  /** Collected at a Udozo Connect Centre: where, and its steps. */
  connect?: ShopOrderConnect | null;
  currency: string;
  /** The price: on a resale order, the supplier sees their own price, never the store's. */
  price: number;
  delivery_fee: number;
  buyer_fee?: number;
  total?: number;
  seller_fee?: number;
  payout?: number;
  /** Resale, to the supplier: their price, the reseller's discount and their net before the fee. */
  resale?: { supplier_price: number; discount_bps: number; supplier_net: number; deal_id: string | null } | null;
  refund: number | null;
  delivery_address: string | null;
  /** Resale, to the supplier once accepted: the buyer's details (every view logged). */
  buyer_details?: ShopBuyerDetails | null;
  tracking_note: string | null;
  shipment: ShopShipment | null;
  deadlines: { accept_by: string; pay_by: string | null; handover_by: string | null; confirm_by: string | null };
  /** Meet-ups, to the seller: tries left at the buyer's release code. */
  release_tries_left?: number | null;
  timeline?: { requested_at: string; locked_at: string | null; accepted_at: string | null; paid_at: string | null; sent_at: string | null; released_at: string | null; refunded_at: string | null; closed_at: string | null };
  ended_by: string | null;
  end_reason: string | null;
  /** The seller's only: a release waiting for BitoCard's check before it can be cashed out. */
  payout_review?: 'pending' | 'approved' | 'rejected' | null;
  dispute?: { id: string; status: 'open' | 'decided'; reason: ShopDisputeReason; decision: 'refund' | 'partial' | 'release' | null } | null;
};
export type ShopOrders = { object: 'list'; data: ShopOrder[]; total: number };

export type ShopDisputeReason = 'not_received' | 'not_as_described' | 'damaged' | 'other';
export type ShopDisputeMessage = {
  object: 'classified_dispute_message';
  id: string;
  from: 'me' | 'them' | 'bitocard';
  /** Who wrote it (a resale order's buyer reads the supplier's and the store's messages as the store's). */
  name?: string;
  body: string;
  photo: { url: string; content_type: string | null; size: number | null; width: number | null; height: number | null } | null;
  created_at: string;
};
export type ShopDispute = {
  object: 'classified_dispute';
  id: string;
  order_id: string;
  reason: ShopDisputeReason;
  status: 'open' | 'decided';
  decision: 'refund' | 'partial' | 'release' | null;
  /** Whose strike an upheld dispute was: the supplier's, the reseller's (a resale order's store) or nobody's. */
  fault?: 'supplier' | 'reseller' | 'none' | null;
  refund: number | null;
  note: string | null;
  decided_at: string | null;
  created_at: string;
  messages: ShopDisputeMessage[];
};

/** Reporting a Resale shop to BitoCard: what it did. */
export type ShopStoreReportReason = 'claims_ownership' | 'misleading' | 'pay_outside' | 'misused_details' | 'other';
export const storeReportReasonLabels: Record<ShopStoreReportReason, string> = {
  claims_ownership: 'Claims to own or make the items',
  misleading: 'Says things about an item the supplier did not',
  pay_outside: 'Asked to be paid outside BitoCard',
  misused_details: 'Used a buyer’s details for something else',
  other: 'Something else',
};
export type ShopStoreReport = {
  object: 'resale_store_report';
  id: string;
  number: string;
  store: { id: string; name: string; subdomain: string };
  reason: ShopStoreReportReason;
  details: string;
  order_id: string | null;
  status: 'open' | 'upheld' | 'dismissed';
  note: string | null;
  decided_at: string | null;
  created_at: string;
};
export type ShopReleaseCode = { object: 'classified_release_code'; order_id: string; code: string; tries_left: number };
/** What a seller still needs before accepting UdozoPay orders. */
/** `identity_required`: whether the market requires the identity check (Udozo's `customer_identity_check` switch); optional otherwise. */
export type ShopReadiness = { object: 'classified_safe_pay_readiness'; identity_required?: boolean; identity_checked: boolean; payout_account: boolean; ready: boolean; limited: boolean; strikes: number; strike_limit: number };

/**
 * Whether the customer can open listings to resellers (B2B reselling): resale open in their country (`reason` when not:
 * `switch_off` or `not_set_up`), their identity check and payout account, and BitoCard's limits there in basis points.
 */
export type ShopResaleAvailability = {
  object: 'classified_resale_availability';
  country: string;
  open: boolean;
  reason: 'switch_off' | 'not_set_up' | null;
  /** Whether the market requires the identity check; optional otherwise. */
  identity_required?: boolean;
  identity_checked: boolean;
  payout_account: boolean;
  /** Admins are testing reselling in the market: neither the identity check nor a payout account is needed. */
  checks_waived?: boolean;
  ready: boolean;
  discount_min_bps: number;
  discount_max_bps: number;
  markup_max_bps: number;
};

/** A deal a supplier offers one reseller (B2B reselling): a bigger discount, and a floor below the supplier's price. */
export type ShopResaleDeal = {
  object: 'resale_deal';
  id: string;
  supplier_relationship_id: string;
  listing: { id: string; title: string } | null;
  discount_bps: number;
  floor_bps: number;
  status: 'offered' | 'active' | 'declined' | 'withdrawn' | 'ended';
  ends_at: string | null;
  responded_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  created_at: string;
};

export type ShopResaleNote = { text: string; status: 'pending' | 'approved' | 'refused' | 'withdrawn'; reason: string | null; submitted_at: string | null };

/** A reseller carrying the supplier's listings (My Resellers); `listings` only on one reseller's page. */
export type ShopReseller = {
  object: 'resale_reseller';
  id: string;
  reseller: { id: string; name: string; verified: boolean; phone: string | null };
  stores: Array<{ id: string; name: string; url: string }>;
  stopped: boolean;
  closed_by_reseller: boolean;
  listings_carried: number;
  /** What this reseller has sold of the supplier's: orders by state and what the supplier was paid. */
  sales: { open: number; completed: number; refunded: number; paid_to_you: { currency: string; amount: number } | null };
  notes_pending: number;
  unread: number;
  deals: ShopResaleDeal[];
  listings?: Array<{ id: string; store_id: string; listing: { id: string; title: string }; status: 'active' | 'paused' | 'removed'; note: ShopResaleNote | null }>;
  last_message_at: string | null;
  created_at: string;
};

export type ShopResaleMessage = {
  object: 'resale_message';
  id: string;
  author: 'supplier' | 'reseller' | 'system';
  author_name: string;
  mine: boolean;
  body: string;
  deal: ShopResaleDeal | null;
  created_at: string;
};

/** "15%" from basis points. */
export const bpsText = (bps: number) => `${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;

/** A deal in a few words: "15% off every listing, selling from 5% below your price, until 30 Nov 2026". */
export function resaleDealText(deal: Pick<ShopResaleDeal, 'discount_bps' | 'floor_bps' | 'listing' | 'ends_at'>) {
  return [
    `${bpsText(deal.discount_bps)} off ${deal.listing ? `“${deal.listing.title}”` : 'every listing'}`,
    deal.floor_bps ? `selling from ${bpsText(deal.floor_bps)} below your price` : null,
    deal.ends_at ? `until ${new Date(deal.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export type ShopListingStatus = 'draft' | 'pending_review' | 'active' | 'sold' | 'expired' | 'rejected' | 'removed';
export type ShopContact = 'chat' | 'phone' | 'both';
/** A seller's own listing, as the Shop tab edits it. */
export type ShopMyListing = {
  object: 'classified_listing';
  id: string;
  ref: number;
  /** Its category's prefix and number (PHN-000123); null until it has a category. */
  sku: string | null;
  status: ShopListingStatus;
  review_reason: string | null;
  review_flags: string[];
  title: string | null;
  description: string | null;
  price: ShopPrice;
  /** Sold at its price or by auction (Udozo): its reserve (the seller's only) and length in days. */
  sale_method?: ShopSaleMethod;
  auction_reserve?: number | null;
  auction_days?: number | null;
  condition: ShopCondition | null;
  category: { id: string; slug: string; name: string; parent: { id: string; slug: string; name: string } | null } | null;
  country: string;
  area: { id: string; slug: string; name: string; state: { id: string; slug: string; name: string } | null } | null;
  features: Array<{ key: string; name: string; icon: string; unit: string | null; value: string | number | boolean | null }>;
  photos: Array<{ id: string; url: string; width: number | null; height: number | null; status: string }>;
  video: { id: string; url: string | null; poster_url: string | null; duration_ms: number | null; status: 'processing' | 'ready' | 'failed'; failure_reason: string | null } | null;
  delivery: ShopDelivery;
  /** Handed over in person (with the buyer's release code); at least one of this and delivery. */
  pickup: boolean;
  /** The delivery charge within the seller's state and elsewhere, in minor units (0: free). */
  delivery_fees: { within_state: number; nationwide: number };
  /** Shipped through Udozo Connect: the states with the seller's charge (minor units), and every centre there or those chosen. */
  connect?: ShopListingConnectOwn;
  contact: ShopContact;
  views: number;
  leads: number;
  /** Sold on BitoCard Shop itself; with resale enabled it can be both, or resellers only. */
  on_shop: boolean;
  /** Open to resellers' stores, with the discount they earn and how far above the price they may sell (basis points). */
  resale: { enabled: boolean; discount_bps: number | null; markup_max_bps: number | null; paused: boolean };
  /** Units left to sell, shared by every channel (none until the seller says how many). */
  stock: number;
  /** Udozo: whether any are left; out of stock, it stays live 90 days (`delist_at`), then Anjio takes it off. */
  in_stock?: boolean;
  out_of_stock_at?: string | null;
  /** When Anjio takes it off Udozo if it is not restocked (live and out of stock only). */
  delist_at?: string | null;
  /** Why it was taken off: `out_of_stock` when Anjio took it off, so restocking and renewing brings it back. */
  expired_reason?: 'out_of_stock' | null;
  /** Its public page on shop.bitocard.com, while live or recently sold (none for a resale-only listing). */
  url: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  published_at: string | null;
  expires_at: string | null;
  sold_at: string | null;
};
export type ShopMyListings = { object: 'list'; data: ShopMyListing[]; has_more: boolean };

// ---- The account dashboard (udozo.com's /account) ----

/** The periods the account dashboard reports on, in days ending today (UTC). */
export const dashboardPeriods = [7, 30, 90] as const;
export type DashboardPeriod = (typeof dashboardPeriods)[number];
export type DashboardMetric = 'views' | 'leads' | 'chats' | 'saves' | 'sales';
export type DashboardTotal = { value: number; previous: number; change_pct: number | null };
export type BoardTone = 'news' | 'tip' | 'alert';
/** A post on the dashboard's message board, written by Udozo's team. */
export type BoardPost = { object: 'board_post'; id: string; title: string; body: string; tone: BoardTone; href: string | null; link_label: string | null; pinned: boolean; posted_at: string };
/** `GET /v1/classifieds/me/dashboard?days=`: a customer's own figures, day by day, best listings and Udozo's message board. */
export type AccountDashboard = {
  object: 'account_dashboard';
  country: string;
  days: DashboardPeriod;
  since: string;
  until: string;
  listings: { active: number; in_review: number; drafts: number; needs_changes: number; sold: number; expired: number; views: number; leads: number };
  totals: Record<DashboardMetric, DashboardTotal>;
  sales_value: Array<{ currency: string; amount: number }>;
  response_rate: number | null;
  purchases: number;
  reviews: { counted: number; positive_pct: number | null } | null;
  series: Array<{ day: string } & Record<DashboardMetric, number>>;
  top_listings: Array<{ id: string; title: string | null; status: ShopListingStatus; views: number; leads: number }>;
  board: BoardPost[];
};
export type ShopMedia = { object: 'classified_media'; id: string; kind: 'photo' | 'video'; position: number; url: string | null; width: number | null; height: number | null; status: 'processing' | 'ready' | 'failed'; failure_reason: string | null };
export type ShopVideoUpload = { object: 'classified_video_upload'; listing_id: string; path: string; expires_at: string };
export type ShopListingStats = { object: 'classified_listing_stats'; listing_id: string; views: number; leads: number; phone_reveals: number; chats: number; offers: number };

export type ShopFavourite = {
  object: 'classified_favourite';
  listing_id: string;
  state: 'live' | 'sold' | 'gone';
  saved_at: string;
  saved_price: number | null;
  /** How much the price fell since it was saved, while live. */
  price_drop: number | null;
  listing: ShopListingCard | null;
};
export type ShopFavourites = { object: 'list'; data: ShopFavourite[]; total: number };
export type ShopConversations = { object: 'list'; data: ShopConversation[]; total: number };

export type ShopWallet = { object: 'customer_wallet'; currency: string; balance: number };

// ---- Labels ----

/** What people read. The stored value `untested` is shown as Foreign used (imported second-hand). */
/** What paying through Udozo is called (Safe pay until 9 November 2026), and the part of Udozo it belongs to: payments
 * and logistics. Write new copy with these, never the name itself (docs/UDOZO_CONNECT_PLAN.md). */
export const payName = 'UdozoPay';
export const connectName = 'Udozo Connect';

export const conditionLabels: Record<ShopCondition, string> = { new: 'New', used: 'Used', untested: 'Foreign used', parts: 'For parts' };
export const deliveryLabels: Record<ShopDelivery, string> = { none: 'Collection only', state: 'Delivers in the state', nationwide: 'Delivers nationwide' };
export const sortLabels: Record<ShopSort, string> = { relevant: 'Best match', newest: 'Newest', price_asc: 'Lowest price', price_desc: 'Highest price' };
export const badgeLabels: Record<ShopBadge, string> = { phone_confirmed: 'Phone confirmed', id_checked: 'ID checked' };
export const reportReasonLabels: Record<ShopReportReason, string> = {
  scam: 'It looks like a scam',
  prohibited: 'It is not allowed on BitoCard Shop',
  wrong_category: 'It is in the wrong category',
  duplicate: 'It is posted more than once',
  sold: 'It has already been sold',
  offensive: 'It is offensive',
  other: 'Something else',
};
/** Why a chat is reported: the listing's reasons, and pressure over a review. */
export const chatReportReasonLabels: Record<ShopChatReportReason, string> = {
  ...reportReasonLabels,
  review_pressure: 'Pressure over a review (a refund or discount to change one, or demands for one)',
};
/** An order's state, as its buyer reads it. */
export const buyerOrderLabels: Record<ShopOrderStatus, string> = {
  requested: 'Waiting for the seller to accept',
  declined: 'The seller declined',
  lapsed: 'Closed: not answered or paid in time',
  awaiting_payment: 'Accepted: pay to reserve it',
  cancelled: 'Cancelled',
  locked: 'Paid: waiting for the store to confirm',
  paid: 'Paid: Udozo holds the money',
  sent: 'Sent: confirm when it arrives',
  at_centre: 'At the Connect Centre',
  disputed: 'In dispute',
  released: 'Complete',
  refunded: 'Refunded',
  partly_refunded: 'Partly refunded',
};

/** An order's state, as its seller reads it. */
export const sellerOrderLabels: Record<ShopOrderStatus, string> = {
  requested: 'Asked: accept or decline',
  declined: 'You declined',
  lapsed: 'Closed: not answered or paid in time',
  awaiting_payment: 'Accepted: waiting for payment',
  cancelled: 'Cancelled',
  locked: 'Paid and locked: accept or decline',
  paid: 'Paid: hand it over or ship it',
  sent: 'Sent: waiting for the buyer',
  at_centre: 'At the Connect Centre: waiting for the buyer',
  disputed: 'In dispute',
  released: 'Paid to you',
  refunded: 'Refunded to the buyer',
  partly_refunded: 'Partly refunded',
};
export const listingStatusLabels: Record<ShopListingStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  active: 'Active',
  sold: 'Sold',
  expired: 'Expired',
  rejected: 'Needs changes',
  removed: 'Removed',
};
export const disputeReasonLabels: Record<ShopDisputeReason, string> = { not_received: 'It never arrived', not_as_described: 'Not as described', damaged: 'Damaged on arrival', other: 'Something else' };
export const contactLabels: Record<ShopContact, string> = { chat: 'Chat only', phone: 'Phone only', both: 'Chat and phone' };

// ---- Addresses ----

/** A listing's address on shop.bitocard.com: `/ng/l/100001-iphone-13-pro`. */
export function listingPath(country: string, ref: number, slug: string) {
  return `/${country.toLowerCase()}/l/${ref}-${slug}`;
}

/** The listing number from its address segment (`100001-iphone-13-pro`, or the bare number), or null. */
export function listingRef(segment: string) {
  const match = /^(\d{1,15})(?:-[a-z0-9-]*)?$/.exec(segment);
  return match ? Number(match[1]) : null;
}

/** A seller's public page (Udozo): `/ng/seller/k3f9a0b2c1`. */
/** A seller's page address: their username once they chose one, else their random handle. */
export const sellerSlug = (seller: { handle?: string | null; username?: string | null }) => seller.username || seller.handle || '';

export function sellerPath(country: string, handle: string) {
  return `/${country.toLowerCase()}/seller/${handle}`;
}

/** A brand's public page (Udozo): `/ng/brand/hp`. */
export function brandPath(country: string, slug: string) {
  return `/${country.toLowerCase()}/brand/${slug}`;
}

export function categoryPath(country: string, slug: string) {
  return `/${country.toLowerCase()}/c/${slug}`;
}

/** A location page: `/ng/lagos`, `/ng/lagos/ikeja`, `/ng/lagos/ikeja/mobile-phones`. */
export function placePath(country: string, place: { state: string; area?: string | null; category?: string | null }) {
  return `/${[country.toLowerCase(), place.state, place.area, place.category].filter(Boolean).join('/')}`;
}

export type RegionWord = 'state' | 'region' | 'county' | 'department' | 'province' | 'district';
const regionWords: Record<string, RegionWord> = {
  GH: 'region',
  KE: 'county',
  BJ: 'department',
  CG: 'department',
  CM: 'region',
  SN: 'region',
  UG: 'region',
  CD: 'province',
  GA: 'province',
  MZ: 'province',
  RW: 'province',
  SL: 'province',
  ZM: 'province',
  CI: 'district',
};

/** What a market calls its top-level areas: Nigeria's states, Ghana's regions, Kenya's counties, Rwanda's provinces. */
export function regionWord(country: string): RegionWord {
  return regionWords[country.toUpperCase()] ?? 'state';
}

// ---- Money and words ----

/** An amount in minor units as people read it: "₦520,000", with kobo only when there are any. */
export function shopMoney(minor: number, currency: string) {
  const value = minor / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
  }
}

/** A listing's price: the amount (negotiable ones say so separately), or "Price on request". */
export function shopPriceText(price: ShopPrice) {
  return price.kind === 'on_request' || price.amount === null ? 'Price on request' : shopMoney(price.amount, price.currency);
}

/** A feature's value as the listing page shows it: a number with its unit, Yes or No, or the text. */
export function featureValueText(feature: { unit: string | null; value: string | number | boolean | null }) {
  if (feature.value === null || feature.value === '') return '';
  if (typeof feature.value === 'boolean') return feature.value ? 'Yes' : 'No';
  if (typeof feature.value === 'number') return `${feature.value.toLocaleString('en-GB')}${feature.unit ? ` ${feature.unit}` : ''}`;
  return feature.value;
}

/** "Just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", then the date. */
export function postedAgo(iso: string | null, now = Date.now()) {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** "Chinedu O." as initials for an avatar: "CO". */
export function nameInitials(name: string) {
  return name
    .replace(/\./g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join('');
}

// ---- Descriptions ----

export type DescriptionSpan = { text: string; bold?: boolean; italic?: boolean };
export type DescriptionBlock = { kind: 'p'; spans: DescriptionSpan[] } | { kind: 'ul' | 'ol'; items: DescriptionSpan[][] };

/** `**bold**` and `*italic*` within a line; anything else is plain text (never HTML). */
function spans(line: string): DescriptionSpan[] {
  const out: DescriptionSpan[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) out.push({ text: line.slice(last, match.index) });
    out.push(match[1] !== undefined ? { text: match[1], bold: true } : { text: match[2]!, italic: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/**
 * A description's limited Markdown (paragraphs, **bold**, *italic*, `- ` bullets and `1. ` numbered lists) as blocks to
 * render as text, so nothing in it can ever become markup.
 */
export function descriptionBlocks(text: string | null): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', spans: spans(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const raw of (text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d{1,3}[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const previous = blocks.at(-1);
      if (previous && previous.kind === kind) previous.items.push(spans(item[1]!));
      else blocks.push({ kind, items: [spans(item[1]!)] });
    } else if (!line) flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

// ---- Shop assistants (Anjio) ----

export type ShopAssistantSurface = 'browse' | 'sell' | 'help';

/** What the assistant shows beside its words: always drawn from its tools' results, never from the model's text. */
export type ShopAssistantCard =
  | { type: 'listings'; items: ShopListingCard[] }
  | { type: 'compare'; items: ShopListingCard[] }
  | { type: 'price_range'; category: string; currency: string; low: number; median: number; high: number; count: number }
  | { type: 'safe_pay'; currency: string; price: number; fee: number; total: number; listing_id: string | null }
  | { type: 'checklist'; category: string | null; items: string[] }
  | { type: 'orders'; items: Array<{ order_id: string; number: string; listing: string | null; side: 'buyer' | 'seller'; status: string; price: string; fulfilment: string; next: string | null }> }
  | { type: 'my_listings'; items: Array<{ listing_id: string; title: string; status: string; price: string | null; views: number; leads: number; expires: string | null }> }
  | { type: 'message_draft'; listing_id: string; title: string; url: string; text: string }
  | { type: 'person'; reason: string }
  | ({ type: 'suggestion'; kind: 'draft' | 'improve' | 'reply' } & Record<string, unknown>);

export type ShopAssistantProfile = {
  object: 'shop_assistant';
  assistant: { id: string; name: string; avatar_url: string | null; label: string; language: string; greeting: string | null; roles: ShopAssistantSurface[]; suggestions: string[] } | null;
  languages: Array<{ code: string; name: string }>;
};

export type ShopAssistantMessage = { object: 'assistant_message'; id: string; role: 'user' | 'assistant'; body: string; cards: ShopAssistantCard[]; rating: 1 | -1 | null; reported: boolean; created_at: string };

export type ShopAssistantThread = {
  object: 'assistant_thread';
  id: string;
  country: string;
  language: string;
  surface: ShopAssistantSurface;
  listing_id: string | null;
  conversation_id: string | null;
  chat_id: string | null;
  assistant: { name: string; avatar_url: string | null; label: string; greeting: string | null } | null;
  messages: ShopAssistantMessage[];
  created_at: string;
  /** A visitor's first thread only: the token their site's server keeps for them. */
  visitor_token?: string;
};

/** A streamed answer's events, in order: `status` as each tool runs, `cards` as they return, then `message` (or `error`). */
export type ShopAssistantEvent = { event: 'status'; data: { tool: string } } | { event: 'cards'; data: { cards: ShopAssistantCard[] } } | { event: 'message'; data: ShopAssistantMessage } | { event: 'error'; data: { code: string; message: string } };

export type ShopDraftSuggestion = {
  title: string | null;
  category: { id: string; slug: string; name: string } | null;
  condition: ShopCondition | null;
  features: Array<{ key: string; name: string; value: string | number | boolean | null }>;
  description: string | null;
};
export type ShopImproveSuggestion = { tips: string[]; missing_features: Array<{ key: string; name: string }>; title: string | null };
export type ShopPriceSuggestion = Extract<ShopAssistantCard, { type: 'price_range' }>;

export type ShopSuggestion =
  | { object: 'assistant_suggestion'; kind: 'draft'; message_id: string; suggestion: ShopDraftSuggestion | null }
  | { object: 'assistant_suggestion'; kind: 'improve'; message_id: string; suggestion: ShopImproveSuggestion | null }
  | { object: 'assistant_suggestion'; kind: 'reply'; message_id: string; suggestion: { text: string } | null }
  | { object: 'assistant_suggestion'; kind: 'price'; suggestion: ShopPriceSuggestion | null; note: string };

/** Each tool's name as people read it while it runs ("Searching listings…"). */
export const assistantToolLabels: Record<string, string> = {
  search_listings: 'Searching listings',
  get_listing: 'Reading the listing',
  compare_listings: 'Comparing listings',
  price_range: 'Checking prices',
  safe_pay_quote: 'Working out the UdozoPay total',
  safety_checklist: 'Finding the safety checks',
  categories: 'Looking at categories',
  search_features: 'Looking up features',
  draft_message: 'Drafting a message',
  my_listings: 'Reading your listings',
  my_orders: 'Reading your orders',
  my_conversations: 'Reading your chats',
  my_listing: 'Reading your listing',
  chat_messages: 'Reading the chat',
  offer_person: 'Finding you a person',
};

/** Reads a server-sent event stream (`event:` and `data:` lines, blank-line separated) into events as they arrive. */
export function parseAssistantEvents(buffer: string): { events: ShopAssistantEvent[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: ShopAssistantEvent[] = [];
  for (const block of blocks) {
    let event = '';
    let data = '';
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!event || !data) continue;
    try {
      events.push({ event, data: JSON.parse(data) } as ShopAssistantEvent);
    } catch {
      // A broken event is skipped; the final message still arrives.
    }
  }
  return { events, rest };
}

/**
 * Usernames (Udozo, docs/UDOZO_USERNAMES_PLAN.md): 3 to 24 characters, lower-case letters, digits and underscores,
 * starting with a letter; chosen once the customer has posted the market's minimum of ads.
 */
export const usernamePattern = /^[a-z][a-z0-9_]{2,23}$/;
export type UsernameStatus = {
  object: 'username_status';
  username: string | null;
  /** Ads they have posted (published at least once, not removed by moderation) and the market's minimum. */
  posted: number;
  required: number;
  eligible: boolean;
  /** When they may change it again (null: now, or never set). */
  change_after: string | null;
  /** Whether the banner asking them to choose one should show (eligible, none yet, dismissed fewer than 3 times). */
  prompt: boolean;
  dismissals: number;
};
export type UsernameAvailability = { object: 'username_availability'; username: string; available: boolean; reason: 'taken' | 'reserved' | 'refused' | 'invalid' | 'own' | null; suggestions: string[] };

// ---- Buy orders (Udozo, docs/UDOZO_RATINGS_PLAN.md phase 0) ----

/**
 * A buy order: the buyer asks to buy at a price, the seller accepts (or counters) before they meet, they trade in person,
 * and the seller marks it sold (or the buyer says they bought it). Payment is between them, off Udozo.
 */
export type ShopBuyOrderStatus = 'requested' | 'countered' | 'accepted' | 'completed' | 'declined' | 'cancelled' | 'lapsed' | 'expired' | 'no_show' | 'voided';
export const buyOrderOpenStatuses: readonly ShopBuyOrderStatus[] = ['requested', 'countered', 'accepted'];
/** `confirm`: the buyer says yes, they bought it (a sale the seller marked), in Reviews' To confirm. */
export type ShopBuyOrderAction = 'accept' | 'counter' | 'decline' | 'accept_counter' | 'cancel' | 'no_show' | 'complete' | 'bought' | 'void' | 'confirm' | 'extend';

/** The words each side reads for a status. */
export const buyOrderLabels: Record<'buyer' | 'seller', Record<ShopBuyOrderStatus, string>> = {
  buyer: {
    requested: 'Waiting for the seller',
    countered: 'The seller offered a price',
    accepted: 'Accepted: meet the seller',
    completed: 'Bought',
    declined: 'Declined',
    cancelled: 'Cancelled',
    lapsed: 'No answer in time',
    expired: 'Ended: not completed in time',
    no_show: 'Did not happen',
    voided: 'You said you did not buy it',
  },
  seller: {
    requested: 'Answer the buyer',
    countered: 'Waiting for the buyer',
    accepted: 'Accepted: meet the buyer',
    completed: 'Sold',
    declined: 'Declined',
    cancelled: 'Cancelled',
    lapsed: 'No answer in time',
    expired: 'Ended: not completed in time',
    no_show: 'Did not happen',
    voided: 'The buyer said they did not buy it',
  },
};

export type ShopBuyOrderSummary = {
  object: 'classified_buy_order';
  id: string;
  /** BO-000123. */
  number: string;
  status: ShopBuyOrderStatus;
  role: 'buyer' | 'seller';
  /** The price agreed so far (the buyer's, or theirs after accepting the seller's counter), for all the units. */
  price: number;
  /** The seller's counter price, while it waits for the buyer. */
  counter: number | null;
  currency: string;
  quantity: number;
  /** What the reader can do now. */
  actions: ShopBuyOrderAction[];
};

export type ShopBuyOrder = ShopBuyOrderSummary & {
  listing: { id: string; ref: number; title: string | null; path: string; status: string; cover_url: string | null; price: ShopPrice };
  /** The other person, by their public name. */
  with: { name: string };
  note: string | null;
  meet_note: string | null;
  conversation_id: string | null;
  /** Whose turn it is to answer, and by when (requested: the seller; countered: the buyer). */
  respond_by: string | null;
  /** An accepted order is completed by then, or ends. */
  meet_by: string | null;
  meet_extended: boolean;
  accepted_at: string | null;
  /** The buyer said they bought it: the seller confirms, else it completes by itself on this date. */
  bought_at: string | null;
  completes_at: string | null;
  completed_at: string | null;
  /** seller, buyer or auto. */
  completed_by: 'seller' | 'buyer' | 'auto' | null;
  /** The buyer may say they did not buy it until then. */
  void_until: string | null;
  /** buyer, seller or udozo: who ended it, and why. */
  ended_by: 'buyer' | 'seller' | 'udozo' | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ShopBuyOrders = { object: 'list'; data: ShopBuyOrder[]; waiting: number };

// ---- Reviews (Udozo, docs/UDOZO_RATINGS_PLAN.md phase 1) ----

export type ShopReviewRating = 'positive' | 'neutral' | 'negative';
export type ShopReviewSource = 'safe_pay' | 'buy_order';
export type ShopReviewAspect = 'described' | 'communication' | 'handover';
export type ShopReviewAspects = Partial<Record<ShopReviewAspect, 'up' | 'down'>>;
export type ShopReviewStance = 'agree' | 'disagree' | 'context';
export type ShopReviewReportReason = 'fake' | 'not_a_buyer' | 'offensive' | 'personal_info' | 'contact_or_links' | 'threat_or_extortion' | 'off_topic' | 'other';

export const reviewRatingLabels: Record<ShopReviewRating, string> = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' };
export const reviewAspectLabels: Record<ShopReviewAspect, string> = { described: 'As described', communication: 'Communication', handover: 'Hand-over' };
export const reviewStanceLabels: Record<ShopReviewStance, string> = { agree: 'Agrees', disagree: 'Disagrees', context: 'Adds context' };
export const reviewSourceLabels: Record<ShopReviewSource, string> = { safe_pay: 'UdozoPay purchase', buy_order: 'Buy order' };
export const reviewReportReasonLabels: Record<ShopReviewReportReason, string> = {
  fake: 'It looks fake',
  not_a_buyer: 'They did not buy it',
  offensive: 'Offensive or abusive',
  personal_info: "Someone's personal details",
  contact_or_links: 'Contact details or links',
  threat_or_extortion: 'A threat, or asking for something to change it',
  off_topic: 'Not about the seller or the item',
  other: 'Something else',
};

/** A seller's reviews of the last 12 months, one voice per reviewer; the positive share once enough count (neutral left out). */
export type ShopReviewSummary = { positive: number; neutral: number; negative: number; counted: number; positive_pct: number | null };

export type ShopReviewPost = {
  id: string;
  role: 'seller' | 'reviewer' | 'buyer';
  name: string;
  avatar_url: string | null;
  stance: ShopReviewStance | null;
  reply_to: string | null;
  /** Null once Udozo removed it. */
  body: string | null;
  removed: boolean;
  edited: boolean;
  /** Written by the reader (signed in), who may edit it within 15 minutes or delete it. */
  mine?: boolean;
  created_at: string;
};

export type ShopReview = {
  object: 'classified_review';
  id: string;
  rating: ShopReviewRating;
  aspects: ShopReviewAspects;
  body: string | null;
  reviewer: { name: string; avatar_url: string | null };
  /** The seller, for links to their page. */
  seller: { name: string; handle: string; username: string | null; country: string | null };
  product: { key: string; label: string };
  source: ShopReviewSource;
  /** When it was bought, as YYYY-MM. */
  month: string;
  edited: boolean;
  edited_after_reply: boolean;
  locked: boolean;
  post_count: number;
  /** The conversation (the first few on lists, all on the review's own page). */
  posts: ShopReviewPost[];
  /** Only to its author: published, held, removed or withdrawn. */
  status?: 'published' | 'held' | 'removed' | 'withdrawn';
  created_at: string;
};

export type ShopSellerReviews = {
  object: 'list';
  summary: ShopReviewSummary;
  /** The seller's products with reviews, most reviewed first (the filter chips). */
  products: Array<{ key: string; label: string; count: number }>;
  data: ShopReview[];
  total: number;
};

export type ShopReviewViewer = {
  object: 'classified_review_viewer';
  /** reviewer, seller, or buyer (of the same product from the same seller); null: cannot post. */
  role: 'seller' | 'reviewer' | 'buyer' | null;
  can_post: boolean;
  posts_left: number;
  /** Why not, in words, when signed in and not allowed. */
  reason: string | null;
  can_report: boolean;
  own_review: boolean;
  can_edit: boolean;
};

// ---- Udozo: private ratings of how sellers deal with buyers before a sale (docs/UDOZO_RATINGS_PLAN.md phase 2) ----

export type ShopInteractionChannel = 'call' | 'chat' | 'callback' | 'contact';
export const interactionGoodTags = ['answered_fast', 'clear_answers', 'honest_item'] as const;
export const interactionBadTags = ['pushy', 'rude', 'no_reply', 'no_show', 'price_changed', 'item_unavailable'] as const;
/** Safety tags: they put the rating in front of Udozo's team. */
export const interactionSafetyTags = ['pay_outside', 'upfront_payment'] as const;
export type ShopInteractionTag = (typeof interactionGoodTags)[number] | (typeof interactionBadTags)[number] | (typeof interactionSafetyTags)[number];
export const interactionTagLabels: Record<ShopInteractionTag, string> = {
  answered_fast: 'Answered fast',
  clear_answers: 'Clear answers',
  honest_item: 'Honest about the item',
  pushy: 'Pushy',
  rude: 'Rude',
  no_reply: 'Did not reply',
  no_show: 'Did not show up',
  price_changed: 'Changed the price',
  item_unavailable: 'Item not available',
  pay_outside: 'Asked me to pay outside Udozo',
  upfront_payment: 'Asked me to pay before seeing it',
};
export const interactionScoreLabels = { responsiveness: 'Replies', helpfulness: 'Helpfulness', courtesy: 'Courtesy' } as const;
export type ShopInteractionScores = { responsiveness: number; helpfulness: number; courtesy: number };

/** The buyer's own rating (never shown to the seller as theirs). */
export type ShopInteractionRating = ShopInteractionScores & {
  object: 'classified_interaction_rating';
  id: string;
  listing_id: string;
  channel: ShopInteractionChannel;
  tags: ShopInteractionTag[];
  comment: string | null;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
};

/** Whether the buyer can rate the seller about a listing; `prompt` whether to ask them now. */
export type ShopInteractionState = {
  object: 'classified_interaction_rating_state';
  listing_id: string;
  open: boolean;
  can_rate: boolean;
  reason: 'own_listing' | 'closed' | 'rated' | 'nothing_yet' | 'seller_rated_recently' | null;
  channels: ShopInteractionChannel[];
  prompt: boolean;
  rating: ShopInteractionRating | null;
};

/** The seller's anonymous summary: from `minimum` ratings, counted up to `as_of` (last midnight, UTC). */
export type ShopInteractionSummary = {
  object: 'classified_interaction_summary';
  open: boolean;
  as_of: string;
  minimum: number;
  shown: boolean;
  count: number | null;
  scores: { responsiveness: number | null; helpfulness: number | null; courtesy: number | null } | null;
  tags: Array<{ tag: ShopInteractionTag; count: number }>;
};

export type ShopPurchase = {
  object: 'classified_purchase';
  id: string;
  source: ShopReviewSource;
  /** The UdozoPay order or buy order it came from. */
  order_id: string | null;
  buy_order_id: string | null;
  listing: { id: string; title: string | null; path: string; cover_url: string | null };
  seller: { name: string; handle: string; username: string | null };
  product_label: string;
  completed_at: string;
  review_closes_at: string;
  can_review: boolean;
  dismissed: boolean;
  /** Neutral is offered in the market. */
  neutral_allowed: boolean;
  review: ShopReview | null;
};

export type ShopPurchases = { object: 'list'; data: ShopPurchase[]; to_review: number };
export type ShopMyReviews = { object: 'list'; data: Array<ShopReview & { listing: { title: string | null; path: string } }> };

// ---- Udozo: Anjio's seller scores (docs/UDOZO_RATINGS_PLAN.md phase 3) ----

export type ShopScoreKey = 'response' | 'attention' | 'pricing' | 'costing' | 'reliability' | 'satisfaction' | 'salesmanship';
export type ShopScoreBand = 'excellent' | 'very_good' | 'good' | 'fair' | 'needs_work';
export const scoreKeyLabels: Record<ShopScoreKey, string> = {
  response: 'Reply time',
  attention: 'Answering buyers',
  pricing: 'Keeping to prices',
  costing: 'Prices against the market',
  reliability: 'Completing sales',
  satisfaction: 'Reviews',
  salesmanship: 'How buyers rate your dealings',
};
export type ShopScoreSummary = { text: string; credit: string; how_it_works: string; written_at: string | null };

/** What the public sees: words only, the band at Good or better, strong points; never numbers. */
export type ShopPublicScores = {
  new_seller: boolean;
  response: string | null;
  attention: string | null;
  band: ShopScoreBand | null;
  band_label: string | null;
  highlights: Array<{ key: ShopScoreKey; words: string }>;
  summary: ShopScoreSummary | null;
  how_it_works: string;
};

/** The seller's own: every number with its sample and minimum, tips, and what the public sees. */
export type ShopMyScores = {
  object: 'classified_seller_scores';
  public: boolean;
  computed_at: string | null;
  overall: number | null;
  band: ShopScoreBand | null;
  band_label: string | null;
  metrics: Array<{ key: ShopScoreKey; score: number | null; n: number; minimum: number; public: boolean }>;
  tips: string[];
  public_view: Omit<ShopPublicScores, 'summary' | 'how_it_works'>;
  summary: ShopScoreSummary | null;
  summary_reported: boolean;
  how_it_works: string;
};
