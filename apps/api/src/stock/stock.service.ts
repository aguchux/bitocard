import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type PricingRule, type Product, type StockCodeStatus, type SupplierProduct } from '../generated/prisma/client.js';
import { worldwideCountry } from '../catalogue/pricing.service.js';
import { slug } from '../suppliers/adapter.js';
import { registryBrand } from '../storefront/brand-registry.js';
import { durationLabel, stockCategories, stockCodeHash, stockSupplier } from '../suppliers/stock.adapter.js';

export type StockCategory = (typeof stockCategories)[number];
export type StockCodeInput = { code: string; pin?: string };

export type StockItemInput = {
  category: StockCategory;
  /** Gift cards: where the card works. Software is global (`WW`), whatever is sent. */
  country?: string;
  /** A brand's slug from Catalog > Brands (or the brand registry). */
  brand: string;
  /** Software: the licence term in months, 0 for lifetime. */
  duration_months?: number;
  title: string;
  description?: string;
  redeem_instructions?: string;
  currency: string;
  /** The face value (the price shown on stores), minor units. */
  face_value: number;
  /** What BitoCard paid for one code, minor units of the same currency. */
  cost: number;
  /** BitoCard's margin on cost for this product (a product pricing rule); without it the category or default rule applies. */
  margin_bps?: number;
  image_url?: string;
  listed?: boolean;
  codes?: StockCodeInput[];
};

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such stock item.');
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

type Item = SupplierProduct & { product: Product };
/** What a stock offer keeps in `meta`: the exact cost per code, whether an admin paused sales, and a licence's term. */
type StockMeta = { cost_minor: number; paused?: boolean; duration_months?: number };

/** Cost per unit of face value: the exact cost spread over the single face value, rounded up so it is never under cost. */
const costRatio = (cost: number, face: bigint) => new Prisma.Decimal(cost).div(face.toString()).toDecimalPlaces(10, Prisma.Decimal.ROUND_UP);
const metaOf = (item: SupplierProduct) => (item.meta ?? { cost_minor: 0 }) as StockMeta;

/**
 * BitoCard's own stock: products an admin adds by hand (software licences, gift cards) with the codes BitoCard has
 * bought. Each is a `stock` supplier offer on a BitoCard product, so it is priced, quoted, ordered and listed like any
 * supplier's: resellers sell it through the API and their stores, and bitocard.com once it is listed. Codes are
 * encrypted and never shown to admins; each is handed over once, to the order that claims it (`StockAdapter`).
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private key() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return this.config.ENCRYPTION_KEY;
  }

  /** How many codes each item has, by status. */
  private async counts(offerIds: string[]) {
    const rows = await this.prisma.stockCode.groupBy({ by: ['offerId', 'status'], where: { offerId: { in: offerIds } }, _count: { _all: true } });
    return (offerId: string, status: StockCodeStatus) => rows.find(row => row.offerId === offerId && row.status === status)?._count._all ?? 0;
  }

  private async present(item: Item, loaded?: { rules: Map<string, PricingRule>; count: (offerId: string, status: StockCodeStatus) => number }) {
    const count = loaded?.count ?? (await this.counts([item.id]));
    const rule = loaded ? loaded.rules.get(item.productId) : await this.prisma.pricingRule.findFirst({ where: { productId: item.productId, category: null, countryCode: null } });
    const { product } = item;
    return {
      object: 'stock_item' as const,
      id: item.id,
      product: {
        id: product.id,
        key: product.key,
        category: product.category,
        country: product.country,
        brand: product.brand,
        name: product.name,
        description: product.description,
        redeem_instructions: product.redeemInstructions,
        image_url: product.imageUrl,
        face_currency: product.faceCurrency,
        face_value: Number(product.fixedValues[0] ?? 0n),
        active: product.active,
        listed: product.listed,
      },
      currency: item.costCurrency,
      /** Software: the licence term in months (0 for lifetime); null for gift cards. */
      duration_months: metaOf(item).duration_months ?? null,
      /** What BitoCard paid for one code. */
      cost: metaOf(item).cost_minor,
      /** This product's own margin rule, or null when the category or default rule applies. */
      margin_bps: rule?.marginBps ?? null,
      /** On sale: there are codes left and an admin has not paused it. */
      on_sale: item.available,
      paused: metaOf(item).paused === true,
      codes: { available: count(item.id, 'available'), sold: count(item.id, 'sold'), withdrawn: count(item.id, 'withdrawn') },
      created_at: item.syncedAt.toISOString(),
    };
  }

  private async load(id: string) {
    const item = await this.prisma.supplierProduct.findFirst({ where: { id, supplierCode: stockSupplier }, include: { product: true } });
    if (!item) throw notFound();
    return item;
  }

  async list(filter: { category?: StockCategory; q?: string }) {
    const items = await this.prisma.supplierProduct.findMany({
      where: {
        supplierCode: stockSupplier,
        product: {
          category: filter.category,
          ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: 'insensitive' } }, { brand: { contains: slug(filter.q) } }] } : {}),
        },
      },
      include: { product: true },
      orderBy: { syncedAt: 'desc' },
      take: 200,
    });
    const rules = await this.prisma.pricingRule.findMany({ where: { productId: { in: items.map(item => item.productId) }, category: null, countryCode: null } });
    const loaded = { rules: new Map(rules.map(rule => [rule.productId!, rule])), count: await this.counts(items.map(item => item.id)) };
    return { object: 'list' as const, data: await Promise.all(items.map(item => this.present(item, loaded))) };
  }

  async get(id: string) {
    return this.present(await this.load(id));
  }

  /** A brand must be set up first (Catalog > Brands) or known to the brand registry, so the store shows it properly. */
  private async knownBrand(input: string) {
    const brand = slug(input);
    if (registryBrand(brand)) return brand;
    if (await this.prisma.brand.findUnique({ where: { slug: brand } })) return brand;
    if (await this.prisma.product.findFirst({ where: { brand }, select: { id: true } })) return brand;
    throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'brand_unknown', 'Add this brand under Catalog > Brands first, then choose it here.', 'brand');
  }

  /**
   * Adds a product to BitoCard's stock, with any codes. Software is global (country `WW`, sold in every market where
   * software is on) and has a licence term, which is part of the product: the same title for another term is another
   * product. The product key is built from the category, country, brand, title (and term); if a product with that key
   * already exists (from a supplier) with the same single face value, the stock is added to it as another source,
   * otherwise the key is refused.
   */
  async create(actorId: string | null, input: StockItemInput) {
    const software = input.category === 'software';
    if (!software && !input.country) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Choose the region where the gift card works.', 'country');
    if (software && input.duration_months === undefined) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Choose the licence term (0 for lifetime).', 'duration_months');
    }
    if (!software && input.duration_months !== undefined) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Only software licences have a term.', 'duration_months');
    }
    const country = software ? worldwideCountry : input.country!.toUpperCase();
    const currency = input.currency.toUpperCase();
    const brand = await this.knownBrand(input.brand);
    const term = software ? durationLabel(input.duration_months!) : null;
    const key = `${input.category}:${country}:${brand}:${slug(input.title, [input.brand, brand])}${software ? `-${input.duration_months === 0 ? 'lifetime' : `${input.duration_months}m`}` : ''}`;
    const name = term ? `${input.title.trim()} (${term})` : input.title.trim();
    const face = BigInt(input.face_value);
    const existing = await this.prisma.product.findUnique({ where: { key }, include: { supplierProducts: { where: { supplierCode: stockSupplier } } } });
    if (existing) {
      if (existing.supplierProducts.length) throw conflict('stock_item_exists', `${existing.name} is already in stock. Add codes to it instead.`, 'title');
      const same = existing.category === input.category && existing.faceCurrency === currency && existing.denominationType === 'fixed' && existing.fixedValues.length === 1 && existing.fixedValues[0] === face;
      if (!same) throw conflict('product_exists', `A different product already uses the key ${key}. Change the title.`, 'title');
    }
    const offerId = randomUUID();
    await this.prisma.$transaction(async tx => {
      const product =
        existing ??
        (await tx.product.create({
          data: {
            key,
            category: input.category,
            country,
            brand,
            name,
            faceCurrency: currency,
            denominationType: 'fixed',
            fixedValues: [face],
            recipientType: 'none',
            description: input.description?.trim() || null,
            redeemInstructions: input.redeem_instructions?.trim() || null,
            imageUrl: input.image_url ?? null,
            ...(input.listed ? { listed: true, listedAt: new Date() } : {}),
          },
        }));
      await tx.supplierProduct.create({
        data: {
          id: offerId,
          supplierCode: stockSupplier,
          productId: product.id,
          sku: offerId,
          costCurrency: currency,
          costRatio: costRatio(input.cost, face),
          costFeeMinor: 0n,
          meta: { cost_minor: input.cost, ...(software ? { duration_months: input.duration_months } : {}) } satisfies StockMeta,
          available: false,
          syncedAt: new Date(),
        },
      });
      if (input.margin_bps !== undefined) await this.setMargin(tx, product.id, input.margin_bps);
    });
    const added = input.codes?.length ? await this.insertCodes(actorId, offerId, input.codes) : { added: 0, duplicates: 0 };
    const item = await this.get(offerId);
    await this.audit.record({ actorId, action: 'stock.created', targetType: 'stock_item', targetId: offerId, after: { ...item, codes_added: added.added } });
    return { ...item, added: added.added, duplicates: added.duplicates };
  }

  /** A product-only pricing rule (null removes it, so the category or default rule applies again). */
  private async setMargin(tx: Prisma.TransactionClient, productId: string, marginBps: number | null) {
    const scope = { productId, category: null, countryCode: null };
    const rule = await tx.pricingRule.findFirst({ where: scope });
    if (marginBps === null) {
      if (rule) await tx.pricingRule.delete({ where: { id: rule.id } });
    } else if (rule) {
      await tx.pricingRule.update({ where: { id: rule.id }, data: { marginBps } });
    } else {
      await tx.pricingRule.create({ data: { ...scope, marginBps } });
    }
  }

  async update(actorId: string | null, id: string, input: { cost?: number; margin_bps?: number | null; on_sale?: boolean }) {
    const before = await this.get(id);
    const offer = await this.load(id);
    const meta: StockMeta = { ...metaOf(offer), ...(input.cost !== undefined ? { cost_minor: input.cost } : {}), ...(input.on_sale !== undefined ? { paused: !input.on_sale } : {}) };
    await this.prisma.$transaction(async tx => {
      await tx.supplierProduct.update({ where: { id }, data: { meta, ...(input.cost !== undefined ? { costRatio: costRatio(input.cost, BigInt(before.product.face_value)) } : {}) } });
      if (input.margin_bps !== undefined) await this.setMargin(tx, before.product.id, input.margin_bps);
    });
    await this.refreshAvailability(id);
    const after = await this.get(id);
    await this.audit.record({ actorId, action: 'stock.updated', targetType: 'stock_item', targetId: id, before, after });
    return after;
  }

  /** On sale while there are codes left, unless an admin paused it. */
  private async refreshAvailability(offerId: string) {
    const offer = await this.prisma.supplierProduct.findUniqueOrThrow({ where: { id: offerId } });
    const paused = metaOf(offer).paused === true;
    const left = await this.prisma.stockCode.count({ where: { offerId, status: 'available' } });
    const available = !paused && left > 0;
    if (offer.available !== available) await this.prisma.supplierProduct.update({ where: { id: offerId }, data: { available } });
  }

  /** Encrypts and stores codes, skipping any already stocked (here or under another item). Never audits the codes. */
  private async insertCodes(actorId: string | null, offerId: string, codes: StockCodeInput[]) {
    const key = this.key();
    const encryption = new Encryption(key);
    const unique = new Map<string, StockCodeInput>();
    for (const entry of codes) {
      const code = entry.code.trim();
      if (code) unique.set(stockCodeHash(key, code), { code, pin: entry.pin?.trim() || undefined });
    }
    const taken = new Set((await this.prisma.stockCode.findMany({ where: { codeHash: { in: [...unique.keys()] } }, select: { codeHash: true } })).map(row => row.codeHash));
    const fresh = [...unique].filter(([hash]) => !taken.has(hash));
    const created = fresh.length
      ? await this.prisma.stockCode.createMany({
          data: fresh.map(([hash, entry]) => ({
            offerId,
            codeEncrypted: encryption.encrypt(entry.code),
            pinEncrypted: entry.pin ? encryption.encrypt(entry.pin) : null,
            codeHash: hash,
            hint: entry.code.slice(-4),
            addedById: actorId,
          })),
          skipDuplicates: true,
        })
      : { count: 0 };
    await this.refreshAvailability(offerId);
    return { added: created.count, duplicates: codes.length - created.count };
  }

  async addCodes(actorId: string | null, id: string, codes: StockCodeInput[]) {
    await this.load(id);
    const result = await this.insertCodes(actorId, id, codes);
    await this.audit.record({ actorId, action: 'stock.codes_added', targetType: 'stock_item', targetId: id, after: result });
    return { ...(await this.get(id)), ...result };
  }

  /** The item's codes, newest first: only the last four characters, and the order each sold to. */
  async codes(id: string, filter: { status?: StockCodeStatus; limit?: number; starting_after?: string }) {
    await this.load(id);
    const limit = filter.limit ?? 50;
    const rows = await this.prisma.stockCode.findMany({
      where: { offerId: id, status: filter.status },
      orderBy: { seq: 'desc' },
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const references = rows.flatMap(row => (row.orderReference ? [row.orderReference] : []));
    const orders = references.length ? await this.prisma.order.findMany({ where: { supplierReference: { in: references } }, select: { id: true, supplierReference: true } }) : [];
    const orderOf = new Map(orders.map(order => [order.supplierReference, order.id]));
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map(row => ({
        object: 'stock_code' as const,
        id: row.id,
        hint: row.hint,
        has_pin: row.pinEncrypted !== null,
        status: row.status,
        order_id: row.orderReference ? (orderOf.get(row.orderReference) ?? null) : null,
        created_at: row.createdAt.toISOString(),
        sold_at: row.soldAt?.toISOString() ?? null,
        withdrawn_at: row.withdrawnAt?.toISOString() ?? null,
      })),
      has_more: rows.length > limit,
    };
  }

  /** Takes an unsold code out of stock (a faulty or mistyped key). Sold codes cannot be withdrawn. */
  async withdrawCode(actorId: string | null, id: string, codeId: string, reason: string) {
    await this.load(id);
    const result = await this.prisma.stockCode.updateMany({ where: { id: codeId, offerId: id, status: 'available' }, data: { status: 'withdrawn', withdrawnAt: new Date() } });
    if (result.count === 0) throw conflict('stock_code_unavailable', 'Only codes still in stock can be withdrawn.');
    await this.refreshAvailability(id);
    await this.audit.record({ actorId, action: 'stock.code_withdrawn', targetType: 'stock_item', targetId: id, after: { code_id: codeId, reason } });
    return this.get(id);
  }
}
