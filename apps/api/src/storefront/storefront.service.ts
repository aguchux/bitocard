import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { worldwideCategories, worldwideCountry } from '../catalogue/pricing.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import { type Brand, type LedgerMode, Prisma, type Product, type ProductCategory } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { minor } from '../ledger/mode.js';
import { brandInitials, registryAssetUrl, registryBrand, registryCardArtUrl, registryIconUrl, registrySlugsMatching } from './brand-registry.js';
import { categoryLabels, categorySynonyms, defaultHome, navigationGroups, type Section, sections as sectionsSchema, storeHome } from './layout.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const homeKey = 'home';
const previewLifetimeMs = 30 * 60_000;
const regionNames = new Intl.DisplayNames(['en-GB'], { type: 'region' });

/** "amazon-us" becomes "Amazon US" when a brand has no presentation of its own. */
const brandNameFromSlug = (slug: string) =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => (part.length <= 3 && /^[a-z]{2,3}$/.test(part) && part !== 'tv' ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');

const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

export type StoreProductFilter = {
  category?: ProductCategory;
  group?: string;
  country?: string;
  brand?: string;
  tag?: string;
  q?: string;
  sort?: 'popular' | 'name' | 'new';
  /** Products that can do all of these (`src/catalogue/features.ts`). */
  features?: string[];
  limit?: number;
  offset?: number;
};

type Availability = { where: Prisma.ProductWhereInput; categories: Set<ProductCategory> };

/** Currencies shown without minor units (as the store's `formatFace`). */
const wholeCurrencies = new Set(['JPY', 'KRW', 'UGX', 'RWF', 'XOF', 'XAF']);
const digits = (currency: string) => (wholeCurrencies.has(currency) ? 0 : 2);

/** Each currency's `pay` rate (units per US dollar) for showing prices in a shopper's currency. */
type Prices = { currency: string; perUsd: Map<string, Decimal> };

/**
 * What a request sees: the shopper's market, on a reseller's hosted store that reseller (their listings and offers),
 * and the signed-in customer's currency for prices (`prices`).
 */
type Scope = { market: string | null; store?: { resellerId: string; country: string; mode: LedgerMode }; prices?: Prices };

/**
 * BitoCard's own storefront (bitocard.com), read by anyone: the published home page with its sections filled in, the
 * catalogue, search across brands, companies, products, categories and countries, and product pages. Shows face
 * values ("from $10"); the price is quoted at checkout. Never names suppliers, costs or routing.
 */
@Injectable()
export class StorefrontService {
  /** The request in progress: the shopper's market (`inMarket`, null for the whole store), and a reseller's store (`inStore`). */
  private readonly scope = new AsyncLocalStorage<Scope>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly fx: FxService,
  ) {}

  /**
   * The rates for showing prices in `currency` (the signed-in customer's): BitoCard's `pay` rate for every currency
   * that has one. None when no currency is asked or it has no rate (paused or stale), so prices stay face values.
   */
  private async prices(currency: string | undefined): Promise<Prices | undefined> {
    if (!currency) return undefined;
    const settings = await this.prisma.currencySetting.findMany({ select: { currency: true } });
    const perUsd = new Map<string, Decimal>([['USD', new Decimal(1)]]);
    for (const { currency: code } of settings) {
      const rate = await this.fx.rate(code).catch(() => null);
      if (rate) perUsd.set(code, rate.pay);
    }
    return perUsd.has(currency) ? { currency, perUsd } : undefined;
  }

  /**
   * A product's face values in the shopper's currency, converted at BitoCard's rate and rounded up to a whole unit
   * (`rate`: the shopper's minor units per face minor unit, for converting any value the same way). Null without a
   * currency or a rate. What the customer pays is quoted at checkout.
   */
  private localPrice(faceCurrency: string, from: bigint, to: bigint) {
    const prices = this.scope.getStore()?.prices;
    const face = prices?.perUsd.get(faceCurrency);
    const local = prices?.perUsd.get(prices.currency);
    if (!prices || !face || !local) return null;
    const rate = local.div(face).mul(new Decimal(10).pow(digits(prices.currency) - digits(faceCurrency)));
    const unit = new Decimal(10).pow(digits(prices.currency));
    const convert = (value: bigint) => (faceCurrency === prices.currency ? Number(value) : rate.mul(value.toString()).div(unit).ceil().mul(unit).toNumber());
    return { currency: prices.currency, from: convert(from), to: convert(to), rate: faceCurrency === prices.currency ? '1' : rate.toSignificantDigits(12).toString() };
  }

  /**
   * Runs `work` for a shopper who chose a market (bitocard.com asks on the first visit and remembers it): other
   * countries' local products (their airtime, data, bills, pay-TV, mobile money) are left out, while products usable
   * anywhere (gift cards, eSIMs, software, numbers) stay. `global` or nothing shows the whole store.
   */
  async inMarket<T>(market: string | undefined, work: () => Promise<T>, currency?: string) {
    const code = market && market.toLowerCase() !== 'global' ? market.toUpperCase() : null;
    const store = this.scope.getStore()?.store;
    const prices = await this.prices(currency);
    // A reseller's store always sells in its own country.
    return this.scope.run(store ? { market: store.country, store, prices } : { market: code, prices }, work);
  }

  /**
   * Runs `work` for a reseller's hosted store (`<subdomain>.bitocard.com`, named by the `store` query): only the
   * products the reseller listed for their store (SHQ Catalogue), available from BitoCard's suppliers or their own, in
   * their country plus products usable anywhere. No store (or `bitocard`) is bitocard.com. A store that is not
   * published is a 404.
   */
  async inStore<T>(subdomain: string | null, market: string | undefined, work: () => Promise<T>, currency?: string) {
    if (!subdomain) return this.inMarket(market, work, currency);
    const store = await this.prisma.store.findUnique({ where: { subdomain }, include: { reseller: true } });
    if (!store || store.status !== 'published' || store.reseller.status === 'suspended' || store.reseller.house || !store.reseller.country) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'store_unavailable', 'This store is not open.');
    }
    const scope = { resellerId: store.resellerId, country: store.reseller.country, mode: store.checkoutMode };
    const prices = await this.prices(currency);
    return this.scope.run({ market: scope.country, store: scope, prices }, work);
  }

  /** Whether the request is for a reseller's hosted store. */
  private get onResellerStore() {
    return Boolean(this.scope.getStore()?.store);
  }

  // -- What is on sale -------------------------------------------------------------------------------------------

  /**
   * Products the storefront shows: active, from a visible brand, with at least one available offer from an enabled
   * supplier, in a category on sale in the product's country (worldwide categories: on sale anywhere).
   */
  async availability(): Promise<Availability> {
    await this.refreshBrandAssets();
    const [enabled, hidden] = await Promise.all([
      this.prisma.countryCategory.findMany({ where: { enabled: true }, select: { countryCode: true, category: true } }),
      this.prisma.brand.findMany({ where: { visible: false }, select: { slug: true } }),
    ]);
    const categories = new Set(enabled.map(row => row.category));
    const worldwide = [...categories].filter(category => worldwideCategories.has(category));
    const market = this.scope.getStore()?.market ?? null;
    const store = this.scope.getStore()?.store;
    const fromBitocard: Prisma.ProductWhereInput = { supplierProducts: { some: { available: true, supplier: { enabled: true } } } };
    return {
      categories,
      where: {
        AND: [
          ...(market ? [{ OR: [{ country: market }, { country: worldwideCountry }, { category: { in: [...worldwideCategories] } }] }] : []),
          // On sale from BitoCard's suppliers, or on a reseller's store from their own supplier account too.
          store ? { OR: [fromBitocard, { resellerOffers: { some: { resellerId: store.resellerId, mode: store.mode, available: true, connection: { status: 'active', routing: { not: 'off' } } } } }] } : fromBitocard,
        ],
        active: true,
        // bitocard.com: only products an admin listed (Catalog > Products > List); a reseller's store: what they listed.
        ...(store ? { listings: { some: { resellerId: store.resellerId } } } : { listed: true }),
        brand: { notIn: hidden.map(row => row.slug) },
        OR: [...enabled.map(row => ({ country: row.countryCode, category: row.category })), ...(worldwide.length ? [{ category: { in: worldwide } }] : [])],
      },
    };
  }

  private async brandsFor(slugs: string[]) {
    const rows = slugs.length ? await this.prisma.brand.findMany({ where: { slug: { in: [...new Set(slugs)] } } }) : [];
    return new Map(rows.map(row => [row.slug, row]));
  }

  /**
   * A brand as the stores show it: the admin's settings when the brand is set up (`brands`), otherwise the brand
   * registry's defaults (`brand-registry.json`), otherwise a name from the slug. The logo falls back from the brand's own
   * to the registry upload, the registry file's logo, then the bundled icon; the card art likewise, ending with the
   * bundled card art. `initials` is what to show when there is no logo.
   */
  presentBrand(slug: string, row?: Brand | null) {
    const registry = registryBrand(slug);
    const uploaded = registry ? this.brandAssets.get(registry.slug) : undefined;
    const config = this.integrations.config;
    const name = row?.name ?? (registry?.slug === slug ? registry.name : brandNameFromSlug(slug));
    return {
      object: 'store_brand' as const,
      slug,
      name,
      company: row?.company ?? registry?.company ?? null,
      description: row?.description ?? null,
      logo_url: row?.logoUrl ?? uploaded?.logoUrl ?? registryAssetUrl(registry?.logo ?? null, config) ?? registryIconUrl(registry, config),
      image_url: row?.imageUrl ?? uploaded?.cardUrl ?? registryAssetUrl(registry?.card ?? null, config) ?? registryCardArtUrl(registry, config),
      color: row?.color ?? registry?.color ?? null,
      initials: brandInitials(name, registry && name === registry.name ? registry.initials : undefined),
      tags: row?.tags.length ? row.tags : (registry?.tags ?? []),
    };
  }

  /** Logos and card art uploaded for registry entries (Storefront > Brand registry), kept for 30 seconds. */
  private brandAssets = new Map<string, { logoUrl: string | null; cardUrl: string | null }>();
  private brandAssetsAt = 0;

  async refreshBrandAssets(force = false) {
    if (!force && Date.now() - this.brandAssetsAt < 30_000) return;
    const rows = await this.prisma.brandAsset.findMany();
    this.brandAssets = new Map(rows.map(row => [row.slug, { logoUrl: row.logoUrl, cardUrl: row.cardUrl }]));
    this.brandAssetsAt = Date.now();
  }

  /** A product as the storefront lists it: face values only (the customer's price is quoted at checkout). */
  presentProduct(product: Product, brand?: Brand | null) {
    const values = product.denominationType === 'fixed' ? product.fixedValues : [product.minValueMinor ?? 0n, product.maxValueMinor ?? 0n];
    const positive = values.filter(value => value > 0n);
    const from = positive.length ? positive.reduce((a, b) => (b < a ? b : a)) : 0n;
    const to = positive.length ? positive.reduce((a, b) => (b > a ? b : a)) : 0n;
    return {
      object: 'store_product' as const,
      id: product.id,
      key: product.key,
      name: product.name,
      category: product.category,
      category_label: categoryLabels[product.category],
      country: product.country,
      country_name: countryName(product.country),
      /** Usable in any country (gift cards, eSIMs, software, numbers) rather than one market's services. */
      global: worldwideCategories.has(product.category),
      face_currency: product.faceCurrency,
      denomination_type: product.denominationType,
      /** Lowest and highest face value, in minor units. */
      from: minor(from),
      to: minor(to),
      /** The face values in the signed-in customer's currency (`currency` asked), or null. */
      price: this.localPrice(product.faceCurrency, from, to),
      description: product.description,
      /** The admin's product image, else the brand's logo from BitoCard's own files: never the supplier's (it would name them). */
      logo_url: product.imageUrl ?? this.presentBrand(product.brand, brand).logo_url,
      /** What it can do (calls, SMS, app codes on numbers), for icons and filters. */
      features: product.features,
      brand: this.presentBrand(product.brand, brand),
    };
  }

  /**
   * The picture for each product where BitoCard's catalogue is shown to resellers and admins: the admin's product
   * image, else its brand's card art (the same chain as the store), else none.
   */
  async productImages(products: Pick<Product, 'id' | 'brand' | 'imageUrl'>[]) {
    const art = await this.productArt(products);
    return new Map([...art].map(([id, item]) => [id, item.image]));
  }

  /**
   * Each product's picture and logo, both from BitoCard's own files (the admin's product image, the brand's
   * settings, registry uploads, the registry file or the bundled icons and card art), never a supplier's address:
   * a supplier's logo URL would tell resellers and customers who BitoCard buys from.
   */
  async productArt(products: Pick<Product, 'id' | 'brand' | 'imageUrl'>[]) {
    await this.refreshBrandAssets();
    const brands = await this.brandsFor(products.map(product => product.brand));
    return new Map(
      products.map(product => {
        const brand = this.presentBrand(product.brand, brands.get(product.brand));
        return [product.id, { image: product.imageUrl ?? brand.image_url, logo: product.imageUrl ?? brand.logo_url }] as const;
      }),
    );
  }

  private async present(products: Product[]) {
    const brands = await this.brandsFor(products.map(product => product.brand));
    return products.map(product => this.presentProduct(product, brands.get(product.brand)));
  }

  // -- Rankings --------------------------------------------------------------------------------------------------

  /**
   * Most sold (completed live orders, by quantity) over the last `days`, topped up with featured brands' products
   * and then the newest, so a rail is never empty while sales are few.
   */
  async ranked(kind: 'trending' | 'top_selling' | 'new' | 'featured', limit: number, extra: Prisma.ProductWhereInput = {}) {
    const { where } = await this.availability();
    const scope: Prisma.ProductWhereInput = { AND: [where, extra] };
    const picked: Product[] = [];
    const take = (rows: Product[]) => {
      for (const row of rows) if (picked.length < limit && !picked.some(item => item.id === row.id)) picked.push(row);
    };
    if (kind === 'trending' || kind === 'top_selling') {
      const since = new Date(Date.now() - (kind === 'trending' ? 7 : 30) * 24 * 3600_000);
      const sold = await this.prisma.order.groupBy({
        by: ['productId'],
        where: { status: 'completed', mode: 'live', completedAt: { gte: since } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 200,
      });
      const products = await this.prisma.product.findMany({ where: { AND: [scope, { id: { in: sold.map(row => row.productId) } }] } });
      take(sold.map(row => products.find(product => product.id === row.productId)).filter((product): product is Product => Boolean(product)));
    }
    if (picked.length < limit && kind !== 'new') {
      const featured = await this.prisma.brand.findMany({ where: { featured: true, visible: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { slug: true } });
      if (featured.length) {
        const products = await this.prisma.product.findMany({ where: { AND: [scope, { brand: { in: featured.map(row => row.slug) } }] }, orderBy: { name: 'asc' }, take: 100 });
        take(featured.flatMap(row => products.filter(product => product.brand === row.slug)));
      }
    }
    if (picked.length < limit) take(await this.prisma.product.findMany({ where: scope, orderBy: [{ createdAt: 'desc' }, { name: 'asc' }], take: limit * 2 }));
    return this.present(picked);
  }

  // -- Catalogue -------------------------------------------------------------------------------------------------

  private filterWhere(filter: StoreProductFilter): Prisma.ProductWhereInput {
    const and: Prisma.ProductWhereInput[] = [];
    if (filter.category) and.push({ category: filter.category });
    if (filter.group) {
      const group = navigationGroups.find(item => item.key === filter.group);
      and.push({ category: { in: group?.categories ?? [] } });
    }
    if (filter.country === 'global') and.push({ category: { in: [...worldwideCategories] } });
    else if (filter.country) and.push({ country: filter.country.toUpperCase() });
    if (filter.brand) and.push({ brand: filter.brand });
    if (filter.features?.length) and.push({ features: { hasEvery: filter.features } });
    return and.length ? { AND: and } : {};
  }

  async products(filter: StoreProductFilter) {
    const { where } = await this.availability();
    const limit = filter.limit ?? 24;
    const offset = filter.offset ?? 0;
    const and: Prisma.ProductWhereInput[] = [where, this.filterWhere(filter)];
    if (filter.tag) {
      const tagged = await this.prisma.brand.findMany({ where: { tags: { has: filter.tag.toLowerCase() } }, select: { slug: true } });
      and.push({ brand: { in: tagged.map(row => row.slug) } });
    }
    if (filter.q) and.push(await this.textWhere(filter.q));
    const scope: Prisma.ProductWhereInput = { AND: and };
    const total = await this.prisma.product.count({ where: scope });
    if ((filter.sort ?? 'popular') === 'popular') {
      // Popular: most sold in 30 days, then featured brands (in their order), then by name.
      const [rows, sold, featured] = await Promise.all([
        this.prisma.product.findMany({ where: scope, select: { id: true, brand: true, name: true }, take: 2000 }),
        this.prisma.order.groupBy({
          by: ['productId'],
          where: { status: 'completed', mode: 'live', completedAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
          _sum: { quantity: true },
        }),
        this.prisma.brand.findMany({ where: { featured: true }, select: { slug: true, sortOrder: true } }),
      ]);
      const sales = new Map(sold.map(row => [row.productId, row._sum.quantity ?? 0]));
      const rank = new Map(featured.map(row => [row.slug, row.sortOrder]));
      rows.sort(
        (a, b) =>
          (sales.get(b.id) ?? 0) - (sales.get(a.id) ?? 0) ||
          (rank.get(a.brand) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.brand) ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      );
      const ids = rows.slice(offset, offset + limit).map(row => row.id);
      const page = await this.prisma.product.findMany({ where: { id: { in: ids } } });
      const ordered = ids.map(id => page.find(row => row.id === id)).filter((row): row is Product => Boolean(row));
      return { object: 'list' as const, data: await this.present(ordered), has_more: total > offset + limit, total };
    }
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = filter.sort === 'new' ? [{ createdAt: 'desc' }, { name: 'asc' }] : [{ name: 'asc' }, { key: 'asc' }];
    const rows = await this.prisma.product.findMany({ where: scope, orderBy, skip: offset, take: limit });
    return { object: 'list' as const, data: await this.present(rows), has_more: total > offset + limit, total };
  }

  async product(key: string) {
    const { where } = await this.availability();
    const product = await this.prisma.product.findFirst({ where: { AND: [where, { key }] } });
    if (!product) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This product is not available.');
    const [brand] = (await this.brandsFor([product.brand])).values();
    const [sameBrand, sameCategory] = await Promise.all([
      this.prisma.product.findMany({ where: { AND: [where, { brand: product.brand, id: { not: product.id } }] }, orderBy: { country: 'asc' }, take: 8 }),
      this.prisma.product.findMany({ where: { AND: [where, { category: product.category, brand: { not: product.brand } }] }, orderBy: { name: 'asc' }, take: 8 }),
    ]);
    return {
      ...this.presentProduct(product, brand),
      /** Face values to choose from (fixed), or the range a customer may enter, in minor units. */
      denominations: product.denominationType === 'fixed' ? product.fixedValues.map(minor) : null,
      range: product.denominationType === 'range' ? { min: minor(product.minValueMinor ?? 0n), max: minor(product.maxValueMinor ?? 0n) } : null,
      recipient_type: product.recipientType,
      redeem_instructions: product.redeemInstructions,
      other_countries: await this.present(sameBrand),
      related: await this.present(sameCategory),
    };
  }

  /** Categories on sale (enabled somewhere, with products available). */
  async categories() {
    return (await this.everyCategory()).filter(item => item.on_sale);
  }

  /** Every category with its products on sale (none for categories not open yet), for the menu. */
  private async everyCategory() {
    const { where, categories } = await this.availability();
    const [counts, presentation] = await Promise.all([this.prisma.product.groupBy({ by: ['category'], where, _count: { _all: true } }), this.prisma.categoryPresentation.findMany()]);
    return (Object.keys(categoryLabels) as ProductCategory[]).map(category => {
      const products = counts.find(row => row.category === category)?._count._all ?? 0;
      return {
        object: 'store_category' as const,
        category,
        label: categoryLabels[category],
        group: navigationGroups.find(group => group.categories.includes(category))?.key ?? null,
        icon_url: presentation.find(row => row.category === category)?.iconUrl ?? null,
        image_url: presentation.find(row => row.category === category)?.imageUrl ?? null,
        products,
        on_sale: categories.has(category) && products > 0,
      };
    });
  }

  async brands(filter: { tag?: string; limit?: number; category?: ProductCategory[] } = {}) {
    const { where } = await this.availability();
    const grouped = await this.prisma.product.groupBy({
      by: ['brand'],
      where: { AND: [where, filter.category ? { category: { in: filter.category } } : {}] },
      _count: { _all: true },
    });
    const rows = await this.brandsFor(grouped.map(row => row.brand));
    const list = grouped
      .map(row => ({ ...this.presentBrand(row.brand, rows.get(row.brand)), products: row._count._all, featured: rows.get(row.brand)?.featured ?? false, order: rows.get(row.brand)?.sortOrder ?? 1000 }))
      .filter(item => !filter.tag || item.tags.includes(filter.tag.toLowerCase()))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order || b.products - a.products || a.name.localeCompare(b.name));
    return list.slice(0, filter.limit ?? 60).map(item => {
      const { order, ...rest } = item;
      void order;
      return rest;
    });
  }

  /** Countries with products on sale, for the country picker. */
  /**
   * The countries for the country picker: every market BitoCard has set up (Settings > Markets), with the products on
   * sale there (none yet is fine), plus any other country with products on sale.
   */
  async countries() {
    // A reseller's store sells in its own country only.
    const store = this.scope.getStore()?.store;
    if (store) {
      const market = await this.prisma.country.findUnique({ where: { code: store.country }, select: { name: true } });
      return [{ code: store.country, name: market?.name ?? countryName(store.country), products: await this.prisma.product.count({ where: (await this.availability()).where }) }];
    }
    // Always the whole store's countries, so a shopper can pick another market.
    const { where } = await this.scope.run({ market: null }, () => this.availability());
    const [grouped, markets] = await Promise.all([
      this.prisma.product.groupBy({ by: ['country'], where, _count: { _all: true } }),
      this.prisma.country.findMany({ select: { code: true, name: true } }),
    ]);
    const counts = new Map(grouped.map(row => [row.country, row._count._all]));
    const codes = new Set([...markets.map(row => row.code), ...counts.keys()]);
    return [...codes]
      // Products usable anywhere (`WW`) are not a country to pick: they show in every country.
      .filter(code => /^[A-Z]{2}$/.test(code) && code !== worldwideCountry)
      .map(code => ({ code, name: markets.find(row => row.code === code)?.name ?? countryName(code), products: counts.get(code) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // -- Search ----------------------------------------------------------------------------------------------------

  private tokens(q: string) {
    return q
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0)
      .slice(0, 6);
  }

  /** Brands whose name, company, slug or aliases match the query (or every word of it). */
  private async matchingBrandSlugs(q: string) {
    const words = this.tokens(q);
    if (!words.length) return [];
    const phrase = words.join(' ');
    const rows = await this.prisma.brand.findMany({
      where: {
        visible: true,
        OR: [
          { name: { contains: phrase, mode: 'insensitive' } },
          { company: { contains: phrase, mode: 'insensitive' } },
          { slug: { contains: words.join('-') } },
          { aliases: { hasSome: [phrase, ...words] } },
        ],
      },
      select: { slug: true },
    });
    // Plus brands the registry knows by name, company or search word (PSN for PlayStation, robux for Roblox).
    return [...new Set([...rows.map(row => row.slug), ...registrySlugsMatching(phrase, words)])];
  }

  /** Products matching a query: every word in the name or brand, or a matching brand (name, company, alias). */
  private async textWhere(q: string): Promise<Prisma.ProductWhereInput> {
    const words = this.tokens(q);
    if (!words.length) return {};
    const brands = await this.matchingBrandSlugs(q);
    return {
      OR: [
        { AND: words.map(word => ({ OR: [{ name: { contains: word, mode: 'insensitive' as const } }, { brand: { contains: word } }] })) },
        ...(brands.length ? [{ brand: { in: brands } }] : []),
      ],
    };
  }

  /**
   * One search across everything on sale: products (best matches first), brands and the companies behind them,
   * categories (by name and the words people use, such as "top up" or "electricity") and countries.
   */
  async search(q: string, filter: { country?: string; limit?: number } = {}) {
    const query = q.trim().slice(0, 100);
    const words = this.tokens(query);
    const limit = filter.limit ?? 20;
    if (!words.length) return { object: 'store_search' as const, query, products: [], brands: [], categories: [], countries: [] };
    const phrase = words.join(' ');
    const { where, categories: onSale } = await this.availability();
    const country = filter.country ? this.filterWhere({ country: filter.country }) : {};

    const matchedCategories = (Object.keys(categoryLabels) as ProductCategory[]).filter(
      category => onSale.has(category) && (categoryLabels[category].toLowerCase().includes(phrase) || categorySynonyms[category].some(synonym => synonym.includes(phrase) || phrase.includes(synonym))),
    );
    const textMatch = await this.textWhere(query);
    const candidates = await this.prisma.product.findMany({
      where: { AND: [where, country, { OR: [textMatch, ...(matchedCategories.length ? [{ category: { in: matchedCategories } }] : [])] }] },
      take: 200,
    });
    const brands = await this.brandsFor(candidates.map(product => product.brand));
    // Best first: name starts with the query, then brand matches, then every word in the name, then category matches.
    const score = (product: Product) => {
      const name = product.name.toLowerCase();
      const brand = brands.get(product.brand);
      const registry = registryBrand(product.brand);
      const brandText = `${product.brand} ${brand?.name ?? registry?.name ?? ''} ${brand?.company ?? registry?.company ?? ''} ${[...(brand?.aliases ?? []), ...(registry?.aliases ?? [])].join(' ')}`.toLowerCase();
      let value = 0;
      if (name.startsWith(phrase)) value += 50;
      if (brandText.includes(phrase)) value += 30;
      if (words.every(word => name.includes(word))) value += 20;
      if (matchedCategories.includes(product.category)) value += 5;
      return value;
    };
    const ranked = candidates.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));

    const brandCounts = new Map<string, number>();
    for (const product of ranked) if (score(product) >= 20) brandCounts.set(product.brand, (brandCounts.get(product.brand) ?? 0) + 1);
    const countryMatches = (await this.countries()).filter(item => item.name.toLowerCase().includes(phrase) || item.code.toLowerCase() === phrase);
    const categoryCounts = await this.prisma.product.groupBy({ by: ['category'], where: { AND: [where, { category: { in: matchedCategories } }] }, _count: { _all: true } });

    return {
      object: 'store_search' as const,
      query,
      products: ranked.slice(0, limit).map(product => this.presentProduct(product, brands.get(product.brand))),
      brands: [...brandCounts.entries()].slice(0, 8).map(([slug, products]) => ({ ...this.presentBrand(slug, brands.get(slug)), products })),
      categories: matchedCategories.map(category => ({
        object: 'store_category' as const,
        category,
        label: categoryLabels[category],
        group: navigationGroups.find(group => group.categories.includes(category))?.key ?? null,
        products: categoryCounts.find(row => row.category === category)?._count._all ?? 0,
      })),
      countries: countryMatches.slice(0, 5),
    };
  }

  // -- The home page ---------------------------------------------------------------------------------------------

  /**
   * The menu: every category group, always in the same order, so the store's menus never come and go. Each lists its
   * categories with the products on sale (`on_sale: false` for those not open yet) and its top brands.
   */
  async navigation() {
    const categories = await this.everyCategory();
    return Promise.all(
      navigationGroups.map(async group => {
        const own = categories.filter(item => group.categories.includes(item.category));
        return {
          key: group.key,
          label: group.label,
          on_sale: own.some(item => item.on_sale),
          categories: own,
          brands: own.some(item => item.on_sale) ? await this.brands({ category: group.categories, limit: 8 }) : [],
        };
      }),
    );
  }

  /** Fills each visible section with what it shows. */
  async resolve(list: Section[]) {
    const visible = list.filter(item => !item.hidden);
    return Promise.all(
      visible.map(async item => {
        switch (item.type) {
          case 'hero': {
            // Brands with a logo first, so the floating cards show logos rather than initials.
            const brands = await this.brands({ limit: 24 });
            return { ...item, data: { featured: [...brands.filter(brand => brand.logo_url), ...brands.filter(brand => !brand.logo_url)].slice(0, 6) } };
          }
          case 'product_rail': {
            let products;
            if (item.source === 'manual') {
              const { where } = await this.availability();
              const rows = await this.prisma.product.findMany({ where: { AND: [where, { key: { in: item.productKeys } }] } });
              const ordered = item.productKeys.map(key => rows.find(row => row.key === key)).filter((row): row is Product => Boolean(row));
              products = await this.present(ordered.slice(0, item.limit));
            } else if (item.source === 'category' || item.source === 'brand') {
              products = (await this.products({ category: item.source === 'category' ? item.category : undefined, brand: item.source === 'brand' ? item.brand : undefined, limit: item.limit })).data;
            } else {
              products = await this.ranked(item.source, item.limit);
            }
            return { ...item, data: { products } };
          }
          case 'category_grid': {
            const all = await this.categories();
            const chosen = item.categories.length ? item.categories.map(category => all.find(row => row.category === category)).filter(Boolean) : all;
            return { ...item, data: { categories: chosen } };
          }
          case 'brand_grid':
            return { ...item, data: { brands: await this.brands({ tag: item.tag || undefined, limit: item.limit }) } };
          default:
            return { ...item, data: null };
        }
      }),
    );
  }

  /**
   * The published home page, ready to render: its sections filled in, the menu and the countries on sale. With a
   * valid preview token (from the Storefront Manager), the draft instead. Until a layout is published (or after it is
   * taken offline), the approved default layout (`defaultHome()`), so bitocard.com is always the store.
   */
  async home(previewToken?: string) {
    if (this.onResellerStore) {
      // A reseller's store: their listed products under their brand (the Storefront Manager is bitocard.com's).
      const [sections, navigation, countries] = await Promise.all([this.resolve(storeHome()), this.navigation(), this.countries()]);
      return { object: 'store_home' as const, preview: false, published: false, version: null, published_at: null, sections, navigation, countries };
    }
    const page = await this.prisma.storefrontPage.findUnique({ where: { key: homeKey } });
    const preview = previewToken ? this.verifyPreview(previewToken) : false;
    if (previewToken && !preview) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'preview_expired', 'This preview link has expired. Open a new one from the Storefront Manager.');
    const parsed = sectionsSchema.safeParse(preview ? page?.draft : page?.published);
    const published = !preview && parsed.success && Boolean(page?.published);
    const layout = parsed.success && (preview || published) ? parsed.data : defaultHome();
    const [sections, navigation, countries] = await Promise.all([this.resolve(layout), this.navigation(), this.countries()]);
    return {
      object: 'store_home' as const,
      preview,
      /** False while the default layout is shown (nothing published yet, or taken offline). */
      published,
      version: published ? page!.version : null,
      published_at: published ? (page!.publishedAt?.toISOString() ?? null) : null,
      sections,
      navigation,
      countries,
    };
  }

  // -- Preview links ---------------------------------------------------------------------------------------------

  private previewKey() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Previews need ENCRYPTION_KEY to be set.');
    return key;
  }

  /** A link that shows the draft for 30 minutes, signed so it cannot be forged. */
  previewToken(now = Date.now()) {
    const expires = now + previewLifetimeMs;
    const signature = createHmac('sha256', this.previewKey()).update(`storefront-preview:${homeKey}:${expires}`).digest('base64url');
    return { token: `${expires}.${signature}`, expires_at: new Date(expires).toISOString() };
  }

  verifyPreview(token: string, now = Date.now()) {
    const [expiresText, signature] = token.split('.');
    const expires = Number(expiresText);
    if (!Number.isFinite(expires) || expires < now || !signature) return false;
    const expected = createHmac('sha256', this.previewKey()).update(`storefront-preview:${homeKey}:${expires}`).digest('base64url');
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
