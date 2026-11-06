import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { errorParts, utcDay } from '../signups/journeys.service.js';

/**
 * Udozo's posting journeys (Reports > Posting journeys): each ad's way from the seller pressing Sell to the ad live and
 * its first results (a view, a chat or call, a lead, sold), step by step with why a step was refused, so admins can see
 * where sellers get stuck posting (`docs/UDOZO_POSTING_JOURNEYS_PLAN.md`).
 *
 * Steps come from three places: the API's listing routes (`@TrackPosting`, `PostingJourneyInterceptor`), Post an ad's
 * wizard on udozo.com (`POST /v1/classifieds/posting-journeys/events`: the step reached or refused and the field it
 * needed, never what was typed) and moderators' decisions. First results are read from the listings' own records by
 * `syncResults` (the 15-minute `classifieds` job), so chats, calls and leads gain no work. Recording never fails or
 * slows a step: it runs after the answer, and any problem is logged.
 *
 * Kept 30 days after the last step of an ad that never went live, or 90 days after one went live (30 after it sold, if
 * sooner), then rolled into daily counts with nobody's details (`purge`, the daily `marketing` job).
 */

/** Where Sell was pressed on udozo.com (`/sell?from=`). */
export const sellSources = ['header', 'header_phone', 'my_listings', 'empty_state', 'start_here', 'invite', 'pwa', 'reseller', 'username', 'direct'] as const;
export type SellSource = (typeof sellSources)[number];
/** Plus `api` (a draft made without Sell), `resumed` (a draft or sent-back ad reopened) and `unknown`. */
export const postingSources = [...sellSources, 'api', 'resumed', 'unknown'] as const;
export type PostingSource = (typeof postingSources)[number];

/** Post an ad's wizard steps, in order (udozo.com's `postSteps`). */
export const postStepKeys = ['basics', 'media', 'details', 'where', 'place', 'post'] as const;
export type PostStepKey = (typeof postStepKeys)[number];
/** The fields a wizard step can ask for before moving on (udozo.com's `stepProblem`), and the terms box. */
export const wizardParams = ['title', 'category_id', 'photos', 'price', 'condition', 'on_shop', 'area_id', 'terms'] as const;
export type WizardParam = (typeof wizardParams)[number];

/** What udozo.com's wizard tells the API: nothing anyone typed. */
export const clientEventTypes = ['sell_opened', 'form_resumed', 'step_reached', 'step_refused', 'terms_ticked', 'post_pressed'] as const;
export type ClientEventType = (typeof clientEventTypes)[number];
export type ClientEvent = { type: ClientEventType; listing_id?: string; step?: PostStepKey; param?: WizardParam; source?: SellSource };

/** The listing routes a journey follows. */
export const apiSteps = ['create', 'save', 'photo', 'video', 'submit', 'sold', 'delete'] as const;
export type ApiStep = (typeof apiSteps)[number];

/** The funnel, in order: composing (up to submitted) then going live, then first results. */
export const postingMilestones = ['opened', 'draft', 'step_media', 'step_details', 'step_where', 'step_place', 'step_post', 'submitted', 'live', 'first_view', 'first_contact', 'first_lead', 'sold'] as const;
export type PostingMilestone = (typeof postingMilestones)[number];
/** Where an unfinished journey can be stuck: the composing milestones, or a sent-back ad not yet submitted again. */
export const stuckMilestones = ['opened', 'draft', 'step_media', 'step_details', 'step_where', 'step_place', 'step_post', 'submitted', 'resubmitted'] as const;
export type StuckMilestone = (typeof stuckMilestones)[number];

export const postingStages = ['composing', 'in_review', 'sent_back', 'live', 'abandoned', 'removed'] as const;
export type PostingStage = (typeof postingStages)[number];

/** Moderators' reasons for sending an ad back or removing it, with what the seller reads when they write no note. */
export const listingReviewCodes = ['photos', 'wrong_category', 'prohibited_item', 'misleading', 'contact_details', 'duplicate', 'other'] as const;
export type ListingReviewCode = (typeof listingReviewCodes)[number];
export const reviewCodeText: Record<ListingReviewCode, string> = {
  photos: 'The photos need to show the item clearly: your own photos of it, well lit, nothing else in them.',
  wrong_category: 'This ad is in the wrong category: choose the one that fits the item.',
  prohibited_item: 'This item cannot be sold on Udozo. See the prohibited items in the marketplace terms.',
  misleading: 'The title, price or description does not match the item: say exactly what it is.',
  contact_details: 'Take your phone number, email or links out of the ad: buyers reach you through Udozo.',
  duplicate: 'You already have an ad for this item: keep one ad for it.',
  other: 'This ad needs changes before it can go live.',
};

/** Opening Sell again within this time carries on the same journey; later, a new one starts. */
export const reuseWithinMs = 24 * 60 * 60 * 1000;
/** A journey still being composed and quiet this long is stuck. */
export const stuckAfterMs = 24 * 60 * 60 * 1000;
/** The wizard's steps sent before the draft is tied to its journey join the seller's latest one from within this time. */
const lateEventMs = 60 * 60 * 1000;
/** Saves (autosave) only move a journey's last step at most this often, and add no step. */
const saveThrottleMs = 60_000;
export const openRetentionMs = 30 * 24 * 60 * 60 * 1000;
export const liveRetentionMs = 90 * 24 * 60 * 60 * 1000;
export const soldRetentionMs = 30 * 24 * 60 * 60 * 1000;
/** In review this long without a decision, it goes all the same. */
const reviewRetentionMs = 90 * 24 * 60 * 60 * 1000;
export const maxJourneyEvents = 200;

export type Journey = Prisma.PostingJourneyGetPayload<object>;

/** The listing a route answered with (the presented listing). */
type ListingAnswer = { id?: string; ref?: number; sku?: string | null; status?: string; review_flags?: string[]; category?: { id: string; parent: { id: string } | null } | null } | null;

export type ApiInput = {
  step: ApiStep;
  customerId: string;
  country: string | null;
  listingId: string | null;
  answer: ListingAnswer;
  error?: unknown;
  device: string | null;
};

type EventInput = { origin: 'api' | 'client' | 'system'; step: string; refused?: boolean; code?: string | null; param?: string | null; device?: string | null };

const minutes = (from: Date | null, to: Date | null) => (from && to ? Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000)) : null);
const earliest = (...dates: Array<Date | null>) => dates.filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

/** Whether a journey reached each milestone. Composing milestones count as reached once a later one is (a submitted ad passed every step). */
export function milestonesOf(journey: Journey): Record<PostingMilestone, boolean> {
  const step = (index: number) => journey.furthestStep >= index;
  const composing: Array<[PostingMilestone, boolean]> = [
    ['opened', Boolean(journey.openedAt)],
    ['draft', Boolean(journey.draftAt)],
    ['step_media', step(1)],
    ['step_details', step(2)],
    ['step_where', step(3)],
    ['step_place', step(4)],
    ['step_post', step(5)],
    ['submitted', Boolean(journey.submittedAt)],
    ['live', Boolean(journey.liveAt)],
  ];
  for (let index = composing.length - 2; index >= 0; index -= 1) composing[index][1] ||= composing[index + 1][1];
  return {
    ...(Object.fromEntries(composing) as Record<PostingMilestone, boolean>),
    first_view: Boolean(journey.firstViewAt),
    first_contact: Boolean(journey.firstChatAt || journey.firstCallAt),
    first_lead: Boolean(journey.firstLeadAt),
    sold: Boolean(journey.soldAt),
  };
}

/** When the ad first heard from a buyer: its first chat or call. */
export const firstContactOf = (journey: Pick<Journey, 'firstChatAt' | 'firstCallAt'>) => earliest(journey.firstChatAt, journey.firstCallAt);

@Injectable()
export class PostingJourneysService {
  private readonly logger = new Logger(PostingJourneysService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Runs a recording after the answer (Udozo's instance only), never failing or awaited by the step it records. */
  private run(label: string, work: () => Promise<unknown>) {
    if (this.config.APP_PRODUCT !== 'udozo') return;
    const task = work()
      .then(() => undefined)
      .catch(error => this.logger.warn({ err: error, step: label }, 'Could not record a posting step'))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Waits for recordings still running (tests, and the jobs before they read). */
  async idle() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** A step of Post an ad's wizard on udozo.com. */
  client(customer: { id: string; country: string | null }, event: ClientEvent, device: string | null) {
    this.run(event.type, () => this.writeClient(customer, event, device));
  }

  /** A listing route was asked (`@TrackPosting`). */
  api(input: ApiInput) {
    this.run(input.step, () => this.writeApi(input));
  }

  /** A moderator decided an ad: approved (live), sent back to the seller, or removed. */
  reviewed(listingId: string, outcome: 'approved' | 'sent_back' | 'removed', code: ListingReviewCode | null = null) {
    this.run(`review_${outcome}`, () => this.writeReview(listingId, outcome, code));
  }

  /** A live ad went back to review (an edit flagged by the checks, or reports). */
  requeued(listingId: string, reason: string, flags: string[] = []) {
    this.run('review_requeued', () => this.writeRequeued(listingId, reason, flags));
  }

  /** The ad's first view (called only when its count was 0, so this costs nothing after). */
  firstView(listingId: string) {
    this.run('first_view', async () => {
      const now = new Date();
      const moved = await this.prisma.postingJourney.updateMany({ where: { listingId, firstViewAt: null }, data: { firstViewAt: now } });
      if (moved.count) await this.event({ listingId }, { origin: 'system', step: 'first_view' }, now);
    });
  }

  // ---- Writing ----

  private async writeClient(customer: { id: string; country: string | null }, event: ClientEvent, device: string | null) {
    const now = new Date();
    if (event.type === 'sell_opened') return this.opened(customer, event.source ?? 'direct', device, now);
    if (event.type === 'form_resumed') {
      if (event.listing_id) await this.resume(customer.id, event.listing_id, device, now, 'form_resumed');
      return;
    }
    const journey = event.listing_id ? await this.resume(customer.id, event.listing_id, device, now) : await this.latestOpen(customer.id, now);
    if (!journey) return;
    if (event.type === 'step_reached') {
      const index = postStepKeys.indexOf(event.step ?? 'basics');
      const moved = await this.prisma.postingJourney.updateMany({ where: { id: journey.id, furthestStep: { lt: index } }, data: { furthestStep: index } });
      if (moved.count) await this.event({ id: journey.id }, { origin: 'client', step: `step_${event.step}`, device }, now);
      else await this.touch(journey.id, now);
      return;
    }
    if (event.type === 'step_refused') {
      await this.event({ id: journey.id }, { origin: 'client', step: `step_${event.step ?? 'post'}`, refused: true, code: 'step_incomplete', param: event.param ?? null, device }, now);
      return;
    }
    await this.event({ id: journey.id }, { origin: 'client', step: event.type, device }, now);
  }

  /** Sell opened: the seller's open journey carries on within a day, else a new one starts (the stale one abandoned). */
  private async opened(customer: { id: string; country: string | null }, source: PostingSource, device: string | null, now: Date) {
    const open = await this.prisma.postingJourney.findFirst({ where: { customerId: customer.id, listingId: null, stage: 'composing' } });
    if (open && now.getTime() - open.lastEventAt.getTime() < reuseWithinMs) {
      if (!open.openedAt) await this.prisma.postingJourney.updateMany({ where: { id: open.id, openedAt: null }, data: { openedAt: now } });
      await this.event({ id: open.id }, { origin: 'client', step: 'sell_opened', device }, now);
      return;
    }
    if (open) await this.prisma.postingJourney.updateMany({ where: { id: open.id, listingId: null, stage: 'composing' }, data: { stage: 'abandoned', endedAt: now, endedReason: 'never_drafted' } });
    let journey: Journey;
    try {
      journey = await this.prisma.postingJourney.create({ data: { customerId: customer.id, source, country: customer.country, device, openedAt: now, startedAt: now, lastEventAt: now } });
    } catch (error) {
      // Another tab opened Sell at the same moment: theirs is ours.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      journey = await this.prisma.postingJourney.findFirstOrThrow({ where: { customerId: customer.id, listingId: null, stage: 'composing' } });
    }
    await this.event({ id: journey.id }, { origin: 'client', step: 'sell_opened', device }, now);
  }

  /** The seller's journey not yet tied to a listing, else their latest one still composing from the last hour. */
  private async latestOpen(customerId: string, now: Date) {
    return (
      (await this.prisma.postingJourney.findFirst({ where: { customerId, listingId: null, stage: 'composing' } })) ??
      (await this.prisma.postingJourney.findFirst({ where: { customerId, stage: 'composing', lastEventAt: { gte: new Date(now.getTime() - lateEventMs) } }, orderBy: { lastEventAt: 'desc' } }))
    );
  }

  /**
   * A listing's journey; one reopened from before journeys were kept (a draft, or an ad sent back) starts one from
   * there (`resumed`). Live ads with none are never journeys: editing them is not posting.
   */
  private async resume(customerId: string, listingId: string, device: string | null, now: Date, step?: string) {
    const found = await this.prisma.postingJourney.findUnique({ where: { listingId } });
    if (found) {
      if (step) await this.event({ id: found.id }, { origin: 'client', step, device }, now);
      return found;
    }
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { customerId: true, status: true, ref: true, sku: true, country: true, createdAt: true, categoryId: true, category: { select: { parentId: true } } } });
    if (!listing || listing.customerId !== customerId || !['draft', 'rejected'].includes(listing.status)) return null;
    try {
      const journey = await this.prisma.postingJourney.create({
        data: {
          customerId,
          listingId,
          listingRef: listing.ref,
          sku: listing.sku,
          source: 'resumed',
          country: listing.country,
          categoryId: listing.categoryId,
          topCategoryId: listing.category?.parentId ?? listing.categoryId,
          device,
          stage: listing.status === 'rejected' ? 'sent_back' : 'composing',
          draftAt: listing.createdAt,
          startedAt: now,
          lastEventAt: now,
        },
      });
      if (step) await this.event({ id: journey.id }, { origin: 'client', step, device }, now);
      return journey;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.postingJourney.findUnique({ where: { listingId } });
      throw error;
    }
  }

  private async writeApi(input: ApiInput) {
    const now = new Date();
    const refused = input.error !== undefined && input.error !== null;
    const parts = refused ? errorParts(input.error) : null;
    const listingId = input.listingId ?? input.answer?.id ?? null;
    const category = input.answer?.category ? { categoryId: input.answer.category.id, topCategoryId: input.answer.category.parent?.id ?? input.answer.category.id } : {};

    if (input.step === 'create') {
      if (refused) {
        const open = await this.latestOpen(input.customerId, now);
        if (open) await this.event({ id: open.id }, { origin: 'api', step: 'create', refused: true, code: parts?.code, param: parts?.param, device: input.device }, now);
        return;
      }
      if (!listingId) return;
      await this.bind(input, listingId, category, now);
      return;
    }
    if (!listingId) return;

    let journey = await this.prisma.postingJourney.findUnique({ where: { listingId } });
    // A draft (or sent-back ad) saved from before journeys were kept starts one; live ads never do, so their edits cost
    // no lookup.
    if (!journey && !refused && (input.answer?.status === 'draft' || input.answer?.status === 'rejected')) journey = await this.resume(input.customerId, listingId, input.device, now);
    if (!journey) {
      // A submitted ad whose draft came from before journeys were kept: it starts here.
      if (input.step === 'submit' && !refused) journey = await this.startAtSubmit(input, listingId, now);
      if (!journey) return;
    }
    const id = journey.id;
    if (refused) {
      await this.event({ id }, { origin: 'api', step: input.step, refused: true, code: parts?.code, param: parts?.param, device: input.device }, now, input.step === 'submit' ? { submitAttempts: { increment: 1 } } : {});
      return;
    }

    switch (input.step) {
      case 'save': {
        // Autosave: no step recorded, and the last step moved at most once a minute (a live ad flagged back to review by
        // an edit is told by `ListingsService.recheck`).
        const moved = category.categoryId !== undefined && category.categoryId !== journey.categoryId;
        await this.prisma.postingJourney.updateMany({ where: { id, ...(moved ? {} : { lastEventAt: { lt: new Date(now.getTime() - saveThrottleMs) } }) }, data: { lastEventAt: now, ...category } });
        return;
      }
      case 'photo': {
        const first = await this.prisma.postingJourney.updateMany({ where: { id, firstPhotoAt: null }, data: { firstPhotoAt: now } });
        if (first.count) await this.event({ id }, { origin: 'api', step: 'photo', device: input.device }, now);
        else await this.touch(id, now);
        return;
      }
      case 'video':
        await this.event({ id }, { origin: 'api', step: 'video', device: input.device }, now);
        return;
      case 'submit': {
        const status = input.answer?.status;
        const resubmitted = journey.stage === 'sent_back';
        const data: Prisma.PostingJourneyUpdateInput = {
          ...category,
          submitAttempts: { increment: 1 },
          furthestStep: 5,
          ...(journey.submittedAt ? {} : { submittedAt: now }),
          ...(resubmitted && !journey.resubmittedAt ? { resubmittedAt: now } : {}),
          ...(input.answer?.sku ? { sku: input.answer.sku } : {}),
          ...(status === 'active' ? { stage: 'live', ...(journey.liveAt ? {} : { liveAt: now, liveVia: 'direct' }) } : {}),
          ...(status === 'pending_review' ? { stage: 'in_review', ...(journey.reviewQueuedAt ? {} : { reviewQueuedAt: now, reviewFlags: input.answer?.review_flags ?? [] }) } : {}),
        };
        await this.event({ id }, { origin: 'api', step: resubmitted ? 'resubmit' : 'submit', device: input.device }, now, data);
        if (status === 'active') await this.event({ id }, { origin: 'system', step: 'went_live' }, now);
        if (status === 'pending_review') await this.event({ id }, { origin: 'system', step: 'review_queued', code: input.answer?.review_flags?.[0] ?? null }, now);
        return;
      }
      case 'sold':
        await this.event({ id }, { origin: 'api', step: 'sold', device: input.device }, now, journey.soldAt ? {} : { soldAt: now });
        return;
      case 'delete': {
        const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { status: true } });
        const ended: Prisma.PostingJourneyUpdateInput = journey.stage === 'live' ? { endedAt: now, endedReason: 'deleted' } : { stage: 'abandoned', endedAt: now, endedReason: listing ? 'deleted' : 'draft_deleted' };
        await this.event({ id }, { origin: 'api', step: 'delete', device: input.device }, now, ended);
        return;
      }
    }
  }

  /** A new draft: tied to the seller's open journey from Sell, else a journey starts at the draft (made without Sell). */
  private async bind(input: ApiInput, listingId: string, category: { categoryId?: string; topCategoryId?: string }, now: Date) {
    const listing = { listingRef: input.answer?.ref !== undefined ? BigInt(input.answer.ref) : null, sku: input.answer?.sku ?? null, ...category };
    const open = await this.prisma.postingJourney.findFirst({ where: { customerId: input.customerId, listingId: null, stage: 'composing' } });
    let id: string | null = null;
    if (open && now.getTime() - open.lastEventAt.getTime() < reuseWithinMs) {
      const tied = await this.prisma.postingJourney.updateMany({ where: { id: open.id, listingId: null }, data: { listingId, draftAt: now, ...listing } }).catch(error => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { count: 0 };
        throw error;
      });
      if (tied.count) id = open.id;
    }
    if (!id) {
      if (open) await this.prisma.postingJourney.updateMany({ where: { id: open.id, listingId: null, stage: 'composing' }, data: { stage: 'abandoned', endedAt: now, endedReason: 'never_drafted' } });
      try {
        id = (await this.prisma.postingJourney.create({ data: { customerId: input.customerId, listingId, source: 'api', country: input.country, device: input.device, draftAt: now, startedAt: now, lastEventAt: now, ...listing } })).id;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
        throw error;
      }
    }
    await this.event({ id }, { origin: 'api', step: 'create', device: input.device }, now);
  }

  private async startAtSubmit(input: ApiInput, listingId: string, now: Date) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { customerId: true, ref: true, sku: true, country: true, createdAt: true, categoryId: true, category: { select: { parentId: true } } } });
    if (!listing || listing.customerId !== input.customerId) return null;
    try {
      return await this.prisma.postingJourney.create({
        data: { customerId: input.customerId, listingId, listingRef: listing.ref, sku: listing.sku, source: 'resumed', country: listing.country, categoryId: listing.categoryId, topCategoryId: listing.category?.parentId ?? listing.categoryId, device: input.device, draftAt: listing.createdAt, startedAt: now, lastEventAt: now },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.postingJourney.findUnique({ where: { listingId } });
      throw error;
    }
  }

  private async writeReview(listingId: string, outcome: 'approved' | 'sent_back' | 'removed', code: ListingReviewCode | null) {
    const journey = await this.prisma.postingJourney.findUnique({ where: { listingId } });
    if (!journey) return;
    const now = new Date();
    const decided: Prisma.PostingJourneyUpdateInput = { reviews: { increment: 1 }, ...(journey.reviewedAt ? {} : { reviewedAt: now }) };
    const data: Prisma.PostingJourneyUpdateInput =
      outcome === 'approved'
        ? { ...decided, stage: 'live', ...(journey.liveAt ? {} : { liveAt: now, liveVia: 'review' }) }
        : outcome === 'sent_back'
          ? { ...decided, stage: 'sent_back', sentBackCount: { increment: 1 }, lastRejectCode: code, ...(journey.sentBackAt ? {} : { sentBackAt: now }) }
          : { ...decided, stage: 'removed', lastRejectCode: code, endedAt: now, endedReason: 'removed' };
    await this.event({ id: journey.id }, { origin: 'system', step: outcome, code }, now, data);
  }

  private async writeRequeued(listingId: string, reason: string, flags: string[]) {
    const now = new Date();
    const journey = await this.prisma.postingJourney.findUnique({ where: { listingId } });
    if (!journey || journey.stage !== 'live') return;
    await this.event({ id: journey.id }, { origin: 'system', step: 'review_requeued', code: reason.slice(0, 60) }, now, { stage: 'in_review', reviewFlags: [...new Set([...journey.reviewFlags, ...flags])] });
  }

  /** Moves the journey's last step (when the step itself is not worth a row of its own). */
  private touch(id: string, now: Date) {
    return this.prisma.postingJourney.updateMany({ where: { id, lastEventAt: { lt: new Date(now.getTime() - saveThrottleMs) } }, data: { lastEventAt: now } });
  }

  /** One step: the journey moved on (with `data`), and the step kept while the journey has room for it. */
  private async event(where: { id: string } | { listingId: string }, input: EventInput, now: Date, data: Prisma.PostingJourneyUpdateInput = {}) {
    const journey = await this.prisma.postingJourney.findUnique({ where: 'id' in where ? { id: where.id } : { listingId: where.listingId }, select: { id: true, eventCount: true, device: true } });
    if (!journey) return;
    await this.prisma.$transaction(async tx => {
      await tx.postingJourney.update({
        where: { id: journey.id },
        data: {
          ...data,
          lastEventAt: now,
          eventCount: { increment: 1 },
          ...(!journey.device && input.device ? { device: input.device } : {}),
          ...(input.refused ? { refusals: { increment: 1 }, lastErrorStep: input.step.slice(0, 30), lastErrorCode: (input.code ?? 'api_error').slice(0, 60) } : {}),
        },
      });
      if (journey.eventCount < maxJourneyEvents) {
        await tx.postingJourneyEvent.create({
          data: { journeyId: journey.id, origin: input.origin, step: input.step.slice(0, 30), outcome: input.refused ? 'refused' : 'ok', code: input.code?.slice(0, 60) ?? null, param: input.param?.slice(0, 40) ?? null, device: input.device ?? null, createdAt: now },
        });
      }
    });
  }

  // ---- Jobs ----

  /**
   * First results of live ads, read from their own records: the first chat, call and lead (exact times), and sold. One
   * statement, touching only journeys it changes (the 15-minute `classifieds` job, and the daily one).
   */
  async syncResults() {
    if (this.config.APP_PRODUCT !== 'udozo') return { posting_results: 0 };
    const changed = await this.prisma.$executeRaw`
      WITH found AS (
        SELECT j."id",
          (SELECT min(c."created_at") FROM "classified_conversations" c WHERE c."listing_id" = j."listing_id") AS chat,
          (SELECT min(k."created_at") FROM "classified_calls" k WHERE k."listing_id" = j."listing_id") AS call,
          (SELECT min(l."first_at") FROM "classified_leads" l WHERE l."listing_id" = j."listing_id") AS lead,
          (SELECT s."sold_at" FROM "classified_listings" s WHERE s."id" = j."listing_id") AS sold
        FROM "posting_journeys" j
        WHERE j."listing_id" IS NOT NULL AND j."live_at" IS NOT NULL
          AND (j."first_chat_at" IS NULL OR j."first_call_at" IS NULL OR j."first_lead_at" IS NULL OR j."sold_at" IS NULL)
      )
      UPDATE "posting_journeys" j SET
        "first_chat_at" = COALESCE(j."first_chat_at", found.chat),
        "first_call_at" = COALESCE(j."first_call_at", found.call),
        "first_lead_at" = COALESCE(j."first_lead_at", found.lead),
        "sold_at" = COALESCE(j."sold_at", found.sold)
      FROM found
      WHERE j."id" = found."id" AND (
        (j."first_chat_at" IS NULL AND found.chat IS NOT NULL) OR (j."first_call_at" IS NULL AND found.call IS NOT NULL) OR
        (j."first_lead_at" IS NULL AND found.lead IS NOT NULL) OR (j."sold_at" IS NULL AND found.sold IS NOT NULL))`;
    return { posting_results: changed };
  }

  /**
   * The daily safety net: whatever a missed recording left behind is put right from the listings themselves (live,
   * removed, deleted, drafts gone), then first results are read.
   */
  async reconcile() {
    if (this.config.APP_PRODUCT !== 'udozo') return { reconciled: 0 };
    const live = await this.prisma.$executeRaw`
      UPDATE "posting_journeys" j SET "stage" = 'live', "live_at" = l."published_at", "live_via" = COALESCE(j."live_via", CASE WHEN j."review_queued_at" IS NULL THEN 'direct' ELSE 'review' END),
        "submitted_at" = COALESCE(j."submitted_at", l."submitted_at"), "furthest_step" = 5
      FROM "classified_listings" l
      WHERE l."id" = j."listing_id" AND l."published_at" IS NOT NULL AND j."live_at" IS NULL AND j."stage" IN ('composing', 'in_review', 'sent_back')
        AND l."status" IN ('active', 'sold', 'expired')`;
    const removed = await this.prisma.$executeRaw`
      UPDATE "posting_journeys" j SET "stage" = 'removed', "ended_at" = COALESCE(l."closed_at", now()), "ended_reason" = 'removed'
      FROM "classified_listings" l
      WHERE l."id" = j."listing_id" AND l."status" = 'removed' AND j."stage" NOT IN ('removed', 'abandoned')`;
    const deleted = await this.prisma.$executeRaw`
      UPDATE "posting_journeys" j SET "stage" = 'abandoned', "ended_at" = COALESCE(l."closed_at", now()), "ended_reason" = 'deleted'
      FROM "classified_listings" l
      WHERE l."id" = j."listing_id" AND l."status" = 'deleted' AND j."stage" IN ('composing', 'in_review', 'sent_back')`;
    const gone = await this.prisma.$executeRaw`
      UPDATE "posting_journeys" j SET "stage" = 'abandoned', "ended_at" = now(), "ended_reason" = 'draft_deleted'
      WHERE j."listing_id" IS NOT NULL AND j."stage" IN ('composing', 'in_review', 'sent_back')
        AND NOT EXISTS (SELECT 1 FROM "classified_listings" l WHERE l."id" = j."listing_id")`;
    const results = await this.syncResults();
    return { reconciled: live + removed + deleted + gone, ...results };
  }

  /** Post an ad (or sign-in on the way to it) was opened: counted for the day, nothing about the visitor kept. */
  async visit(source: SellSource, signedIn: boolean, now = new Date()) {
    if (this.config.APP_PRODUCT === 'udozo') {
      const day = utcDay(now);
      await this.prisma.postingVisitDay.upsert({ where: { day_source_signedIn: { day, source, signedIn } }, create: { day, source, signedIn, visits: 1 }, update: { visits: { increment: 1 } } });
    }
    return { object: 'notice' as const, message: 'Counted.' };
  }

  /**
   * Journeys past their time are rolled into daily counts (`posting_funnel_days`, `posting_blocker_days`,
   * `posting_review_days`; no seller, listing or device) in the same transaction that deletes them, so a run stopped
   * part way counts nothing twice. Daily counts go after 400 days.
   */
  async purge(now = new Date()) {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const due: Prisma.PostingJourneyWhereInput = {
      OR: [
        { liveAt: null, stage: { not: 'in_review' }, lastEventAt: { lt: ago(openRetentionMs) } },
        { liveAt: null, stage: 'in_review', lastEventAt: { lt: ago(reviewRetentionMs) } },
        { liveAt: { lt: ago(liveRetentionMs) } },
        { soldAt: { lt: ago(soldRetentionMs) } },
      ],
    };
    let deleted = 0;
    for (let round = 0; round < 40; round += 1) {
      const batch = await this.prisma.postingJourney.findMany({
        where: due,
        take: 250,
        orderBy: { startedAt: 'asc' },
        include: { events: { where: { OR: [{ outcome: 'refused' }, { origin: 'system', step: { in: ['approved', 'sent_back', 'removed'] } }] }, select: { origin: true, step: true, outcome: true, code: true, param: true, createdAt: true } } },
      });
      if (batch.length === 0) break;
      await this.prisma.$transaction(async tx => {
        for (const row of funnelRows(batch)) {
          const { day, country, source, topCategoryId, ...counts } = row;
          await tx.postingFunnelDay.upsert({ where: { day_country_source_topCategoryId: { day, country, source, topCategoryId } }, create: row, update: increments(counts) });
        }
        for (const row of blockerRows(batch)) {
          const { day, origin, step, code, param, country, refusals, journeys } = row;
          await tx.postingBlockerDay.upsert({ where: { day_origin_step_code_param_country: { day, origin, step, code, param, country } }, create: row, update: { refusals: { increment: refusals }, journeys: { increment: journeys } } });
        }
        for (const row of reviewRows(batch)) {
          const { day, country, kind, value, count, minutes: summed } = row;
          await tx.postingReviewDay.upsert({ where: { day_country_kind_value: { day, country, kind, value } }, create: row, update: { count: { increment: count }, minutes: { increment: summed } } });
        }
        await tx.postingJourney.deleteMany({ where: { id: { in: batch.map(row => row.id) } } });
      });
      deleted += batch.length;
    }
    const before = ago(400 * 24 * 60 * 60 * 1000);
    const counts = await Promise.all([
      this.prisma.postingVisitDay.deleteMany({ where: { day: { lt: before } } }),
      this.prisma.postingFunnelDay.deleteMany({ where: { day: { lt: before } } }),
      this.prisma.postingBlockerDay.deleteMany({ where: { day: { lt: before } } }),
      this.prisma.postingReviewDay.deleteMany({ where: { day: { lt: before } } }),
    ]);
    return { journeys_rolled_up: deleted, daily_counts_deleted: counts.reduce((sum, item) => sum + item.count, 0) };
  }
}

const increments = (counts: Record<string, number | bigint>) => Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, { increment: value }]));

type RollUp = Journey & { events: Array<{ origin: string; step: string; outcome: string; code: string | null; param: string | null; createdAt: Date }> };

export const reviewDecisions = ['approved', 'sent_back', 'removed'] as const;

function funnelRows(journeys: RollUp[]) {
  type Row = { day: Date; country: string; source: string; topCategoryId: string } & Record<
    'started' | 'opened' | 'draft' | 'stepMedia' | 'stepDetails' | 'stepWhere' | 'stepPlace' | 'stepPost' | 'submitted' | 'reviewQueued' | 'sentBack' | 'live' | 'liveDirect' | 'liveAfterReview' | 'firstView' | 'firstContact' | 'firstLead' | 'sold' | 'abandoned' | 'removed',
    number
  > & { minutesToSubmit: bigint; minutesToLive: bigint; minutesToFirstContact: bigint };
  const rows = new Map<string, Row>();
  for (const journey of journeys) {
    const day = utcDay(journey.startedAt);
    const country = journey.country ?? '';
    const topCategoryId = journey.topCategoryId ?? '';
    const key = `${day.toISOString()}|${country}|${journey.source}|${topCategoryId}`;
    const row =
      rows.get(key) ??
      ({ day, country, source: journey.source, topCategoryId, started: 0, opened: 0, draft: 0, stepMedia: 0, stepDetails: 0, stepWhere: 0, stepPlace: 0, stepPost: 0, submitted: 0, reviewQueued: 0, sentBack: 0, live: 0, liveDirect: 0, liveAfterReview: 0, firstView: 0, firstContact: 0, firstLead: 0, sold: 0, abandoned: 0, removed: 0, minutesToSubmit: 0n, minutesToLive: 0n, minutesToFirstContact: 0n } as Row);
    const reached = milestonesOf(journey);
    row.started += 1;
    row.opened += Number(reached.opened);
    row.draft += Number(reached.draft);
    row.stepMedia += Number(reached.step_media);
    row.stepDetails += Number(reached.step_details);
    row.stepWhere += Number(reached.step_where);
    row.stepPlace += Number(reached.step_place);
    row.stepPost += Number(reached.step_post);
    row.submitted += Number(reached.submitted);
    row.reviewQueued += Number(Boolean(journey.reviewQueuedAt));
    row.sentBack += Number(journey.sentBackCount > 0);
    row.live += Number(reached.live);
    row.liveDirect += Number(journey.liveVia === 'direct');
    row.liveAfterReview += Number(journey.liveVia === 'review');
    row.firstView += Number(reached.first_view);
    row.firstContact += Number(reached.first_contact);
    row.firstLead += Number(reached.first_lead);
    row.sold += Number(reached.sold);
    row.abandoned += Number(journey.stage === 'abandoned');
    row.removed += Number(journey.stage === 'removed');
    row.minutesToSubmit += BigInt(minutes(journey.startedAt, journey.submittedAt) ?? 0);
    row.minutesToLive += BigInt(minutes(journey.startedAt, journey.liveAt) ?? 0);
    row.minutesToFirstContact += BigInt(minutes(journey.liveAt, firstContactOf(journey)) ?? 0);
    rows.set(key, row);
  }
  return [...rows.values()];
}

function blockerRows(journeys: RollUp[]) {
  const rows = new Map<string, { day: Date; origin: string; step: string; code: string; param: string; country: string; refusals: number; journeys: number }>();
  for (const journey of journeys) {
    const day = utcDay(journey.startedAt);
    const seen = new Set<string>();
    for (const event of journey.events) {
      if (event.outcome !== 'refused') continue;
      const code = event.code ?? 'api_error';
      const param = event.param ?? '';
      const country = journey.country ?? '';
      const key = `${day.toISOString()}|${event.origin}|${event.step}|${code}|${param}|${country}`;
      const row = rows.get(key) ?? { day, origin: event.origin, step: event.step, code, param, country, refusals: 0, journeys: 0 };
      row.refusals += 1;
      if (!seen.has(key)) row.journeys += 1;
      seen.add(key);
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

/** Flags by the day an ad was queued; decisions (and their reasons) by the day they were made. */
function reviewRows(journeys: RollUp[]) {
  const rows = new Map<string, { day: Date; country: string; kind: string; value: string; count: number; minutes: bigint }>();
  const add = (day: Date, country: string, kind: string, value: string, spent: number | null) => {
    const key = `${day.toISOString()}|${country}|${kind}|${value}`;
    const row = rows.get(key) ?? { day, country, kind, value, count: 0, minutes: 0n };
    row.count += 1;
    row.minutes += BigInt(spent ?? 0);
    rows.set(key, row);
  };
  for (const journey of journeys) {
    const country = journey.country ?? '';
    if (journey.reviewQueuedAt) for (const flag of journey.reviewFlags) add(utcDay(journey.reviewQueuedAt), country, 'flag', flag.slice(0, 30), null);
    for (const event of journey.events) {
      if (event.origin !== 'system' || !(reviewDecisions as readonly string[]).includes(event.step)) continue;
      add(utcDay(event.createdAt), country, 'outcome', event.step, minutes(journey.reviewQueuedAt, event.createdAt));
      if (event.code) add(utcDay(event.createdAt), country, 'reason', event.code, null);
    }
  }
  return [...rows.values()];
}
