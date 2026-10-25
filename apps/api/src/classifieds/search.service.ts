import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeadsService } from './leads.service.js';
import { ListingsService, shopOrigin } from './listings.service.js';
import { conditions, featureValueOut, invalid } from './rules.js';

/** Areas whose centres are this close count as nearby. */
export const nearbyKm = 25;
/** Sold listings stay visible (marked Sold) this long, then answer 410. */
export const soldVisibleMs = 30 * 86_400_000;
export const maxResults = 50;
export const maxOffset = 1000;
export const searchSorts = ['relevant', 'newest', 'price_asc', 'price_desc'] as const;
export type SearchSort = (typeof searchSorts)[number];

/** Where a result sits, from the buyer's chosen area outwards: each tier is its own heading. */
export const tierNames = ['area', 'nearby', 'state', 'country'] as const;

export type SearchInput = {
  country: string;
  q?: string;
  category?: string;
  area?: string;
  state?: string;
  price_min?: number;
  price_max?: number;
  condition?: string[];
  /** `key:value[,value…]` for text, choices and yes or no; `key:min..max` (either end optional) for numbers. */
  f?: string[];
  sort?: SearchSort;
  offset?: number;
  limit?: number;
};

type FeatureFilter = { featureId: string; values?: string[]; min?: number; max?: number };

const gone = () => new ApiError(HttpStatus.GONE, 'invalid_request_error', 'listing_gone', 'This listing is no longer on BitoCard Shop.');
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');

/** "Chinedu Okafor" shows as "Chinedu O.": enough to recognise, never a full name on a public page. */
export const publicName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

/**
 * BitoCard Shop's public reads: search within one country (full text and trigram matching, filters on price, condition
 * and the category's feature filters), ranked local first (the buyer's area, nearby areas, their state, then the whole
 * country, each a tier) before the chosen sort; one listing's page; and suggestions as the buyer types.
 */
@Injectable()
export class ListingSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly leads: LeadsService,
  ) {}

  private async features(filters: string[] | undefined) {
    if (!filters?.length) return [];
    const parsed = filters.map((raw, index) => {
      const at = raw.indexOf(':');
      if (at < 1) throw invalid('parameter_invalid', 'Write each feature filter as key:value or key:min..max.', `f[${index}]`);
      return { index, key: raw.slice(0, at).trim().toLowerCase(), value: raw.slice(at + 1).trim() };
    });
    const registry = await this.prisma.classifiedFeature.findMany({ where: { key: { in: parsed.map(item => item.key) }, enabled: true, filterable: true } });
    return parsed.map(({ index, key, value }): FeatureFilter => {
      const feature = registry.find(row => row.key === key);
      if (!feature) throw invalid('parameter_invalid', `"${key}" is not a filter.`, `f[${index}]`);
      if (feature.dataType === 'number') {
        const range = /^(-?\d+(?:\.\d+)?)?\.\.(-?\d+(?:\.\d+)?)?$/.exec(value) ?? /^(-?\d+(?:\.\d+)?)()$/.exec(value);
        if (!range || (range[1] === undefined && !range[2])) throw invalid('parameter_invalid', `${feature.name}: give a number or a range such as 4..16.`, `f[${index}]`);
        const exact = !value.includes('..');
        return { featureId: feature.id, min: range[1] !== undefined ? Number(range[1]) : undefined, max: exact ? Number(range[1]) : range[2] ? Number(range[2]) : undefined };
      }
      const values = value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
      if (!values.length) throw invalid('parameter_invalid', `${feature.name}: give a value.`, `f[${index}]`);
      return { featureId: feature.id, values: feature.dataType === 'boolean' ? values.map(item => (['yes', 'true'].includes(item) ? 'true' : 'false')) : values };
    });
  }

  /** The buyer's place: an area (and its state), or only a state. */
  private async place(country: string, input: { area?: string; state?: string }) {
    if (input.area) {
      const area = await this.prisma.classifiedArea.findFirst({ where: { country, kind: 'area', enabled: true, slug: input.area, ...(input.state ? { parent: { slug: input.state } } : {}) } });
      if (!area) throw invalid('parameter_invalid', 'Choose an area in this country.', 'area');
      return { areaId: area.id, stateId: area.parentId, latitude: Number(area.latitude), longitude: Number(area.longitude) };
    }
    if (input.state) {
      const state = await this.prisma.classifiedArea.findFirst({ where: { country, kind: 'state', enabled: true, slug: input.state } });
      if (!state) throw invalid('parameter_invalid', 'Choose a state in this country.', 'state');
      return { areaId: null, stateId: state.id, latitude: null, longitude: null };
    }
    return { areaId: null, stateId: null, latitude: null, longitude: null };
  }

  async search(input: SearchInput) {
    const country = input.country.toUpperCase();
    await this.listings.requireOpen(country);
    const limit = Math.min(input.limit ?? 24, maxResults);
    const offset = input.offset ?? 0;
    if (offset > maxOffset) throw invalid('parameter_invalid', `Results stop after ${maxOffset}. Narrow the search.`, 'offset');
    const q = input.q?.trim().slice(0, 100) || null;
    const sort: SearchSort = input.sort ?? (q ? 'relevant' : 'newest');
    if (input.price_min !== undefined && input.price_max !== undefined && input.price_min > input.price_max) throw invalid('parameter_invalid', 'The lowest price is above the highest.', 'price_min');
    for (const condition of input.condition ?? []) if (!(conditions as readonly string[]).includes(condition)) throw invalid('parameter_invalid', 'Conditions are new, used, untested or parts.', 'condition');

    let categoryIds: string[] | null = null;
    if (input.category) {
      const category = await this.prisma.classifiedCategory.findUnique({ where: { slug: input.category }, include: { children: { where: { enabled: true }, select: { id: true } } } });
      if (!category || !category.enabled) throw invalid('parameter_invalid', 'No such category.', 'category');
      categoryIds = [category.id, ...category.children.map(child => child.id)];
    }
    const [place, featureFilters] = await Promise.all([this.place(country, input), this.features(input.f)]);

    const where: Prisma.Sql[] = [Prisma.sql`l."country" = ${country}`, Prisma.sql`l."status" = 'active'`];
    if (categoryIds) where.push(Prisma.sql`l."category_id" IN (${Prisma.join(categoryIds.map(id => Prisma.sql`${id}::uuid`))})`);
    if (input.price_min !== undefined) where.push(Prisma.sql`l."price_minor" >= ${BigInt(input.price_min)}`);
    if (input.price_max !== undefined) where.push(Prisma.sql`l."price_minor" <= ${BigInt(input.price_max)}`);
    if (input.condition?.length) where.push(Prisma.sql`l."condition" IN (${Prisma.join(input.condition)})`);
    for (const filter of featureFilters) {
      const match = filter.values
        ? Prisma.sql`lower(lf."value_text") IN (${Prisma.join(filter.values)})`
        : Prisma.sql`lf."value_number" BETWEEN ${filter.min ?? -1e300} AND ${filter.max ?? 1e300}`;
      where.push(Prisma.sql`EXISTS (SELECT 1 FROM "classified_listing_features" lf WHERE lf."listing_id" = l."id" AND lf."feature_id" = ${filter.featureId}::uuid AND ${match})`);
    }
    const query = q ? Prisma.sql`websearch_to_tsquery('english', ${q})` : null;
    if (q) where.push(Prisma.sql`(l."search" @@ ${query} OR word_similarity(lower(${q}), lower(l."title")) >= 0.45)`);

    const distance =
      place.latitude !== null
        ? Prisma.sql`sqrt(power(a."latitude"::float8 - ${place.latitude}, 2) + power((a."longitude"::float8 - ${place.longitude}) * cos(radians(${place.latitude})), 2)) * 111.32`
        : Prisma.sql`NULL::float8`;
    const delivers = place.stateId
      ? Prisma.sql`(l."delivery" = 'nationwide' OR (l."delivery" = 'state' AND l."state_id" = ${place.stateId}::uuid))`
      : Prisma.sql`false`;
    const tier = Prisma.sql`CASE
      WHEN ${place.areaId}::uuid IS NOT NULL AND l."area_id" = ${place.areaId}::uuid THEN 0
      WHEN ${place.areaId}::uuid IS NOT NULL AND ${distance} <= ${nearbyKm} THEN 1
      WHEN ${place.stateId}::uuid IS NOT NULL AND (l."state_id" = ${place.stateId}::uuid OR ${delivers}) THEN 2
      ELSE 3 END`;
    const rank = query ? Prisma.sql`ts_rank_cd(coalesce(l."search", ''::tsvector), ${query}) + word_similarity(lower(${q}), lower(l."title"))` : Prisma.sql`0`;
    const order = {
      relevant: Prisma.sql`rank DESC, l."published_at" DESC`,
      newest: Prisma.sql`l."published_at" DESC`,
      price_asc: Prisma.sql`l."price_minor" ASC NULLS LAST, l."published_at" DESC`,
      price_desc: Prisma.sql`l."price_minor" DESC NULLS LAST, l."published_at" DESC`,
    }[sort];
    const from = Prisma.sql`FROM "classified_listings" l JOIN "classified_areas" a ON a."id" = l."area_id" WHERE ${Prisma.join(where, ' AND ')}`;

    const [rows, tiers] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; tier: number; delivers: boolean; rank: number }[]>`
        SELECT l."id", (${tier})::int AS tier, ${delivers} AS delivers, (${rank})::float8 AS rank ${from}
        ORDER BY tier, ${order}, l."id" OFFSET ${offset} LIMIT ${limit}`,
      this.prisma.$queryRaw<{ tier: number; count: bigint }[]>`SELECT (${tier})::int AS tier, count(*) AS count ${from} GROUP BY 1`,
    ]);
    const cards = await this.cards(rows.map(row => row.id));
    const counts = Object.fromEntries(tierNames.map((name, index) => [name, Number(tiers.find(row => row.tier === index)?.count ?? 0)]));
    return {
      object: 'list' as const,
      data: rows.map(row => ({ ...cards.get(row.id)!, tier: place.stateId ? tierNames[row.tier] : null, delivers_to_you: row.delivers && row.tier >= 2 })),
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      tiers: place.stateId ? counts : null,
      offset,
      limit,
      sort,
    };
  }

  /** The buyer's card for each listing, in one read. */
  async cards(ids: string[]) {
    const rows = await this.prisma.classifiedListing.findMany({
      where: { id: { in: ids } },
      include: {
        area: { include: { parent: true } },
        category: true,
        customer: { select: { id: true, name: true, createdAt: true, phoneVerifiedAt: true } },
        media: { where: { status: 'ready' }, orderBy: [{ kind: 'asc' }, { position: 'asc' }], select: { kind: true, url: true, width: true, height: true, posterUrl: true } },
      },
    });
    const checked = await this.idChecked(rows.map(row => row.customerId));
    return new Map(
      rows.map(row => {
        const photos = row.media.filter(item => item.kind === 'photo');
        return [
          row.id,
          {
            object: 'classified_listing_card' as const,
            id: row.id,
            ref: Number(row.ref),
            title: row.title!,
            url: `${shopOrigin}/${row.country.toLowerCase()}/l/${row.ref}-${row.slug}`,
            price: { kind: row.priceKind, amount: row.priceMinor === null ? null : Number(row.priceMinor), currency: row.currency },
            condition: row.condition,
            category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
            area: { slug: row.area!.slug, name: row.area!.name, state: { slug: row.area!.parent!.slug, name: row.area!.parent!.name } },
            cover: photos[0] ? { url: photos[0].url, width: photos[0].width, height: photos[0].height } : null,
            photo_count: photos.length,
            has_video: row.media.some(item => item.kind === 'video'),
            delivery: row.delivery,
            seller: { name: publicName(row.customer.name), badges: this.badges(row.customer, checked) },
            published_at: row.publishedAt?.toISOString() ?? null,
          },
        ] as const;
      }),
    );
  }

  /** Sellers whose identity BitoCard has checked (an approved live customer check). */
  private async idChecked(customerIds: string[]) {
    if (!customerIds.length) return new Set<string>();
    const rows = await this.prisma.identityVerification.findMany({
      where: { subject: 'customer', mode: 'live', status: 'approved', customerReference: { in: [...new Set(customerIds)] } },
      select: { customerReference: true },
    });
    return new Set(rows.map(row => row.customerReference));
  }

  private badges(customer: { id: string; phoneVerifiedAt: Date | null }, checked: Set<string | null>) {
    return [...(customer.phoneVerifiedAt ? ['phone_confirmed'] : []), ...(checked.has(customer.id) ? ['id_checked'] : [])];
  }

  /** One listing's public page: live, or sold within 30 days (shown as Sold); anything older or closed is gone (410). */
  async listing(country: string, ref: number) {
    const code = country.toUpperCase();
    await this.listings.requireOpen(code);
    const row = await this.prisma.classifiedListing.findUnique({
      where: { ref: BigInt(ref) },
      include: {
        area: { include: { parent: true } },
        category: { include: { parent: true, features: true } },
        features: { include: { feature: true } },
        customer: { select: { id: true, name: true, createdAt: true, phoneVerifiedAt: true, phone: true } },
        media: { where: { status: 'ready' }, orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
      },
    });
    if (!row || row.country !== code || ['draft', 'pending_review'].includes(row.status)) throw notFound();
    if (row.status === 'sold' ? !row.soldAt || Date.now() - row.soldAt.getTime() > soldVisibleMs : row.status !== 'active') throw gone();
    const [checked, active, responseRate, holding] = await Promise.all([
      this.idChecked([row.customerId]),
      this.prisma.classifiedListing.count({ where: { customerId: row.customerId, status: 'active' } }),
      this.leads.responseRate(row.customerId),
      this.prisma.classifiedOrder.count({ where: { listingId: row.id, status: { in: ['paid', 'sent', 'disputed'] } } }),
    ]);
    const order = new Map(row.category!.features.map(link => [link.featureId, link.position]));
    const photos = row.media.filter(item => item.kind === 'photo');
    const video = row.media.find(item => item.kind === 'video');
    const category = row.category!;
    return {
      object: 'classified_listing_page' as const,
      id: row.id,
      ref: Number(row.ref),
      status: row.status,
      title: row.title!,
      slug: row.slug!,
      url: `${shopOrigin}/${row.country.toLowerCase()}/l/${row.ref}-${row.slug}`,
      description: row.description,
      price: { kind: row.priceKind, amount: row.priceMinor === null ? null : Number(row.priceMinor), currency: row.currency },
      condition: row.condition,
      category: {
        slug: category.slug,
        name: category.name,
        parent: category.parent ? { slug: category.parent.slug, name: category.parent.name } : null,
        safety_checklist: category.safetyChecklist.length ? category.safetyChecklist : (category.parent?.safetyChecklist ?? []),
      },
      area: { slug: row.area!.slug, name: row.area!.name, state: { slug: row.area!.parent!.slug, name: row.area!.parent!.name } },
      features: row.features
        .sort((a, b) => (order.get(a.featureId) ?? 1000) - (order.get(b.featureId) ?? 1000) || a.feature.name.localeCompare(b.feature.name))
        .map(value => ({ key: value.feature.key, name: value.feature.name, icon: value.feature.icon, unit: value.feature.unit, value: featureValueOut(value.feature.dataType, value) })),
      photos: photos.map(item => ({ url: item.url, width: item.width, height: item.height })),
      video: video ? { url: video.url, poster_url: video.posterUrl, duration_ms: video.durationMs, width: video.width, height: video.height } : null,
      delivery: row.delivery,
      /** Paid for with Safe pay and waiting for the hand-over. */
      reserved: holding > 0,
      contact: { chat: row.contact !== 'phone', phone: row.contact !== 'chat' && Boolean(row.customer.phoneVerifiedAt && row.customer.phone) },
      seller: { name: publicName(row.customer.name), member_since: row.customer.createdAt.toISOString(), badges: this.badges(row.customer, checked), active_listings: active, response_rate: responseRate },
      published_at: row.publishedAt?.toISOString() ?? null,
      sold_at: row.soldAt?.toISOString() ?? null,
    };
  }

  /** As the buyer types: matching categories, then titles of live listings like it (typos forgiven). */
  async suggest(country: string, q: string) {
    const code = country.toUpperCase();
    await this.listings.requireOpen(code);
    const words = q.trim().toLowerCase().slice(0, 60);
    if (words.length < 2) return { object: 'list' as const, categories: [], queries: [] };
    const [categories, titles] = await Promise.all([
      this.prisma.classifiedCategory.findMany({
        where: { enabled: true, parentId: { not: null }, countries: { some: { country: code, enabled: true } }, name: { contains: words, mode: 'insensitive' } },
        include: { parent: true },
        take: 3,
        orderBy: { name: 'asc' },
      }),
      this.prisma.$queryRaw<{ title: string }[]>`
        SELECT t."title" FROM (
          SELECT DISTINCT ON (lower(l."title")) l."title", word_similarity(${words}, lower(l."title")) AS score
          FROM "classified_listings" l
          WHERE l."country" = ${code} AND l."status" = 'active' AND (lower(l."title") LIKE ${`%${words.replace(/[%_\\]/g, '\\$&')}%`} OR word_similarity(${words}, lower(l."title")) >= 0.45)
          ORDER BY lower(l."title"), score DESC
        ) t ORDER BY t."score" DESC, t."title" LIMIT 6`,
    ]);
    return {
      object: 'list' as const,
      categories: categories.map(category => ({ slug: category.slug, name: category.name, parent: category.parent ? { slug: category.parent.slug, name: category.parent.name } : null })),
      queries: titles.map(row => row.title),
    };
  }
}
