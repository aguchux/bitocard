/**
 * Post an ad in the app: the ad as the form holds it, its steps and what each still needs, and the body the API takes
 * (`POST /v1/classifieds/listings`, `PATCH …/:id`). The same rules as udozo.com's wizard (apps/udozo/lib/post-steps.ts)
 * and the API's `requireComplete`, asked early so the seller puts each right on its own step.
 *
 * Resale, Udozo POS, Udozo Connect and auctions are left as the listing has them: the app never sends them, and the
 * last step links to udozo.com for those.
 */
import type { ShopCondition, ShopContact, ShopDelivery, ShopFeature, ShopMyListing, ShopPriceKind } from '../shared/classifieds';

export const postSteps = [
  { key: 'basics', title: 'What are you selling?' },
  { key: 'photos', title: 'Photos' },
  { key: 'details', title: 'Price and details' },
  { key: 'place', title: 'Where it is and delivery' },
  { key: 'post', title: 'Check and post' },
] as const;
export const lastStep = postSteps.length - 1;

/** The market's least number of photos (the API's default; it names a market's own when it refuses). */
export const minPhotos = 4;
export const maxPhotos = 12;

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
export function bodyOf(draft: ListingDraft, types: Record<string, Pick<ShopFeature, 'data_type'>> = {}): { body: Record<string, unknown> } | { problem: Problem } {
  const body: Record<string, unknown> = {
    title: draft.title.trim() || null,
    description: draft.description.trim() || null,
    category_id: draft.categoryId,
    area_id: draft.areaId,
    price_kind: draft.priceKind,
    condition: draft.condition,
    delivery: draft.delivery,
    pickup: draft.pickup,
    contact: draft.contact,
  };
  if (draft.priceKind === 'on_request' || !draft.price.trim()) body.price = null;
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
  return { body };
}

/** What a step still needs before the next one, naming the field (null when it is complete). */
export function stepProblem(step: number, draft: ListingDraft, photos: { ready: number; uploading: number; failed: number }): Problem | null {
  switch (step) {
    case 0:
      if (draft.title.trim().length < 5) return { message: 'Give your ad a title of at least 5 characters.', param: 'title' };
      if (!draft.categoryId) return { message: 'Choose a category.', param: 'category_id' };
      return null;
    case 1:
      if (photos.uploading > 0) return { message: 'Wait for your photos to finish uploading.', param: 'photos' };
      if (photos.failed > 0) return { message: 'Remove the photo that could not be used, or add it again.', param: 'photos' };
      if (photos.ready < minPhotos) return { message: `Add at least ${minPhotos} photos.`, param: 'photos' };
      return null;
    case 2:
      if (draft.priceKind !== 'on_request' && !toMinor(draft.price)) return { message: 'Enter the price, or choose Contact for price.', param: 'price' };
      if (!draft.condition) return { message: 'Choose its condition.', param: 'condition' };
      return null;
    case 3:
      if (!draft.areaId) return { message: 'Choose where it is: the area it is in.', param: 'area_id' };
      if (draft.delivery === 'none' && !draft.pickup) return { message: 'Choose delivery, collection in person, or both.', param: 'pickup' };
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
  if (['price', 'price_kind', 'condition', 'description', 'stock'].includes(param) || param.startsWith('features')) return 2;
  if (param === 'area_id' || param === 'pickup' || param === 'contact' || param.startsWith('delivery')) return 3;
  return null;
}

/** The first step still missing something, where a saved draft carries on (the last step when none is). */
export function firstIncomplete(draft: ListingDraft, photos: { ready: number; uploading: number; failed: number }) {
  for (let step = 0; step < lastStep; step++) if (stepProblem(step, draft, photos)) return step;
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
