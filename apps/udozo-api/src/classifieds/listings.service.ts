import { HttpStatus, Injectable } from '@nestjs/common';
import { PostingJourneysService } from '../postings/journeys.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { MediaStorage } from '../media/storage.js';
import { InboxService } from '../notifications/inbox.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { WatermarkService } from '../watermarks/watermarks.service.js';
import { ClassifiedBrandsService } from './brands.service.js';
import { connectInclude, type ConnectChanges, type ConnectInput, ListingShippingService } from './connect-shipping.service.js';
import { ClassifiedModelsService } from './models.service.js';
import { ModerationService, type ReviewFlag } from './moderation.service.js';
import { ResaleService } from './resale.service.js';
import { ShopTermsService } from './terms.service.js';
import {
  brandFeatureKey,
  modelFeatureKey,
  checkDescription,
  checkFeatureValue,
  checkTitle,
  type conditions,
  type contacts,
  type deliveries,
  featureValueOut,
  formatSku,
  heldUnits,
  invalid,
  type ListingStatus,
  maxFeatures,
  maxPriceMinor,
  maxStock,
  type priceKinds,
  slugify,
} from './rules.js';
import { liveUntil, outOfStockDays, stockChange } from './stock.js';

export type ListingInput = ConnectInput & {
  category_id?: string | null;
  area_id?: string | null;
  title?: string | null;
  description?: string | null;
  price_kind?: (typeof priceKinds)[number];
  price?: number | null;
  condition?: (typeof conditions)[number] | null;
  delivery?: (typeof deliveries)[number];
  /** Handed over in person (with the buyer's release code). At least one of pickup and delivery. */
  pickup?: boolean;
  /** The delivery charge within the seller's state and elsewhere, in minor units (0: free). */
  delivery_fee_state?: number;
  delivery_fee_nationwide?: number;
  contact?: (typeof contacts)[number];
  features?: { key: string; value: unknown }[];
  /** Sold on BitoCard Shop itself (default), and/or open to resellers' stores: at least one. */
  on_shop?: boolean;
  resale?: boolean;
  resale_discount_bps?: number | null;
  resale_markup_max_bps?: number | null;
  /** Pause or resume reselling (stores stop selling it while paused). */
  resale_paused?: boolean;
  /** Units to sell, shared by every channel. */
  stock?: number;
  /** Sold at its price (fixed) or by auction: then its price is the starting price, with an optional hidden reserve and a length. */
  sale_method?: 'fixed' | 'auction';
  auction_reserve?: number | null;
  auction_days?: number | null;
};

/** What the auctions service does around a listing's life (registered by it, so this file never imports it). */
export type ListingAuctionHooks = {
  beforeSubmit(customer: CustomerWithStore, listing: { saleMethod: string; country: string }): Promise<void>;
  live(listingId: string): Promise<unknown>;
  running(listingId: string): Promise<{ id: string; bids: { id: string }[] } | null>;
};
/** How long an auction listing runs, in days. */
const auctionLengths = [1, 3, 5, 7, 10];

const dayMs = 86_400_000;
/** A listing can be renewed from this long before it expires (and any time after). */
export const renewWindowMs = 3 * dayMs;
/** The limit on new listings counts those submitted in the last 30 days. */
const limitWindowMs = 30 * dayMs;

/** What submitting an ad needs filled in. */
export type ListingParts = { categoryId: string | null; areaId: string | null; title: string | null; condition: string | null; priceKind: string; priceMinor: bigint | null; saleMethod?: string; auctionDays?: number | null };

/** What a draft still lacks before it can be submitted (photos apart), as the field and how a seller reads it. */
export function missingParts(listing: ListingParts): [string, string][] {
  const missing: [string, string][] = [];
  if (!listing.title) missing.push(['title', 'a title']);
  if (!listing.categoryId) missing.push(['category_id', 'a category']);
  if (!listing.condition) missing.push(['condition', 'its condition']);
  if (listing.priceKind !== 'on_request' && listing.priceMinor === null) missing.push(['price', listing.saleMethod === 'auction' ? 'a starting price' : 'a price']);
  if (listing.saleMethod === 'auction' && !listing.auctionDays) missing.push(['auction_days', 'how long the auction runs']);
  if (!listing.areaId) missing.push(['area_id', 'where it is']);
  return missing;
}

const defaults = { listingDays: 30, monthlyListingLimit: 10, firstListingsReviewed: 3, minPhotos: 4, maxPhotos: 12, usernameMinListings: 5, buyRequestHours: 48, buyMeetDays: 7, buyOpenPerBuyer: 10, buyRequestsPerDay: 20, reviewsNeutral: false, reviewWindowDays: 30, reviewMinShown: 3, unfinishedReminderHours: 24, readyReminder1Hours: 24, readyReminder2Hours: 72, readyReminder3Hours: 168, wantedOpenPerBuyer: 3, wantedPerDay: 5, wantedSellersPerRequest: 30, wantedNoticesPerSellerDay: 20 };

const listingInclude = {
  category: { include: { parent: true } },
  area: { include: { parent: true } },
  features: { include: { feature: true } },
  media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
  ...connectInclude,
} satisfies Prisma.ClassifiedListingInclude;

type ListingRow = Prisma.ClassifiedListingGetPayload<{ include: typeof listingInclude }>;
type ListingFields = {
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  condition?: string | null;
  delivery?: string;
  pickup?: boolean;
  deliveryFeeStateMinor?: bigint;
  deliveryFeeNationwideMinor?: bigint;
  contact?: string;
  categoryId?: string | null;
  areaId?: string | null;
  stateId?: string | null;
  priceKind?: string;
  priceMinor?: bigint | null;
  onShop?: boolean;
  resale?: boolean;
  resaleDiscountBps?: number | null;
  resaleMarkupMaxBps?: number | null;
  resalePausedAt?: Date | null;
  stock?: number;
  connect?: boolean;
  connectAllCentres?: boolean;
  saleMethod?: string;
  auctionReserveMinor?: bigint | null;
  auctionDays?: number | null;
};

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/** Where a listing is public. */
export const shopOrigin = 'https://udozo.com';

/**
 * BitoCard Shop's listings, from the seller's side: drafts saved as they go, checked against the feature registry,
 * categories and areas of their own (fixed) country, submitted for the market (a new seller's first listings to review),
 * renewed, marked sold and deleted. Only bitocard.com accounts with a confirmed email sell, and only where the
 * `classifieds` switch is on for their country.
 */
@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: MediaStorage,
    private readonly moderation: ModerationService,
    private readonly terms: ShopTermsService,
    private readonly resale: ResaleService,
    private readonly brands: ClassifiedBrandsService,
    private readonly models: ClassifiedModelsService,
    private readonly watermarks: WatermarkService,
    private readonly postings: PostingJourneysService,
    private readonly inbox: InboxService,
    private readonly shipping: ListingShippingService,
  ) {}

  private auctions?: ListingAuctionHooks;

  /** The auctions service registers what it does when an auction listing is submitted and goes live. */
  useAuctions(hooks: ListingAuctionHooks) {
    this.auctions = hooks;
  }

  /** An auction running with bids fixes its listing's price, reserve and length, and it cannot be sold another way. */
  private async requireNoBids(listingId: string, message: string) {
    const lot = await this.auctions?.running(listingId);
    if (lot?.bids.length) throw conflict('auction_has_bids', message);
    return lot;
  }

  /** The seller's country, once they may sell there. */
  async sellerCountry(customer: CustomerWithStore) {
    if (!customer.store.reseller.house) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'classifieds_unavailable', 'Sign in with your Udozo account.');
    }
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
    if (!customer.country) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_required', 'Choose your country on your account first.');
    }
    await this.requireOpen(customer.country);
    await this.moderation.requireNotSuspended(customer.id);
    return customer.country;
  }

  /** `classifieds_unavailable` unless BitoCard Shop is open in the country. */
  async requireOpen(country: string) {
    if (!(await this.settings.isOnForCountry('classifieds', country))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'classifieds_unavailable', 'Udozo is not open in this country yet.');
    }
  }

  async marketSettings(country: string) {
    return (await this.prisma.classifiedMarketSettings.findUnique({ where: { country } })) ?? { country, ...defaults };
  }

  private async own(customer: CustomerWithStore, id: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id }, include: listingInclude });
    if (!listing || listing.customerId !== customer.id || listing.status === 'deleted') throw notFound();
    return listing;
  }

  async get(customer: CustomerWithStore, id: string) {
    await this.sellerCountry(customer);
    return this.present(await this.own(customer, id));
  }

  async list(customer: CustomerWithStore, filter: { status?: ListingStatus; limit?: number; starting_after?: string }) {
    await this.sellerCountry(customer);
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.classifiedListing.findMany({
      where: { customerId: customer.id, status: filter.status ?? { not: 'deleted' } },
      include: listingInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => this.present(row)), has_more: rows.length > limit };
  }

  async create(customer: CustomerWithStore, input: ListingInput) {
    const country = await this.sellerCountry(customer);
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: country } });
    const data = await this.changes(country, input, null);
    const created = await this.prisma.$transaction(async tx => {
      const sku = data.fields.categoryId ? await this.issueSku(tx, data.fields.categoryId) : null;
      const listing = await tx.classifiedListing.create({ data: { customerId: customer.id, country, currency: market.currency, ...data.fields, sku } });
      if (data.features) await tx.classifiedListingFeature.createMany({ data: data.features.map(value => ({ listingId: listing.id, ...value })) });
      await this.shipping.write(tx, listing.id, data.connect);
      await this.refreshSearch(tx, listing.id);
      return listing;
    });
    return this.present(await this.own(customer, created.id));
  }

  async update(customer: CustomerWithStore, id: string, input: ListingInput) {
    const country = await this.sellerCountry(customer);
    const listing = await this.own(customer, id);
    // An expired listing can only be restocked (then renewed); anything else past live is closed.
    const sent = Object.entries(input).filter(([, value]) => value !== undefined).map(([key]) => key);
    const restocking = listing.status === 'expired' && sent.length === 1 && sent[0] === 'stock';
    if (!['draft', 'pending_review', 'active', 'rejected'].includes(listing.status) && !restocking) throw conflict('listing_closed', 'This listing can no longer be changed.');
    const data = await this.changes(country, input, listing);
    if (listing.status !== 'draft' && !restocking) {
      this.requireComplete({ ...listing, ...data.fields });
      // Opening a submitted listing to resellers needs what submitting one does.
      if (data.fields.resale && !listing.resale) {
        await this.terms.require(customer.id);
        await this.resale.requireSupplier(customer, country);
      }
    }
    const listingDays = data.fields.stock !== undefined && listing.status !== 'draft' ? (await this.marketSettings(country)).listingDays : 0;
    await this.prisma.$transaction(async tx => {
      if (data.fields.stock !== undefined && listing.status !== 'draft') {
        // Units paid for and waiting to be handed over stay: stock cannot go below them (the row locked against a payment).
        await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const held = await heldUnits(tx, id);
        if (data.fields.stock < held) throw conflict('stock_below_held', `${held} of these are held for buyers (paid with UdozoPay, or buy orders you accepted): stock cannot go below that.`);
        // Running out starts the 90 days out of stock; restocking ends them (the stock as it is now, read under the lock).
        const current = await tx.classifiedListing.findUniqueOrThrow({ where: { id }, select: { status: true, stock: true, outOfStockAt: true, expiresAt: true } });
        Object.assign(data.fields, stockChange(current, data.fields.stock, listingDays, new Date()));
      }
      // A listing in another category takes a SKU there, so its prefix is always its category's.
      const moved = data.fields.categoryId !== undefined && data.fields.categoryId !== listing.categoryId;
      const sku = moved ? (data.fields.categoryId ? await this.issueSku(tx, data.fields.categoryId) : null) : undefined;
      await tx.classifiedListing.update({ where: { id }, data: { ...data.fields, ...(sku !== undefined ? { sku } : {}) } });
      await this.shipping.write(tx, id, data.connect);
      // A live listing shipping through Connect keeps saying where to, and through which centres.
      if (listing.status !== 'draft' && !restocking) await this.shipping.requireComplete(tx, id, { connect: data.fields.connect ?? listing.connect, connectAllCentres: data.fields.connectAllCentres ?? listing.connectAllCentres });
      if (data.features) {
        await tx.classifiedListingFeature.deleteMany({ where: { listingId: id } });
        await tx.classifiedListingFeature.createMany({ data: data.features.map(value => ({ listingId: id, ...value })) });
      }
      const price = data.fields.priceMinor;
      if (price !== undefined && listing.status !== 'draft' && price !== listing.priceMinor) await this.recordPrice(tx, id, price);
      await this.refreshSearch(tx, id);
    });
    // A live listing whose words, category or price changed is checked again, and goes back to review if doubtful.
    const changed = ['title', 'description', 'categoryId', 'priceMinor'].some(key => key in data.fields) || data.features !== null;
    if (listing.status === 'active' && changed) await this.recheck(id);
    const saved = await this.own(customer, id);
    if (saved.status !== 'draft' && data.features) await this.noteBrand(customer.id, saved);
    return this.present(saved);
  }

  /** The category's next SKU (PHN-000123), its number claimed in one statement so two listings never share it. */
  private async issueSku(tx: Prisma.TransactionClient, categoryId: string) {
    const [row] = await tx.$queryRaw<Array<{ prefix: string; number: number }>>`
      UPDATE "classified_categories" SET "sku_next" = "sku_next" + 1 WHERE "id" = ${categoryId}::uuid RETURNING "sku_prefix" AS "prefix", "sku_next" - 1 AS "number"`;
    if (!row) throw invalid('parameter_invalid', 'Choose a category open in your country.', 'category_id');
    return formatSku(row.prefix, row.number);
  }

  /** A submitted listing's brand or model the registry lacks is noted as a suggestion (it is saved as typed all the same). */
  private async noteBrand(customerId: string, listing: { categoryId: string | null; features: { valueText: string | null; feature: { key: string } }[] }) {
    const brand = listing.features.find(value => value.feature.key === brandFeatureKey)?.valueText;
    const model = listing.features.find(value => value.feature.key === modelFeatureKey)?.valueText;
    if (brand) await this.brands.note(customerId, brand, listing.categoryId);
    if (brand && model && listing.categoryId) await this.models.note(customerId, brand, listing.categoryId, model);
  }

  /** Runs the checks on a live listing again (after an edit or a new photo): doubtful ones go back to review. */
  async recheck(id: string) {
    const listing = await this.prisma.classifiedListing.findUniqueOrThrow({ where: { id } });
    if (listing.status !== 'active') return;
    const flags = await this.moderation.check(listing).catch(async error => {
      // Words refused outright: the listing leaves the market until it is fixed and reviewed.
      if ((error as { code?: string }).code === 'listing_prohibited') return ['prohibited_words'] as ReviewFlag[];
      throw error;
    });
    if (!flags.length) return;
    const moved = await this.prisma.classifiedListing.updateMany({ where: { id, status: 'active' }, data: { status: 'pending_review', reviewReason: flags[0], reviewFlags: flags } });
    if (moved.count) this.postings.requeued(id, 'edited', flags);
  }

  /**
   * Rebuilds the listing's search vector: its title first, then its features (name, value and unit), its category and
   * the category above it, then its description.
   */
  private async refreshSearch(tx: Prisma.TransactionClient, listingId: string) {
    await tx.$executeRaw`
      UPDATE "classified_listings" l SET "search" =
        setweight(to_tsvector('english', coalesce(l."title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce((
          SELECT string_agg(f."name" || ' ' || coalesce(v."value_text", v."value_number"::text) || coalesce(' ' || f."unit", ''), ' ')
          FROM "classified_listing_features" v JOIN "classified_features" f ON f."id" = v."feature_id" WHERE v."listing_id" = l."id"), '')), 'B') ||
        setweight(to_tsvector('english', coalesce((
          SELECT c."name" || coalesce(' ' || p."name", '') FROM "classified_categories" c LEFT JOIN "classified_categories" p ON p."id" = c."parent_id" WHERE c."id" = l."category_id"), '')), 'C') ||
        setweight(to_tsvector('english', coalesce(l."description", '')), 'D')
      WHERE l."id" = ${listingId}::uuid`;
  }

  /** Closes the current price and opens the new one (or none, for "contact for price"). */
  private async recordPrice(tx: Prisma.TransactionClient, listingId: string, price: bigint | null) {
    const now = new Date();
    await tx.classifiedPriceHistory.updateMany({ where: { listingId, to: null }, data: { to: now } });
    if (price !== null) await tx.classifiedPriceHistory.create({ data: { listingId, priceMinor: price, from: now } });
  }

  /** Sends a draft (or a rejected listing, once fixed) to the market: live at once, or to review. */
  async submit(customer: CustomerWithStore, id: string) {
    const country = await this.sellerCountry(customer);
    const settings = await this.marketSettings(country);
    const listing = await this.own(customer, id);
    if (!['draft', 'rejected'].includes(listing.status)) throw conflict('listing_not_draft', 'Only drafts and rejected listings are submitted.');
    await this.terms.require(customer.id);
    this.requireComplete(listing);
    await this.shipping.requireComplete(this.prisma, listing.id, listing);
    if (listing.resale) await this.resale.requireSupplier(customer, country);
    await this.auctions?.beforeSubmit(customer, listing);
    const photos = listing.media.filter(item => item.kind === 'photo' && item.status === 'ready').length;
    if (photos < settings.minPhotos) throw invalid('photos_required', `Add at least ${settings.minPhotos} photos.`, 'photos');
    if (listing.media.some(item => item.kind === 'photo' && item.status === 'failed')) throw invalid('media_failed', 'Remove the photo that could not be used, or add it again.', 'photos');
    // The video is optional: one still being prepared joins the listing once ready (pages show only ready media), and
    // one that could not be used is never shown, so neither holds the listing back.

    const flags = await this.moderation.check(listing);
    const topCategory = listing.category!.parentId ?? listing.category!.id;
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      // One submission per seller at a time (their row locked), so the limit cannot be passed in parallel.
      await tx.$queryRaw`SELECT 1 FROM "customers" WHERE "id" = ${customer.id}::uuid FOR UPDATE`;
      if (!listing.submittedAt) {
        const recent = await tx.classifiedListing.count({
          where: { customerId: customer.id, id: { not: id }, submittedAt: { gte: new Date(now.getTime() - limitWindowMs) }, category: { OR: [{ id: topCategory }, { parentId: topCategory }] } },
        });
        if (recent >= settings.monthlyListingLimit) {
          throw conflict('listing_limit_reached', `You can post ${settings.monthlyListingLimit} listings in this category every 30 days. Renew one or wait.`);
        }
      }
      const published = await tx.classifiedListing.count({ where: { customerId: customer.id, publishedAt: { not: null } } });
      const review: ReviewFlag[] = [...(published < settings.firstListingsReviewed ? (['first_listings'] as const) : []), ...flags];
      const claimed = await tx.classifiedListing.updateMany({
        where: { id, status: listing.status },
        data: review.length
          ? { status: 'pending_review', reviewReason: review[0], reviewFlags: review, submittedAt: listing.submittedAt ?? now, outOfStockAt: listing.stock > 0 ? null : (listing.outOfStockAt ?? now) }
          : { status: 'active', reviewReason: null, reviewFlags: [], submittedAt: listing.submittedAt ?? now, publishedAt: listing.publishedAt ?? now, expiresAt: liveUntil(listing, settings.listingDays, now), outOfStockAt: listing.stock > 0 ? null : now },
      });
      if (!claimed.count) throw conflict('listing_not_draft', 'This listing was already submitted.');
      if (!(await tx.classifiedPriceHistory.count({ where: { listingId: id } })) && listing.priceMinor !== null) await this.recordPrice(tx, id, listing.priceMinor);
    });
    await this.noteBrand(customer.id, listing);
    // Live at once: an auction listing's bidding opens now (one held for review opens when it is approved).
    await this.auctions?.live(id);
    return this.present(await this.own(customer, id));
  }

  /** Another listing period, from now: a listing about to expire, or one that has. */
  async renew(customer: CustomerWithStore, id: string) {
    const country = await this.sellerCountry(customer);
    const settings = await this.marketSettings(country);
    const listing = await this.own(customer, id);
    const now = Date.now();
    if (!['active', 'expired'].includes(listing.status)) throw conflict('listing_not_renewable', 'Only live or expired listings are renewed.');
    // Out of stock, a listing is live 90 days at most: restock it first.
    if (listing.stock === 0) throw conflict('restock_required', `Add stock first: a listing out of stock stays on Udozo for ${outOfStockDays} days at most.`);
    if (listing.status === 'active' && listing.expiresAt && listing.expiresAt.getTime() - now > renewWindowMs) throw conflict('renew_not_due', 'You can renew a listing from 3 days before it expires.');
    const claimed = await this.prisma.classifiedListing.updateMany({
      where: { id, status: listing.status, stock: { gt: 0 } },
      data: { status: 'active', expiresAt: new Date(now + settings.listingDays * dayMs), outOfStockAt: null, expiredReason: null },
    });
    if (!claimed.count) throw conflict('listing_not_renewable', 'This listing changed: refresh and try again.');
    // An auction listing renewed after it did not sell is auctioned again.
    await this.auctions?.live(id);
    return this.present(await this.own(customer, id));
  }

  async markSold(customer: CustomerWithStore, id: string) {
    await this.sellerCountry(customer);
    const listing = await this.own(customer, id);
    if (listing.status !== 'active') throw conflict('listing_not_active', 'Only a live listing is marked sold.');
    if (listing.saleMethod === 'auction' && (await this.auctions?.running(id))) throw conflict('auction_running', 'It is at auction: it sells to the winning bid.');
    const now = new Date();
    const claimed = await this.prisma.classifiedListing.updateMany({ where: { id, status: 'active' }, data: { status: 'sold', soldAt: now } });
    if (!claimed.count) throw conflict('listing_not_active', 'This listing changed: refresh and try again.');
    await this.prisma.classifiedPriceHistory.updateMany({ where: { listingId: id, to: null }, data: { to: now } });
    return this.present(await this.own(customer, id));
  }

  /** A draft is removed entirely; anything else leaves the market for good (kept for orders, chats and reports). */
  async remove(customer: CustomerWithStore, id: string) {
    await this.sellerCountry(customer);
    const listing = await this.own(customer, id);
    if (listing.status === 'draft') {
      const removed = await this.prisma.classifiedListing.deleteMany({ where: { id, status: 'draft' } });
      // Its published photos and video go too (best effort: a leftover object is never linked anywhere).
      const keys = removed.count ? listing.media.flatMap(item => (item.storageKey ? [item.storageKey, ...(item.posterUrl ? [item.storageKey.replace(/\.mp4$/, '.jpg')] : [])] : [])) : [];
      if (keys.length && this.storage.configured()) await Promise.all(keys.map(key => this.storage.remove(key))).catch(() => undefined);
      return;
    }
    await this.requireNoBids(id, 'People have bid on it: it sells to the winning bid.');
    const now = new Date();
    await this.prisma.classifiedListing.updateMany({ where: { id, status: listing.status }, data: { status: 'deleted', closedAt: now } });
    await this.prisma.connectAuction.updateMany({ where: { listingId: id, status: { in: ['scheduled', 'live'] } }, data: { status: 'cancelled', cancelReason: 'Listing deleted' } });
    await this.prisma.classifiedPriceHistory.updateMany({ where: { listingId: id, to: null }, data: { to: now } });
  }

  /**
   * The scheduled job: live listings past their time expire, and Anjio takes off those out of stock for 90 days
   * (`expired_reason: out_of_stock`; restocking and renewing shows them again).
   */
  async expireDue(now = new Date()) {
    const due = await this.prisma.classifiedListing.findMany({
      where: { status: 'active', expiresAt: { lte: now } },
      select: { id: true, title: true, stock: true, expiresAt: true, customer: { select: { id: true, storeId: true } } },
      take: 2000,
    });
    if (!due.length) return { expired: 0, out_of_stock: 0 };
    const ran = due.filter(row => row.stock === 0);
    const rest = due.filter(row => row.stock > 0);
    const delisted = ran.length ? await this.prisma.classifiedListing.updateMany({ where: { id: { in: ran.map(row => row.id) }, status: 'active', stock: 0 }, data: { status: 'expired', expiredReason: 'out_of_stock' } }) : { count: 0 };
    const expired = rest.length ? await this.prisma.classifiedListing.updateMany({ where: { id: { in: rest.map(row => row.id) }, status: 'active' }, data: { status: 'expired', expiredReason: null } }) : { count: 0 };
    // Each seller hears once per period (the subject is the listing and its expiry), so a run twice tells nobody twice.
    for (const row of due) {
      const outOfStock = row.stock === 0;
      await this.inbox.customer({ customerId: row.customer.id, storeId: row.customer.storeId }, 'customer.classifieds.listing_expired', {
        subject: `${row.id}:expired:${row.expiresAt?.toISOString()}`,
        title: outOfStock ? 'Anjio took your ad off Udozo' : 'Your ad expired',
        body: outOfStock
          ? `"${row.title}" was out of stock for ${outOfStockDays} days, so it is off Udozo. Add stock and renew it from My listings to show it again.`
          : `"${row.title}" is off Udozo. Renew it from My listings to show it again.`,
        link: outOfStock ? `/account/listings/${row.id}` : '/account/listings',
      });
    }
    return { expired: expired.count + delisted.count, out_of_stock: delisted.count };
  }

  /** Everything a listing past draft must have. */
  private requireComplete(listing: ListingParts) {
    const missing = missingParts(listing);
    if (missing.length) throw invalid('listing_incomplete', `Add ${missing.map(([, label]) => label).join(', ')}.`, missing[0][0]);
  }

  /** The columns and feature values a request changes, each checked. */
  private async changes(country: string, input: ListingInput, current: ListingRow | null) {
    const fields: ListingFields = {};
    if (input.title !== undefined) {
      fields.title = input.title === null ? null : checkTitle(input.title);
      fields.slug = fields.title ? slugify(fields.title) : null;
    }
    if (input.description !== undefined) fields.description = input.description === null ? null : checkDescription(input.description);
    if (input.condition !== undefined) fields.condition = input.condition;
    if (input.delivery !== undefined) fields.delivery = input.delivery;
    if (input.pickup !== undefined) fields.pickup = input.pickup;
    for (const [key, field] of [['delivery_fee_state', 'deliveryFeeStateMinor'], ['delivery_fee_nationwide', 'deliveryFeeNationwideMinor']] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value < 0 || BigInt(value) > maxPriceMinor) throw invalid('parameter_invalid', 'A delivery charge is 0 (free) or more, in minor units.', key);
      fields[field] = BigInt(value);
    }
    if (input.contact !== undefined) fields.contact = input.contact;
    if (input.category_id !== undefined) {
      if (input.category_id === null) fields.categoryId = null;
      else {
        const category = await this.prisma.classifiedCategory.findUnique({ where: { id: input.category_id }, include: { parent: { include: { countries: true } }, countries: true, children: { select: { id: true }, take: 1 } } });
        const open = (c: { enabled: boolean; countries: { country: string; enabled: boolean }[] } | null) => !c || (c.enabled && c.countries.some(row => row.country === country && row.enabled));
        if (!category || !category.enabled || !open(category) || (category.parent && !open(category.parent))) throw invalid('parameter_invalid', 'Choose a category open in your country.', 'category_id');
        if (category.children.length) throw invalid('parameter_invalid', 'Choose a subcategory.', 'category_id');
        fields.categoryId = category.id;
      }
    }
    if (input.area_id !== undefined) {
      if (input.area_id === null) Object.assign(fields, { areaId: null, stateId: null });
      else {
        const area = await this.prisma.classifiedArea.findUnique({ where: { id: input.area_id }, include: { parent: true } });
        if (!area || area.kind !== 'area' || area.country !== country || !area.enabled || !area.parent?.enabled) throw invalid('parameter_invalid', 'Choose a city or area in your country.', 'area_id');
        Object.assign(fields, { areaId: area.id, stateId: area.parentId });
      }
    }
    const priceKind = input.price_kind ?? current?.priceKind ?? 'fixed';
    if (input.price_kind !== undefined) fields.priceKind = input.price_kind;
    // A price for a "contact for price" listing is refused, never dropped: the seller must say how it is priced.
    if (input.price !== undefined && input.price !== null && input.price_kind === undefined && priceKind === 'on_request') {
      throw invalid('parameter_invalid', 'This ad says "Contact for price": choose Fixed or Negotiable to give it a price.', 'price_kind');
    }
    if (input.price !== undefined) {
      if (input.price === null) fields.priceMinor = null;
      else {
        if (!Number.isSafeInteger(input.price) || input.price <= 0 || BigInt(input.price) > maxPriceMinor) throw invalid('parameter_invalid', 'Enter the price in minor units (kobo), a whole number above zero.', 'price');
        fields.priceMinor = BigInt(input.price);
      }
    }
    if (priceKind === 'on_request' && (input.price_kind !== undefined || input.price !== undefined)) fields.priceMinor = null;

    // Sold by auction: one item, a starting price, an optional reserve (at least the starting price) and a length.
    const saleMethod = input.sale_method ?? current?.saleMethod ?? 'fixed';
    if (input.sale_method !== undefined) fields.saleMethod = input.sale_method;
    if (input.auction_days !== undefined) {
      if (input.auction_days !== null && !auctionLengths.includes(input.auction_days)) throw invalid('parameter_invalid', `An auction runs ${auctionLengths.join(', ')} days.`, 'auction_days');
      fields.auctionDays = input.auction_days;
    }
    if (input.auction_reserve !== undefined) {
      if (input.auction_reserve !== null && (!Number.isSafeInteger(input.auction_reserve) || input.auction_reserve <= 0 || BigInt(input.auction_reserve) > maxPriceMinor)) throw invalid('parameter_invalid', 'Give the reserve in minor units, a whole number above zero.', 'auction_reserve');
      fields.auctionReserveMinor = input.auction_reserve === null ? null : BigInt(input.auction_reserve);
    }
    if (saleMethod === 'auction') {
      if (priceKind !== 'fixed') {
        if (input.price_kind !== undefined) throw invalid('parameter_invalid', 'An auction starts at a price: it cannot be negotiable or contact for price.', 'price_kind');
        fields.priceKind = 'fixed';
      }
      if (current?.saleMethod === 'auction') {
        const changed = (['priceMinor', 'priceKind', 'auctionReserveMinor', 'auctionDays'] as const).some(key => key in fields && fields[key] !== current[key]);
        if (changed) await this.requireNoBids(current.id, 'People have bid on it: its price, reserve and length are fixed until the auction ends.');
      }
      const start = 'priceMinor' in fields ? fields.priceMinor! : (current?.priceMinor ?? null);
      const reserve = 'auctionReserveMinor' in fields ? fields.auctionReserveMinor! : (current?.auctionReserveMinor ?? null);
      if (reserve !== null && start !== null && reserve < start) throw invalid('reserve_below_start', 'The reserve is at least the starting price.', 'auction_reserve');
      if ((input.resale ?? current?.resale) === true) throw invalid('parameter_invalid', 'A listing sold by auction is sold on Udozo only, not through resellers.', 'resale');
    } else if (input.sale_method === 'fixed') {
      fields.auctionReserveMinor = null;
      fields.auctionDays = null;
    }
    // Once people have bid, the price, reserve, length and way of selling are fixed.
    if (current?.saleMethod === 'auction') {
      const changed = (['priceMinor', 'priceKind', 'saleMethod', 'auctionReserveMinor', 'auctionDays'] as const).some(key => key in fields && fields[key] !== current[key]);
      if (changed) await this.requireNoBids(current.id, 'People have bid on it: its price, reserve and length are fixed until the auction ends.');
    }

    // Shipping through Udozo Connect: the states, their charges and the centres, each checked.
    const connect: ConnectChanges = await this.shipping.check(country, input, current, priceKind);
    Object.assign(fields, connect.fields);
    if ((fields.pickup ?? current?.pickup ?? true) === false && (fields.delivery ?? current?.delivery ?? 'none') === 'none' && !(fields.connect ?? current?.connect ?? false)) {
      throw invalid('fulfilment_required', 'Offer the hand-over in person, delivery, shipping through Udozo Connect, or more than one.', 'pickup');
    }

    let features: { featureId: string; valueText: string | null; valueNumber: number | null }[] | null = null;
    if (input.features !== undefined) {
      if (input.features.length > maxFeatures) throw invalid('parameter_invalid', `A listing can have at most ${maxFeatures} features.`, 'features');
      const keys = input.features.map(item => item.key);
      if (new Set(keys).size !== keys.length) throw invalid('parameter_invalid', 'Each feature can be given once.', 'features');
      const registry = await this.prisma.classifiedFeature.findMany({ where: { key: { in: keys } } });
      features = input.features.map((item, index) => {
        const feature = registry.find(row => row.key === item.key);
        if (!feature || !feature.enabled) throw invalid('feature_unknown', `There is no feature "${item.key}". Choose one from the list, or suggest it.`, `features[${index}].key`);
        return { featureId: feature.id, ...checkFeatureValue(feature, item.value, `features[${index}].value`) };
      });
      // A brand reads as the registry writes it ("samsung" is Samsung, "benz" Mercedes-Benz); one it lacks stays as typed.
      const brand = registry.find(row => row.key === brandFeatureKey);
      for (const value of features) if (brand && value.featureId === brand.id && value.valueText) value.valueText = await this.brands.canonical(value.valueText);
      // A model too, among that brand's in the category ("s23 ultra" is Galaxy S23 Ultra); one it lacks stays as typed.
      const model = registry.find(row => row.key === modelFeatureKey);
      const brandValue = features.find(value => value.featureId === brand?.id)?.valueText;
      const categoryId = fields.categoryId ?? current?.categoryId;
      if (brandValue && categoryId) for (const value of features) if (value.featureId === model?.id && value.valueText) value.valueText = await this.models.canonical(brandValue, categoryId, value.valueText);
    }

    // Where it is sold (BitoCard Shop, resellers' stores or both), its resale terms and its stock.
    if (input.on_shop !== undefined) fields.onShop = input.on_shop;
    if (input.resale !== undefined) fields.resale = input.resale;
    if (input.resale_discount_bps !== undefined) fields.resaleDiscountBps = input.resale_discount_bps;
    if (input.resale_markup_max_bps !== undefined) fields.resaleMarkupMaxBps = input.resale_markup_max_bps;
    if (input.resale_paused !== undefined) fields.resalePausedAt = input.resale_paused ? (current?.resalePausedAt ?? new Date()) : null;
    if (input.stock !== undefined) {
      if (!Number.isInteger(input.stock) || input.stock < 0 || input.stock > maxStock) throw invalid('parameter_invalid', `Stock is a whole number from 0 (out of stock) to ${maxStock.toLocaleString('en-GB')}.`, 'stock');
      fields.stock = input.stock;
    }
    const onShop = fields.onShop ?? current?.onShop ?? true;
    const resale = fields.resale ?? current?.resale ?? false;
    if (!onShop && !resale) throw invalid('channel_required', 'Sell it on Udozo, through resellers, or both.', 'on_shop');
    if (resale && ['resale', 'resaleDiscountBps', 'resaleMarkupMaxBps', 'priceKind'].some(key => key in fields)) {
      if (priceKind === 'on_request') throw invalid('resale_price_required', 'Resellers sell at a price: give one to let them sell it.', 'price_kind');
      const discount = 'resaleDiscountBps' in fields ? fields.resaleDiscountBps! : (current?.resaleDiscountBps ?? null);
      const markup = 'resaleMarkupMaxBps' in fields ? fields.resaleMarkupMaxBps! : (current?.resaleMarkupMaxBps ?? null);
      this.resale.checkTerms(await this.resale.limits(country), discount, markup);
    }
    // An auction sells one item.
    if (saleMethod === 'auction') fields.stock = 1;
    return { fields, features, connect };
  }

  /** The seller's view of a listing. */
  present(listing: ListingRow) {
    const photos = listing.media.filter(item => item.kind === 'photo');
    const video = listing.media.find(item => item.kind === 'video') ?? null;
    return {
      object: 'classified_listing' as const,
      id: listing.id,
      ref: Number(listing.ref),
      sku: listing.sku,
      status: listing.status,
      review_reason: listing.reviewReason,
      review_reason_code: listing.reviewReasonCode,
      review_flags: listing.reviewFlags,
      title: listing.title,
      description: listing.description,
      price: { kind: listing.priceKind, amount: listing.priceMinor === null ? null : Number(listing.priceMinor), currency: listing.currency },
      /** Sold at its price, or by auction (the price its starting price; the reserve is the seller's only). */
      sale_method: listing.saleMethod as 'fixed' | 'auction',
      auction_reserve: listing.auctionReserveMinor === null ? null : Number(listing.auctionReserveMinor),
      auction_days: listing.auctionDays,
      condition: listing.condition,
      category: listing.category ? { id: listing.category.id, slug: listing.category.slug, name: listing.category.name, parent: listing.category.parent ? { id: listing.category.parent.id, slug: listing.category.parent.slug, name: listing.category.parent.name } : null } : null,
      country: listing.country,
      area: listing.area ? { id: listing.area.id, slug: listing.area.slug, name: listing.area.name, state: listing.area.parent ? { id: listing.area.parent.id, slug: listing.area.parent.slug, name: listing.area.parent.name } : null } : null,
      features: listing.features
        .map(value => ({ key: value.feature.key, name: value.feature.name, icon: value.feature.icon, unit: value.feature.unit, value: featureValueOut(value.feature.dataType, value) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      photos: photos.map(item => ({ id: item.id, url: this.watermarks.url(item, 960), width: item.width, height: item.height, status: item.status })),
      video: video ? { id: video.id, url: video.url, poster_url: video.posterUrl, duration_ms: video.durationMs, status: video.status, failure_reason: video.failureReason } : null,
      delivery: listing.delivery,
      pickup: listing.pickup,
      delivery_fees: { within_state: Number(listing.deliveryFeeStateMinor), nationwide: Number(listing.deliveryFeeNationwideMinor) },
      /** Shipped through Udozo Connect: to a Connect Centre in its states, at its charge per state. */
      connect: this.shipping.presentOwn(listing),
      contact: listing.contact,
      views: listing.views,
      leads: listing.leads,
      /** Sold on BitoCard Shop itself; a resale-only listing has no Shop address. */
      on_shop: listing.onShop,
      resale: {
        enabled: listing.resale,
        discount_bps: listing.resaleDiscountBps,
        markup_max_bps: listing.resaleMarkupMaxBps,
        paused: listing.resalePausedAt !== null,
      },
      stock: listing.stock,
      /** Some to sell (units held for buyers count: they are theirs). Out of stock, buying is closed. */
      in_stock: listing.stock > 0,
      /** When a posted listing ran out, and, while it is live, when Anjio takes it off unless it is restocked. */
      out_of_stock_at: listing.outOfStockAt?.toISOString() ?? null,
      delist_at: listing.status === 'active' && listing.stock === 0 ? (listing.expiresAt?.toISOString() ?? null) : null,
      /** `out_of_stock` when Anjio took it off after 90 days out of stock (an expired listing); else null. */
      expired_reason: listing.expiredReason,
      url: listing.onShop && ['active', 'sold'].includes(listing.status) && listing.slug ? `${shopOrigin}/${listing.country.toLowerCase()}/l/${listing.ref}-${listing.slug}` : null,
      created_at: listing.createdAt.toISOString(),
      updated_at: listing.updatedAt.toISOString(),
      submitted_at: listing.submittedAt?.toISOString() ?? null,
      published_at: listing.publishedAt?.toISOString() ?? null,
      expires_at: listing.expiresAt?.toISOString() ?? null,
      sold_at: listing.soldAt?.toISOString() ?? null,
    };
  }
}
