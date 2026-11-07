import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../../notifications/inbox.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { cleanNote } from '../contact.service.js';
import { ConversationsService, safetyNote } from '../conversations.service.js';
import { ListingsService } from '../listings.service.js';
import { conditionName, conditions, invalid, isOnShop, priceText } from '../rules.js';
import { ListingSearchService, publicName } from '../search.service.js';

const dayMs = 86_400_000;
/** A request is open this long. */
export const wantedDays = 14;
export const wantedSources = ['web', 'whatsapp'] as const;
export type WantedSource = (typeof wantedSources)[number];

export type WantedInput = {
  words: string;
  category_id: string;
  area_id?: string | null;
  state_id?: string | null;
  details?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  conditions?: string[];
};

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such request.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

const include = {
  category: { select: { id: true, slug: true, name: true, parentId: true } },
  state: { select: { id: true, slug: true, name: true } },
  area: { select: { id: true, slug: true, name: true, parent: { select: { id: true, slug: true, name: true } } } },
  customer: { select: { id: true, name: true, storeId: true } },
  _count: { select: { responses: true } },
} satisfies Prisma.ClassifiedWantedRequestInclude;
type RequestRow = Prisma.ClassifiedWantedRequestGetPayload<{ include: typeof include }>;

export const wantedNumber = (number: bigint | number) => `WR-${String(number).padStart(6, '0')}`;

/** "Wuse, FCT", "FCT", or "" for the whole country. */
export const wantedPlace = (row: { area: { name: string; parent: { name: string } | null } | null; state: { name: string } | null }) =>
  row.area ? (row.area.parent ? `${row.area.name}, ${row.area.parent.name}` : row.area.name) : (row.state?.name ?? '');

/** The budget as people read it ("up to ₦450,000", "₦200,000 to ₦450,000"), or null. */
export const budgetText = (row: { budgetMinMinor: bigint | null; budgetMaxMinor: bigint | null; currency: string }) =>
  row.budgetMaxMinor !== null
    ? row.budgetMinMinor ? `${priceText(row.budgetMinMinor, row.currency)} to ${priceText(row.budgetMaxMinor, row.currency)}` : `up to ${priceText(row.budgetMaxMinor, row.currency)}`
    : row.budgetMinMinor !== null ? `from ${priceText(row.budgetMinMinor, row.currency)}` : null;

/**
 * Wanted requests (docs/UDOZO_WHATSAPP_PLAN.md): a buyer says what they need (category, place, budget, condition), sees
 * matching listings at once, and Udozo tells sellers with live listings in that category, nearest first, each once
 * and within each market's daily cap. A seller answers with one of their live listings in the category, which opens
 * (or joins) that listing's chat with the buyer. On udozo.com and WhatsApp alike, behind `classifieds_wanted`.
 */
@Injectable()
export class WantedService {
  private readonly logger = new Logger(WantedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly search: ListingSearchService,
    private readonly conversations: ConversationsService,
    private readonly inbox: InboxService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async open(country: string) {
    return this.settings.isOnForCountry('classifieds_wanted', country);
  }

  private async requireOpen(country: string) {
    if (!(await this.open(country))) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'wanted_unavailable', 'Requests are not open in your country yet.');
  }

  // ---- Buyers ----

  async create(customer: CustomerWithStore, input: WantedInput, source: WantedSource = 'web', now = new Date()) {
    const country = await this.listings.sellerCountry(customer);
    await this.requireOpen(country);
    const words = input.words.replace(/\s+/g, ' ').trim();
    if (words.length < 3) throw invalid('parameter_invalid', 'Say what you are looking for in a few words.', 'words');
    if (words.length > 80) throw invalid('parameter_invalid', 'Keep what you are looking for under 80 characters; add the rest as details.', 'words');
    const category = await this.prisma.classifiedCategory.findFirst({ where: { id: input.category_id, enabled: true, countries: { some: { country, enabled: true } } }, select: { id: true } });
    if (!category) throw invalid('parameter_invalid', 'Choose a category open in your country.', 'category_id');
    let stateId: string | null = null;
    let areaId: string | null = null;
    if (input.area_id) {
      const area = await this.prisma.classifiedArea.findFirst({ where: { id: input.area_id, country, kind: 'area', enabled: true }, select: { id: true, parentId: true } });
      if (!area) throw invalid('parameter_invalid', 'Choose an area in your country.', 'area_id');
      areaId = area.id;
      stateId = area.parentId;
    } else if (input.state_id) {
      const state = await this.prisma.classifiedArea.findFirst({ where: { id: input.state_id, country, kind: 'state', enabled: true }, select: { id: true } });
      if (!state) throw invalid('parameter_invalid', 'Choose a state in your country.', 'state_id');
      stateId = state.id;
    }
    const min = input.budget_min ?? null;
    const max = input.budget_max ?? null;
    for (const [value, param] of [[min, 'budget_min'], [max, 'budget_max']] as const) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 1e15)) throw invalid('parameter_invalid', 'Give the budget in minor units.', param);
    }
    if (min !== null && max !== null && min > max) throw invalid('parameter_invalid', 'The lowest budget is above the highest.', 'budget_min');
    const wanted = [...new Set(input.conditions ?? [])];
    for (const condition of wanted) if (!(conditions as readonly string[]).includes(condition)) throw invalid('parameter_invalid', 'Conditions are new, used, untested or parts.', 'conditions');
    const details = input.details ? cleanNote(input.details).slice(0, 300) || null : null;
    await this.refuseWords(country, `${words} ${details ?? ''}`);

    const settings = await this.listings.marketSettings(country);
    const [openCount, today] = await Promise.all([
      this.prisma.classifiedWantedRequest.count({ where: { customerId: customer.id, status: 'open' } }),
      this.prisma.classifiedWantedRequest.count({ where: { customerId: customer.id, createdAt: { gt: new Date(now.getTime() - dayMs) } } }),
    ]);
    if (openCount >= settings.wantedOpenPerBuyer) throw conflict('too_many_requests', `You have ${openCount} open requests. Close one first.`);
    if (today >= settings.wantedPerDay) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'request_limit', 'You have made several requests today. Try again tomorrow.');

    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: country }, select: { currency: true } });
    const row = await this.prisma.classifiedWantedRequest.create({
      data: {
        customerId: customer.id,
        country,
        currency: market.currency,
        categoryId: category.id,
        stateId,
        areaId,
        words,
        details,
        budgetMinMinor: min === null ? null : BigInt(min),
        budgetMaxMinor: max === null ? null : BigInt(max),
        conditions: wanted,
        source,
        expiresAt: new Date(now.getTime() + wantedDays * dayMs),
      },
      include,
    });
    const told = await this.tellSellers(row, now).catch(error => {
      this.logger.warn({ err: error, request: row.id }, 'Could not tell sellers about a wanted request');
      return 0;
    });
    return { ...this.present({ ...row, sellersTold: told }, customer.id), matches: await this.matches(row) };
  }

  private async refuseWords(country: string, text: string) {
    const words = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', action: 'block', OR: [{ country: null }, { country }] }, select: { phrase: true } });
    const lower = text.toLowerCase();
    if (words.some(word => lower.includes(word.phrase.toLowerCase()))) throw invalid('request_prohibited', 'This cannot be asked for on Udozo.', 'words');
  }

  /** Up to 5 live listings that may fit (what the buyer sees at once). */
  async matches(row: RequestRow) {
    try {
      const found = await this.search.search({
        country: row.country,
        q: row.words,
        category: row.category.slug,
        ...(row.area ? { area: row.area.slug, state: row.area.parent?.slug } : row.state ? { state: row.state.slug } : {}),
        ...(row.budgetMaxMinor !== null ? { price_max: Number(row.budgetMaxMinor) } : {}),
        ...(row.conditions.length ? { condition: row.conditions } : {}),
        limit: 5,
      });
      return found.data;
    } catch {
      return [];
    }
  }

  /**
   * Sellers with a live listing in the category (or its subcategories) in the country, the request's area first, then
   * its state, then the rest, each told once: never the buyer, a suspended seller, one who blocked the buyer, or one
   * already told the market's daily number of requests.
   */
  async tellSellers(row: RequestRow, now = new Date()) {
    const settings = await this.listings.marketSettings(row.country);
    const categoryIds = row.category.parentId ? [row.category.id] : [row.category.id, ...(await this.prisma.classifiedCategory.findMany({ where: { parentId: row.category.id }, select: { id: true } })).map(child => child.id)];
    const since = new Date(now.getTime() - dayMs);
    const sellers = await this.prisma.$queryRaw<Array<{ id: string; store_id: string }>>`
      SELECT c."id", c."store_id" FROM "customers" c
      JOIN "classified_listings" l ON l."customer_id" = c."id"
      WHERE l."status" = 'active' AND l."on_shop" AND l."country" = ${row.country}
        AND l."category_id" IN (${Prisma.join(categoryIds.map(id => Prisma.sql`${id}::uuid`))})
        AND c."id" <> ${row.customerId}::uuid AND c."status" = 'active'
        AND NOT EXISTS (SELECT 1 FROM "classified_sellers" s WHERE s."customer_id" = c."id" AND s."suspended_at" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "classified_conversations" b WHERE b."seller_id" = c."id" AND b."buyer_id" = ${row.customerId}::uuid AND b."seller_blocked_at" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "classified_wanted_matches" m WHERE m."request_id" = ${row.id}::uuid AND m."seller_id" = c."id")
        AND (SELECT count(*) FROM "classified_wanted_matches" m WHERE m."seller_id" = c."id" AND m."notified_at" > ${since}) < ${settings.wantedNoticesPerSellerDay}
      GROUP BY c."id", c."store_id"
      ORDER BY max(CASE WHEN ${row.areaId}::uuid IS NOT NULL AND l."area_id" = ${row.areaId}::uuid THEN 2 WHEN ${row.stateId}::uuid IS NOT NULL AND l."state_id" = ${row.stateId}::uuid THEN 1 ELSE 0 END) DESC, max(l."published_at") DESC
      LIMIT ${settings.wantedSellersPerRequest}`;
    if (!sellers.length) return row.sellersTold;
    const created = await this.prisma.classifiedWantedMatch.createManyAndReturn({ data: sellers.map(seller => ({ requestId: row.id, sellerId: seller.id, notifiedAt: now })), skipDuplicates: true });
    const place = wantedPlace(row);
    const budget = budgetText(row);
    for (const match of created) {
      const seller = sellers.find(item => item.id === match.sellerId)!;
      await this.inbox.customer({ customerId: seller.id, storeId: seller.store_id }, 'customer.classifieds.wanted_match', {
        subject: row.id,
        title: `A buyer is looking for ${row.words}`,
        body: [place ? `In ${place}` : null, budget ? `Budget ${budget}` : null, 'Answer with one of your listings.'].filter(Boolean).join('. '),
        link: `/account/wanted/${row.id}`,
      });
    }
    const updated = await this.prisma.classifiedWantedRequest.update({ where: { id: row.id }, data: { sellersTold: { increment: created.length } }, select: { sellersTold: true } });
    return updated.sellersTold;
  }

  async mine(customer: CustomerWithStore, query: { status?: string; limit?: number; offset?: number } = {}) {
    await this.listings.sellerCountry(customer);
    const where: Prisma.ClassifiedWantedRequestWhereInput = { customerId: customer.id, ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedWantedRequest.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: query.limit ?? 30, skip: query.offset ?? 0 }),
      this.prisma.classifiedWantedRequest.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.present(row, customer.id)), total };
  }

  /** One request: its buyer sees it with the answers; a seller it was sent to sees it with which of their listings fit. */
  async get(customer: CustomerWithStore, id: string) {
    await this.listings.sellerCountry(customer);
    const row = await this.find(id);
    if (row.customerId === customer.id) {
      const responses = await this.prisma.classifiedWantedResponse.findMany({ where: { requestId: id }, orderBy: { createdAt: 'desc' }, include: { listing: { select: { id: true } }, seller: { select: { name: true } } } });
      const cards = await this.search.cards(responses.map(response => response.listingId));
      return {
        ...this.present(row, customer.id),
        matches: row.status === 'open' ? await this.matches(row) : [],
        responses: responses.map(response => ({ id: response.id, seller: publicName(response.seller.name), note: response.note, listing: cards.get(response.listingId) ?? null, conversation_id: response.conversationId, created_at: response.createdAt.toISOString() })),
      };
    }
    const match = await this.prisma.classifiedWantedMatch.findUnique({ where: { requestId_sellerId: { requestId: id, sellerId: customer.id } } });
    if (!match) throw notFound();
    const [answered, own] = await Promise.all([
      this.prisma.classifiedWantedResponse.findUnique({ where: { requestId_sellerId: { requestId: id, sellerId: customer.id } } }),
      this.answerable(customer.id, row),
    ]);
    return { ...this.present(row, customer.id), answered: Boolean(answered), answer_listing_id: answered?.listingId ?? null, your_listings: own };
  }

  /** The seller's live listings that can answer a request (its category or subcategories), newest first. */
  async answerable(sellerId: string, row: { country: string; category: { id: string; parentId: string | null } }) {
    const rows = await this.prisma.classifiedListing.findMany({
      where: { customerId: sellerId, status: 'active', onShop: true, country: row.country, ...(row.category.parentId ? { categoryId: row.category.id } : { category: { OR: [{ id: row.category.id }, { parentId: row.category.id }] } }) },
      orderBy: { publishedAt: 'desc' },
      take: 10,
      select: { id: true, ref: true, title: true, slug: true, priceKind: true, priceMinor: true, currency: true },
    });
    return rows.map(listing => ({ id: listing.id, ref: Number(listing.ref), title: listing.title, slug: listing.slug, price: { kind: listing.priceKind, amount: listing.priceMinor === null ? null : Number(listing.priceMinor), currency: listing.currency } }));
  }

  async close(customer: CustomerWithStore, id: string, fulfilled = false) {
    await this.listings.sellerCountry(customer);
    const row = await this.find(id);
    if (row.customerId !== customer.id) throw notFound();
    if (row.status !== 'open') throw conflict('request_closed', 'This request is already closed.');
    await this.prisma.classifiedWantedRequest.updateMany({ where: { id, status: 'open' }, data: { status: fulfilled ? 'fulfilled' : 'closed', closedAt: new Date() } });
    return this.present(await this.find(id), customer.id);
  }

  // ---- Sellers ----

  /** Open requests the seller was told about, newest first, with whether they answered. */
  async forYou(customer: CustomerWithStore, query: { limit?: number; offset?: number } = {}) {
    await this.listings.sellerCountry(customer);
    const where: Prisma.ClassifiedWantedMatchWhereInput = { sellerId: customer.id, request: { status: 'open' } };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedWantedMatch.findMany({ where, orderBy: { notifiedAt: 'desc' }, take: query.limit ?? 30, skip: query.offset ?? 0, include: { request: { include } } }),
      this.prisma.classifiedWantedMatch.count({ where }),
    ]);
    const answered = new Set((await this.prisma.classifiedWantedResponse.findMany({ where: { sellerId: customer.id, requestId: { in: rows.map(row => row.requestId) } }, select: { requestId: true } })).map(row => row.requestId));
    return { object: 'list' as const, data: rows.map(row => ({ ...this.present(row.request, customer.id), answered: answered.has(row.requestId), told_at: row.notifiedAt.toISOString() })), total };
  }

  /**
   * A seller answers with one of their live listings in the request's category: that listing's chat with the buyer is
   * opened (or joined) with their note, and the buyer told. Once per request and seller.
   */
  async respond(customer: CustomerWithStore, id: string, input: { listing_id: string; note?: string | null }) {
    const country = await this.listings.sellerCountry(customer);
    const row = await this.find(id);
    if (row.customerId === customer.id || row.country !== country) throw notFound();
    if (row.status !== 'open' || row.expiresAt <= new Date()) throw conflict('request_closed', 'This request is closed.');
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: input.listing_id }, include: { category: { select: { id: true, parentId: true } } } });
    const fits = listing?.category && (listing.category.id === row.category.id || listing.category.parentId === row.category.id || (row.category.parentId && listing.category.id === row.category.id));
    if (!listing || listing.customerId !== customer.id || !isOnShop(listing) || listing.status !== 'active' || !fits) throw invalid('parameter_invalid', 'Choose one of your live listings in this category.', 'listing_id');
    const blocked = await this.prisma.classifiedConversation.findFirst({ where: { sellerId: customer.id, buyerId: row.customerId, OR: [{ sellerBlockedAt: { not: null } }, { buyerBlockedAt: { not: null } }] }, select: { id: true } });
    if (blocked) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'buyer_unavailable', 'You cannot answer this buyer.');
    const note = input.note ? cleanNote(input.note).slice(0, 300) || null : null;
    let response;
    try {
      response = await this.prisma.classifiedWantedResponse.create({ data: { requestId: id, sellerId: customer.id, listingId: listing.id, note } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('already_answered', 'You already answered this request.');
      throw error;
    }
    const now = new Date();
    let chat = await this.prisma.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId: listing.id, buyerId: row.customerId } } });
    if (!chat) {
      try {
        chat = await this.prisma.$transaction(async tx => {
          const created = await tx.classifiedConversation.create({ data: { listingId: listing.id, buyerId: row.customerId, sellerId: customer.id, country, lastMessageAt: now, sellerReadAt: now } });
          await tx.classifiedMessage.create({ data: { conversationId: created.id, kind: 'system', body: safetyNote, createdAt: now } });
          return created;
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        chat = await this.prisma.classifiedConversation.findUniqueOrThrow({ where: { listingId_buyerId: { listingId: listing.id, buyerId: row.customerId } } });
      }
    }
    await this.conversations.send(customer, chat.id, `About your request "${row.words}" (${wantedNumber(row.number)}): ${note ?? 'this may be what you are looking for.'}`);
    await this.prisma.classifiedWantedResponse.update({ where: { id: response.id }, data: { conversationId: chat.id } });
    await this.inbox.customer({ customerId: row.customerId, storeId: row.customer.storeId }, 'customer.classifieds.wanted_response', {
      subject: response.id,
      title: `A seller answered your request for ${row.words}`,
      body: `${publicName(customer.name)}: ${listing.title}${listing.priceMinor !== null ? `, ${priceText(listing.priceMinor, listing.currency)}` : ''}`,
      link: `/account/messages/${chat.id}`,
    });
    return { object: 'classified_wanted_response' as const, id: response.id, request_id: id, listing_id: listing.id, conversation_id: chat.id };
  }

  // ---- Admins ----

  async adminList(query: { status?: string; country?: string; q?: string; limit?: number; offset?: number }) {
    const where: Prisma.ClassifiedWantedRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.country ? { country: query.country.toUpperCase() } : {}),
      ...(query.q ? { words: { contains: query.q, mode: Prisma.QueryMode.insensitive } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedWantedRequest.findMany({ where, include: { ...include, customer: { select: { id: true, name: true, storeId: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: query.limit ?? 50, skip: query.offset ?? 0 }),
      this.prisma.classifiedWantedRequest.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.map(row => ({ ...this.present(row, null), buyer: { id: row.customer.id, name: row.customer.name, email: row.customer.email } })), total };
  }

  async adminRemove(actorId: string | null, id: string, reason: string) {
    const row = await this.find(id);
    if (row.status === 'removed') throw conflict('request_closed', 'This request is already removed.');
    await this.prisma.classifiedWantedRequest.update({ where: { id }, data: { status: 'removed', closedAt: new Date(), removedReason: reason.slice(0, 500) } });
    await this.audit.record({ actorId, action: 'classifieds.wanted_removed', targetType: 'classified_wanted_request', targetId: id, before: { status: row.status }, after: { status: 'removed', reason } });
    return this.present(await this.find(id), null);
  }

  /** The `classifieds` job: open requests past their time expire. */
  async expireDue(now = new Date()) {
    const expired = await this.prisma.classifiedWantedRequest.updateMany({ where: { status: 'open', expiresAt: { lte: now } }, data: { status: 'expired', closedAt: now } });
    return expired.count;
  }

  // ---- Helpers ----

  async find(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const row = await this.prisma.classifiedWantedRequest.findUnique({ where: { id }, include });
    if (!row) throw notFound();
    return row;
  }

  present(row: RequestRow & { sellersTold?: number }, viewerId: string | null) {
    const status = row.status === 'open' && row.expiresAt <= new Date() ? 'expired' : row.status;
    return {
      object: 'classified_wanted_request' as const,
      id: row.id,
      number: wantedNumber(row.number),
      words: row.words,
      details: row.details,
      country: row.country,
      category: { id: row.category.id, slug: row.category.slug, name: row.category.name },
      place: wantedPlace(row) || null,
      state: row.state ? { id: row.state.id, slug: row.state.slug, name: row.state.name } : null,
      area: row.area ? { id: row.area.id, slug: row.area.slug, name: row.area.name } : null,
      budget: { min: row.budgetMinMinor === null ? null : Number(row.budgetMinMinor), max: row.budgetMaxMinor === null ? null : Number(row.budgetMaxMinor), currency: row.currency, text: budgetText(row) },
      conditions: row.conditions,
      condition_text: row.conditions.length ? row.conditions.map(condition => conditionName(condition)).join(' or ') : null,
      status,
      source: row.source,
      mine: viewerId !== null && row.customerId === viewerId,
      buyer: publicName(row.customer.name),
      sellers_told: row.sellersTold,
      responses: row._count.responses,
      expires_at: row.expiresAt.toISOString(),
      created_at: row.createdAt.toISOString(),
    };
  }
}
