import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Product, type ProductCategory, type Supplier, type SupplierMarket, type SupplierStatus } from '../generated/prisma/client.js';
import { worldwideCategories } from '../catalogue/pricing.service.js';
import type { CatalogueItem, CatalogueScope } from './adapter.js';
import { SupplierAdapters } from './supplier-adapters.js';

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

/** Rows per batch when saving a catalogue: well under Postgres's parameter limit, few round trips. */
const batchSize = 500;

export function chunks<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let at = 0; at < list.length; at += size) out.push(list.slice(at, at + size));
  return out;
}

/** JSON with sorted keys, so a stored value (Postgres reorders jsonb keys) compares equal to the same value. */
const stableJson = (value: unknown): string =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value ?? null)
    : Array.isArray(value)
      ? `[${value.map(stableJson).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
          .join(',')}}`;

/** A product's details from a catalogue item. */
export function productData(item: CatalogueItem) {
  return {
    category: item.category,
    country: item.country,
    brand: item.brand,
    name: item.name,
    faceCurrency: item.faceCurrency,
    denominationType: item.denominationType,
    fixedValues: item.fixedValues,
    minValueMinor: item.minValue ?? null,
    maxValueMinor: item.maxValue ?? null,
    recipientType: item.recipientType,
    description: item.description ?? null,
    redeemInstructions: item.redeemInstructions ?? null,
    logoUrl: item.logoUrl ?? null,
    features: item.features ?? [],
  };
}

function productChanged(product: Product, data: ReturnType<typeof productData>) {
  return (
    product.category !== data.category ||
    product.country !== data.country ||
    product.brand !== data.brand ||
    product.name !== data.name ||
    product.faceCurrency !== data.faceCurrency ||
    product.denominationType !== data.denominationType ||
    product.fixedValues.join(',') !== data.fixedValues.join(',') ||
    product.minValueMinor !== data.minValueMinor ||
    product.maxValueMinor !== data.maxValueMinor ||
    product.recipientType !== data.recipientType ||
    product.description !== data.description ||
    product.redeemInstructions !== data.redeemInstructions ||
    product.logoUrl !== data.logoUrl ||
    product.features.join(',') !== data.features.join(',')
  );
}

/** An offer's cost and details from a catalogue item (BitoCard's supplier offers and resellers' own offers alike). */
export function offerData(item: CatalogueItem, productId: string) {
  return {
    productId,
    costCurrency: item.costCurrency,
    costRatio: new Prisma.Decimal(item.costRatio),
    costFeeMinor: item.costFee,
    meta: (item.meta ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

/** Whether a stored offer differs from a freshly fetched one. */
export function offerChanged(
  old: { productId: string; costCurrency: string; costRatio: Prisma.Decimal; costFeeMinor: bigint; meta: Prisma.JsonValue | null },
  offer: ReturnType<typeof offerData>,
) {
  return (
    old.productId !== offer.productId ||
    old.costCurrency !== offer.costCurrency ||
    !old.costRatio.equals(offer.costRatio) ||
    old.costFeeMinor !== offer.costFeeMinor ||
    (offer.meta !== undefined && stableJson(old.meta) !== stableJson(offer.meta))
  );
}

export type SupplierUpdate = Partial<{
  enabled: boolean;
  status: SupplierStatus;
  billing_model: string | null;
  funding_currency: string | null;
  min_first_deposit_minor: number | null;
  min_top_up_minor: number | null;
  fees: string | null;
  refunds: string | null;
  resale_approved: boolean;
  requires_ip_allowlist: boolean | null;
  notes: string | null;
  logo_url: string | null;
}>;

/** Admin view of a supplier. Never returned by reseller endpoints. */
export function presentSupplier(supplier: Supplier & { markets?: SupplierMarket[] }, configured: boolean) {
  return {
    object: 'supplier' as const,
    code: supplier.code,
    name: supplier.name,
    logo_url: supplier.logoUrl,
    categories: supplier.categories,
    coverage: supplier.coverage,
    status: supplier.status,
    enabled: supplier.enabled,
    configured,
    funding: {
      billing_model: supplier.billingModel,
      currency: supplier.fundingCurrency,
      min_first_deposit_minor: supplier.minFirstDepositMinor === null ? null : Number(supplier.minFirstDepositMinor),
      min_top_up_minor: supplier.minTopUpMinor === null ? null : Number(supplier.minTopUpMinor),
      fees: supplier.fees,
      refunds: supplier.refunds,
      resale_approved: supplier.resaleApproved,
    },
    requires_ip_allowlist: supplier.requiresIpAllowlist,
    notes: supplier.notes,
    markets: supplier.markets?.map(m => ({ country: m.countryCode, category: m.category, enabled: m.enabled })),
    last_synced_at: supplier.lastSyncedAt?.toISOString() ?? null,
    last_sync_error: supplier.lastSyncError,
  };
}

/** The supplier registry, where each supplier is used, and catalogue syncing. Admin only. */
@Injectable()
export class SuppliersService {
  private readonly logger = new Logger('Suppliers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: SupplierAdapters,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const suppliers = await this.prisma.supplier.findMany({ include: { markets: true }, orderBy: { code: 'asc' } });
    return { object: 'list' as const, data: suppliers.map(s => presentSupplier(s, this.adapters.get(s.code).configured())) };
  }

  async get(code: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { code }, include: { markets: true } });
    if (!supplier) throw notFound('supplier');
    return presentSupplier(supplier, this.adapters.get(code).configured());
  }

  async update(actorId: string | null, code: string, input: SupplierUpdate) {
    const before = await this.prisma.supplier.findUnique({ where: { code } });
    if (!before) throw notFound('supplier');
    const big = (value: number | null | undefined) => (value === undefined ? undefined : value === null ? null : BigInt(value));
    const after = await this.prisma.supplier.update({
      where: { code },
      data: {
        enabled: input.enabled,
        status: input.status,
        billingModel: input.billing_model,
        fundingCurrency: input.funding_currency?.toUpperCase() ?? input.funding_currency,
        minFirstDepositMinor: big(input.min_first_deposit_minor),
        minTopUpMinor: big(input.min_top_up_minor),
        fees: input.fees,
        refunds: input.refunds,
        resaleApproved: input.resale_approved,
        requiresIpAllowlist: input.requires_ip_allowlist,
        notes: input.notes,
        logoUrl: input.logo_url,
      },
    });
    await this.audit.record({ actorId, action: 'supplier.updated', targetType: 'supplier', targetId: code, before, after });
    return this.get(code);
  }

  /** Switches a supplier on or off for a category in a market. */
  async setMarket(actorId: string | null, code: string, countryCode: string, category: ProductCategory, enabled: boolean) {
    const supplier = await this.prisma.supplier.findUnique({ where: { code } });
    if (!supplier) throw notFound('supplier');
    if (!supplier.categories.includes(category)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `${supplier.name} does not supply ${category}.`, 'category');
    }
    if (!(await this.prisma.country.findUnique({ where: { code: countryCode } }))) throw notFound('country');
    const key = { supplierCode_countryCode_category: { supplierCode: code, countryCode, category } };
    const before = await this.prisma.supplierMarket.findUnique({ where: key });
    const after = await this.prisma.supplierMarket.upsert({ where: key, create: { supplierCode: code, countryCode, category, enabled }, update: { enabled } });
    await this.audit.record({ actorId, action: 'supplier.market_updated', targetType: 'supplier', targetId: code, before, after });
    return this.get(code);
  }

  /** What to sync for a supplier: each enabled market, with worldwide categories (gift cards, numbers) fetched once. */
  private async scopes(code: string): Promise<CatalogueScope[]> {
    const adapter = this.adapters.get(code);
    const markets = await this.prisma.supplierMarket.findMany({ where: { supplierCode: code, enabled: true } });
    const scopes = new Map<string, CatalogueScope>();
    for (const market of markets) {
      if (!adapter.syncs.includes(market.category)) continue;
      const country = worldwideCategories.has(market.category) ? null : market.countryCode;
      scopes.set(`${market.category}:${country}`, { category: market.category, country });
    }
    return [...scopes.values()];
  }

  /**
   * Fetches the supplier catalogue for its enabled markets and maps it onto BitoCard products. Offers the
   * supplier no longer lists become unavailable. Admin settings (product switches, agreed discounts) are kept.
   */
  async sync(code: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { code } });
    if (!supplier) throw notFound('supplier');
    const adapter = this.adapters.get(code);
    if (!adapter.configured()) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'supplier_not_configured', `${supplier.name} has no API credentials configured.`);
    }
    const scopes = await this.scopes(code);
    if (scopes.length === 0) {
      // Nothing to fetch: say so rather than report an empty success.
      throw new ApiError(
        HttpStatus.CONFLICT,
        'conflict_error',
        'supplier_no_markets',
        `Switch on at least one market for ${supplier.name} first (a country and one of its categories). The catalogue is fetched only for switched-on markets; worldwide categories need just one country.`,
      );
    }
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    try {
      const items: CatalogueItem[] = [];
      for (const scope of scopes) {
        for (const item of await adapter.catalogue(scope)) {
          if (seen.has(item.sku)) continue;
          seen.add(item.sku);
          items.push(item);
        }
      }
      ({ created, updated } = await this.saveOffers(code, items));
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await this.prisma.supplier.update({ where: { code }, data: { lastSyncError: message } });
      this.logger.error({ err: error, supplier: code }, 'Catalogue sync failed');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'supplier_sync_failed', 'The supplier catalogue could not be fetched. Details are on the supplier record.');
    }
    const removed = await this.prisma.supplierProduct.updateMany({ where: { supplierCode: code, available: true, sku: { notIn: [...seen] } }, data: { available: false } });
    await this.prisma.supplier.update({ where: { code }, data: { lastSyncedAt: new Date(), lastSyncError: null } });
    // When nothing came back, say why (the adapter's report: what the supplier returned and what was left out).
    const note = created + updated === 0 ? (adapter.syncReport?.() ?? 'The supplier returned no products for the switched-on markets.') : null;
    return { object: 'supplier_sync' as const, supplier: code, products_created: created, offers_updated: updated, offers_withdrawn: removed.count, note };
  }

  /** Syncs every enabled, configured supplier. Run daily; one failing supplier does not stop the others. */
  async syncAll() {
    const suppliers = await this.prisma.supplier.findMany({ where: { enabled: true } });
    const results: Record<string, unknown> = {};
    for (const supplier of suppliers) {
      if (!this.adapters.get(supplier.code).configured()) continue;
      results[supplier.code] = await this.sync(supplier.code).catch((error: Error) => ({ error: error.message }));
    }
    return results;
  }

  /**
   * Saves a supplier's catalogue in batches (a few queries per 500 offers, not several per offer, so catalogues of
   * thousands, such as DIDWW's numbers, sync well inside the function time limit). Only what changed is written;
   * offers still listed but unchanged are marked seen in one statement. Admin settings (discount, priority) are kept.
   */
  private async saveOffers(supplierCode: string, items: CatalogueItem[]) {
    const now = new Date();
    const { ids, created } = await this.upsertProducts(items);
    for (const chunk of chunks(items, batchSize)) {
      const existing = await this.prisma.supplierProduct.findMany({ where: { supplierCode, sku: { in: chunk.map(item => item.sku) } } });
      const bySku = new Map(existing.map(offer => [offer.sku, offer]));
      const fresh: Prisma.SupplierProductCreateManyInput[] = [];
      const changed: Prisma.PrismaPromise<unknown>[] = [];
      const unchanged: string[] = [];
      for (const item of chunk) {
        const offer = offerData(item, ids.get(item.productKey)!);
        const old = bySku.get(item.sku);
        if (!old) fresh.push({ supplierCode, sku: item.sku, ...offer, available: true, syncedAt: now });
        else if (offerChanged(old, offer)) changed.push(this.prisma.supplierProduct.update({ where: { id: old.id }, data: { ...offer, available: true, syncedAt: now } }));
        else unchanged.push(old.id);
      }
      if (fresh.length) await this.prisma.supplierProduct.createMany({ data: fresh, skipDuplicates: true });
      if (changed.length) await this.prisma.$transaction(changed);
      if (unchanged.length) await this.prisma.supplierProduct.updateMany({ where: { id: { in: unchanged } }, data: { available: true, syncedAt: now } });
    }
    return { created: created.size, updated: items.length - created.size };
  }

  /**
   * The BitoCard products for catalogue items (by product key), created or updated from them, in batches. Shared by
   * every source, so equivalent offers from BitoCard's suppliers and resellers' own accounts are one product. Returns
   * each key's product ID and the keys that were new.
   */
  async upsertProducts(items: CatalogueItem[]) {
    const ids = new Map<string, string>();
    const created = new Set<string>();
    // The last item with a key decides its product's details, as when items were saved one by one.
    const byKey = new Map(items.map(item => [item.productKey, item]));
    for (const keys of chunks([...byKey.keys()], batchSize)) {
      const existing = await this.prisma.product.findMany({ where: { key: { in: keys } } });
      const found = new Set(existing.map(product => product.key));
      const fresh = keys.filter(key => !found.has(key));
      if (fresh.length) {
        await this.prisma.product.createMany({ data: fresh.map(key => ({ key, ...productData(byKey.get(key)!) })), skipDuplicates: true });
        for (const key of fresh) created.add(key);
        for (const row of await this.prisma.product.findMany({ where: { key: { in: fresh } }, select: { id: true, key: true } })) ids.set(row.key, row.id);
      }
      const updates = existing.filter(product => productChanged(product, productData(byKey.get(product.key)!)));
      if (updates.length) await this.prisma.$transaction(updates.map(product => this.prisma.product.update({ where: { id: product.id }, data: productData(byKey.get(product.key)!) })));
      for (const product of existing) ids.set(product.key, product.id);
    }
    return { ids, created };
  }

  // -- Products (admin) ------------------------------------------------------------------------------------------

  async products(filter: { category?: ProductCategory; country?: string; q?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 50;
    const products = await this.prisma.product.findMany({
      where: {
        category: filter.category,
        country: filter.country?.toUpperCase(),
        ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: 'insensitive' } }, { brand: { contains: filter.q.toLowerCase() } }] } : {}),
      },
      include: { supplierProducts: true },
      orderBy: { key: 'asc' },
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return {
      object: 'list' as const,
      data: products.slice(0, limit).map(product => ({
        object: 'admin_product' as const,
        id: product.id,
        key: product.key,
        category: product.category,
        country: product.country,
        name: product.name,
        brand: product.brand,
        logo_url: product.logoUrl,
        image_url: product.imageUrl,
        face_currency: product.faceCurrency,
        active: product.active,
        offers: product.supplierProducts.map(offer => ({
          id: offer.id,
          supplier: offer.supplierCode,
          sku: offer.sku,
          cost_currency: offer.costCurrency,
          cost_ratio: offer.costRatio.toString(),
          cost_fee_minor: Number(offer.costFeeMinor),
          discount_bps: offer.discountBps,
          priority: offer.priority,
          available: offer.available,
          synced_at: offer.syncedAt.toISOString(),
        })),
      })),
      has_more: products.length > limit,
    };
  }

  async updateProduct(actorId: string | null, id: string, input: { active?: boolean; name?: string; description?: string | null; image_url?: string | null }) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw notFound('product');
    const after = await this.prisma.product.update({ where: { id }, data: { active: input.active, name: input.name, description: input.description, imageUrl: input.image_url } });
    await this.audit.record({ actorId, action: 'product.updated', targetType: 'product', targetId: id, before, after });
    return { object: 'admin_product' as const, id, key: after.key, name: after.name, description: after.description, image_url: after.imageUrl, active: after.active };
  }

  /** The commission agreed with a supplier for one offer, and its routing priority. */
  async updateOffer(actorId: string | null, id: string, input: { discount_bps?: number; priority?: number; available?: boolean }) {
    const before = await this.prisma.supplierProduct.findUnique({ where: { id } });
    if (!before) throw notFound('offer');
    const after = await this.prisma.supplierProduct.update({ where: { id }, data: { discountBps: input.discount_bps, priority: input.priority, available: input.available } });
    await this.audit.record({ actorId, action: 'supplier_product.updated', targetType: 'supplier_product', targetId: id, before, after });
    return { object: 'supplier_offer' as const, id, discount_bps: after.discountBps, priority: after.priority, available: after.available };
  }
}
