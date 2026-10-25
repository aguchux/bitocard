import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { MediaStorage } from '../media/storage.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { ModerationService, type ReviewFlag } from './moderation.service.js';
import {
  checkDescription,
  checkFeatureValue,
  checkTitle,
  type conditions,
  type contacts,
  type deliveries,
  featureValueOut,
  invalid,
  type ListingStatus,
  maxFeatures,
  maxPriceMinor,
  type priceKinds,
  slugify,
} from './rules.js';

export type ListingInput = {
  category_id?: string | null;
  area_id?: string | null;
  title?: string | null;
  description?: string | null;
  price_kind?: (typeof priceKinds)[number];
  price?: number | null;
  condition?: (typeof conditions)[number] | null;
  delivery?: (typeof deliveries)[number];
  contact?: (typeof contacts)[number];
  features?: { key: string; value: unknown }[];
};

const dayMs = 86_400_000;
/** A listing can be renewed from this long before it expires (and any time after). */
export const renewWindowMs = 3 * dayMs;
/** The limit on new listings counts those submitted in the last 30 days. */
const limitWindowMs = 30 * dayMs;

const defaults = { listingDays: 30, monthlyListingLimit: 10, firstListingsReviewed: 3, minPhotos: 4, maxPhotos: 12 };

const listingInclude = {
  category: { include: { parent: true } },
  area: { include: { parent: true } },
  features: { include: { feature: true } },
  media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
} satisfies Prisma.ClassifiedListingInclude;

type ListingRow = Prisma.ClassifiedListingGetPayload<{ include: typeof listingInclude }>;
type ListingFields = {
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  condition?: string | null;
  delivery?: string;
  contact?: string;
  categoryId?: string | null;
  areaId?: string | null;
  stateId?: string | null;
  priceKind?: string;
  priceMinor?: bigint | null;
};

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/** Where a listing is public. */
export const shopOrigin = 'https://shop.bitocard.com';

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
  ) {}

  /** The seller's country, once they may sell there. */
  async sellerCountry(customer: CustomerWithStore) {
    if (!customer.store.reseller.house) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'classifieds_unavailable', 'BitoCard Shop is for bitocard.com accounts.');
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
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'classifieds_unavailable', 'BitoCard Shop is not open in this country yet.');
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
      const listing = await tx.classifiedListing.create({ data: { customerId: customer.id, country, currency: market.currency, ...data.fields } });
      if (data.features) await tx.classifiedListingFeature.createMany({ data: data.features.map(value => ({ listingId: listing.id, ...value })) });
      await this.refreshSearch(tx, listing.id);
      return listing;
    });
    return this.present(await this.own(customer, created.id));
  }

  async update(customer: CustomerWithStore, id: string, input: ListingInput) {
    const country = await this.sellerCountry(customer);
    const listing = await this.own(customer, id);
    if (!['draft', 'pending_review', 'active', 'rejected'].includes(listing.status)) throw conflict('listing_closed', 'This listing can no longer be changed.');
    const data = await this.changes(country, input, listing);
    if (listing.status !== 'draft') this.requireComplete({ ...listing, ...data.fields });
    await this.prisma.$transaction(async tx => {
      await tx.classifiedListing.update({ where: { id }, data: data.fields });
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
    return this.present(await this.own(customer, id));
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
    if (flags.length) await this.prisma.classifiedListing.updateMany({ where: { id, status: 'active' }, data: { status: 'pending_review', reviewReason: flags[0], reviewFlags: flags } });
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
    this.requireComplete(listing);
    const photos = listing.media.filter(item => item.kind === 'photo' && item.status === 'ready').length;
    if (photos < settings.minPhotos) throw invalid('photos_required', `Add at least ${settings.minPhotos} photos.`, 'photos');
    if (listing.media.some(item => item.status === 'failed')) throw invalid('media_failed', 'Remove the photo or video that could not be used, or add it again.', 'photos');
    if (listing.media.some(item => item.status === 'processing')) throw conflict('video_processing', 'Your video is still being prepared. Submit again in a minute.');

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
          ? { status: 'pending_review', reviewReason: review[0], reviewFlags: review, submittedAt: listing.submittedAt ?? now }
          : { status: 'active', reviewReason: null, reviewFlags: [], submittedAt: listing.submittedAt ?? now, publishedAt: listing.publishedAt ?? now, expiresAt: new Date(now.getTime() + settings.listingDays * dayMs) },
      });
      if (!claimed.count) throw conflict('listing_not_draft', 'This listing was already submitted.');
      if (!(await tx.classifiedPriceHistory.count({ where: { listingId: id } })) && listing.priceMinor !== null) await this.recordPrice(tx, id, listing.priceMinor);
    });
    return this.present(await this.own(customer, id));
  }

  /** Another listing period, from now: a listing about to expire, or one that has. */
  async renew(customer: CustomerWithStore, id: string) {
    const country = await this.sellerCountry(customer);
    const settings = await this.marketSettings(country);
    const listing = await this.own(customer, id);
    const now = Date.now();
    if (listing.status === 'active' && listing.expiresAt && listing.expiresAt.getTime() - now > renewWindowMs) throw conflict('renew_not_due', 'You can renew a listing from 3 days before it expires.');
    if (!['active', 'expired'].includes(listing.status)) throw conflict('listing_not_renewable', 'Only live or expired listings are renewed.');
    const claimed = await this.prisma.classifiedListing.updateMany({ where: { id, status: listing.status }, data: { status: 'active', expiresAt: new Date(now + settings.listingDays * dayMs) } });
    if (!claimed.count) throw conflict('listing_not_renewable', 'This listing changed: refresh and try again.');
    return this.present(await this.own(customer, id));
  }

  async markSold(customer: CustomerWithStore, id: string) {
    await this.sellerCountry(customer);
    const listing = await this.own(customer, id);
    if (listing.status !== 'active') throw conflict('listing_not_active', 'Only a live listing is marked sold.');
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
    const now = new Date();
    await this.prisma.classifiedListing.updateMany({ where: { id, status: listing.status }, data: { status: 'deleted', closedAt: now } });
    await this.prisma.classifiedPriceHistory.updateMany({ where: { listingId: id, to: null }, data: { to: now } });
  }

  /** The scheduled job: live listings past their time expire. */
  async expireDue(now = new Date()) {
    const expired = await this.prisma.classifiedListing.updateMany({ where: { status: 'active', expiresAt: { lte: now } }, data: { status: 'expired' } });
    return { expired: expired.count };
  }

  /** Everything a listing past draft must have. */
  private requireComplete(listing: { categoryId: string | null; areaId: string | null; title: string | null; condition: string | null; priceKind: string; priceMinor: bigint | null }) {
    const missing: [string, string][] = [];
    if (!listing.title) missing.push(['title', 'a title']);
    if (!listing.categoryId) missing.push(['category_id', 'a category']);
    if (!listing.condition) missing.push(['condition', 'its condition']);
    if (listing.priceKind !== 'on_request' && listing.priceMinor === null) missing.push(['price', 'a price']);
    if (!listing.areaId) missing.push(['area_id', 'where it is']);
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
    if (input.contact !== undefined) fields.contact = input.contact;
    if (input.category_id !== undefined) {
      if (input.category_id === null) fields.categoryId = null;
      else {
        const category = await this.prisma.classifiedCategory.findUnique({ where: { id: input.category_id }, include: { parent: true, countries: true, children: { select: { id: true }, take: 1 } } });
        const open = (c: { enabled: boolean; countries: { country: string; enabled: boolean }[] } | null) => !c || (c.enabled && c.countries.some(row => row.country === country && row.enabled));
        if (!category || !category.enabled || !open(category) || (category.parent && !category.parent.enabled)) throw invalid('parameter_invalid', 'Choose a category open in your country.', 'category_id');
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
    if (input.price !== undefined) {
      if (input.price === null) fields.priceMinor = null;
      else {
        if (!Number.isSafeInteger(input.price) || input.price <= 0 || BigInt(input.price) > maxPriceMinor) throw invalid('parameter_invalid', 'Enter the price in minor units (kobo), a whole number above zero.', 'price');
        fields.priceMinor = BigInt(input.price);
      }
    }
    if (priceKind === 'on_request' && (input.price_kind !== undefined || input.price !== undefined)) fields.priceMinor = null;

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
    }
    return { fields, features };
  }

  /** The seller's view of a listing. */
  present(listing: ListingRow) {
    const photos = listing.media.filter(item => item.kind === 'photo');
    const video = listing.media.find(item => item.kind === 'video') ?? null;
    return {
      object: 'classified_listing' as const,
      id: listing.id,
      ref: Number(listing.ref),
      status: listing.status,
      review_reason: listing.reviewReason,
      review_flags: listing.reviewFlags,
      title: listing.title,
      description: listing.description,
      price: { kind: listing.priceKind, amount: listing.priceMinor === null ? null : Number(listing.priceMinor), currency: listing.currency },
      condition: listing.condition,
      category: listing.category ? { id: listing.category.id, slug: listing.category.slug, name: listing.category.name, parent: listing.category.parent ? { id: listing.category.parent.id, slug: listing.category.parent.slug, name: listing.category.parent.name } : null } : null,
      country: listing.country,
      area: listing.area ? { id: listing.area.id, slug: listing.area.slug, name: listing.area.name, state: listing.area.parent ? { id: listing.area.parent.id, slug: listing.area.parent.slug, name: listing.area.parent.name } : null } : null,
      features: listing.features
        .map(value => ({ key: value.feature.key, name: value.feature.name, icon: value.feature.icon, unit: value.feature.unit, value: featureValueOut(value.feature.dataType, value) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      photos: photos.map(item => ({ id: item.id, url: item.url, width: item.width, height: item.height, status: item.status })),
      video: video ? { id: video.id, url: video.url, poster_url: video.posterUrl, duration_ms: video.durationMs, status: video.status, failure_reason: video.failureReason } : null,
      delivery: listing.delivery,
      contact: listing.contact,
      views: listing.views,
      leads: listing.leads,
      url: ['active', 'sold'].includes(listing.status) && listing.slug ? `${shopOrigin}/${listing.country.toLowerCase()}/l/${listing.ref}-${listing.slug}` : null,
      created_at: listing.createdAt.toISOString(),
      updated_at: listing.updatedAt.toISOString(),
      submitted_at: listing.submittedAt?.toISOString() ?? null,
      published_at: listing.publishedAt?.toISOString() ?? null,
      expires_at: listing.expiresAt?.toISOString() ?? null,
      sold_at: listing.soldAt?.toISOString() ?? null,
    };
  }
}
