import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';

/**
 * BitoCard Shop's rules for what a listing may say: the values a feature key accepts (from its registry entry), the
 * limited Markdown of descriptions, titles and their address slugs. Pure functions, so the API, the Anjio suggestion
 * checks and the tests share them.
 */

export const listingStatuses = ['draft', 'pending_review', 'active', 'sold', 'expired', 'rejected', 'removed', 'deleted'] as const;
export type ListingStatus = (typeof listingStatuses)[number];
export const conditions = ['new', 'used', 'untested', 'parts'] as const;
export const priceKinds = ['fixed', 'negotiable', 'on_request'] as const;
export const deliveries = ['none', 'state', 'nationwide'] as const;
export const contacts = ['chat', 'phone', 'both'] as const;

/**
 * Live on BitoCard Shop itself: active and sold there (`onShop`). A listing open to resellers only is never shown on the
 * Shop, in search, on its pages, in its chats or Safe pay, its sitemaps, showcase or assistant (B2B reselling plan).
 */
export const onShopWhere = { status: 'active', onShop: true } as const;
export const isOnShop = (listing: { status: string; onShop: boolean }) => listing.status === 'active' && listing.onShop;
/** Statuses in which an order holds units of its listing: a resale order's locked money, and paid orders not yet released. */
export const holdingStatuses = ['locked', 'paid', 'sent', 'disputed'];

type OrderCounter = { classifiedOrder: { aggregate(args: { where: { listingId: string; status: { in: string[] }; id?: { not: string } }; _sum: { quantity: true } }): Promise<{ _sum: { quantity: number | null } }> } };

/** Units of a listing held by orders (`holdingStatuses`), less one order's own when given. */
export async function heldUnits(db: OrderCounter, listingId: string, exceptOrderId?: string) {
  const result = await db.classifiedOrder.aggregate({ where: { listingId, status: { in: holdingStatuses }, ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}) }, _sum: { quantity: true } });
  return result._sum.quantity ?? 0;
}

/** Most units one listing can hold (its stock). */
export const maxStock = 100_000;

export const maxTitle = 90;
export const minTitle = 5;
export const maxDescription = 5000;
export const maxFeatures = 20;
export const maxFeatureText = 80;
/** Prices in minor units: up to 10 trillion in the currency's major unit (land, machinery), never a JavaScript overflow. */
export const maxPriceMinor = 1_000_000_000_000_000n;

export const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

/** Links, web addresses and HTML: what scammers use to take buyers off BitoCard. Titles and descriptions refuse them. */
export const linkPattern = /(https?:\/\/|www\.|\]\(|!\[|<\s*[a-z/!?]|\b[a-z0-9-]+\.(com|net|org|ng|io|co|me|ly|link|app|xyz|shop|store)\b)/i;

export function checkTitle(value: string) {
  const title = value.replace(/\s+/g, ' ').trim();
  if (title.length < minTitle || title.length > maxTitle) throw invalid('parameter_invalid', `The title needs ${minTitle} to ${maxTitle} characters.`, 'title');
  if (linkPattern.test(title)) throw invalid('listing_text_refused', 'Titles cannot contain links, web addresses or HTML.', 'title');
  return title;
}

/** The address part made from a title: lower-case letters and digits joined by hyphens, at most 60 characters. */
export function slugify(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'listing';
}

/**
 * A description in limited Markdown: paragraphs, **bold**, *italic*, and bullet (`- `) or numbered (`1. `) lists. It is
 * stored as written and rendered escaped, so anything else shows as plain text; links, web addresses, images and HTML
 * are refused outright.
 */
export function checkDescription(value: string) {
  const text = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > maxDescription) throw invalid('parameter_invalid', `The description can be at most ${maxDescription.toLocaleString('en-GB')} characters.`, 'description');
  if (linkPattern.test(text)) throw invalid('listing_text_refused', 'Descriptions cannot contain links, web addresses, images or HTML.', 'description');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw invalid('parameter_invalid', 'The description contains characters that cannot be shown.', 'description');
  return text.length ? text : null;
}

export type RegistryFeature = { id: string; key: string; name: string; dataType: string; unit: string | null; choices: string[]; min: number | null; max: number | null; enabled: boolean };
export type FeatureValue = { valueText: string | null; valueNumber: number | null };

/** A seller's value for one key, checked against its data type, choices and limits; `param` names it in errors. */
export function checkFeatureValue(feature: RegistryFeature, raw: unknown, param: string): FeatureValue {
  const refuse = (message: string) => invalid('feature_value_invalid', `${feature.name}: ${message}`, param);
  if (raw === null || raw === undefined || raw === '') throw refuse('enter a value.');
  switch (feature.dataType) {
    case 'number': {
      const number = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw.replace(/,/g, '')) ? Number(raw.replace(/,/g, '')) : NaN;
      if (!Number.isFinite(number)) throw refuse('enter a number.');
      if (feature.min !== null && number < feature.min) throw refuse(`at least ${feature.min}${feature.unit ? ` ${feature.unit}` : ''}.`);
      if (feature.max !== null && number > feature.max) throw refuse(`at most ${feature.max}${feature.unit ? ` ${feature.unit}` : ''}.`);
      return { valueText: null, valueNumber: number };
    }
    case 'boolean': {
      const text = String(raw).trim().toLowerCase();
      if (['true', 'yes'].includes(text)) return { valueText: 'true', valueNumber: null };
      if (['false', 'no'].includes(text)) return { valueText: 'false', valueNumber: null };
      throw refuse('choose yes or no.');
    }
    case 'choice': {
      const text = String(raw).trim().toLowerCase();
      const choice = feature.choices.find(option => option.toLowerCase() === text);
      if (!choice) throw refuse(`choose one of ${feature.choices.join(', ')}.`);
      return { valueText: choice, valueNumber: null };
    }
    default: {
      if (typeof raw !== 'string' && typeof raw !== 'number') throw refuse('enter text.');
      const text = String(raw).replace(/\s+/g, ' ').trim();
      if (!text || text.length > maxFeatureText) throw refuse(`use 1 to ${maxFeatureText} characters.`);
      if (linkPattern.test(text)) throw invalid('listing_text_refused', `${feature.name}: links, web addresses and HTML are not allowed.`, param);
      return { valueText: text, valueNumber: null };
    }
  }
}

/** How a stored value reads back: numbers as numbers, yes or no as booleans, everything else as text. */
export function featureValueOut(dataType: string, value: FeatureValue): string | number | boolean | null {
  if (dataType === 'number') return value.valueNumber;
  if (dataType === 'boolean') return value.valueText === 'true';
  return value.valueText;
}

/** A price as people read it in chats and notices: "₦220,000", or with kobo when there are any. */
export function priceText(minor: bigint | number, currency: string) {
  const value = Number(minor) / 100;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-GB')}`;
  }
}
