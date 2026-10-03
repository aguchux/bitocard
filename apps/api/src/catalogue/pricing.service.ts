import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import {
  type Country,
  type CountryCategory,
  type LedgerMode,
  Prisma,
  type PricingRule,
  type Product,
  type ProductCategory,
  type ResellerMarkup,
  type Supplier,
  type SupplierProduct,
} from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Categories sold at a face value in local currency, where resellers earn a markup or a discount. */
export const faceValueCategories = new Set<ProductCategory>(['airtime', 'data', 'pay_tv', 'bills']);
/** Categories bought for use anywhere, so any market can sell them without the international plan feature. */
export const worldwideCategories = new Set<ProductCategory>(['gift_cards', 'esim', 'software']);

export type Offer = SupplierProduct & { supplier: Supplier };
export type ProductWithOffers = Product & { supplierProducts: Offer[] };

/** Everything needed to price products for one reseller, loaded once per request. */
export type PricingContext = {
  resellerId: string;
  mode: LedgerMode;
  country: Country & { categories: CountryCategory[] };
  currency: string;
  earning: 'markup' | 'discount';
  international: boolean;
  capBps: number;
  markups: ResellerMarkup[];
  rules: PricingRule[];
  /** supplierCode:category pairs switched on in the reseller market. */
  markets: Set<string>;
  rates: Map<string, { pay: Decimal; receive: Decimal }>;
};

/** One unit priced through one supplier offer. All amounts are minor units of the reseller currency unless noted. */
export type Priced = {
  offer: Offer;
  /** In the supplier currency. */
  supplierCost: bigint;
  /** Reseller currency per unit of supplier currency (null when they are the same). */
  fxRate: Decimal | null;
  cost: bigint;
  wholesale: bigint;
  /** The reseller price before tax handling. */
  price: bigint;
  basis: 'markup' | 'discount' | 'cost';
};

const mulBps = (amount: bigint, bps: number) => amount * BigInt(bps);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
/** amount x (1 + bps/10000), rounded up. */
const addBps = (amount: bigint, bps: number) => ceilDiv(mulBps(amount, 10_000 + bps), 10_000n);

export const unavailable = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', code, message, param);

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
    private readonly settings: SettingsService,
    private readonly adapters: SupplierAdapters,
  ) {}

  async context(resellerId: string, mode: LedgerMode): Promise<PricingContext> {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { plan: true, countryRef: { include: { categories: true } } } });
    if (!reseller.countryRef) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_required', 'Set your business country before using the catalogue.');
    }
    const options = await this.settings.effectiveOptions(resellerId);
    const markets = await this.prisma.supplierMarket.findMany({ where: { countryCode: reseller.countryRef.code, enabled: true } });
    return {
      resellerId,
      mode,
      country: reseller.countryRef,
      currency: reseller.countryRef.currency,
      earning: options.fixed_price_earning?.value === 'discount' ? 'discount' : 'markup',
      international: reseller.plan.features.includes('international_selling'),
      capBps: reseller.countryRef.markupCapPercent * 100,
      markups: await this.prisma.resellerMarkup.findMany({ where: { resellerId } }),
      rules: await this.prisma.pricingRule.findMany(),
      markets: new Set(markets.map(m => `${m.supplierCode}:${m.category}`)),
      rates: new Map(),
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

  /** The most specific BitoCard pricing rule for a product in the reseller market. */
  rule(ctx: PricingContext, product: Product) {
    let best: PricingRule | null = null;
    let bestScore = -1;
    for (const rule of ctx.rules) {
      if (rule.productId && rule.productId !== product.id) continue;
      if (rule.category && rule.category !== product.category) continue;
      if (rule.countryCode && rule.countryCode !== ctx.country.code) continue;
      const score = (rule.productId ? 4 : 0) + (rule.category ? 2 : 0) + (rule.countryCode ? 1 : 0);
      if (score > bestScore) [best, bestScore] = [rule, score];
    }
    return { marginBps: best?.marginBps ?? 0, resellerDiscountBps: best?.resellerDiscountBps ?? 0 };
  }

  /** The reseller markup for a product (its own override, else the category one), never above the cap. */
  markupBps(ctx: PricingContext, product: Product) {
    const own = ctx.markups.find(m => m.productId === product.id) ?? ctx.markups.find(m => m.category === product.category && m.productId === null);
    return Math.min(own?.markupBps ?? 0, ctx.capBps);
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

  /** Offers that may be used: available, supplier on, supplier switched on for this market, and (live) configured. */
  eligibleOffers(ctx: PricingContext, product: ProductWithOffers, exclude: ReadonlySet<string> = new Set()) {
    return product.supplierProducts.filter(
      offer =>
        !exclude.has(offer.supplierCode) &&
        offer.available &&
        offer.supplier.enabled &&
        ctx.markets.has(`${offer.supplierCode}:${product.category}`) &&
        (ctx.mode === 'test' || this.adapters.get(offer.supplierCode).configured()),
    );
  }

  /** Prices one unit of a face value through the cheapest viable offer, optionally leaving some suppliers out. */
  async price(ctx: PricingContext, product: ProductWithOffers, faceValue: bigint, exclude?: ReadonlySet<string>): Promise<Priced> {
    const rule = this.rule(ctx, product);
    const markup = this.markupBps(ctx, product);
    const faceValueProduct = product.faceCurrency === ctx.currency && faceValueCategories.has(product.category);
    let best: Priced | null = null;
    for (const offer of this.eligibleOffers(ctx, product, exclude)) {
      const discounted = new Decimal(faceValue.toString()).mul(offer.costRatio).mul(new Decimal(10_000 - offer.discountBps).div(10_000));
      const supplierCost = BigInt(discounted.toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0)) + offer.costFeeMinor;
      const { amount: cost, rate } = await this.convert(ctx, supplierCost, offer.costCurrency);
      let priced: Priced;
      if (faceValueProduct && ctx.earning === 'discount') {
        priced = { offer, supplierCost, fxRate: rate, cost, wholesale: faceValue - mulBps(faceValue, rule.resellerDiscountBps) / 10_000n, price: faceValue, basis: 'discount' };
      } else if (faceValueProduct) {
        priced = { offer, supplierCost, fxRate: rate, cost, wholesale: faceValue, price: addBps(faceValue, markup), basis: 'markup' };
      } else {
        const wholesale = addBps(cost, rule.marginBps);
        priced = { offer, supplierCost, fxRate: rate, cost, wholesale, price: addBps(wholesale, markup), basis: 'cost' };
      }
      // BitoCard never sells below its own cost.
      if (priced.wholesale < cost) continue;
      if (!best || cost < best.cost || (cost === best.cost && offer.priority < best.offer.priority)) best = priced;
    }
    if (!best) throw unavailable('product_unavailable', 'This product is not available right now.');
    return best;
  }

  // -- Reseller markups ------------------------------------------------------------------------------------------

  async pricingSettings(resellerId: string) {
    const ctx = await this.context(resellerId, 'live');
    return {
      object: 'pricing' as const,
      currency: ctx.currency,
      earning: ctx.earning,
      markup_cap_percent: ctx.country.markupCapPercent,
      markups: ctx.markups.map(m => ({ category: m.category, product_id: m.productId, markup_bps: m.markupBps })),
    };
  }

  async setMarkup(resellerId: string, input: { category: ProductCategory; product_id?: string; markup_bps: number }) {
    const ctx = await this.context(resellerId, 'live');
    if (input.markup_bps > ctx.capBps) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'invalid_request_error',
        'markup_above_cap',
        `The Markup Protection Scheme allows at most ${ctx.country.markupCapPercent}% above wholesale price.`,
        'markup_bps',
      );
    }
    if (input.product_id) {
      const product = await this.prisma.product.findUnique({ where: { id: input.product_id } });
      if (!product || product.category !== input.category) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such product in this category.', 'product_id');
      }
    }
    const productId = input.product_id ?? null;
    const existing = await this.prisma.resellerMarkup.findFirst({ where: { resellerId, category: input.category, productId } });
    if (existing) await this.prisma.resellerMarkup.update({ where: { id: existing.id }, data: { markupBps: input.markup_bps } });
    else await this.prisma.resellerMarkup.create({ data: { resellerId, category: input.category, productId, markupBps: input.markup_bps } });
    return this.pricingSettings(resellerId);
  }

  async removeMarkup(resellerId: string, category: ProductCategory, productId: string | null) {
    await this.prisma.resellerMarkup.deleteMany({ where: { resellerId, category, productId } });
    return this.pricingSettings(resellerId);
  }

  // -- BitoCard pricing rules (admin) ----------------------------------------------------------------------------

  async listRules() {
    const rules = await this.prisma.pricingRule.findMany({ orderBy: [{ category: 'asc' }, { countryCode: 'asc' }] });
    return { object: 'list' as const, data: rules.map(presentRule) };
  }

  async setRule(input: { category?: ProductCategory; country?: string; product_id?: string; margin_bps: number; reseller_discount_bps?: number }) {
    const scope = { category: input.category ?? null, countryCode: input.country?.toUpperCase() ?? null, productId: input.product_id ?? null };
    const existing = await this.prisma.pricingRule.findFirst({ where: scope });
    const data = { marginBps: input.margin_bps, resellerDiscountBps: input.reseller_discount_bps ?? 0 };
    const rule = existing ? await this.prisma.pricingRule.update({ where: { id: existing.id }, data }) : await this.prisma.pricingRule.create({ data: { ...scope, ...data } });
    return { before: existing, after: rule, presented: presentRule(rule) };
  }

  async deleteRule(id: string) {
    const rule = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (!rule) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such pricing rule.');
    if (!rule.category && !rule.countryCode && !rule.productId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'The default rule can be changed but not removed.');
    }
    await this.prisma.pricingRule.delete({ where: { id } });
    return rule;
  }
}

export function presentRule(rule: PricingRule) {
  return {
    object: 'pricing_rule' as const,
    id: rule.id,
    category: rule.category,
    country: rule.countryCode,
    product_id: rule.productId,
    margin_bps: rule.marginBps,
    reseller_discount_bps: rule.resellerDiscountBps,
    updated_at: rule.updatedAt.toISOString(),
  };
}
