import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { utcDay } from '../signups/journeys.service.js';
import {
  firstContactOf,
  type Journey,
  liveRetentionMs,
  milestonesOf,
  openRetentionMs,
  type PostingMilestone,
  postingMilestones,
  postStepKeys,
  reviewDecisions,
  soldRetentionMs,
  type StuckMilestone,
  stuckAfterMs,
  stuckMilestones,
} from './journeys.service.js';

export const postingStatuses = ['in_progress', 'stuck', 'in_review', 'sent_back', 'live', 'sold', 'abandoned', 'removed'] as const;
export type PostingStatus = (typeof postingStatuses)[number];
export const summaryDays = [7, 30, 90, 365] as const;

const dayMs = 24 * 60 * 60 * 1000;
const reviewRetentionMs = 90 * dayMs;

/** Composing and touched within a day: in progress; quiet longer: stuck. Otherwise where the ad is. */
export function statusOf(journey: Pick<Journey, 'stage' | 'lastEventAt' | 'soldAt'>, now = new Date()): PostingStatus {
  if (journey.stage === 'composing') return now.getTime() - journey.lastEventAt.getTime() < stuckAfterMs ? 'in_progress' : 'stuck';
  if (journey.stage === 'live') return journey.soldAt ? 'sold' : 'live';
  return journey.stage as PostingStatus;
}

/** Where an unfinished journey is (or got stuck): its first composing milestone not reached, or a sent-back ad waiting to be submitted again. */
export function stuckAt(journey: Journey): StuckMilestone | null {
  if (journey.stage === 'sent_back') return 'resubmitted';
  if (journey.stage !== 'composing') return null;
  const reached = milestonesOf(journey);
  return (stuckMilestones.filter(milestone => milestone !== 'resubmitted') as PostingMilestone[]).find(milestone => !reached[milestone]) as StuckMilestone | undefined ?? 'submitted';
}

export function deletesAt(journey: Journey) {
  if (journey.liveAt) {
    const live = journey.liveAt.getTime() + liveRetentionMs;
    return new Date(journey.soldAt ? Math.min(live, journey.soldAt.getTime() + soldRetentionMs) : live);
  }
  return new Date(journey.lastEventAt.getTime() + (journey.stage === 'in_review' ? reviewRetentionMs : openRetentionMs));
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
};
const minutesBetween = (from: Date | null, to: Date | null) => (from && to ? Math.max(0, (to.getTime() - from.getTime()) / 60000) : null);
const average = (sum: number, count: number) => (count ? Math.round((sum / count) * 10) / 10 : null);

type Listed = Journey & { customer: { id: string; name: string; email: string } };
type ListingInfo = { id: string; title: string | null; status: string };

function present(journey: Listed, listing: ListingInfo | null, categories: Map<string, string>, now = new Date()) {
  const at = (date: Date | null) => date?.toISOString() ?? null;
  return {
    object: 'posting_journey' as const,
    id: journey.id,
    status: statusOf(journey, now),
    stage: journey.stage,
    stuck_at: stuckAt(journey),
    source: journey.source,
    country: journey.country,
    device: journey.device,
    seller: { id: journey.customer.id, name: journey.customer.name, email: journey.customer.email },
    listing: journey.listingId ? { id: journey.listingId, ref: journey.listingRef === null ? null : Number(journey.listingRef), sku: journey.sku, title: listing?.title ?? null, status: listing?.status ?? 'deleted' } : null,
    category: journey.topCategoryId ? { id: journey.topCategoryId, name: categories.get(journey.topCategoryId) ?? null } : null,
    furthest_step: journey.furthestStep >= 0 ? postStepKeys[journey.furthestStep] : null,
    milestones: {
      opened: at(journey.openedAt),
      draft: at(journey.draftAt),
      first_photo: at(journey.firstPhotoAt),
      submitted: at(journey.submittedAt),
      review_queued: at(journey.reviewQueuedAt),
      reviewed: at(journey.reviewedAt),
      sent_back: at(journey.sentBackAt),
      resubmitted: at(journey.resubmittedAt),
      live: at(journey.liveAt),
      first_view: at(journey.firstViewAt),
      first_chat: at(journey.firstChatAt),
      first_call: at(journey.firstCallAt),
      first_lead: at(journey.firstLeadAt),
      sold: at(journey.soldAt),
      ended: at(journey.endedAt),
    },
    live_via: journey.liveVia,
    ended_reason: journey.endedReason,
    review_flags: journey.reviewFlags,
    reviews: journey.reviews,
    sent_back_count: journey.sentBackCount,
    last_reject_code: journey.lastRejectCode,
    last_error: journey.lastErrorCode ? { step: journey.lastErrorStep, code: journey.lastErrorCode } : null,
    refusals: journey.refusals,
    submit_attempts: journey.submitAttempts,
    steps: journey.eventCount,
    started_at: journey.startedAt.toISOString(),
    last_event_at: journey.lastEventAt.toISOString(),
    deletes_at: deletesAt(journey).toISOString(),
  };
}

type Breakdown = { key: string; label: string | null; started: number; submitted: number; live: number };

/** Reports > Posting journeys in Udozo's admin: the funnel from Sell to first results, what blocks sellers, reviews, and each journey. */
@Injectable()
export class PostingInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async categoryNames(ids: Iterable<string>) {
    const list = [...new Set([...ids].filter(Boolean))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.prisma.classifiedCategory.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
    return new Map(rows.map(row => [row.id, row.name]));
  }

  /**
   * The last `days` by the day each journey started: journeys still kept plus the daily counts of those already deleted
   * (`purge`), so long ranges keep their history. Medians, in progress, stuck, devices and the review queue now come
   * from the journeys still kept; averages include the daily counts. With a source or category chosen, blockers and
   * reviews count only journeys still kept (the daily counts of those are not split that way).
   */
  async summary(input: { days: number; country?: string; source?: string; category?: string }, now = new Date()) {
    const from = new Date(utcDay(now).getTime() - (input.days - 1) * dayMs);
    const country = input.country ? { country: input.country } : {};
    const split = Boolean(input.source || input.category);
    const where: Prisma.PostingJourneyWhereInput = { startedAt: { gte: from }, ...country, ...(input.source ? { source: input.source } : {}), ...(input.category ? { topCategoryId: input.category } : {}) };
    const [journeys, funnelDays, blockerDays, reviewDays, visitDays, inReview, sentBack] = await Promise.all([
      this.prisma.postingJourney.findMany({ where, take: 50_000 }),
      this.prisma.postingFunnelDay.findMany({ where: { day: { gte: from }, ...country, ...(input.source ? { source: input.source } : {}), ...(input.category ? { topCategoryId: input.category } : {}) } }),
      split ? Promise.resolve([]) : this.prisma.postingBlockerDay.findMany({ where: { day: { gte: from }, ...country } }),
      split ? Promise.resolve([]) : this.prisma.postingReviewDay.findMany({ where: { day: { gte: from }, ...country } }),
      this.prisma.postingVisitDay.findMany({ where: { day: { gte: from }, ...(input.source ? { source: input.source } : {}) } }),
      this.prisma.postingJourney.count({ where: { stage: 'in_review', ...country } }),
      this.prisma.postingJourney.count({ where: { stage: 'sent_back', ...country } }),
    ]);
    const events = journeys.length
      ? await this.prisma.postingJourneyEvent.findMany({
          where: { journeyId: { in: journeys.map(row => row.id) }, OR: [{ outcome: 'refused' }, { origin: 'system', step: { in: [...reviewDecisions] } }] },
          select: { journeyId: true, origin: true, step: true, outcome: true, code: true, param: true, createdAt: true },
        })
      : [];

    const funnel = Object.fromEntries(postingMilestones.map(milestone => [milestone, 0])) as Record<PostingMilestone, number>;
    const stuck = Object.fromEntries(stuckMilestones.map(milestone => [milestone, 0])) as Record<StuckMilestone, number>;
    const statuses = Object.fromEntries(['in_progress', 'stuck', 'in_review', 'sent_back', 'live', 'sold', 'abandoned', 'removed'].map(status => [status, 0])) as Record<PostingStatus, number>;
    const daily = new Map<string, { day: string; visits: number; started: number; submitted: number; live: number }>();
    for (let day = from.getTime(); day <= utcDay(now).getTime(); day += dayMs) {
      const key = new Date(day).toISOString().slice(0, 10);
      daily.set(key, { day: key, visits: 0, started: 0, submitted: 0, live: 0 });
    }
    const groups = { sources: new Map<string, Breakdown>(), categories: new Map<string, Breakdown>(), devices: new Map<string, Breakdown>(), countries: new Map<string, Breakdown>() };
    const tally = (map: Map<string, Breakdown>, key: string, started: number, submitted: number, live: number) => {
      const row = map.get(key) ?? { key, label: null, started: 0, submitted: 0, live: 0 };
      row.started += started;
      row.submitted += submitted;
      row.live += live;
      map.set(key, row);
    };
    const sums = { submit: 0, submitN: 0, live: 0, liveN: 0, contact: 0, contactN: 0 };
    const kept = { submit: [] as number[], live: [] as number[], contact: [] as number[], review: [] as number[] };
    let liveDirect = 0;
    let liveReview = 0;
    let abandoned = 0;
    let removed = 0;

    for (const journey of journeys) {
      const reached = milestonesOf(journey);
      for (const milestone of postingMilestones) funnel[milestone] += Number(reached[milestone]);
      const status = statusOf(journey, now);
      statuses[status] += 1;
      if (status === 'stuck' || status === 'sent_back') stuck[stuckAt(journey) ?? 'submitted'] += 1;
      liveDirect += Number(journey.liveVia === 'direct');
      liveReview += Number(journey.liveVia === 'review');
      abandoned += Number(journey.stage === 'abandoned');
      removed += Number(journey.stage === 'removed');
      const toSubmit = minutesBetween(journey.startedAt, journey.submittedAt);
      const toLive = minutesBetween(journey.startedAt, journey.liveAt);
      const toContact = minutesBetween(journey.liveAt, firstContactOf(journey));
      if (toSubmit !== null) kept.submit.push(toSubmit);
      if (toLive !== null) kept.live.push(toLive);
      if (toContact !== null) kept.contact.push(toContact);
      const day = daily.get(journey.startedAt.toISOString().slice(0, 10));
      if (day) {
        day.started += 1;
        day.submitted += Number(reached.submitted);
        day.live += Number(reached.live);
      }
      const counts = [1, Number(reached.submitted), Number(reached.live)] as const;
      tally(groups.sources, journey.source, ...counts);
      tally(groups.categories, journey.topCategoryId ?? '', ...counts);
      tally(groups.devices, journey.device ?? 'Unknown', ...counts);
      tally(groups.countries, journey.country ?? '', ...counts);
    }
    sums.submit = kept.submit.reduce((a, b) => a + b, 0);
    sums.submitN = kept.submit.length;
    sums.live = kept.live.reduce((a, b) => a + b, 0);
    sums.liveN = kept.live.length;
    sums.contact = kept.contact.reduce((a, b) => a + b, 0);
    sums.contactN = kept.contact.length;
    let started = journeys.length;

    for (const row of funnelDays) {
      started += row.started;
      funnel.opened += row.opened;
      funnel.draft += row.draft;
      funnel.step_media += row.stepMedia;
      funnel.step_details += row.stepDetails;
      funnel.step_where += row.stepWhere;
      funnel.step_place += row.stepPlace;
      funnel.step_post += row.stepPost;
      funnel.submitted += row.submitted;
      funnel.live += row.live;
      funnel.first_view += row.firstView;
      funnel.first_contact += row.firstContact;
      funnel.first_lead += row.firstLead;
      funnel.sold += row.sold;
      liveDirect += row.liveDirect;
      liveReview += row.liveAfterReview;
      abandoned += row.abandoned;
      removed += row.removed;
      sums.submit += Number(row.minutesToSubmit);
      sums.submitN += row.submitted;
      sums.live += Number(row.minutesToLive);
      sums.liveN += row.live;
      sums.contact += Number(row.minutesToFirstContact);
      sums.contactN += row.firstContact;
      const day = daily.get(row.day.toISOString().slice(0, 10));
      if (day) {
        day.started += row.started;
        day.submitted += row.submitted;
        day.live += row.live;
      }
      tally(groups.sources, row.source, row.started, row.submitted, row.live);
      tally(groups.categories, row.topCategoryId, row.started, row.submitted, row.live);
      tally(groups.countries, row.country, row.started, row.submitted, row.live);
    }
    const visits = { signed_in: 0, signed_out: 0 };
    for (const row of visitDays) {
      visits[row.signedIn ? 'signed_in' : 'signed_out'] += row.visits;
      const day = daily.get(row.day.toISOString().slice(0, 10));
      if (day) day.visits += row.visits;
    }

    // Reviews: decisions, their reasons and time from queued to decided; flags as queued.
    const decisions: Record<(typeof reviewDecisions)[number], number> = { approved: 0, sent_back: 0, removed: 0 };
    const reasons = new Map<string, number>();
    const flags = new Map<string, number>();
    let reviewMinutes = 0;
    let reviewN = 0;
    let queued = 0;
    const byId = new Map(journeys.map(journey => [journey.id, journey]));
    for (const journey of journeys) {
      if (!journey.reviewQueuedAt) continue;
      queued += 1;
      for (const flag of journey.reviewFlags) flags.set(flag, (flags.get(flag) ?? 0) + 1);
      const toReview = minutesBetween(journey.reviewQueuedAt, journey.reviewedAt);
      if (toReview !== null) kept.review.push(toReview);
    }
    const blockers = new Map<string, { origin: string; step: string; code: string; param: string | null; refusals: number; journeys: Set<string> | number }>();
    for (const event of events) {
      if (event.outcome === 'refused') {
        const code = event.code ?? 'api_error';
        const key = `${event.origin}|${event.step}|${code}|${event.param ?? ''}`;
        const row = blockers.get(key) ?? { origin: event.origin, step: event.step, code, param: event.param, refusals: 0, journeys: new Set<string>() };
        row.refusals += 1;
        (row.journeys as Set<string>).add(event.journeyId);
        blockers.set(key, row);
        continue;
      }
      const decision = event.step as (typeof reviewDecisions)[number];
      decisions[decision] += 1;
      if (event.code) reasons.set(event.code, (reasons.get(event.code) ?? 0) + 1);
      const spent = minutesBetween(byId.get(event.journeyId)?.reviewQueuedAt ?? null, event.createdAt);
      if (spent !== null) {
        reviewMinutes += spent;
        reviewN += 1;
      }
    }
    for (const row of reviewDays) {
      if (row.kind === 'flag') {
        flags.set(row.value, (flags.get(row.value) ?? 0) + row.count);
        continue;
      }
      if (row.kind === 'reason') {
        reasons.set(row.value, (reasons.get(row.value) ?? 0) + row.count);
        continue;
      }
      if ((reviewDecisions as readonly string[]).includes(row.value)) decisions[row.value as (typeof reviewDecisions)[number]] += row.count;
      reviewMinutes += Number(row.minutes);
      reviewN += row.count;
    }
    for (const row of funnelDays) queued += row.reviewQueued;
    const blockerList = [...blockers.values()].map(row => ({ origin: row.origin, step: row.step, code: row.code, param: row.param, refusals: row.refusals, journeys: (row.journeys as Set<string>).size }));
    for (const row of blockerDays) {
      const param = row.param || null;
      const found = blockerList.find(item => item.origin === row.origin && item.step === row.step && item.code === row.code && item.param === param);
      if (found) {
        found.refusals += row.refusals;
        found.journeys += row.journeys;
      } else blockerList.push({ origin: row.origin, step: row.step, code: row.code, param, refusals: row.refusals, journeys: row.journeys });
    }
    blockerList.sort((a, b) => b.journeys - a.journeys || b.refusals - a.refusals);

    const names = await this.categoryNames(groups.categories.keys());
    for (const row of groups.categories.values()) row.label = row.key ? (names.get(row.key) ?? null) : null;
    const decided = decisions.approved + decisions.sent_back + decisions.removed;
    const byCount = (rows: Iterable<Breakdown>) => [...rows].sort((a, b) => b.started - a.started);
    return {
      object: 'posting_summary' as const,
      days: input.days,
      country: input.country ?? null,
      source: input.source ?? null,
      category: input.category ?? null,
      from: from.toISOString().slice(0, 10),
      to: utcDay(now).toISOString().slice(0, 10),
      visits,
      totals: {
        started,
        submitted: funnel.submitted,
        live: funnel.live,
        sold: funnel.sold,
        abandoned,
        removed,
        post_rate: started ? funnel.live / started : null,
        // Of the journeys still kept.
        in_progress: statuses.in_progress,
        stuck: statuses.stuck,
        // Waiting now, whenever they started.
        in_review_now: inReview,
        sent_back_now: sentBack,
        median_minutes_to_submit: median(kept.submit),
        median_minutes_to_live: median(kept.live),
        median_minutes_to_first_contact: median(kept.contact),
        average_minutes_to_submit: average(sums.submit, sums.submitN),
        average_minutes_to_live: average(sums.live, sums.liveN),
        average_minutes_to_first_contact: average(sums.contact, sums.contactN),
      },
      funnel: postingMilestones.map(milestone => ({ milestone, count: funnel[milestone] })),
      live_split: { direct: liveDirect, after_review: liveReview },
      stuck_at: stuckMilestones.map(milestone => ({ milestone, count: stuck[milestone] })),
      review: {
        queued,
        approved: decisions.approved,
        sent_back: decisions.sent_back,
        removed: decisions.removed,
        approval_rate: decided ? decisions.approved / decided : null,
        median_minutes_to_review: median(kept.review),
        average_minutes_to_review: average(reviewMinutes, reviewN),
        reasons: [...reasons].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
        flags: [...flags].map(([flag, count]) => ({ flag, count })).sort((a, b) => b.count - a.count),
      },
      blockers: blockerList.slice(0, 30),
      daily: [...daily.values()],
      sources: byCount(groups.sources.values()),
      categories: byCount(groups.categories.values()).slice(0, 15),
      devices: byCount(groups.devices.values()).slice(0, 10),
      countries: byCount(groups.countries.values()),
    };
  }

  async list(
    input: { status?: PostingStatus; stuck_at?: StuckMilestone; code?: string; source?: string; category?: string; country?: string; q?: string; limit?: number; offset?: number },
    now = new Date(),
  ) {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const quiet = new Date(now.getTime() - stuckAfterMs);
    const q = input.q?.trim();
    const search: Prisma.PostingJourneyWhereInput | null = !q
      ? null
      : /^\d{1,15}$/.test(q)
        ? { listingRef: BigInt(q) }
        : /^[A-Za-z]{3}-?\d{1,9}$/.test(q)
          ? { sku: { contains: q.toUpperCase().replace(/^([A-Z]{3})-?/, '$1-') } }
          : { customer: { OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: 'insensitive' } }] } };
    const statusWhere: Record<PostingStatus, Prisma.PostingJourneyWhereInput> = {
      in_progress: { stage: 'composing', lastEventAt: { gte: quiet } },
      stuck: { stage: 'composing', lastEventAt: { lt: quiet } },
      in_review: { stage: 'in_review' },
      sent_back: { stage: 'sent_back' },
      live: { stage: 'live', soldAt: null },
      sold: { soldAt: { not: null } },
      abandoned: { stage: 'abandoned' },
      removed: { stage: 'removed' },
    };
    const where: Prisma.PostingJourneyWhereInput = {
      ...(input.country ? { country: input.country } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.category ? { OR: [{ topCategoryId: input.category }, { categoryId: input.category }] } : {}),
      ...(input.code ? { events: { some: { code: input.code } } } : {}),
      ...(input.status ? statusWhere[input.status] : {}),
      ...(search ?? {}),
    };
    const include = { customer: { select: { id: true, name: true, email: true } } } as const;
    let rows: Listed[];
    let total: number;
    let hasMore: boolean;
    if (input.stuck_at) {
      // Worked out from the milestones, so filtered here: journeys still composing are few.
      const candidates = await this.prisma.postingJourney.findMany({ where: { ...where, stage: input.stuck_at === 'resubmitted' ? 'sent_back' : 'composing' }, include, orderBy: { lastEventAt: 'desc' }, take: 5000 });
      const matching = candidates.filter(row => stuckAt(row) === input.stuck_at);
      rows = matching.slice(offset, offset + limit);
      total = matching.length;
      hasMore = matching.length > offset + limit;
    } else {
      const [found, count] = await Promise.all([this.prisma.postingJourney.findMany({ where, include, orderBy: { lastEventAt: 'desc' }, take: limit + 1, skip: offset }), this.prisma.postingJourney.count({ where })]);
      rows = found.slice(0, limit);
      total = count;
      hasMore = found.length > limit;
    }
    const [listings, names] = await Promise.all([this.listingsOf(rows), this.categoryNames(rows.map(row => row.topCategoryId ?? ''))]);
    return { object: 'list' as const, data: rows.map(row => present(row, listings.get(row.listingId ?? '') ?? null, names, now)), total, has_more: hasMore };
  }

  private async listingsOf(rows: Journey[]) {
    const ids = rows.map(row => row.listingId).filter((id): id is string => Boolean(id));
    if (!ids.length) return new Map<string, ListingInfo>();
    const listings = await this.prisma.classifiedListing.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, status: true } });
    return new Map(listings.map(listing => [listing.id, listing]));
  }

  /** One journey with every step it took; viewing it (the seller's name and email) is audited. */
  async get(id: string, actorId: string | null, now = new Date()) {
    const journey = await this.prisma.postingJourney.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true, email: true } }, events: { orderBy: { createdAt: 'asc' } } } });
    if (!journey) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This posting journey no longer exists: it may have been deleted after its time.');
    await this.audit.record({ actorId, action: 'posting_journey.viewed', targetType: 'posting_journey', targetId: journey.id });
    const [listings, names] = await Promise.all([this.listingsOf([journey]), this.categoryNames([journey.topCategoryId ?? ''])]);
    return {
      ...present(journey, listings.get(journey.listingId ?? '') ?? null, names, now),
      events: journey.events.map(event => ({ id: event.id, origin: event.origin, step: event.step, outcome: event.outcome, code: event.code, param: event.param, device: event.device, at: event.createdAt.toISOString() })),
    };
  }
}
