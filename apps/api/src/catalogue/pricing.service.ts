import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import {
  type ConnectionRouting,
  type Country,
  type CountryCategory,
  type FeeRule,
  type LedgerMode,
  Prisma,
  type PricingRule,
  type Product,
  type ProductCategory,
  type ResellerMarkup,
  type ResellerOffer,
  type Supplier,
  type SupplierProduct,
} from '../generated/prisma/client.js';
import { exactFeeNano, maxFeeMinor, pickFeeRule } from '../fees/platform-fees.service.js';
import { minor } from '../ledger/mode.js';
import { stockSupplier } from '../suppliers/stock.adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Categories sold at a face value in local currency, where resellers earn a markup or a discount. */
export const faceValueCategories = new Set<ProductCategory>(['airtime', 'data', 'pay_tv', 'bills']);
/** Categories bought for use anywhere, so any market can sell them without the international plan feature. */
export const worldwideCategories = new Set<ProductCategory>(['gift_cards', 'esim', 'software', 'virtual_numbers']);
/** The country of products usable anywhere, such as BitoCard's own software licences (ISO's user-assigned "WW"). */
export const worldwideCountry = 'WW';

export type Offer = SupplierProduct & { supplier: Supplier };
/** An offer from the reseller's own supplier account, with when the reseller wants it used. */
export type OwnOffer = ResellerOffer & { connection: { routing: ConnectionRouting } };
/** What a priced offer needs, whichever source it came from. */
export type PricedOffer = Pick<SupplierProduct, 'id' | 'supplierCode' | 'costCurrency' | 'meta'>;
export type ProductWithOffers = Product & { supplierProducts: Offer[] };

/** Everything needed to price products for one reseller, loaded once per request. */
export type PricingContext = {
  resellerId: string;
  mode: LedgerMode;
  country: Country & { categories: CountryCategory[] };
  currency: string;
  international: boolean;
  capBps: number;
  markups: ResellerMarkup[];
  rules: PricingRule[];
  /** supplierCode:category pairs switched on in the reseller market. */
  markets: Set<string>;
  rates: Map<string, { pay: Decimal; receive: Decimal }>;
  planCode: string;
  /** BitoCard's fee rules for own-supplier orders. */
  feeRules: FeeRule[];
  /** The reseller's own offers by product (active connections in this mode, not switched off). */
  own: Map<string, OwnOffer[]>;
};

/** One unit priced through one supplier offer. All amounts are minor units of the reseller currency unless noted. */
export type Priced = {
  offer: PricedOffer;
  /** `own`: the reseller's own supplier account; BitoCard's fee replaces its margin and is all it charges. */
  source: 'bitocard' | 'own';
  connectionId?: string;
  routing?: ConnectionRouting;
  /** Own supplier, per unit: the fee rule and rate, and the base the fee is on (cost, or face value for face-value products). */
  fee?: { ruleId: string | null; ratePpb: number; baseMinor: bigint; minFeeMinor: bigint | null };
  /** In the supplier currency. */
  supplierCost: bigint;
  /** Reseller currency per unit of supplier currency (null when they are the same). */
  fxRate: Decimal | null;
  cost: bigint;
  wholesale: bigint;
  /** The reseller price before tax handling. */
  price: bigint;
  /** `discount`: sold at face value with the supplier's discount shared; `cost`: priced up from cost (markup or fixed). */
  basis: 'discount' | 'cost';
  /** The face value in the reseller currency (what a discount product's customer pays at most). */
  face: bigint;
  /** BitoCard's rule that priced it (own-supplier offers: the scheme only). */
  rule: ResolvedRule;
  /** The reseller's settings that applied. */
  terms: ResellerTerms;
  /** A fixed customer price below BitoCard's price: the customer pays BitoCard's price instead. */
  fixedBelowCost: boolean;
};

export const priceKinds = ['auto', 'discount', 'markup', 'fixed'] as const;
export type PriceKind = (typeof priceKinds)[number];
type Level = 'product' | 'supplier' | 'category' | 'country' | 'general' | 'default';

/** BitoCard's rule for one offer, and the level it came from. */
export type ResolvedRule = {
  kind: PriceKind;
  marginBps: number;
  resellerDiscountBps: number;
  fixedMinor: bigint | null;
  fixedCurrency: string | null;
  ruleId: string | null;
  level: Level;
};

/** The reseller's settings for one product, each with the level it came from. */
export type ResellerTerms = {
  customerDiscountBps: number;
  markupBps: number;
  fixedMinor: bigint | null;
  from: { customerDiscount: 'product' | 'category' | 'general' | 'none'; markup: 'product' | 'category' | 'general' | 'none'; fixed: 'product' | 'none' };
};

/** Maximum BitoCard markup (200%) and reseller markup (100%), in basis points. */
export const maxMarginBps = 20_000;
export const maxResellerMarkupBps = 10_000;

/** Single-value products can take a fixed price; a fixed price on a range or a list of values would be one price for all. */
export const singleValue = (product: Pick<Product, 'denominationType' | 'fixedValues'>) => product.denominationType === 'fixed' && product.fixedValues.length === 1;

/** Offers for one face value only (a supplier listing each value as its own offer) carry it as `meta.face_value`. */
export const offerCovers = (offer: { meta: Prisma.JsonValue | null }, faceValue: bigint) => {
  const only = (offer.meta as { face_value?: string } | null)?.face_value;
  return only === undefined || BigInt(only) === faceValue;
};

const mulBps = (amount: bigint, bps: number) => amount * BigInt(bps);
/** amount x bps/10000, rounded down (a discount is never more than its rate). */
const shareBps = (amount: bigint, bps: number) => mulBps(amount, bps) / 10_000n;
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
/** amount x (1 + bps/10000), rounded up. */
const addBps = (amount: bigint, bps: number) => ceilDiv(mulBps(amount, 10_000 + bps), 10_000n);

export const unavailable = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

/**
 * BitoCard pricing. Routing picks the cheapest eligible supplier offer; BitoCard wholesale price comes from it
 * (or from face value for local face-value products); the reseller price adds the reseller markup, capped by the
 * Markup Protection Scheme. Supplier identity and cost never leave this service except into internal records.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly adapters: SupplierAdapters,
  ) {}

  async context(resellerId: string, mode: LedgerMode): Promise<PricingContext> {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { plan: true, countryRef: { include: { categories: true } } } });
    if (!reseller.countryRef) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_required', 'Set your business country before using the catalogue.');
    }
    const markets = await this.prisma.supplierMarket.findMany({ where: { countryCode: reseller.countryRef.code, enabled: true } });
    const own = await this.prisma.resellerOffer.findMany({
      where: { resellerId, mode, available: true, connection: { status: 'active', routing: { not: 'off' } } },
      include: { connection: { select: { routing: true } } },
    });
    const ownByProduct = new Map<string, OwnOffer[]>();
    for (const offer of own) ownByProduct.set(offer.productId, [...(ownByProduct.get(offer.productId) ?? []), offer]);
    return {
      resellerId,
      mode,
      country: reseller.countryRef,
      currency: reseller.countryRef.currency,
      international: reseller.plan.features.includes('international_selling'),
      capBps: reseller.countryRef.markupCapPercent * 100,
      markups: await this.prisma.resellerMarkup.findMany({ where: { resellerId } }),
      rules: await this.prisma.pricingRule.findMany(),
      markets: new Set(markets.map(m => `${m.supplierCode}:${m.category}`)),
      rates: new Map(),
      planCode: reseller.planCode,
      feeRules: await this.prisma.feeRule.findMany({ where: { kind: 'supplier_order' } }),
      own: ownByProduct,
    };
  }

  /** Why the reseller cannot sell a product, or null if they can. */
  unavailableReason(ctx: PricingContext, product: Product) {
    if (!product.active) return unavailable('product_unavailable', 'This product is not available.');
    if (!ctx.country.categories.some(c => c.category === product.category && c.enabled)) {
      return unavailable('category_unavailable', 'This category is not available in your country yet.');
    }
    if (product.country !== ctx.country.code && !worldwideCategories.has(product.category) && !ctx.international) {
      return unavailable('international_selling_required', 'Selling products for other countries needs the Premium plan.');
    }
    return null;
  }

  /**
   * BitoCard's rule for an offer: the most specific of product, supplier, category and country (in that order of
   * weight), else the general rule. Fixed prices only apply to single-value products (`skipFixed` leaves them out
   * entirely, for renewals priced from a monthly cost).
   */
  rule(ctx: PricingContext, product: Product, supplierCode: string | null, options: { skipFixed?: boolean } = {}): ResolvedRule {
    let best: PricingRule | null = null;
    let bestScore = -1;
    for (const rule of ctx.rules) {
      if (rule.productId && rule.productId !== product.id) continue;
      if (rule.supplierCode && rule.supplierCode !== supplierCode) continue;
      if (rule.category && rule.category !== product.category) continue;
      if (rule.countryCode && rule.countryCode !== ctx.country.code) continue;
      if (rule.kind === 'fixed' && (options.skipFixed || !singleValue(product) || rule.fixedMinor === null || !rule.fixedCurrency)) continue;
      const score = (rule.productId ? 8 : 0) + (rule.supplierCode ? 4 : 0) + (rule.category ? 2 : 0) + (rule.countryCode ? 1 : 0);
      if (score > bestScore) [best, bestScore] = [rule, score];
    }
    if (!best) return { kind: 'auto', marginBps: 0, resellerDiscountBps: 0, fixedMinor: null, fixedCurrency: null, ruleId: null, level: 'default' };
    const level: Level = best.productId ? 'product' : best.supplierCode ? 'supplier' : best.category ? 'category' : best.countryCode ? 'country' : 'general';
    return {
      kind: best.kind as PriceKind,
      marginBps: best.marginBps,
      resellerDiscountBps: best.resellerDiscountBps,
      fixedMinor: best.fixedMinor,
      fixedCurrency: best.fixedCurrency,
      ruleId: best.id,
      level,
    };
  }

  /** The reseller's settings for a product: each field from their product rule, else category rule, else general rule. */
  terms(ctx: PricingContext, product: Product): ResellerTerms {
    const ofProduct = ctx.markups.find(m => m.productId === product.id);
    const ofCategory = ctx.markups.find(m => m.productId === null && m.category === product.category);
    const general = ctx.markups.find(m => m.productId === null && m.category === null);
    const pick = <K extends 'markupBps' | 'customerDiscountBps'>(key: K) => {
      for (const [row, from] of [[ofProduct, 'product'], [ofCategory, 'category'], [general, 'general']] as const) {
        const value = row?.[key];
        if (value !== null && value !== undefined) return { value, from };
      }
      return { value: 0, from: 'none' as const };
    };
    const markup = pick('markupBps');
    const discount = pick('customerDiscountBps');
    const fixed = ofProduct?.fixedMinor ?? null;
    return {
      customerDiscountBps: discount.value,
      markupBps: Math.min(markup.value, ctx.capBps),
      fixedMinor: fixed,
      from: { customerDiscount: discount.from, markup: markup.from, fixed: fixed === null ? 'none' : 'product' },
    };
  }

  private async rate(ctx: PricingContext, currency: string) {
    let rate = ctx.rates.get(currency);
    if (!rate) {
      const fetched = await this.fx.rate(currency);
      rate = { pay: fetched.pay, receive: fetched.receive };
      ctx.rates.set(currency, rate);
    }
    return rate;
  }

  /** Converts a supplier cost into the reseller currency the conservative way (BitoCard never loses on the rate). */
  private async convert(ctx: PricingContext, amount: bigint, from: string) {
    if (from === ctx.currency) return { amount, rate: null };
    const rate = (await this.rate(ctx, ctx.currency)).pay.div((await this.rate(ctx, from)).receive);
    return { amount: BigInt(rate.mul(amount.toString()).toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0)), rate };
  }

  /**
   * Offers that may be used: available, supplier on, supplier switched on for this market (BitoCard's own stock sells
   * in every market), and (live) configured.
   */
  eligibleOffers(ctx: PricingContext, product: ProductWithOffers, exclude: ReadonlySet<string> = new Set()) {
    return product.supplierProducts.filter(
      offer =>
        !exclude.has(offer.supplierCode) &&
        offer.available &&
        offer.supplier.enabled &&
        (offer.supplierCode === stockSupplier || ctx.markets.has(`${offer.supplierCode}:${product.category}`)) &&
        (ctx.mode === 'test' || this.adapters.get(offer.supplierCode).configured()),
    );
  }

  /**
   * What the reseller pays BitoCard for a supplier cost outside an order (a number's renewal, an SMS): converted to
   * the reseller currency the conservative way, plus BitoCard's margin for the product (never below cost).
   */
  async wholesaleFor(ctx: PricingContext, product: Product, supplierCost: bigint, costCurrency: string, supplierCode: string | null = null) {
    const { amount: cost } = await this.convert(ctx, supplierCost, costCurrency);
    const rule = this.rule(ctx, product, supplierCode, { skipFixed: true });
    const wholesale = rule.kind === 'markup' || rule.kind === 'auto' ? addBps(cost, rule.marginBps) : cost;
    return { cost, wholesale: wholesale < cost ? cost : wholesale, currency: ctx.currency };
  }

  /**
   * One unit through one source, given its cost in the reseller currency. Discount: the customer pays face value at
   * most; BitoCard's discount is face value minus cost; the reseller gets their share of it (never more), and gives
   * their customers their share of theirs. Markup and fixed: BitoCard's price on cost, then the reseller's markup or
   * fixed price on that. Null when it cannot be sold without loss (cost above face value, or a fixed price below cost).
   */
  private settle(ctx: PricingContext, product: Product, face: bigint, cost: bigint, given: ResolvedRule, fixedWholesale: bigint | null, ownFee: bigint | null) {
    const terms = this.terms(ctx, product);
    // Automatic: local airtime, data, bills and pay-TV always sell at face value at most (discount); anything else is
    // discount where the supplier gives one (cost, with any fee, below face value), else markup.
    const local = faceValueCategories.has(product.category) && product.faceCurrency === ctx.currency;
    const rule: ResolvedRule = given.kind === 'auto' ? { ...given, kind: local || cost + (ownFee ?? 0n) < face ? 'discount' : 'markup' } : given;
    let wholesale: bigint;
    let price: bigint;
    let fixedBelowCost = false;
    if (rule.kind === 'discount') {
      const floor = ownFee === null ? cost : cost + ownFee;
      if (floor > face) return null;
      // BitoCard's own offers: the reseller's discount, at most what the supplier gives. Own supplier: their cost plus BitoCard's fee.
      wholesale = ownFee === null ? face - min(shareBps(face, rule.resellerDiscountBps), face - cost) : floor;
      price = face - min(shareBps(face, terms.customerDiscountBps), face - wholesale);
    } else {
      wholesale = ownFee !== null ? cost + ownFee : rule.kind === 'fixed' ? fixedWholesale! : addBps(cost, rule.marginBps);
      if (wholesale < cost) return null;
      if (terms.fixedMinor !== null) {
        fixedBelowCost = terms.fixedMinor < wholesale;
        price = fixedBelowCost ? wholesale : terms.fixedMinor;
      } else {
        price = addBps(wholesale, terms.markupBps);
      }
    }
    return { wholesale, price, terms, fixedBelowCost, rule, basis: rule.kind === 'discount' ? ('discount' as const) : ('cost' as const) };
  }

  /** The face value in the reseller currency (converted the same conservative way as costs). */
  private async faceIn(ctx: PricingContext, product: Product, faceValue: bigint) {
    return (await this.convert(ctx, faceValue, product.faceCurrency)).amount;
  }

  /** Prices one unit of a face value through the cheapest viable offer, optionally leaving some suppliers out. */
  async price(ctx: PricingContext, product: ProductWithOffers, faceValue: bigint, exclude?: ReadonlySet<string>): Promise<Priced> {
    const face = await this.faceIn(ctx, product, faceValue);
    let best: (Priced & { offer: Offer }) | null = null;
    for (const offer of this.eligibleOffers(ctx, product, exclude)) {
      const priced = await this.priceOffer(ctx, product, faceValue, face, offer);
      if (!priced) continue;
      if (!best || priced.cost < best.cost || (priced.cost === best.cost && offer.priority < best.offer.priority)) best = priced;
    }
    if (!best) throw unavailable('product_unavailable', 'This product is not available right now.');
    return best;
  }

  /** One unit through one of BitoCard's offers under its rule, or null if that offer cannot be sold without loss. */
  async priceOffer(ctx: PricingContext, product: Product, faceValue: bigint, face: bigint, offer: Offer): Promise<(Priced & { offer: Offer }) | null> {
    if (!offerCovers(offer, faceValue)) return null;
    const discounted = new Decimal(faceValue.toString()).mul(offer.costRatio).mul(new Decimal(10_000 - offer.discountBps).div(10_000));
    const supplierCost = BigInt(discounted.toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0)) + offer.costFeeMinor;
    const { amount: cost, rate } = await this.convert(ctx, supplierCost, offer.costCurrency);
    const rule = this.rule(ctx, product, offer.supplierCode);
    const fixed = rule.kind === 'fixed' ? (await this.convert(ctx, rule.fixedMinor!, rule.fixedCurrency!)).amount : null;
    const settled = this.settle(ctx, product, face, cost, rule, fixed, null);
    if (!settled) return null;
    return { offer, source: 'bitocard', supplierCost, fxRate: rate, cost, face, ...settled };
  }

  /**
   * Prices one unit through the reseller's own supplier account, or null if they have no usable offer. Their cost
   * plus BitoCard's fee (the most it can be) is the wholesale price; BitoCard's margin does not apply. Face-value
   * products keep their face-value price; offers that would sell below cost plus fee are skipped.
   */
  async priceOwn(ctx: PricingContext, product: Product, faceValue: bigint): Promise<Priced | null> {
    const feeRule = pickFeeRule(ctx.feeRules, { kind: 'supplier_order', countryCode: ctx.country.code, category: product.category, planCode: ctx.planCode });
    const face = await this.faceIn(ctx, product, faceValue);
    let best: Priced | null = null;
    for (const offer of ctx.own.get(product.id) ?? []) {
      if (!offerCovers(offer, faceValue)) continue;
      const supplierCost = BigInt(new Decimal(faceValue.toString()).mul(offer.costRatio).toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0)) + offer.costFeeMinor;
      const { amount: cost, rate } = await this.convert(ctx, supplierCost, offer.costCurrency);
      // The scheme follows BitoCard's rule for the product; BitoCard's fee replaces its margin or discount share.
      const given = this.rule(ctx, product, offer.supplierCode);
      const local = faceValueCategories.has(product.category) && product.faceCurrency === ctx.currency;
      const discount = given.kind === 'discount' || (given.kind === 'auto' && (local || cost < face));
      const base = discount ? face : cost;
      const fee = maxFeeMinor(exactFeeNano(base, feeRule?.ratePpb ?? 0), feeRule?.minFeeMinor ?? null);
      const settled = this.settle(ctx, product, face, cost, { ...given, kind: discount ? 'discount' : 'markup' }, null, fee);
      if (!settled) continue;
      const priced: Priced = {
        offer,
        source: 'own',
        connectionId: offer.connectionId,
        routing: offer.connection.routing,
        fee: { ruleId: feeRule?.id ?? null, ratePpb: feeRule?.ratePpb ?? 0, baseMinor: base, minFeeMinor: feeRule?.minFeeMinor ?? null },
        supplierCost,
        fxRate: rate,
        cost,
        face,
        ...settled,
      };
      // Preferred accounts first, then the cheapest.
      const rank = (item: Priced) => (item.routing === 'preferred' ? 0 : 1);
      if (!best || rank(priced) < rank(best) || (rank(priced) === rank(best) && cost < best.cost)) best = priced;
    }
    return best;
  }

  /**
   * The source for a sale: the reseller's own supplier when they prefer it (or BitoCard has no offer), otherwise
   * BitoCard's cheapest offer.
   */
  async choose(ctx: PricingContext, product: ProductWithOffers, faceValue: bigint): Promise<Priced> {
    const own = await this.priceOwn(ctx, product, faceValue);
    if (own?.routing === 'preferred') return own;
    try {
      return await this.price(ctx, product, faceValue);
    } catch (error) {
      if (own && error instanceof ApiError && error.code === 'product_unavailable') return own;
      throw error;
    }
  }

  // -- Reseller pricing --------------------------------------------------------------------------------------------

  async pricingSettings(resellerId: string) {
    const ctx = await this.context(resellerId, 'live');
    const productIds = ctx.markups.flatMap(m => (m.productId ? [m.productId] : []));
    const names = new Map((productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : []).map(p => [p.id, p.name]));
    return {
      object: 'pricing' as const,
      currency: ctx.currency,
      markup_cap_percent: Math.min(ctx.country.markupCapPercent, maxResellerMarkupBps / 100),
      markups: ctx.markups.map(m => ({
        category: m.category,
        product_id: m.productId,
        product_name: m.productId ? (names.get(m.productId) ?? null) : null,
        markup_bps: m.markupBps,
        customer_discount_bps: m.customerDiscountBps,
        fixed_price: m.fixedMinor === null ? null : Number(m.fixedMinor),
      })),
    };
  }

  /**
   * Sets the reseller's pricing for everything (no category), a category, or one product. Only the fields sent change;
   * `null` clears one. `markup_bps` is for markup products (capped by the Markup Protection Scheme), `customer_discount_bps`
   * for discount products, `fixed_price` (a customer price in the reseller currency) for one product.
   */
  async setMarkup(
    resellerId: string,
    input: { category?: ProductCategory | null; product_id?: string | null; markup_bps?: number | null; customer_discount_bps?: number | null; fixed_price?: number | null },
  ) {
    const ctx = await this.context(resellerId, 'live');
    const cap = Math.min(ctx.capBps, maxResellerMarkupBps);
    if (input.markup_bps !== undefined && input.markup_bps !== null && input.markup_bps > cap) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'markup_above_cap', `The Markup Protection Scheme allows at most ${cap / 100}% above BitoCard's price.`, 'markup_bps');
    }
    let category = input.category ?? null;
    if (input.product_id) {
      const product = await this.prisma.product.findUnique({ where: { id: input.product_id } });
      if (!product || (category && product.category !== category)) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such product in this category.', 'product_id');
      }
      category = product.category;
    } else if (input.fixed_price !== undefined && input.fixed_price !== null) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'A fixed price is set for one product.', 'fixed_price');
    }
    const productId = input.product_id ?? null;
    const data = {
      ...(input.markup_bps !== undefined ? { markupBps: input.markup_bps } : {}),
      ...(input.customer_discount_bps !== undefined ? { customerDiscountBps: input.customer_discount_bps } : {}),
      ...(input.fixed_price !== undefined ? { fixedMinor: input.fixed_price === null ? null : BigInt(input.fixed_price) } : {}),
    };
    const existing = await this.prisma.resellerMarkup.findFirst({ where: { resellerId, category: productId ? undefined : category, productId } });
    if (existing) await this.prisma.resellerMarkup.update({ where: { id: existing.id }, data });
    else await this.prisma.resellerMarkup.create({ data: { resellerId, category, productId, ...data } });
    return this.pricingSettings(resellerId);
  }

  async removeMarkup(resellerId: string, category: ProductCategory | null, productId: string | null) {
    await this.prisma.resellerMarkup.deleteMany({ where: productId ? { resellerId, productId } : { resellerId, category, productId: null } });
    return this.pricingSettings(resellerId);
  }

  /**
   * What one sale of a product earns the reseller, with their settings or ones they are trying (`trial`, nothing saved):
   * BitoCard's price, the customer's price and their profit, under the product's scheme.
   */
  async preview(
    resellerId: string,
    mode: LedgerMode,
    product: ProductWithOffers,
    faceValue: bigint | null,
    trial: { markup_bps?: number; customer_discount_bps?: number; fixed_price?: number | null },
  ) {
    const ctx = await this.context(resellerId, mode);
    const reason = this.unavailableReason(ctx, product);
    if (reason) throw reason;
    if (trial.markup_bps !== undefined || trial.customer_discount_bps !== undefined || trial.fixed_price !== undefined) {
      const current = ctx.markups.find(m => m.productId === product.id);
      const row: ResellerMarkup = {
        id: current?.id ?? 'trial',
        resellerId,
        category: product.category,
        productId: product.id,
        markupBps: trial.markup_bps ?? current?.markupBps ?? null,
        customerDiscountBps: trial.customer_discount_bps ?? current?.customerDiscountBps ?? null,
        // Trying a markup tries it instead of a saved fixed price.
        fixedMinor:
          trial.fixed_price !== undefined && trial.fixed_price !== null
            ? BigInt(trial.fixed_price)
            : trial.fixed_price === null || trial.markup_bps !== undefined
              ? null
              : (current?.fixedMinor ?? null),
        updatedAt: new Date(),
      };
      ctx.markups = [...ctx.markups.filter(m => m.productId !== product.id), row];
    }
    const face = faceValue ?? product.fixedValues[0] ?? product.minValueMinor ?? null;
    if (face === null || face <= 0n) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Say which face value to price.', 'face_value');
    const priced = await this.choose(ctx, product, face);
    const discount = priced.basis === 'discount';
    return {
      object: 'price_preview' as const,
      product_id: product.id,
      mode,
      currency: ctx.currency,
      face_value: minor(face),
      scheme: discount ? ('discount' as const) : ('markup' as const),
      /** Discount products: the most a customer pays, in your currency. */
      face_price: discount ? minor(priced.face) : null,
      /** What BitoCard charges you per sale. */
      bitocard_price: minor(priced.wholesale),
      /** Discount products: your discount off face value. */
      your_discount: discount ? minor(priced.face - priced.wholesale) : null,
      /** Discount products: what you give your customer off face value. */
      customer_discount: discount ? minor(priced.face - priced.price) : null,
      customer_price: minor(priced.price),
      your_profit: minor(priced.price - priced.wholesale),
      markup_cap_bps: Math.min(ctx.capBps, maxResellerMarkupBps),
      fixed_below_cost: priced.fixedBelowCost,
      settings: {
        customer_discount_bps: priced.terms.customerDiscountBps,
        markup_bps: priced.terms.markupBps,
        fixed_price: priced.terms.fixedMinor === null ? null : minor(priced.terms.fixedMinor),
        from: { customer_discount: priced.terms.from.customerDiscount, markup: priced.terms.from.markup, fixed: priced.terms.from.fixed },
      },
    };
  }

  // -- BitoCard pricing rules (admin) ----------------------------------------------------------------------------

  async listRules() {
    const rules = await this.prisma.pricingRule.findMany({ orderBy: [{ category: 'asc' }, { countryCode: 'asc' }, { supplierCode: 'asc' }] });
    return { object: 'list' as const, data: rules.map(presentRule) };
  }

  async setRule(input: {
    category?: ProductCategory;
    country?: string;
    supplier_code?: string;
    product_id?: string;
    kind?: PriceKind;
    margin_bps?: number;
    reseller_discount_bps?: number;
    fixed_price?: number;
    fixed_currency?: string;
  }) {
    const kind: PriceKind = input.kind ?? 'auto';
    const invalid = (message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);
    if (kind === 'fixed') {
      if (!input.product_id && !input.supplier_code) throw invalid('A fixed price is set for a supplier or a product.', 'kind');
      if (!input.fixed_price || !input.fixed_currency) throw invalid('Give the fixed price and its currency.', 'fixed_price');
      if (input.product_id) {
        const product = await this.prisma.product.findUnique({ where: { id: input.product_id } });
        if (!product) throw invalid('No such product.', 'product_id');
        if (!singleValue(product)) throw invalid('A fixed price fits a product with one value only; use a markup or a discount for this one.', 'kind');
      }
    }
    if (input.supplier_code && !(await this.prisma.supplier.findUnique({ where: { code: input.supplier_code } }))) throw invalid('No such supplier.', 'supplier_code');
    const scope = { category: input.category ?? null, countryCode: input.country?.toUpperCase() ?? null, supplierCode: input.supplier_code ?? null, productId: input.product_id ?? null };
    const existing = await this.prisma.pricingRule.findFirst({ where: scope });
    const data = {
      kind,
      marginBps: input.margin_bps ?? existing?.marginBps ?? 0,
      resellerDiscountBps: input.reseller_discount_bps ?? existing?.resellerDiscountBps ?? 0,
      fixedMinor: kind === 'fixed' ? BigInt(input.fixed_price!) : null,
      fixedCurrency: kind === 'fixed' ? input.fixed_currency!.toUpperCase() : null,
    };
    const rule = existing ? await this.prisma.pricingRule.update({ where: { id: existing.id }, data }) : await this.prisma.pricingRule.create({ data: { ...scope, ...data } });
    return { before: existing, after: rule, presented: presentRule(rule) };
  }

  async deleteRule(id: string) {
    const rule = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (!rule) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such pricing rule.');
    if (!rule.category && !rule.countryCode && !rule.productId && !rule.supplierCode) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'The default rule can be changed but not removed.');
    }
    await this.prisma.pricingRule.delete({ where: { id } });
    return rule;
  }

  /**
   * An admin's view of how one product sells in a market: every supplier offer with its cost, BitoCard's discount from
   * it, the rule that applies and what BitoCard makes per sale, with the current rules or a trial product rule (nothing saved).
   */
  async adminPreview(
    countryCode: string,
    product: ProductWithOffers,
    faceValue: bigint | null,
    trial: { kind?: PriceKind; margin_bps?: number; reseller_discount_bps?: number; fixed_price?: number; fixed_currency?: string } | null,
  ) {
    const country = await this.prisma.country.findUnique({ where: { code: countryCode.toUpperCase() }, include: { categories: true } });
    if (!country) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such market.', 'country');
    const markets = await this.prisma.supplierMarket.findMany({ where: { countryCode: country.code, enabled: true } });
    const ctx: PricingContext = {
      resellerId: '',
      mode: 'live',
      country,
      currency: country.currency,
      international: true,
      capBps: country.markupCapPercent * 100,
      markups: [],
      rules: await this.prisma.pricingRule.findMany(),
      markets: new Set(markets.map(m => `${m.supplierCode}:${m.category}`)),
      rates: new Map(),
      planCode: 'standard',
      feeRules: [],
      own: new Map(),
    };
    const current = this.rule(ctx, product, null);
    if (trial?.kind) {
      const row: PricingRule = {
        id: 'trial',
        category: null,
        countryCode: null,
        supplierCode: null,
        productId: product.id,
        kind: trial.kind,
        marginBps: trial.margin_bps ?? 0,
        resellerDiscountBps: trial.reseller_discount_bps ?? 0,
        fixedMinor: trial.kind === 'fixed' && trial.fixed_price ? BigInt(trial.fixed_price) : null,
        fixedCurrency: trial.kind === 'fixed' ? (trial.fixed_currency ?? country.currency).toUpperCase() : null,
        updatedAt: new Date(),
      };
      ctx.rules = [...ctx.rules.filter(rule => rule.productId !== product.id || rule.supplierCode || rule.category || rule.countryCode), row];
    }
    const face = faceValue ?? product.fixedValues[0] ?? product.minValueMinor ?? null;
    if (face === null || face <= 0n) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Say which face value to price.', 'face_value');
    const faceLocal = await this.faceIn(ctx, product, face);
    const offers = [];
    let chosen: string | null = null;
    let cheapest: bigint | null = null;
    for (const offer of product.supplierProducts) {
      const eligible = this.eligibleOffers(ctx, { ...product, supplierProducts: [offer] }).length === 1;
      const priced = eligible ? await this.priceOffer(ctx, product, face, faceLocal, offer).catch(() => null) : null;
      const rule = this.rule(ctx, product, offer.supplierCode);
      const discounted = new Decimal(face.toString()).mul(offer.costRatio).mul(new Decimal(10_000 - offer.discountBps).div(10_000));
      const supplierCost = BigInt(discounted.toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0)) + offer.costFeeMinor;
      const cost = priced?.cost ?? (await this.convert(ctx, supplierCost, offer.costCurrency).catch(() => ({ amount: null }))).amount;
      if (priced && (cheapest === null || priced.cost < cheapest)) [cheapest, chosen] = [priced.cost, offer.id];
      offers.push({
        offer_id: offer.id,
        supplier_code: offer.supplierCode,
        supplier_name: offer.supplier.name,
        supplier_cost: cost === null ? null : minor(cost),
        supplier_discount_bps: cost === null || faceLocal <= 0n ? null : Number(((faceLocal - cost) * 10_000n) / faceLocal),
        rule: presentResolved(priced?.rule ?? rule),
        scheme: priced ? (priced.basis === 'discount' ? 'discount' : 'markup') : null,
        sellable: Boolean(priced),
        reason: priced ? null : !eligible ? 'not_offered' : rule.kind === 'discount' ? 'cost_above_face_value' : rule.kind === 'fixed' ? 'price_below_cost' : 'not_priced',
        wholesale: priced ? minor(priced.wholesale) : null,
        bitocard_profit: priced ? minor(priced.wholesale - priced.cost) : null,
        reseller_discount: priced && priced.basis === 'discount' ? minor(priced.face - priced.wholesale) : null,
        chosen: false,
      });
    }
    for (const item of offers) item.chosen = item.offer_id === chosen;
    // What sells now: the chosen offer's rule (else the rule without a supplier).
    const chosenOffer = product.supplierProducts.find(offer => offer.id === chosen);
    const now = chosenOffer ? this.rule(ctx, product, chosenOffer.supplierCode) : current;
    return {
      object: 'admin_price_preview' as const,
      product_id: product.id,
      country: country.code,
      currency: country.currency,
      face_value: minor(face),
      face_price: minor(faceLocal),
      single_value: singleValue(product),
      current: presentResolved(trial?.kind ? current : now),
      trial: trial?.kind ? presentResolved(now) : null,
      offers,
    };
  }
}

function presentResolved(rule: ResolvedRule) {
  return {
    kind: rule.kind,
    level: rule.level,
    rule_id: rule.ruleId,
    margin_bps: rule.marginBps,
    reseller_discount_bps: rule.resellerDiscountBps,
    fixed_price: rule.fixedMinor === null ? null : Number(rule.fixedMinor),
    fixed_currency: rule.fixedCurrency,
  };
}

export function presentRule(rule: PricingRule) {
  return {
    object: 'pricing_rule' as const,
    id: rule.id,
    category: rule.category,
    country: rule.countryCode,
    supplier_code: rule.supplierCode,
    product_id: rule.productId,
    kind: rule.kind as PriceKind,
    margin_bps: rule.marginBps,
    reseller_discount_bps: rule.resellerDiscountBps,
    fixed_price: rule.fixedMinor === null ? null : Number(rule.fixedMinor),
    fixed_currency: rule.fixedCurrency,
    updated_at: rule.updatedAt.toISOString(),
  };
}
