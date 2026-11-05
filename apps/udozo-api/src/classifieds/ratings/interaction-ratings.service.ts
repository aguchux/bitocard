import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../../notifications/inbox.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { listingPath } from '../contact.service.js';
import { ListingsService } from '../listings.service.js';
import { cleanReviewText } from '../reviews/reviews.service.js';
import { SafePayGuardsService } from '../safe-pay-guards.service.js';

const secondMs = 1000;
const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

export const interactionChannels = ['call', 'chat', 'callback', 'contact'] as const;
export type InteractionChannel = (typeof interactionChannels)[number];
/** What went well, what did not, and the two safety tags that put a rating in front of Udozo's team. */
export const goodTags = ['answered_fast', 'clear_answers', 'honest_item'] as const;
export const badTags = ['pushy', 'rude', 'no_reply', 'no_show', 'price_changed', 'item_unavailable'] as const;
export const safetyTags = ['pay_outside', 'upfront_payment'] as const;
export const interactionTags = [...goodTags, ...badTags, ...safetyTags] as const;
export type InteractionTag = (typeof interactionTags)[number];
export const maxComment = 500;

/** A chat counts once the buyer wrote twice and the seller replied, or wrote once and waited this long for nothing. */
export const chatSilenceMs = dayMs;
/** A missed call counts once it rang this long. */
export const callRangMs = 10 * secondMs;
/** A request counts once answered, or once left unanswered this long. */
export const requestWaitMs = 48 * hourMs;
/** A rating can be changed this long after it was written. */
export const editWindowMs = 30 * dayMs;
/** One rating of the same seller per buyer in this long (about different listings). */
export const sellerGapMs = 30 * dayMs;
export const perDay = 10;
/** The seller sees their summary from this many ratings, never fewer. */
export const minShown = 5;
/** Asked at most once a day. */
export const promptGapMs = dayMs;
/** Ratings count towards the summary for a year; kept two years (the `marketing` job), prompts 90 days. */
const countedMs = 365 * dayMs;
const keptMs = 2 * 365 * dayMs;
const promptsKeptMs = 90 * dayMs;

export type InteractionInput = { responsiveness: number; helpfulness: number; courtesy: number; tags?: string[]; comment?: string | null };
type Source = { channel: InteractionChannel; source_id: string };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such rating.');
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);

/** Midnight UTC today: the seller's summary counts ratings up to it, so a rating never shows the day it is written. */
export const summaryCutoff = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const average = (values: number[]) => (values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null);

/** The tags kept, in the list's order; an unknown one is refused. */
function cleanTags(tags: string[] | undefined) {
  const given = new Set(tags ?? []);
  for (const tag of given) if (!(interactionTags as readonly string[]).includes(tag)) throw invalid(`Unknown tag: ${tag}.`, 'tags');
  return interactionTags.filter(tag => given.has(tag));
}

function cleanScores(input: Partial<InteractionInput>) {
  for (const key of ['responsiveness', 'helpfulness', 'courtesy'] as const) {
    const value = input[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 5)) throw invalid('Each score is a whole number from 1 to 5.', key);
  }
}

const ratingSelect = {
  id: true, raterId: true, sellerId: true, listingId: true, country: true, channel: true, responsiveness: true, helpfulness: true, courtesy: true, tags: true, comment: true, flagged: true,
  excludedAt: true, excludedReason: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ClassifiedInteractionRatingSelect;
type RatingRow = Prisma.ClassifiedInteractionRatingGetPayload<{ select: typeof ratingSelect }>;

const adminInclude = {
  rater: { select: { id: true, name: true, email: true } },
  seller: { select: { id: true, name: true, email: true } },
  listing: { select: { id: true, ref: true, title: true, slug: true, country: true } },
} satisfies Prisma.ClassifiedInteractionRatingInclude;
type AdminRow = Prisma.ClassifiedInteractionRatingGetPayload<{ include: typeof adminInclude }>;

/**
 * Private ratings of how sellers deal with buyers before a sale (docs/UDOZO_RATINGS_PLAN.md phase 2). Once a buyer has
 * really been in touch about a listing (a chat both sides wrote in, or one the seller left unanswered a day; a call
 * that was answered or rang at least 10 seconds; a call back or contact request answered, or left two days), they may
 * rate the seller's responsiveness, helpfulness and courtesy, 1 to 5, with tags and a note for Udozo's team. Once per
 * listing (changed for 30 days), once per seller in 30 days, ten a day. The seller sees only an anonymous summary of
 * at least five ratings, counted up to last midnight (UTC), so no single rating can be told apart; no listing, channel,
 * date or note. A safety tag (asked to pay outside Udozo, or upfront) tells Udozo's team; admins see everything and
 * can leave a rating out of the summary.
 */
@Injectable()
export class InteractionRatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly listings: ListingsService,
    private readonly guards: SafePayGuardsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** Whether buyers rate sellers in a market. */
  isOpen(country: string) {
    return this.settings.isOnForCountry('classifieds_interaction_ratings', country);
  }

  private async listing(id: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id }, select: { id: true, customerId: true, country: true, title: true, ref: true, slug: true } });
    if (!listing) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.', 'listing_id');
    return listing;
  }

  /** What the buyer did with the seller about this listing that lets them rate it, strongest first. */
  async sources(raterId: string, listingId: string, sellerId: string, now = new Date()): Promise<Source[]> {
    const [conversation, calls, requests] = await Promise.all([
      this.prisma.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId, buyerId: raterId } }, select: { id: true, sellerId: true, sellerRepliedAt: true } }),
      this.prisma.classifiedCall.findMany({
        where: { listingId, OR: [{ callerId: raterId, calleeId: sellerId }, { callerId: sellerId, calleeId: raterId }] },
        select: { id: true, status: true, answeredAt: true, endedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.classifiedContactRequest.findMany({ where: { listingId, buyerId: raterId, sellerId }, select: { id: true, kind: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const found: Source[] = [];
    const call = calls.find(row => row.answeredAt || (row.status === 'missed' && (row.endedAt ?? now).getTime() - row.createdAt.getTime() >= callRangMs));
    if (call) found.push({ channel: 'call', source_id: call.id });
    if (conversation && conversation.sellerId === sellerId) {
      const written = await this.prisma.classifiedMessage.findMany({ where: { conversationId: conversation.id, senderId: raterId, kind: { in: ['text', 'photo', 'offer'] } }, select: { createdAt: true }, orderBy: { seq: 'asc' }, take: 2 });
      const replied = Boolean(conversation.sellerRepliedAt);
      if ((replied && written.length >= 2) || (!replied && written.length >= 1 && now.getTime() - written[0]!.createdAt.getTime() >= chatSilenceMs)) found.push({ channel: 'chat', source_id: conversation.id });
    }
    for (const kind of ['callback', 'contact'] as const) {
      const request = requests.find(row => row.kind === kind && row.status !== 'cancelled' && (row.status !== 'pending' || now.getTime() - row.createdAt.getTime() >= requestWaitMs));
      if (request) found.push({ channel: kind, source_id: request.id });
    }
    return found;
  }

  /**
   * Whether the buyer can rate the seller about a listing, their own rating, and (with `prompt`) whether to ask them
   * now, which counts as asking: at most one listing a day, never again once they said not now or rated.
   */
  async state(customer: CustomerWithStore, listingId: string, prompt = false) {
    const country = await this.listings.sellerCountry(customer);
    const listing = await this.listing(listingId);
    const open = await this.isOpen(listing.country);
    const own = await this.prisma.classifiedInteractionRating.findUnique({ where: { raterId_listingId: { raterId: customer.id, listingId } }, select: ratingSelect });
    const base = { object: 'classified_interaction_rating_state' as const, listing_id: listingId, open, rating: own ? this.presentOwn(own) : null };
    if (!open || listing.customerId === customer.id || listing.country !== country) return { ...base, can_rate: false, reason: listing.customerId === customer.id ? 'own_listing' : 'closed', channels: [], prompt: false };
    const channels = own ? [] : await this.sources(customer.id, listingId, listing.customerId);
    let reason: string | null = own ? 'rated' : channels.length ? null : 'nothing_yet';
    if (!reason && (await this.recentOfSeller(customer.id, listing.customerId, listingId))) reason = 'seller_rated_recently';
    const canRate = !reason;
    let asked = false;
    if (prompt && canRate) asked = await this.ask(customer.id, listingId);
    return { ...base, can_rate: canRate, reason, channels: channels.map(source => source.channel), prompt: asked };
  }

  /** Asks (and records it) unless they said not now here, or were asked about another listing today. */
  private async ask(customerId: string, listingId: string, now = new Date()) {
    const [here, other] = await Promise.all([
      this.prisma.classifiedInteractionPrompt.findUnique({ where: { customerId_listingId: { customerId, listingId } } }),
      this.prisma.classifiedInteractionPrompt.findFirst({ where: { customerId, listingId: { not: listingId }, shownAt: { gt: new Date(now.getTime() - promptGapMs) } }, select: { listingId: true } }),
    ]);
    if (here?.dismissedAt) return false;
    if (here && now.getTime() - here.shownAt.getTime() < promptGapMs) return true;
    if (other) return false;
    await this.prisma.classifiedInteractionPrompt.upsert({ where: { customerId_listingId: { customerId, listingId } }, create: { customerId, listingId, shownAt: now }, update: { shownAt: now } });
    return true;
  }

  /** Not now: never asked about this listing again (they can still rate it from the listing). */
  async dismiss(customer: CustomerWithStore, listingId: string) {
    await this.listings.sellerCountry(customer);
    await this.listing(listingId);
    const now = new Date();
    await this.prisma.classifiedInteractionPrompt.upsert({ where: { customerId_listingId: { customerId: customer.id, listingId } }, create: { customerId: customer.id, listingId, shownAt: now, dismissedAt: now }, update: { dismissedAt: now } });
    return { object: 'classified_interaction_prompt' as const, listing_id: listingId, dismissed: true };
  }

  private recentOfSeller(raterId: string, sellerId: string, listingId: string, now = new Date()) {
    return this.prisma.classifiedInteractionRating.findFirst({ where: { raterId, sellerId, listingId: { not: listingId }, createdAt: { gt: new Date(now.getTime() - sellerGapMs) } }, select: { id: true } });
  }

  async create(customer: CustomerWithStore, input: InteractionInput & { listing_id: string; channel?: InteractionChannel }) {
    const country = await this.listings.sellerCountry(customer);
    const listing = await this.listing(input.listing_id);
    if (!(await this.isOpen(listing.country)) || listing.country !== country) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'ratings_unavailable', 'Rating sellers is not open in this country yet.');
    if (listing.customerId === customer.id) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'own_listing', 'You cannot rate yourself.');
    cleanScores(input);
    const tags = cleanTags(input.tags);
    const comment = input.comment?.trim() ? cleanReviewText(input.comment, maxComment) : null;
    if (await this.prisma.classifiedInteractionRating.findUnique({ where: { raterId_listingId: { raterId: customer.id, listingId: listing.id } }, select: { id: true } })) {
      throw conflict('rating_given', 'You already rated this seller about this listing: change your rating instead.');
    }
    const sources = await this.sources(customer.id, listing.id, listing.customerId);
    const source = input.channel ? sources.find(item => item.channel === input.channel) : sources[0];
    if (!source) throw conflict('rating_not_open', input.channel ? 'You have not been in touch with the seller that way about this listing yet.' : 'You can rate the seller once you have been in touch about this listing.', input.channel ? 'channel' : undefined);
    if (await this.recentOfSeller(customer.id, listing.customerId, listing.id)) throw conflict('seller_rated_recently', 'You rated this seller in the last 30 days.');
    if ((await this.prisma.classifiedInteractionRating.count({ where: { raterId: customer.id, createdAt: { gt: new Date(Date.now() - dayMs) } } })) >= perDay) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'rating_limit', `You can rate ${perDay} sellers a day. Try again tomorrow.`);
    }
    if (await this.guards.samePerson(customer.id, listing.customerId)) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'same_person', 'A rating is from a buyer to a different seller, so it cannot be written here.');
    const flagged = tags.some(tag => (safetyTags as readonly string[]).includes(tag));
    let row: RatingRow;
    try {
      row = await this.prisma.classifiedInteractionRating.create({
        data: { raterId: customer.id, sellerId: listing.customerId, listingId: listing.id, country: listing.country, channel: source.channel, sourceId: source.source_id, responsiveness: input.responsiveness, helpfulness: input.helpfulness, courtesy: input.courtesy, tags, comment, flagged },
        select: ratingSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('rating_given', 'You already rated this seller about this listing: change your rating instead.');
      throw error;
    }
    if (flagged) await this.alert(row);
    return this.presentOwn(row);
  }

  async update(customer: CustomerWithStore, id: string, input: Partial<InteractionInput>) {
    await this.listings.sellerCountry(customer);
    const row = await this.prisma.classifiedInteractionRating.findUnique({ where: { id }, select: ratingSelect });
    if (!row || row.raterId !== customer.id) throw notFound();
    if (Date.now() - row.createdAt.getTime() > editWindowMs) throw conflict('rating_edit_closed', 'A rating can be changed for 30 days after you wrote it.');
    cleanScores(input);
    const tags = input.tags !== undefined ? cleanTags(input.tags) : row.tags;
    const flagged = tags.some(tag => (safetyTags as readonly string[]).includes(tag));
    const updated = await this.prisma.classifiedInteractionRating.update({
      where: { id },
      data: {
        ...(input.responsiveness !== undefined ? { responsiveness: input.responsiveness } : {}),
        ...(input.helpfulness !== undefined ? { helpfulness: input.helpfulness } : {}),
        ...(input.courtesy !== undefined ? { courtesy: input.courtesy } : {}),
        ...(input.tags !== undefined ? { tags } : {}),
        ...(input.comment !== undefined ? { comment: input.comment?.trim() ? cleanReviewText(input.comment, maxComment) : null } : {}),
        flagged,
      },
      select: ratingSelect,
    });
    if (flagged && !row.flagged) await this.alert(updated);
    return this.presentOwn(updated);
  }

  private async alert(row: RatingRow) {
    await this.inbox.admins('admin.classifieds.interaction_flagged', {
      subject: row.id,
      title: 'A buyer said a seller asked them to pay outside Udozo or upfront',
      body: 'Read the rating and the seller\'s other ratings, then decide what to do.',
      link: `/classifieds/ratings?seller=${row.sellerId}`,
    });
  }

  /**
   * The seller's anonymous summary: their ratings of the last 12 months up to last midnight (UTC), left out by admins
   * excluded, shown only from five. Averages and how often each tag was given; never who, which listing, how or when.
   */
  async summaryFor(customer: CustomerWithStore) {
    const country = await this.listings.sellerCountry(customer);
    const open = await this.isOpen(country);
    const cutoff = summaryCutoff();
    if (!open) return { object: 'classified_interaction_summary' as const, open, as_of: cutoff.toISOString(), shown: false, minimum: minShown, count: null, scores: null, tags: [] };
    const rows = await this.prisma.classifiedInteractionRating.findMany({
      where: { sellerId: customer.id, excludedAt: null, createdAt: { lt: cutoff, gt: new Date(cutoff.getTime() - countedMs) } },
      select: { responsiveness: true, helpfulness: true, courtesy: true, tags: true },
    });
    const shown = rows.length >= minShown;
    return { object: 'classified_interaction_summary' as const, open, as_of: cutoff.toISOString(), minimum: minShown, ...(shown ? { shown: true, ...this.aggregate(rows) } : { shown: false, count: null, scores: null, tags: [] }) };
  }

  private aggregate(rows: Pick<RatingRow, 'responsiveness' | 'helpfulness' | 'courtesy' | 'tags'>[]) {
    const tagCounts = new Map<string, number>();
    for (const row of rows) for (const tag of row.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    return {
      count: rows.length,
      scores: { responsiveness: average(rows.map(row => row.responsiveness)), helpfulness: average(rows.map(row => row.helpfulness)), courtesy: average(rows.map(row => row.courtesy)) },
      tags: interactionTags.filter(tag => tagCounts.has(tag)).map(tag => ({ tag, count: tagCounts.get(tag)! })).sort((a, b) => b.count - a.count),
    };
  }

  /** The buyer's own rating: never the seller's view of it. */
  private presentOwn(row: RatingRow) {
    return {
      object: 'classified_interaction_rating' as const,
      id: row.id,
      listing_id: row.listingId,
      channel: row.channel,
      responsiveness: row.responsiveness,
      helpfulness: row.helpfulness,
      courtesy: row.courtesy,
      tags: row.tags,
      comment: row.comment,
      can_edit: Date.now() - row.createdAt.getTime() <= editWindowMs,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  // ---- Admins ----

  private presentAdmin(row: AdminRow) {
    return {
      object: 'classified_admin_interaction_rating' as const,
      id: row.id,
      channel: row.channel,
      country: row.country,
      responsiveness: row.responsiveness,
      helpfulness: row.helpfulness,
      courtesy: row.courtesy,
      tags: row.tags,
      comment: row.comment,
      flagged: row.flagged,
      excluded: row.excludedAt ? { at: row.excludedAt.toISOString(), reason: row.excludedReason } : null,
      rater: row.rater,
      seller: row.seller,
      listing: { id: row.listing.id, title: row.listing.title, path: listingPath(row.listing) },
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  async adminList(filter: { flagged?: boolean; country?: string; seller?: string; rater?: string; limit?: number; offset?: number }) {
    const where: Prisma.ClassifiedInteractionRatingWhereInput = {
      ...(filter.flagged ? { flagged: true, excludedAt: null } : {}),
      ...(filter.country ? { country: filter.country } : {}),
      ...(filter.seller ? { sellerId: filter.seller } : {}),
      ...(filter.rater ? { raterId: filter.rater } : {}),
    };
    const [rows, total, flagged] = await Promise.all([
      this.prisma.classifiedInteractionRating.findMany({ where, include: adminInclude, orderBy: { createdAt: 'desc' }, take: Math.min(filter.limit ?? 50, 100), skip: filter.offset ?? 0 }),
      this.prisma.classifiedInteractionRating.count({ where }),
      this.prisma.classifiedInteractionRating.count({ where: { flagged: true, excludedAt: null } }),
    ]);
    return { object: 'list' as const, counts: { flagged }, data: rows.map(row => this.presentAdmin(row)), total };
  }

  /** A seller's ratings for admins: the summary as it stands now (today's included, the minimum ignored) and the latest 100. */
  async adminSeller(sellerId: string) {
    const [counted, rows, excluded] = await Promise.all([
      this.prisma.classifiedInteractionRating.findMany({ where: { sellerId, excludedAt: null, createdAt: { gt: new Date(Date.now() - countedMs) } }, select: { responsiveness: true, helpfulness: true, courtesy: true, tags: true } }),
      this.prisma.classifiedInteractionRating.findMany({ where: { sellerId }, include: adminInclude, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.classifiedInteractionRating.count({ where: { sellerId, excludedAt: { not: null } } }),
    ]);
    return {
      object: 'classified_admin_interaction_summary' as const,
      seller_id: sellerId,
      minimum: minShown,
      shown_to_seller: counted.length >= minShown,
      excluded,
      ...this.aggregate(counted),
      data: rows.map(row => this.presentAdmin(row)),
    };
  }

  /** Leaves a rating out of the seller's summary (or puts it back), with why; audited. */
  async exclude(actorId: string | null, id: string, excluded: boolean, reason: string) {
    const row = await this.prisma.classifiedInteractionRating.findUnique({ where: { id }, select: { id: true, excludedAt: true } });
    if (!row) throw notFound();
    if (Boolean(row.excludedAt) !== excluded) {
      await this.prisma.classifiedInteractionRating.update({ where: { id }, data: excluded ? { excludedAt: new Date(), excludedById: actorId, excludedReason: reason } : { excludedAt: null, excludedById: null, excludedReason: null } });
      await this.audit.record({ actorId, action: excluded ? 'classifieds.interaction_rating_excluded' : 'classifieds.interaction_rating_restored', targetType: 'classified_interaction_rating', targetId: id, before: { excluded: Boolean(row.excludedAt) }, after: { excluded, reason } });
    }
    return this.presentAdmin(await this.prisma.classifiedInteractionRating.findUniqueOrThrow({ where: { id }, include: adminInclude }));
  }

  /** Retention (the daily `marketing` job): ratings after two years, prompts after 90 days. */
  async purge(now = new Date()) {
    const [ratings, prompts] = await Promise.all([
      this.prisma.classifiedInteractionRating.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - keptMs) } } }),
      this.prisma.classifiedInteractionPrompt.deleteMany({ where: { shownAt: { lt: new Date(now.getTime() - promptsKeptMs) } } }),
    ]);
    return { ratings: ratings.count, prompts: prompts.count };
  }
}
