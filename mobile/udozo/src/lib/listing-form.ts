/**
 * Post an ad in the app: the ad as the form holds it, its steps and what each still needs, and the body the API takes
 * (`POST /v1/classifieds/listings`, `PATCH …/:id`). The same six steps and rules as udozo.com's wizard
 * (apps/udozo/lib/post-steps.ts) and the API's `requireComplete`, asked early so the seller puts each right on its own
 * step: selling at a price or by auction, where it sells (Udozo, resellers' stores, the seller's own shop through Udozo
 * POS) and shipping through Udozo Connect, so a seller never needs the website.
 */
import type { ShopCondition, ShopContact, ShopDelivery, ShopFeature, ShopMyListing, ShopPriceKind } from '../shared/classifieds';

export const postSteps = [
  { key: 'basics', title: 'What are you selling?' },
  { key: 'photos', title: 'Photos and video' },
  { key: 'details', title: 'Price and details' },
  { key: 'where', title: 'Where to sell' },
  { key: 'place', title: 'Where it is and delivery' },
  { key: 'post', title: 'Check and post' },
] as const;
export const lastStep = postSteps.length - 1;

/** The least and most photos where the market does not say (the API's defaults; markets carry their own, `min_photos`). */
export const minPhotos = 4;
export const maxPhotos = 12;

/** How long an auction can run, in days (the API's `auctionLengths`). */
export const auctionLengths = [1, 3, 5, 7, 10] as const;

/** The largest video a listing takes (the API's `maxVideoBytes`). */
export const maxVideoBytes = 50 * 1024 * 1024;

/**
 * What the seller can choose in this market and account, from the API: resale (open, with Udozo's limits), Udozo POS
 * (an account with room), Udozo Connect (open in the market), auctions, and whether the category is sold at the
 * seller's shop only. What the listing already has always counts as offered (`offersFor`), so it can be kept or undone.
 */
export type SellOffers = { resale: boolean; pos: boolean; connect: boolean; auctions: boolean; shopOnly: boolean };
export const noOffers: SellOffers = { resale: false, pos: false, connect: false, auctions: false, shopOnly: false };

export type FeatureValue = string | number | boolean | null;

export type ListingDraft = {
  title: string;
  categoryId: string | null;
  priceKind: ShopPriceKind;
  /** As typed, in the currency's main unit ("520,000"). */
  price: string;
  condition: ShopCondition | null;
  features: Record<string, FeatureValue>;
  description: string;
  /** How many there are to sell, as typed; empty for none said yet. */
  stock: string;
  stateId: string | null;
  areaId: string | null;
  delivery: ShopDelivery;
  pickup: boolean;
  feeState: string;
  feeNationwide: string;
  contact: ShopContact;
  /** Sold at its price, or by auction (the price is then the starting price). */
  saleMethod: 'fixed' | 'auction';
  /** As typed; empty for no reserve. */
  auctionReserve: string;
  auctionDays: number | null;
  /** Where it sells: Udozo itself, resellers' stores (discount and markup limit in basis points), the seller's shop. */
  onShop: boolean;
  resale: boolean;
  discountBps: number;
  markupMaxBps: number;
  pos: boolean;
  barcode: string;
  reorderLevel: string;
  /** Shipping through Udozo Connect: the states it ships to with the charge typed for each, and which centres. */
  connect: boolean;
  connectStates: Record<string, string>;
  connectAllCentres: boolean;
  connectCentres: string[];
};

export const emptyDraft: ListingDraft = {
  title: '',
  categoryId: null,
  priceKind: 'fixed',
  price: '',
  condition: null,
  features: {},
  description: '',
  stock: '1',
  stateId: null,
  areaId: null,
  delivery: 'none',
  pickup: true,
  feeState: '',
  feeNationwide: '',
  contact: 'both',
  saleMethod: 'fixed',
  auctionReserve: '',
  auctionDays: null,
  onShop: true,
  resale: false,
  discountBps: 500,
  markupMaxBps: 2000,
  pos: false,
  barcode: '',
  reorderLevel: '',
  connect: false,
  connectStates: {},
  connectAllCentres: true,
  connectCentres: [],
};

/** Typed money ("520,000", "1500.50") in minor units; null when it is not an amount above nothing. */
export function toMinor(text: string) {
  const clean = text.replace(/[,\s]/g, '');
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(clean)) return null;
  const minor = Math.round(Number(clean) * 100);
  return minor > 0 ? minor : null;
}

/** Minor units as the price field shows them ("520,000", "1,500.50"); empty for none. */
export function fromMinor(minor: number | null | undefined) {
  if (minor === null || minor === undefined || minor <= 0) return '';
  const major = minor / 100;
  const [whole, cents] = major.toFixed(Number.isInteger(major) ? 0 : 2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${cents ? `.${cents}` : ''}`;
}

/** The form from a saved listing (a draft carried on, or a live ad edited). */
export function draftOf(listing: ShopMyListing): ListingDraft {
  return {
    title: listing.title ?? '',
    categoryId: listing.category?.id ?? null,
    priceKind: listing.price.kind,
    price: fromMinor(listing.price.amount),
    condition: listing.condition,
    features: Object.fromEntries(listing.features.map(item => [item.key, item.value])),
    description: listing.description ?? '',
    stock: String(listing.stock ?? 0),
    stateId: listing.area?.state?.id ?? null,
    areaId: listing.area?.id ?? null,
    delivery: listing.delivery,
    pickup: listing.pickup,
    feeState: fromMinor(listing.delivery_fees.within_state),
    feeNationwide: fromMinor(listing.delivery_fees.nationwide),
    contact: listing.contact,
    saleMethod: listing.sale_method ?? 'fixed',
    auctionReserve: fromMinor(listing.auction_reserve ?? null),
    auctionDays: listing.auction_days ?? null,
    onShop: listing.on_shop,
    resale: listing.resale.enabled,
    discountBps: listing.resale.discount_bps ?? emptyDraft.discountBps,
    markupMaxBps: listing.resale.markup_max_bps ?? emptyDraft.markupMaxBps,
    pos: listing.pos_enabled ?? false,
    barcode: listing.barcode ?? '',
    reorderLevel: listing.reorder_level === null || listing.reorder_level === undefined ? '' : String(listing.reorder_level),
    connect: listing.connect?.enabled ?? false,
    connectStates: Object.fromEntries((listing.connect?.states ?? []).map(item => [item.state.id, item.shipping ? fromMinor(item.shipping) : '0'])),
    connectAllCentres: listing.connect?.all_centres ?? true,
    connectCentres: (listing.connect?.centres ?? []).map(centre => centre.id),
  };
}

/** What the listing already has counts as offered: a seller can always keep, change or turn off what it has. */
export function offersFor(offers: SellOffers, draft: Pick<ListingDraft, 'resale' | 'pos' | 'connect' | 'saleMethod'>): SellOffers {
  return {
    resale: offers.resale || draft.resale,
    pos: offers.pos || draft.pos || offers.shopOnly,
    connect: offers.connect || draft.connect,
    auctions: offers.auctions || draft.saleMethod === 'auction',
    shopOnly: offers.shopOnly,
  };
}

/** What a feature's field holds, as the API takes it: numbers as numbers, yes or no as booleans, empty as nothing. */
export function featureValue(feature: Pick<ShopFeature, 'data_type'>, typed: FeatureValue): FeatureValue {
  if (typed === null || typed === '') return null;
  if (feature.data_type === 'boolean') return typed === true || typed === 'true';
  if (feature.data_type === 'number') {
    const value = Number(String(typed).replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }
  return String(typed).trim() || null;
}

export type Problem = { message: string; param: string };

/**
 * The body to save, or the field that cannot be read. Everything the form holds is sent every time, so a step saved
 * twice changes nothing; empty fields clear theirs. `features` are only those with a value, checked against the
 * category's registry entries (`types`).
 */
export function bodyOf(draft: ListingDraft, types: Record<string, Pick<ShopFeature, 'data_type'>> = {}, offers: SellOffers = noOffers): { body: Record<string, unknown> } | { problem: Problem } {
  const auction = offers.auctions && draft.saleMethod === 'auction';
  const body: Record<string, unknown> = {
    title: draft.title.trim() || null,
    description: draft.description.trim() || null,
    category_id: draft.categoryId,
    area_id: draft.areaId,
    price_kind: auction ? 'fixed' : draft.priceKind,
    condition: draft.condition,
    delivery: draft.delivery,
    pickup: draft.pickup,
    contact: draft.contact,
  };
  if ((draft.priceKind === 'on_request' && !auction) || !draft.price.trim()) body.price = null;
  else {
    const minor = toMinor(draft.price);
    if (minor === null) return { problem: { message: 'Give the price as an amount, such as 520,000.', param: 'price' } };
    body.price = minor;
  }
  for (const [field, key] of [
    ['feeState', 'delivery_fee_state'],
    ['feeNationwide', 'delivery_fee_nationwide'],
  ] as const) {
    const typed = draft[field].trim();
    const minor = typed ? toMinor(typed) : 0;
    if (minor === null) return { problem: { message: 'Give the delivery charge as an amount, such as 2,000 (or leave it empty for free).', param: key } };
    body[key] = minor;
  }
  const stock = draft.stock.trim();
  if (stock) {
    const units = Number(stock);
    if (!Number.isInteger(units) || units < 0 || units > 100000) return { problem: { message: 'Say how many you have as a whole number, such as 1.', param: 'stock' } };
    body.stock = units;
  }
  body.features = Object.entries(draft.features)
    .map(([key, value]) => ({ key, value: types[key] ? featureValue(types[key], value) : value }))
    .filter(item => item.value !== null && item.value !== '');

  // Selling by auction: one item, the price its starting price, an optional reserve and a length.
  if (offers.auctions) {
    body.sale_method = auction ? 'auction' : 'fixed';
    if (auction) {
      const reserve = draft.auctionReserve.trim();
      const minor = reserve ? toMinor(reserve) : null;
      if (reserve && minor === null) return { problem: { message: 'Give the reserve as an amount, or leave it empty.', param: 'auction_reserve' } };
      body.auction_reserve = minor;
      body.auction_days = draft.auctionDays;
    }
  }
  // Where it sells. A shop-only category sells only at the seller's shop: the API places it there itself.
  if (!offers.shopOnly) {
    body.on_shop = draft.onShop;
    if (offers.resale) {
      body.resale = !auction && draft.resale;
      body.resale_discount_bps = draft.discountBps;
      body.resale_markup_max_bps = draft.markupMaxBps;
    }
  }
  if (offers.pos) {
    if (!offers.shopOnly) body.pos_enabled = !auction && draft.pos;
    body.barcode = draft.barcode.trim() || null;
    const level = draft.reorderLevel.trim();
    if (level && !/^\d{1,6}$/.test(level)) return { problem: { message: 'Give the reorder level as a whole number, or leave it empty.', param: 'reorder_level' } };
    body.reorder_level = level ? Number(level) : null;
  }
  // Shipping through Udozo Connect: the states with their charges, and every centre there or the chosen ones.
  if (offers.connect) {
    body.connect = draft.connect;
    if (draft.connect) {
      const states: { state_id: string; shipping: number }[] = [];
      for (const [stateId, typed] of Object.entries(draft.connectStates)) {
        const clean = typed.trim();
        const minor = !clean || clean === '0' ? 0 : toMinor(clean);
        if (minor === null) return { problem: { message: 'Give each shipping charge as an amount, or 0 for free.', param: 'connect_states' } };
        states.push({ state_id: stateId, shipping: minor });
      }
      body.connect_states = states;
      body.connect_centres = draft.connectAllCentres ? null : draft.connectCentres;
    }
  }
  return { body };
}

/** What a step still needs before the next one, naming the field (null when it is complete). */
export function stepProblem(
  step: number,
  draft: ListingDraft,
  photos: { ready: number; uploading: number; failed: number },
  rules: { minPhotos?: number; offers?: SellOffers } = {},
): Problem | null {
  const least = rules.minPhotos ?? minPhotos;
  const offers = rules.offers ?? noOffers;
  const auction = offers.auctions && draft.saleMethod === 'auction';
  switch (step) {
    case 0:
      if (draft.title.trim().length < 5) return { message: 'Give your ad a title of at least 5 characters.', param: 'title' };
      if (!draft.categoryId) return { message: 'Choose a category.', param: 'category_id' };
      return null;
    case 1:
      if (photos.uploading > 0) return { message: 'Wait for your photos to finish uploading.', param: 'photos' };
      if (photos.failed > 0) return { message: 'Remove the photo that could not be used, or add it again.', param: 'photos' };
      // Sold only at the seller's own shop, it is never shown publicly, so it needs no photos.
      if (!offers.shopOnly && photos.ready < least) return { message: `Add at least ${least} photos.`, param: 'photos' };
      return null;
    case 2:
      if (auction) {
        if (!toMinor(draft.price)) return { message: 'Enter the starting price: bidding starts there.', param: 'price' };
        if (!draft.auctionDays) return { message: 'Choose how long the auction runs.', param: 'auction_days' };
      }
      if (offers.shopOnly) return draft.priceKind === 'on_request' || !toMinor(draft.price) ? { message: 'Enter the price your till sells it at.', param: 'price' } : null;
      if (draft.priceKind !== 'on_request' && !toMinor(draft.price)) return { message: 'Enter the price, or choose Contact for price.', param: 'price' };
      if (!draft.condition) return { message: 'Choose its condition.', param: 'condition' };
      return null;
    case 3:
      if (offers.shopOnly || auction) return null;
      if (!draft.onShop && !(offers.resale && draft.resale) && !(offers.pos && draft.pos)) return { message: 'Choose at least one place to sell it.', param: 'on_shop' };
      if (offers.resale && draft.resale && draft.priceKind === 'on_request') return { message: 'Resellers sell at a price: give one, or stop them reselling it.', param: 'resale' };
      return null;
    case 4:
      if (offers.shopOnly) return null;
      if (!draft.areaId) return { message: 'Choose where it is: the area it is in.', param: 'area_id' };
      if (draft.delivery === 'none' && !draft.pickup && !(offers.connect && draft.connect)) return { message: 'Choose delivery, collection in person, Udozo Connect, or more than one.', param: 'pickup' };
      if (offers.connect && draft.connect) {
        if (!Object.keys(draft.connectStates).length) return { message: 'Choose the states it ships to through Udozo Connect.', param: 'connect_states' };
        if (!draft.connectAllCentres && !draft.connectCentres.length) return { message: 'Choose the Connect Centres it ships to, or every centre there.', param: 'connect_centres' };
        if (draft.priceKind === 'on_request' && !auction) return { message: 'Shipped items are paid with UdozoPay, so they need a price.', param: 'connect' };
      }
      return null;
    default:
      return null;
  }
}

/** The step holding the field the API named, so a refusal opens where it can be put right (null: stay put). */
export function stepOf(param: string | null | undefined): number | null {
  if (!param) return null;
  if (param === 'terms') return lastStep;
  if (param === 'title' || param === 'category_id') return 0;
  if (param === 'photos' || param === 'video' || param.startsWith('media')) return 1;
  if (['price', 'price_kind', 'condition', 'description', 'sale_method', 'safe_pay'].includes(param) || param.startsWith('auction') || param.startsWith('features')) return 2;
  if (['on_shop', 'stock', 'pos_enabled', 'barcode', 'reorder_level'].includes(param) || param.startsWith('resale')) return 3;
  if (param === 'area_id' || param === 'pickup' || param === 'contact' || param.startsWith('delivery') || param.startsWith('connect')) return 4;
  return null;
}

/** The first step still missing something, where a saved draft carries on (the last step when none is). */
export function firstIncomplete(draft: ListingDraft, photos: { ready: number; uploading: number; failed: number }, rules: { minPhotos?: number; offers?: SellOffers } = {}) {
  for (let step = 0; step < lastStep; step++) if (stepProblem(step, draft, photos, rules)) return step;
  return lastStep;
}

/** The photos of a listing counted by state, for the steps. */
export function photoCounts(photos: { status: string }[], uploading = 0) {
  return {
    ready: photos.filter(photo => photo.status === 'ready').length,
    failed: photos.filter(photo => photo.status === 'failed').length,
    uploading: uploading + photos.filter(photo => photo.status === 'processing').length,
  };
}

/** A Fill from photos suggestion put into the form: only what the seller has not filled in, unless they ask for all. */
export function applyDraftSuggestion(
  draft: ListingDraft,
  suggestion: { title: string | null; category: { id: string } | null; condition: ShopCondition | null; features: { key: string; value: FeatureValue }[]; description: string | null },
  overwrite = false,
): ListingDraft {
  const take = <T,>(current: T, offered: T | null, empty: boolean) => (offered !== null && offered !== undefined && (overwrite || empty) ? offered : current);
  const features = { ...draft.features };
  for (const item of suggestion.features) if (item.value !== null && (overwrite || features[item.key] === undefined || features[item.key] === null || features[item.key] === '')) features[item.key] = item.value;
  return {
    ...draft,
    title: take(draft.title, suggestion.title, !draft.title.trim()),
    categoryId: take(draft.categoryId, suggestion.category?.id ?? null, !draft.categoryId),
    condition: take(draft.condition, suggestion.condition, !draft.condition),
    description: take(draft.description, suggestion.description, !draft.description.trim()),
    features,
  };
}

/** My listings' groups, in order, as the API names their statuses (`?status=`). */
export const listingGroups = [
  { status: 'active', label: 'Live' },
  { status: 'pending_review', label: 'In review' },
  { status: 'draft', label: 'Drafts' },
  { status: 'rejected', label: 'Needs changes' },
  { status: 'expired', label: 'Expired' },
  { status: 'sold', label: 'Sold' },
] as const;

/** What a seller can do with their listing now. */
export function listingActions(listing: Pick<ShopMyListing, 'status' | 'stock' | 'expired_reason'> & { expires_at?: string | null }, now = Date.now()) {
  const renewDue = listing.status === 'active' && listing.stock > 0 && Boolean(listing.expires_at) && Date.parse(listing.expires_at as string) - now <= 3 * 86_400_000;
  const actions: ('edit' | 'renew' | 'sold' | 'restock' | 'delete' | 'view')[] = [];
  if (['draft', 'rejected', 'active', 'pending_review'].includes(listing.status)) actions.push('edit');
  if (listing.status === 'active') actions.push('view', 'sold');
  if (listing.status === 'active' || (listing.status === 'expired' && listing.expired_reason === 'out_of_stock')) actions.push('restock');
  if ((listing.status === 'expired' && listing.expired_reason !== 'out_of_stock') || renewDue) actions.push('renew');
  if (listing.status !== 'removed') actions.push('delete');
  return actions;
}
