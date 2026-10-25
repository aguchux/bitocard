/**
 * BitoCard Shop (classifieds) for customers: the public `/v1/classifieds` shapes and the signed-in buyer's, typed by hand
 * against the API presenters (`apps/api/src/classifieds`), with the pure helpers shop.bitocard.com and the storefront's
 * Shop tab share (addresses, prices, labels, the description's limited Markdown). Types only, no RTK Query client.
 * Amounts are minor units (kobo).
 */

export type ShopCondition = 'new' | 'used' | 'untested' | 'parts';
export type ShopPriceKind = 'fixed' | 'negotiable' | 'on_request';
export type ShopDelivery = 'none' | 'state' | 'nationwide';
export type ShopSort = 'relevant' | 'newest' | 'price_asc' | 'price_desc';
export type ShopBadge = 'phone_confirmed' | 'id_checked';
export type ShopTier = 'area' | 'nearby' | 'state' | 'country';
export type ShopReportReason = 'scam' | 'prohibited' | 'wrong_category' | 'duplicate' | 'sold' | 'offensive' | 'other';
export type ShopOrderStatus = 'requested' | 'declined' | 'lapsed' | 'awaiting_payment' | 'cancelled' | 'paid' | 'sent' | 'disputed' | 'released' | 'refunded' | 'partly_refunded';
export type ShopFeatureType = 'text' | 'number' | 'choice' | 'boolean';

export type ShopPrice = { kind: ShopPriceKind; amount: number | null; currency: string };
export type ShopPlace = { slug: string; name: string; state: { slug: string; name: string } };

/** `safe_pay`: open there (its switch on and both fees set); a buyer's own wallet is checked when they ask. */
export type ShopMarket = { object: 'classified_market'; country: string; name: string; currency: string; listings: number; safe_pay: boolean };
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

export type ShopCategory = {
  object: 'classified_category';
  id: string;
  slug: string;
  name: string;
  icon: string;
  b2b: boolean;
  safety_checklist: string[];
  /** The keys the category suggests, in order; `filter` marks those buyers filter by. */
  features: Array<ShopFeature & { filter: boolean }>;
};
export type ShopTopCategory = ShopCategory & { children: ShopCategory[] };

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
  seller: { name: string; badges: ShopBadge[] };
  published_at: string | null;
};
/** A search result: its tier (from the buyer's area outwards) when an area or state was given. */
export type ShopResult = ShopListingCard & { tier: ShopTier | null; delivers_to_you: boolean };
export type ShopSearch = { object: 'list'; data: ShopResult[]; total: number; tiers: Record<ShopTier, number> | null; offset: number; limit: number; sort: ShopSort };

export type ShopListingPage = {
  object: 'classified_listing_page';
  id: string;
  ref: number;
  status: 'active' | 'sold';
  title: string;
  slug: string;
  url: string;
  description: string | null;
  price: ShopPrice;
  condition: ShopCondition | null;
  category: { slug: string; name: string; parent: { slug: string; name: string } | null; safety_checklist: string[] };
  area: ShopPlace;
  features: Array<{ key: string; name: string; icon: string; unit: string | null; value: string | number | boolean | null }>;
  photos: Array<{ url: string; width: number | null; height: number | null }>;
  video: { url: string; poster_url: string | null; duration_ms: number | null; width: number | null; height: number | null } | null;
  delivery: ShopDelivery;
  reserved: boolean;
  contact: { chat: boolean; phone: boolean };
  seller: { name: string; member_since: string; badges: ShopBadge[]; active_listings: number; response_rate: number | null };
  published_at: string | null;
  sold_at: string | null;
};

/** A showcase card: never a price (prices belong to each country's pages). */
export type ShopShowcaseCard = Omit<ShopListingCard, 'price'>;
export type ShopShowcase = {
  object: 'classified_showcase';
  markets: ShopMarket[];
  category: { slug: string; name: string; icon: string } | null;
  categories: Array<{ slug: string; name: string; icon: string; countries: string[]; listings: Record<string, number> }>;
  recent: ShopShowcaseCard[];
  trending: ShopShowcaseCard[];
  sections: Array<{ country: string; name: string; listings: number; cards: ShopShowcaseCard[] }> | null;
};

export type ShopSitemap = {
  object: 'classified_sitemap';
  country: string;
  categories: Array<{ slug: string; listings: number }>;
  places: Array<{ state: string; area: string | null; listings: number }>;
  listings: Array<{ ref: number; slug: string; updated_at: string }>;
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
};

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
  kind: 'text' | 'photo' | 'offer' | 'system';
  from: 'me' | 'them' | 'bitocard';
  body: string;
  photo: { url: string; content_type: string | null; size: number | null; width: number | null; height: number | null } | null;
  offer: ShopOffer | null;
  created_at: string;
};
export type ShopConversation = {
  object: 'classified_conversation';
  id: string;
  role: 'buyer' | 'seller';
  listing: { id: string; ref: number; title: string | null; slug: string | null; status: string; country: string; price: ShopPrice; cover_url: string | null };
  with: { name: string };
  last_message: { kind: string; body: string; from: 'me' | 'them' | 'bitocard'; created_at: string } | null;
  unread: number;
  open_offer: ShopOffer | null;
  blocked: { by_me: boolean; by_them: boolean };
  last_message_at: string;
  created_at: string;
};
export type ShopChat = ShopConversation & { messages: ShopMessage[]; has_more: boolean };

export type ShopPhone = { object: 'classified_phone'; listing_id: string; phone: string; first_time: boolean };

export type ShopSafePayQuote = {
  object: 'classified_safe_pay_quote';
  listing_id: string;
  offer_id: string | null;
  currency: string;
  price: number;
  buyer_fee: number;
  total: number;
  fulfilment: Array<'meet_up' | 'delivery'>;
  reserved: boolean;
  accept_hours: number;
  pay_hours: number;
  covers: string[];
};

/** A Safe pay order as its buyer sees it (their fee and total; never the seller's money). */
export type ShopOrder = {
  object: 'classified_order';
  id: string;
  number: string;
  role: 'buyer' | 'seller';
  status: ShopOrderStatus;
  listing: { id: string; ref: number; title: string | null; slug: string | null; cover_url: string | null };
  with: { name: string };
  fulfilment: 'meet_up' | 'delivery';
  currency: string;
  price: number;
  buyer_fee?: number;
  total?: number;
  seller_fee?: number;
  payout?: number;
  refund: number | null;
  delivery_address: string | null;
  tracking_note: string | null;
  deadlines: { accept_by: string; pay_by: string | null; handover_by: string | null; confirm_by: string | null };
  ended_by: string | null;
  end_reason: string | null;
};

export type ShopWallet = { object: 'customer_wallet'; currency: string; balance: number };

// ---- Labels ----

export const conditionLabels: Record<ShopCondition, string> = { new: 'New', used: 'Used', untested: 'Untested', parts: 'For parts' };
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
/** An order's state, as its buyer reads it. */
export const buyerOrderLabels: Record<ShopOrderStatus, string> = {
  requested: 'Waiting for the seller to accept',
  declined: 'The seller declined',
  lapsed: 'Closed: not answered or paid in time',
  awaiting_payment: 'Accepted: pay to reserve it',
  cancelled: 'Cancelled',
  paid: 'Paid: BitoCard holds the money',
  sent: 'Sent: confirm when it arrives',
  disputed: 'In dispute',
  released: 'Complete',
  refunded: 'Refunded',
  partly_refunded: 'Partly refunded',
};

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

export function categoryPath(country: string, slug: string) {
  return `/${country.toLowerCase()}/c/${slug}`;
}

/** A location page: `/ng/lagos`, `/ng/lagos/ikeja`, `/ng/lagos/ikeja/mobile-phones`. */
export function placePath(country: string, place: { state: string; area?: string | null; category?: string | null }) {
  return `/${[country.toLowerCase(), place.state, place.area, place.category].filter(Boolean).join('/')}`;
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
