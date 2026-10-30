import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { featureValueOut, invalid } from '../classifieds/rules.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Section, Sections } from '../storefront/layout.js';
import { type ResaleStoreRef, StorefrontService } from '../storefront/storefront.service.js';
import { StoreHomeService } from '../stores/store-home.service.js';
import { templateFor } from '../stores/templates.js';
import { ResaleStoresService } from './resale-stores.service.js';

const unavailable = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'store_unavailable', 'This store is not open.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
type Sort = 'newest' | 'price_asc' | 'price_desc';
type OnSale = Awaited<ReturnType<ResaleStoresService['onSale']>>[number];

/** Lower case, letters and digits separated by single spaces, padded, so phrases match whole words. */
const words = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/**
 * B2B reselling, stage 3 (`docs/BITOCARD_B2B_RESELLING_PLAN.md`): a Resale shop's own pages. Public reads for the store
 * (its listings on sale, one listing as the supplier wrote it with the reseller's price and approved note, the
 * supplier's page with no price, its categories), the template's sections and hero, filled for the storefront, and the
 * check that the store's own words never claim to own, make or stock what it resells. Every listing names its supplier:
 * the supplier is part of each listing returned here, never a section a design could leave out.
 */
@Injectable()
export class ResaleShopService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: ResaleStoresService,
    private readonly storefront: StorefrontService,
    private readonly home: StoreHomeService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.storefront.useResale({ section: (store, item) => this.section(store, item), hero: store => this.hero(store) });
    this.home.useTextCheck((template, sections) => this.checkClaims(template, sections));
  }

  // ---- The store ----

  /** A published Resale shop of a reseller who is not suspended, and the country it sells in (null: it sells nothing now). */
  private async store(subdomain: string) {
    const store = await this.prisma.store.findUnique({ where: { subdomain }, include: { reseller: { select: { status: true, country: true, house: true } } } });
    if (!store || store.status !== 'published' || store.reseller.status === 'suspended' || store.reseller.house || !store.reseller.country || !templateFor(store.template)?.resale) throw unavailable();
    return { id: store.id, resellerId: store.resellerId, country: store.reseller.country, selling: await this.stores.canResell(store.resellerId) };
  }

  private async categoryIds(slug: string | undefined) {
    if (!slug) return undefined;
    const category = await this.prisma.classifiedCategory.findUnique({ where: { slug }, select: { id: true, children: { select: { id: true } } } });
    return category ? [category.id, ...category.children.map(child => child.id)] : [];
  }

  private async onSale(store: ResaleStoreRef & { selling?: string | null }, filter: { category?: string; q?: string; listingRef?: bigint } = {}) {
    // A reseller who can no longer resell (switched off, unverified) has nothing on sale.
    const selling = store.selling !== undefined ? store.selling : await this.stores.canResell(store.resellerId);
    if (!selling) return [];
    return this.stores.onSale(store.id, store.country, { categoryIds: await this.categoryIds(filter.category), q: filter.q, listingRef: filter.listingRef });
  }

  private sorted(items: OnSale[], sort: Sort) {
    if (sort === 'newest') return items;
    return [...items].sort((a, b) => (a.price === b.price ? 0 : (a.price < b.price) === (sort === 'price_asc') ? -1 : 1));
  }

  /** A listing as the store's pages show it: the supplier's words and photos, the reseller's price, the approved note and the supplier. */
  private async cards(items: OnSale[]) {
    const ids = items.map(item => item.row.listingId);
    const [checked, extra] = await Promise.all([
      this.stores.idChecked(items.map(item => item.row.listing.customerId)),
      this.prisma.classifiedListing.findMany({ where: { id: { in: ids } }, select: { id: true, _count: { select: { media: { where: { kind: 'photo', status: 'ready' } } } } } }),
    ]);
    const photos = new Map(extra.map(row => [row.id, row._count.media]));
    return items.map(item => {
      const listing = item.row.listing;
      const cover = listing.media[0];
      return {
        object: 'resale_store_listing' as const,
        id: item.row.id,
        ref: Number(listing.ref),
        slug: listing.slug ?? 'listing',
        title: listing.title ?? '',
        cover: cover ? { url: cover.url, width: cover.width, height: cover.height } : null,
        photo_count: photos.get(listing.id) ?? 0,
        currency: listing.currency,
        price: Number(item.price),
        condition: listing.condition,
        category: listing.category ? { slug: listing.category.slug, name: listing.category.name } : null,
        area: listing.area ? { name: listing.area.name, state: listing.area.parent?.name ?? null } : null,
        delivery: listing.delivery,
        available: item.left,
        /** The reseller's note, only once the supplier approved these exact words. */
        note: item.row.noteStatus === 'approved' ? item.row.note : null,
        /** Who supplies it: always shown with the listing, linking to their page on this store. */
        supplier: { ...this.stores.supplier(listing.customer, checked), id: item.row.relationshipId },
      };
    });
  }

  // ---- Public reads (`/v1/store/resale`) ----

  async listings(subdomain: string, query: { category?: string; q?: string; sort?: Sort; offset?: number; limit?: number }) {
    const store = await this.store(subdomain);
    const items = this.sorted(await this.onSale(store, { category: query.category, q: query.q }), query.sort ?? 'newest');
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 24;
    return { object: 'list' as const, data: await this.cards(items.slice(offset, offset + limit)), total: items.length, offset, limit };
  }

  /** One listing on sale here, as its supplier wrote it, with the store's price and how the buyer's payment is protected. */
  /**
   * The store's home page (Udozo): what its owner published in Seller HQ, else its design's starting page, with the
   * template's sections filled in (its listings, rails and categories). A preview link's token shows the draft.
   */
  async homePage(subdomain: string, previewToken?: string) {
    await this.store(subdomain);
    return this.storefront.inStore(subdomain, undefined, () => this.storefront.storeHome(previewToken));
  }

  async listing(subdomain: string, ref: number) {
    const store = await this.store(subdomain);
    const [item] = await this.onSale(store, { listingRef: BigInt(ref) });
    if (!item) throw notFound('listing');
    const [card] = await this.cards([item]);
    const detail = await this.prisma.classifiedListing.findUniqueOrThrow({
      where: { id: item.row.listingId },
      select: {
        description: true,
        category: { select: { safetyChecklist: true, parent: { select: { safetyChecklist: true } }, features: { select: { featureId: true, position: true } } } },
        features: { include: { feature: true } },
        media: { where: { status: 'ready' }, orderBy: [{ kind: 'asc' }, { position: 'asc' }], select: { kind: true, url: true, width: true, height: true, posterUrl: true, durationMs: true } },
      },
    });
    const order = new Map((detail.category?.features ?? []).map(link => [link.featureId, link.position]));
    const video = detail.media.find(media => media.kind === 'video');
    const checklist = detail.category?.safetyChecklist.length ? detail.category.safetyChecklist : (detail.category?.parent?.safetyChecklist ?? []);
    return {
      ...card,
      object: 'resale_store_listing_detail' as const,
      description: detail.description,
      features: detail.features
        .filter(value => value.feature.enabled)
        .sort((a, b) => (order.get(a.featureId) ?? 1000) - (order.get(b.featureId) ?? 1000) || a.feature.name.localeCompare(b.feature.name))
        .map(value => ({ key: value.feature.key, name: value.feature.name, unit: value.feature.unit, value: featureValueOut(value.feature.dataType, value) })),
      photos: detail.media.filter(media => media.kind === 'photo').map(media => ({ url: media.url, width: media.width, height: media.height })),
      video: video ? { url: video.url, poster_url: video.posterUrl, duration_ms: video.durationMs } : null,
      safety_checklist: checklist,
      /** The buyer's Safe pay fee, paid on top of the price. */
      buyer_fee: Number(item.sums.buyerFee),
      supplier: { ...card.supplier, member_since: item.row.listing.customer.createdAt.toISOString() },
    };
  }

  /**
   * The supplier's page on this store: who they are (checked identity, member since, completed sales) and, when a
   * listing is named, that listing exactly as they wrote it, with no price, so a buyer can see the store added nothing.
   */
  async supplier(subdomain: string, relationshipId: string, ref?: number) {
    const store = await this.store(subdomain);
    const relationship = await this.prisma.resaleRelationship.findFirst({
      where: { id: relationshipId, resellerId: store.resellerId, supplierBlockedAt: null },
      select: { id: true, supplier: { select: { id: true, name: true, createdAt: true, phoneVerifiedAt: true } } },
    });
    if (!relationship) throw notFound('supplier');
    const here = (await this.onSale(store)).filter(item => item.row.relationshipId === relationship.id);
    if (!here.length) throw notFound('supplier');
    const [checked, sales] = await Promise.all([
      this.stores.idChecked([relationship.supplier.id]),
      this.prisma.classifiedOrder.count({ where: { sellerId: relationship.supplier.id, status: 'released' } }),
    ]);
    let listing = null;
    if (ref !== undefined) {
      const item = here.find(row => Number(row.row.listing.ref) === ref);
      if (!item) throw notFound('listing');
      const row = await this.prisma.classifiedListing.findUniqueOrThrow({
        where: { id: item.row.listingId },
        select: {
          ref: true,
          title: true,
          description: true,
          condition: true,
          category: { select: { slug: true, name: true } },
          area: { select: { name: true, parent: { select: { name: true } } } },
          features: { include: { feature: true } },
          media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, select: { url: true, width: true, height: true } },
        },
      });
      listing = {
        ref: Number(row.ref),
        title: row.title ?? '',
        description: row.description,
        condition: row.condition,
        category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
        area: row.area ? { name: row.area.name, state: row.area.parent?.name ?? null } : null,
        features: row.features.filter(value => value.feature.enabled).map(value => ({ key: value.feature.key, name: value.feature.name, unit: value.feature.unit, value: featureValueOut(value.feature.dataType, value) })),
        photos: row.media.map(media => ({ url: media.url, width: media.width, height: media.height })),
      };
    }
    const area = here[0].row.listing.area;
    return {
      object: 'resale_store_supplier' as const,
      ...this.stores.supplier(relationship.supplier, checked),
      // The relationship's ID, never the supplier's own account ID.
      id: relationship.id,
      area: area ? { name: area.name, state: area.parent?.name ?? null } : null,
      completed_sales: sales,
      listings_here: here.length,
      listing,
    };
  }

  /** The categories this store has listings on sale in, each with its count and one listing's photo. */
  async categories(subdomain: string, limit = 12) {
    const store = await this.store(subdomain);
    return { object: 'list' as const, data: await this.categoryTiles(store, limit) };
  }

  private async categoryTiles(store: ResaleStoreRef & { selling?: string | null }, limit: number) {
    const tiles = new Map<string, { slug: string; name: string; count: number; cover: { url: string; width: number | null; height: number | null } | null }>();
    for (const item of await this.onSale(store)) {
      const category = item.row.listing.category;
      if (!category) continue;
      const tile = tiles.get(category.slug) ?? { slug: category.slug, name: category.name, count: 0, cover: null };
      tile.count += 1;
      tile.cover ??= item.row.listing.media[0]?.url ? { url: item.row.listing.media[0].url!, width: item.row.listing.media[0].width, height: item.row.listing.media[0].height } : null;
      tiles.set(category.slug, tile);
    }
    return [...tiles.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
  }

  // ---- The template's sections (through the storefront) ----

  private async section(store: ResaleStoreRef, item: Section) {
    switch (item.type) {
      case 'listing_rail': {
        const items = await this.onSale(store, { category: item.source === 'category' ? item.category : undefined });
        const chosen = this.sorted(items, item.source === 'price_low' ? 'price_asc' : 'newest').slice(0, item.limit);
        return { listings: await this.cards(chosen), total: items.length };
      }
      case 'listing_grid': {
        const items = this.sorted(await this.onSale(store, { category: item.category }), item.sort);
        return { listings: await this.cards(items.slice(0, item.limit)), total: items.length };
      }
      case 'resale_categories':
        return { categories: await this.categoryTiles(store, item.limit) };
      default:
        return null;
    }
  }

  private async hero(store: ResaleStoreRef) {
    const items = await this.onSale(store);
    return { listings: await this.cards(items.slice(0, 6)), categories: await this.categoryTiles(store, 8) };
  }

  // ---- The store's own words ----

  /** Every free-text field of a page, with where it is (for `param`). */
  private texts(sections: Sections) {
    const out: Array<{ path: string; text: string }> = [];
    const add = (path: string, text: string | undefined) => {
      if (text) out.push({ path, text });
    };
    sections.forEach((section, index) => {
      const at = `sections[${index}]`;
      const any = section as Record<string, unknown>;
      for (const key of ['title', 'accent', 'subtitle', 'body']) add(`${at}.${key}`, typeof any[key] === 'string' ? (any[key] as string) : undefined);
      if (section.type === 'promo') {
        section.bullets.forEach((bullet, i) => add(`${at}.bullets[${i}]`, bullet));
        add(`${at}.cta.label`, section.cta?.label);
      }
      if (section.type === 'features' || section.type === 'trust_bar') section.items.forEach((entry, i) => (add(`${at}.items[${i}].title`, entry.title), add(`${at}.items[${i}].body`, entry.body)));
      if (section.type === 'faq') section.items.forEach((entry, i) => (add(`${at}.items[${i}].question`, entry.question), add(`${at}.items[${i}].answer`, entry.answer)));
    });
    return out;
  }

  /** A Resale shop's words may not claim to own, make or stock the items it resells (`store_text_refused`). */
  async checkClaims(template: string, sections: Sections) {
    if (!templateFor(template)?.resale) return;
    const phrases = await this.prisma.resaleClaimPhrase.findMany({ select: { phrase: true } });
    for (const { path, text } of this.texts(sections)) {
      const found = phrases.find(row => words(text).includes(` ${row.phrase} `));
      if (found) {
        throw invalid('store_text_refused', `A Resale shop sells its suppliers' items, so its words cannot claim to own, make or stock them (“${found.phrase}”).`, path);
      }
    }
  }

  // ---- Admins: the phrases ----

  async phrases() {
    const rows = await this.prisma.resaleClaimPhrase.findMany({ orderBy: { phrase: 'asc' } });
    return { object: 'list' as const, data: rows.map(row => ({ object: 'resale_claim_phrase' as const, id: row.id, phrase: row.phrase, created_at: row.createdAt.toISOString() })) };
  }

  async addPhrase(actorId: string | null, raw: string) {
    const phrase = words(raw).trim();
    if (phrase.length < 3 || phrase.length > 80) throw invalid('parameter_invalid', 'A phrase has 3 to 80 letters.', 'phrase');
    const existing = await this.prisma.resaleClaimPhrase.findUnique({ where: { phrase } });
    const row = existing ?? (await this.prisma.resaleClaimPhrase.create({ data: { phrase } }));
    if (!existing) await this.audit.record({ actorId, action: 'classifieds.resale_phrase_added', targetType: 'resale_claim_phrase', targetId: row.id, before: null, after: { phrase } });
    return { object: 'resale_claim_phrase' as const, id: row.id, phrase: row.phrase, created_at: row.createdAt.toISOString() };
  }

  async removePhrase(actorId: string | null, id: string) {
    const row = await this.prisma.resaleClaimPhrase.findUnique({ where: { id } });
    if (!row) throw notFound('phrase');
    await this.prisma.resaleClaimPhrase.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'classifieds.resale_phrase_removed', targetType: 'resale_claim_phrase', targetId: id, before: { phrase: row.phrase }, after: null });
    return { object: 'resale_claim_phrase' as const, id, deleted: true as const };
  }
}
