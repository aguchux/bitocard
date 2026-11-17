import { Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { matchBrand, Prestmit, type PrestmitBuyableCard, type PrestmitBuyTrade } from '../gift-card-sales/prestmit.js';
import { ProviderError } from '../payments/provider-error.js';
import type { CatalogueItem, CatalogueScope, Delivery, FulfilmentRequest, FulfilmentResult, SupplierAdapter } from './adapter.js';
import { slug } from './adapter.js';

const Decimal = Prisma.Decimal;

/** Pricing a card is one call each; past this many, calls are spaced to stay inside Prestmit's 100 a minute. */
const paceAbove = 80;
const defaultPaceMs = 650;

export type PrestmitAdapterOptions = { apiKey?: string; apiSecret?: string; accountPin?: string; baseUrl: string; paceMs?: number };

/**
 * Prestmit as a gift card supplier (the buy side of its partner API; https://documentation.prestmit.io/, read
 * 17 November 2026). Its cards are sold from BitoCard's prefunded Prestmit Naira wallet:
 *
 * - **Catalogue** (`fetch-buyable-giftcards`): each card in its region and currency; a card whose least and most price
 *   agree is one fixed value (the brand's fixed cards gathered on one product, each offer `meta.face_value`), else any
 *   whole amount in between (`meta.min_value`, `meta.max_value`). Its own product keys (`gift_cards:US:amazon:usd-card`,
 *   `…:usd-amount`), so it never rewrites another supplier's face values. The cost is what `calculate-payment` charges
 *   in naira for its least price, as a ratio of face value; what an order is actually charged (`totalPaymentAmount`)
 *   is its reported cost, so a drift shows as `cost_mismatch`.
 * - **Orders** (`buy/create`, paying `NAIRA`, our reference as `uniqueIdentifier`): COMPLETED delivers its codes (from
 *   the reply, else `fetch-codes`), PENDING waits, FAILED is a clear failure (Prestmit refunds its wallet). Anything
 *   unclear waits and is checked in the buy history by Prestmit's reference or ours, never bought twice.
 *
 * The account's PIN (`currentAccountPIN`) is sent when set. An account with withdrawal 2FA cannot buy through the
 * API: Prestmit refuses and the order fails clearly. Confirm the address, the hash of multipart requests and the
 * webhook payload against Prestmit's sandbox before switching it on live.
 */
export class PrestmitAdapter implements SupplierAdapter {
  readonly code = 'prestmit';
  readonly syncs: ProductCategory[] = ['gift_cards'];
  private readonly client: Prestmit;
  private report: string | null = null;

  constructor(private readonly options: PrestmitAdapterOptions) {
    this.client = new Prestmit({ apiKey: options.apiKey, apiSecret: options.apiSecret, baseUrl: options.baseUrl, accountPin: options.accountPin });
  }

  configured() {
    return this.client.configured();
  }

  syncReport() {
    return this.report;
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    if (scope.category !== 'gift_cards') return [];
    const cards = await this.client.buyableCards();
    const usable = cards.filter(card => card.country && !card.preOrder);
    const pace = usable.length > paceAbove ? (this.options.paceMs ?? defaultPaceMs) : 0;
    const items: CatalogueItem[] = [];
    let unpriced = 0;
    for (const card of usable) {
      if (pace && items.length + unpriced > 0) await new Promise(resolve => setTimeout(resolve, pace));
      const item = await this.price(card).catch(error => {
        // One card Prestmit cannot price is left out, never the whole catalogue.
        if (error instanceof ProviderError && !error.definite) throw error;
        return null;
      });
      if (item) items.push(item);
      else unpriced += 1;
    }
    this.report = `Prestmit lists ${cards.length} gift cards: ${items.length} priced, ${cards.length - usable.length} without a region or on pre-order, ${unpriced} it could not price.`;
    return gather(items);
  }

  private async price(card: PrestmitBuyableCard): Promise<CatalogueItem | null> {
    const least = Math.ceil(card.minPrice);
    const most = Math.floor(card.maxPrice);
    if (least > most) return null;
    const cost = await this.client.buyCost(card.sku, least, 1);
    if (cost.naira === null) return null;
    const fixed = least === most;
    const brand = matchBrand(card.category, card.title) ?? slug(card.category || card.title);
    const currency = card.currency.toLowerCase();
    const face = BigInt(least) * 100n;
    return {
      sku: card.sku,
      productKey: `gift_cards:${card.country}:${brand}:${currency}-${fixed ? 'card' : 'amount'}`,
      category: 'gift_cards',
      country: card.country!,
      brand,
      name: card.title,
      faceCurrency: card.currency,
      denominationType: fixed ? 'fixed' : 'range',
      fixedValues: fixed ? [face] : [],
      minValue: fixed ? undefined : face,
      maxValue: fixed ? undefined : BigInt(most) * 100n,
      recipientType: 'none',
      description: card.description ?? undefined,
      logoUrl: card.imageUrl ?? undefined,
      costCurrency: 'NGN',
      costRatio: new Decimal(cost.naira).div(least).toDecimalPlaces(10, Decimal.ROUND_UP).toString(),
      costFee: 0n,
      meta: { sku: card.sku, whole_units: true, ...(fixed ? { face_value: face.toString() } : { min_value: face.toString(), max_value: (BigInt(most) * 100n).toString() }) },
    };
  }

  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    if (request.faceValue % 100n !== 0n) throw new ProviderError(this.code, 'Prestmit sells whole amounts only', true);
    const sku = String(request.meta.sku ?? request.sku);
    const trade = await this.client.buy({ sku, price: Number(request.faceValue / 100n), quantity: request.quantity, uniqueIdentifier: request.reference });
    return this.outcome(trade, request.quantity);
  }

  async orderStatus(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult> {
    const trade = await this.client.findBuy({ reference: supplierTransactionId, uniqueIdentifier: request.reference });
    // Not in the history (yet): it waits. Never bought again while it might still be there.
    if (!trade) return { status: 'pending', supplierTransactionId, detail: 'not found in Prestmit’s buy history yet' };
    return this.outcome(trade, request.quantity);
  }

  private async outcome(trade: PrestmitBuyTrade, quantity: number): Promise<FulfilmentResult> {
    const base = {
      supplierTransactionId: trade.reference || undefined,
      ...(trade.paidNaira !== null ? { reportedCost: { amountMinor: BigInt(Math.round(trade.paidNaira * 100)), currency: 'NGN' } } : {}),
    };
    if (trade.status === 'FAILED' || trade.status === 'REJECTED') return { status: 'failed', ...base, detail: `Prestmit: ${trade.status}` };
    if (trade.status !== 'COMPLETED' && trade.status !== 'APPROVED') return { status: 'pending', ...base, detail: `Prestmit: ${trade.status}` };
    let cards = trade.cards;
    if (cards.length < quantity && trade.reference) {
      cards = await this.client.buyCodes(trade.reference).catch(() => cards);
    }
    // Paid for but its codes not out yet: it waits for them.
    if (cards.length < quantity) return { status: 'pending', ...base, detail: `Prestmit: completed, ${cards.length} of ${quantity} codes so far` };
    const deliveries: Delivery[] = cards.slice(0, quantity).map(card => ({
      kind: 'gift_card',
      code: card.cardNumber || card.claimUrl || '',
      ...(card.pinCode ? { pin: card.pinCode } : {}),
      details: { ...(card.claimUrl ? { claim_url: card.claimUrl } : {}), ...(card.expireDate ? { expires: card.expireDate } : {}) },
    }));
    return { status: 'completed', ...base, deliveries };
  }
}

/** A brand's fixed cards (one value each) gathered on one product, as Zendit's are. */
function gather(items: CatalogueItem[]) {
  const values = new Map<string, Set<bigint>>();
  for (const item of items) if (item.denominationType === 'fixed') for (const value of item.fixedValues) values.set(item.productKey, (values.get(item.productKey) ?? new Set()).add(value));
  return items.map(item => (item.denominationType === 'fixed' ? { ...item, fixedValues: [...(values.get(item.productKey) ?? [])].sort((a, b) => (a < b ? -1 : 1)) } : item));
}
