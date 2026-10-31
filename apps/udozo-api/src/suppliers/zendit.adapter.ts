import { timingSafeEqual } from 'node:crypto';
import { Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import type { CatalogueItem, CatalogueScope, Delivery, FulfilmentRequest, FulfilmentResult, SupplierAdapter } from './adapter.js';
import { slug } from './adapter.js';

const Decimal = Prisma.Decimal;

/** An amount in Zendit's integer units: `fixed` (FIXED offers) or `min`/`max` (RANGE), divided by `currencyDivisor`. */
type Amount = { currency: string; currencyDivisor: number; fixed?: number; min?: number; max?: number };
type Cost = Amount & { fee?: number; feePct?: number };

type Offer = {
  offerId: string;
  brand: string;
  brandName: string;
  country: string;
  enabled: boolean;
  priceType: 'FIXED' | 'RANGE';
  productType: string;
  subTypes?: string[];
  requiredFields?: string[];
  shortNotes?: string;
  notes?: string;
  cost: Cost;
  send: Amount;
  dataGB?: number;
  dataUnlimited?: boolean;
  durationDays?: number;
};

type Purchase = {
  transactionId: string;
  status: 'ACCEPTED' | 'PENDING' | 'AUTHORIZED' | 'IN_PROGRESS' | 'DONE' | 'FAILED';
  receipt?: { epin?: string; voucherId?: string; redemptionUrl?: string; expiresAt?: string };
  confirmation?: { confirmationNumber?: string };
  error?: { code?: string; message?: string };
};

/** Zendit's `_limit` maximum. */
const pageSize = 1024;
const maxPages = 20;
/** Fields BitoCard can fill for every voucher; offers needing anything else (recipient details) are not synced. */
const fillable: Record<string, string> = { 'delivery.language': 'en' };

/** Zendit statuses to BitoCard outcomes: only DONE and FAILED are final; everything else is still in progress. */
export function zenditOutcome(status: string | undefined): FulfilmentResult['status'] {
  if (status === 'DONE') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'pending';
}

/** Major units of a Zendit amount. */
const major = (value: number | undefined, divisor: number) => new Decimal(value ?? 0).div(divisor || 1);

/**
 * The whole cost of `value` units of cost, with Zendit's fees: cost + fee + cost x feePct. `feePct` is read as a
 * fraction when it is at most 1 and as a percentage above that; the larger reading is never smaller, so BitoCard never
 * under-counts what it pays.
 */
function withPercentFee(value: Prisma.Decimal, feePct: number | undefined) {
  const pct = feePct ?? 0;
  return value.mul(new Decimal(1).plus(pct > 1 ? new Decimal(pct).div(100) : new Decimal(pct)));
}

/** The face value in Zendit's send units for a BitoCard minor amount. */
export const sendUnits = (faceMinor: bigint, divisor: number) => Number(new Decimal(faceMinor.toString()).div(100).mul(divisor || 1).toDecimalPlaces(0, Decimal.ROUND_DOWN));

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** The brand slug without its country ("MTN Nigeria" in NG is "mtn"). */
function brandSlug(offer: Offer) {
  let name = offer.brandName || offer.brand;
  try {
    name = name.replace(new RegExp(`\\b${countryNames.of(offer.country) ?? ''}\\b`, 'i'), ' ');
  } catch {
    // An unknown region code: keep the name.
  }
  return slug(name, [offer.country]);
}

/**
 * Zendit: gift cards (vouchers, worldwide) and mobile airtime, bundles and data by country, priced in the wallet
 * currency. Each FIXED offer is one face value, so its offer carries `face_value` and is only routed for that value;
 * an offer's face values are gathered on one product. Vouchers that need the customer's details (email, name,
 * address) are not synced; eSIMs and bill payments are not synced yet.
 *
 * Every purchase uses our reference as Zendit's `transactionId` (unique per account), so a check finds it again. A
 * quantity above one is one purchase per card (`<reference>N<n>`), complete only when all are done.
 */
export class ZenditAdapter implements SupplierAdapter {
  readonly code = 'zendit';
  readonly syncs: ProductCategory[] = ['gift_cards', 'airtime', 'data'];
  private report: string[] = [];

  constructor(private readonly config: { apiKey?: string; baseUrl: string }) {}

  configured() {
    return Boolean(this.config.apiKey);
  }

  syncReport() {
    return this.report.length ? this.report.join(' ') : null;
  }

  private request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    if (!this.configured()) throw new ProviderError(this.code, 'not configured', true);
    return providerRequest<T>(this.code, `${this.config.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers: { authorization: `Bearer ${this.config.apiKey}` } });
  }

  private async offers(kind: 'vouchers' | 'topups', country?: string) {
    const all: Offer[] = [];
    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({ _limit: String(pageSize), _offset: String(page * pageSize), ...(country ? { country } : {}) });
      const res = await this.request<{ list: Offer[]; total: number }>(`/${kind}/offers?${query}`);
      all.push(...res.list);
      if (all.length >= res.total || res.list.length === 0) break;
    }
    return all;
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    if (scope.category === 'gift_cards') {
      const offers = await this.offers('vouchers');
      const usable = offers.filter(offer => offer.enabled && !(offer.subTypes ?? []).includes('Utilities'));
      const needDetails = usable.filter(offer => (offer.requiredFields ?? []).some(field => !(field in fillable)));
      const items = gather(usable.filter(offer => !needDetails.includes(offer)).flatMap(offer => voucherItem(offer) ?? []));
      this.report.push(`Gift cards: ${offers.length} offers, ${items.length} synced, ${needDetails.length} left out because they need the customer's details.`);
      return items;
    }
    if ((scope.category === 'airtime' || scope.category === 'data') && scope.country) {
      const offers = (await this.offers('topups', scope.country)).filter(offer => offer.enabled);
      const items = gather(offers.flatMap(offer => topupItem(offer) ?? [])).filter(item => item.category === scope.category);
      if (!items.length) this.report.push(`${scope.country} ${scope.category}: ${offers.length} offers, none usable.`);
      return items;
    }
    return [];
  }

  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const voucher = request.category === 'gift_cards';
    const units = request.quantity;
    for (let index = 0; index < units; index += 1) {
      const transactionId = purchaseId(request.reference, index, units);
      const value = request.meta.face_value ? undefined : { type: 'ZEND', value: sendUnits(request.faceValue, Number(request.meta.send_divisor ?? 100)) };
      const body = voucher
        ? { offerId: request.meta.offerId, transactionId, fields: Object.entries(fillable).filter(([key]) => ((request.meta.fields as string[] | undefined) ?? []).includes(key)).map(([key, v]) => ({ key, value: v })), ...(value ? { value } : {}) }
        : { offerId: request.meta.offerId, transactionId, recipientPhoneNumber: request.recipient.phone, ...(value ? { value } : {}) };
      try {
        await this.request(`/${voucher ? 'vouchers' : 'topups'}/purchases`, { method: 'POST', body });
      } catch (error) {
        // A refusal of the first card fails the order cleanly; after that, cards already bought must be settled, so the
        // order waits for its checks (and an admin) instead.
        if (index === 0) throw error;
        return { status: 'pending', detail: `Card ${index + 1} of ${units} not placed: ${(error as Error).message}` };
      }
    }
    // Accepted: whatever the first read says, a failed read never fails an order Zendit took.
    return this.orderStatus(request).catch((error: Error) => ({ status: 'pending' as const, supplierTransactionId: request.reference, detail: `Placed; status not read yet: ${error.message}` }));
  }

  async orderStatus(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const voucher = request.category === 'gift_cards';
    const purchases: Purchase[] = [];
    for (let index = 0; index < request.quantity; index += 1) {
      purchases.push(await this.request<Purchase>(`/${voucher ? 'vouchers' : 'topups'}/purchases/${purchaseId(request.reference, index, request.quantity)}`));
    }
    const outcomes = purchases.map(purchase => zenditOutcome(purchase.status));
    const supplierTransactionId = request.reference;
    const detail = purchases.map(purchase => purchase.status + (purchase.error?.message ? ` (${purchase.error.message})` : '')).join(', ');
    if (outcomes.every(outcome => outcome === 'failed')) return { status: 'failed', supplierTransactionId, detail };
    // Some cards done and some failed is not a clean failure: it waits for an admin.
    if (!outcomes.every(outcome => outcome === 'completed')) return { status: 'pending', supplierTransactionId, detail };
    if (!voucher) return { status: 'completed', supplierTransactionId, deliveries: [{ kind: 'confirmation' }], detail };
    const deliveries: Delivery[] = [];
    for (const purchase of purchases) {
      const receipt = purchase.receipt ?? {};
      const code = receipt.epin || receipt.redemptionUrl;
      // Done but no code to hand over yet: keep checking rather than deliver nothing.
      if (!code) return { status: 'pending', supplierTransactionId, detail: 'Done; voucher code not returned yet' };
      deliveries.push({
        kind: 'gift_card',
        code,
        serial: receipt.voucherId || undefined,
        details: { ...(receipt.epin && receipt.redemptionUrl ? { redemption_url: receipt.redemptionUrl } : {}), ...(receipt.expiresAt ? { expires_at: receipt.expiresAt } : {}) },
      });
    }
    return { status: 'completed', supplierTransactionId, deliveries };
  }
}

/** One card's Zendit transaction ID: the reference itself, or `<reference>N<n>` for each card of a multiple order. */
export const purchaseId = (reference: string, index: number, quantity: number) => (quantity > 1 ? `${reference}N${index + 1}` : reference);

/** The cost (in the wallet currency) and face value of an offer, as BitoCard's ratio, fee and face value. */
function pricing(offer: Offer) {
  const send = offer.send;
  const cost = offer.cost;
  if (offer.priceType === 'FIXED') {
    const face = major(send.fixed, send.currencyDivisor);
    if (face.lte(0) || cost.fixed === undefined) return null;
    const total = withPercentFee(major(cost.fixed, cost.currencyDivisor), cost.feePct).plus(major(cost.fee, cost.currencyDivisor));
    return { ratio: total.div(face).toDecimalPlaces(10, Decimal.ROUND_UP).toString(), fee: 0n, faceValue: BigInt(face.mul(100).toFixed(0)) };
  }
  const maxFace = major(send.max, send.currencyDivisor);
  if (maxFace.lte(0) || cost.max === undefined) return null;
  const ratio = withPercentFee(major(cost.max, cost.currencyDivisor), cost.feePct).div(maxFace).toDecimalPlaces(10, Decimal.ROUND_UP).toString();
  return { ratio, fee: BigInt(major(cost.fee, cost.currencyDivisor).mul(100).toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0)), faceValue: null };
}

const minor = (value: number | undefined, divisor: number) => BigInt(major(value, divisor).mul(100).toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0));

export function voucherItem(offer: Offer): CatalogueItem | null {
  const price = pricing(offer);
  if (!price || !offer.country) return null;
  const brand = brandSlug(offer);
  const fixed = price.faceValue !== null;
  const currency = offer.send.currency.toLowerCase();
  return {
    sku: offer.offerId,
    // Their own key (a fourth part), so they never merge into another supplier's product with other face values.
    productKey: `gift_cards:${offer.country}:${brand}:${fixed ? currency : `${currency}-any`}`,
    category: 'gift_cards',
    country: offer.country,
    brand,
    name: offer.brandName,
    faceCurrency: offer.send.currency,
    denominationType: fixed ? 'fixed' : 'range',
    fixedValues: fixed ? [price.faceValue!] : [],
    minValue: fixed ? undefined : minor(offer.send.min, offer.send.currencyDivisor),
    maxValue: fixed ? undefined : minor(offer.send.max, offer.send.currencyDivisor),
    recipientType: 'none',
    description: offer.shortNotes || undefined,
    costCurrency: offer.cost.currency,
    costRatio: price.ratio,
    costFee: price.fee,
    meta: { offerId: offer.offerId, send_divisor: offer.send.currencyDivisor, fields: offer.requiredFields ?? [], ...(fixed ? { face_value: price.faceValue!.toString() } : {}) },
  };
}

export function topupItem(offer: Offer): CatalogueItem | null {
  const price = pricing(offer);
  if (!price || !offer.country) return null;
  const types = offer.subTypes ?? [];
  const data = types.includes('Mobile Data') || (types.includes('Mobile Bundle') && (offer.dataGB ?? 0) > 0) || offer.dataUnlimited === true;
  const bundle = data || types.includes('Mobile Bundle');
  const brand = brandSlug(offer);
  const fixed = price.faceValue !== null;
  const category: ProductCategory = data ? 'data' : 'airtime';
  const plan = offer.shortNotes || offer.notes || offer.offerId;
  return {
    sku: offer.offerId,
    // Bundles are a product each; plain top-ups gather their face values (or take any amount) on one product.
    productKey: bundle ? `${category}:${offer.country}:${brand}:${slug(plan)}` : `${category}:${offer.country}:${brand}:${fixed ? 'amounts' : 'any-amount'}`,
    category,
    country: offer.country,
    brand,
    name: bundle ? `${offer.brandName} ${plan}` : offer.brandName,
    faceCurrency: offer.send.currency,
    denominationType: fixed ? 'fixed' : 'range',
    fixedValues: fixed ? [price.faceValue!] : [],
    minValue: fixed ? undefined : minor(offer.send.min, offer.send.currencyDivisor),
    maxValue: fixed ? undefined : minor(offer.send.max, offer.send.currencyDivisor),
    recipientType: 'phone',
    description: bundle ? plan : undefined,
    costCurrency: offer.cost.currency,
    costRatio: price.ratio,
    costFee: price.fee,
    meta: { offerId: offer.offerId, send_divisor: offer.send.currencyDivisor, ...(fixed ? { face_value: price.faceValue!.toString() } : {}) },
  };
}

/** Gives every item on a product all the product's face values (one FIXED offer is one value). */
export function gather(items: CatalogueItem[]) {
  const values = new Map<string, Set<bigint>>();
  for (const item of items) for (const value of item.fixedValues) values.set(item.productKey, (values.get(item.productKey) ?? new Set()).add(value));
  return items.map(item => (item.denominationType === 'fixed' ? { ...item, fixedValues: [...(values.get(item.productKey) ?? [])].sort((a, b) => (a < b ? -1 : 1)) } : item));
}

/** The header Zendit is set to send (in the Zendit console) with the webhook secret as its value. */
export const zenditWebhookHeader = 'x-webhook-token';

/**
 * Zendit webhooks carry a header and value set in the Zendit console (no signature): BitoCard expects
 * `X-Webhook-Token: <ZENDIT_WEBHOOK_SECRET>`. Not `Authorization`, which the API reads as a BitoCard API key. The body is
 * never trusted either way; it only names the order to re-check.
 */
export function zenditWebhookValid(secret: string | undefined, token: string | undefined) {
  if (!secret || !token) return false;
  const given = Buffer.from(token.trim());
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The order a Zendit notification is about: its transaction ID is our reference (a multiple order's card ID names the order). */
export function zenditNotice(payload: unknown) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const id = typeof body.transactionId === 'string' ? body.transactionId : null;
  return {
    eventType: typeof body.productType === 'string' ? `${body.productType}:${typeof body.status === 'string' ? body.status : ''}` : null,
    reference: id ? id.replace(/N\d+$/, '') : null,
    supplierTransactionId: id ? id.replace(/N\d+$/, '') : null,
  };
}
