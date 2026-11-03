import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { deviceLabel } from '../notifications/push.service.js';

/**
 * Udozo's sign-up journeys (Reports > Sign-up journeys): each person's way through sign-up, from the email they enter
 * to an account they can use, step by step with why a step was refused, so admins can see where people get stuck.
 *
 * Steps are recorded by the API as they are asked (`@TrackSignup` on the routes, `SignupJourneyInterceptor`; Google's
 * own round trips by their services), never reported by the browser, so a visitor can add nothing the sign-up routes do
 * not already take. Recording never fails a step: any problem is logged and the step goes on.
 *
 * Kept 7 days after the account became usable, or 30 days after the last step of one that never did (`purge`, the daily
 * `marketing` job). The privacy notice says so.
 */
export const signupSurfaces = ['udozo', 'shq'] as const;
export type SignupSurface = (typeof signupSurfaces)[number];

export const journeySteps = [
  'signin_lookup',
  'email',
  'email_verify',
  'phone',
  'phone_verify',
  'signup',
  'google',
  'profile',
  'account_email_verify',
  'account_phone',
  'account_phone_verify',
  'phone_later',
  'onboarding_token',
  'onboarding',
  'signin',
] as const;
export type JourneyStep = (typeof journeySteps)[number];

/** The milestones in the order a journey reaches them, for the funnel and "stuck at". */
export const milestones = ['email_entered', 'email_verified', 'phone_entered', 'phone_verified', 'account_created', 'completed'] as const;
export type Milestone = (typeof milestones)[number];

/** Steps that may start a journey; the rest only add to an open one. */
const opening = new Set<JourneyStep>(['signin_lookup', 'email', 'signup', 'google']);
/** Steps after which the account may have become usable. */
const checking = new Set<JourneyStep>(['signup', 'google', 'profile', 'account_email_verify', 'account_phone_verify', 'phone_later', 'onboarding', 'signin', 'phone_verify']);

export const completedRetentionMs = 7 * 24 * 60 * 60 * 1000;
export const openRetentionMs = 30 * 24 * 60 * 60 * 1000;
/** A journey quiet this long without completing is stuck; before it, still in progress. */
export const stuckAfterMs = 60 * 60 * 1000;
/** No journey records more steps than this (a person hammering a step still counts in `refusals`). */
export const maxJourneyEvents = 200;

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export type JourneyInput = {
  surface: SignupSurface;
  step: JourneyStep;
  email: string | null | undefined;
  /** Absent when the step went through. */
  error?: unknown;
  device?: string | null;
  country?: string | null;
  accountId?: string | null;
};

type Journey = Prisma.SignupJourneyGetPayload<object>;

/** The refusal's code (and field), as the API answered it. */
export function errorParts(error: unknown): { code: string; param: string | null } {
  if (error instanceof ApiError) return { code: error.code, param: error.param ?? null };
  const status = (error as { getStatus?: () => number } | null)?.getStatus?.();
  if (status === HttpStatus.TOO_MANY_REQUESTS) return { code: 'rate_limited', param: null };
  if (typeof error === 'string') return { code: error.slice(0, 60), param: null };
  return { code: 'api_error', param: null };
}

/** "Chrome on Android", from a request (udozo.com's server forwards its visitor's browser in `bitocard-client-agent`). */
export function deviceOf(headers: Record<string, string | string[] | undefined>) {
  const pick = (name: string) => {
    const value = headers[name];
    return (Array.isArray(value) ? value[0] : value)?.slice(0, 500) || null;
  };
  const agent = pick('bitocard-client-agent') ?? pick('user-agent');
  return agent ? deviceLabel(agent).slice(0, 60) : null;
}

@Injectable()
export class SignupJourneysService {
  private readonly logger = new Logger(SignupJourneysService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Records one step (Udozo's instance only). Never throws. */
  async record(input: JourneyInput) {
    if (this.config.APP_PRODUCT !== 'udozo') return;
    try {
      await this.write(input);
    } catch (error) {
      this.logger.warn({ err: error, step: input.step }, 'Could not record a sign-up step');
    }
  }

  private async write(input: JourneyInput) {
    const email = input.email?.trim().toLowerCase() ?? '';
    if (email.length > 320 || !emailPattern.test(email)) return;
    const refused = input.error !== undefined && input.error !== null;
    const now = new Date();
    let journey = await this.prisma.signupJourney.findFirst({ where: { surface: input.surface, email, completedAt: null } });
    if (!journey) {
      if (!opening.has(input.step)) return;
      journey = await this.open(input, email, now);
    }
    const parts = refused ? errorParts(input.error) : null;
    const data: Prisma.SignupJourneyUpdateInput = {
      lastEventAt: now,
      eventCount: { increment: 1 },
      ...(input.country && !journey.country ? { country: input.country.toUpperCase().slice(0, 2) } : {}),
      ...(input.accountId && !journey.accountId ? { accountId: input.accountId } : {}),
      ...(!journey.device && input.device ? { device: input.device } : {}),
      ...(parts ? { lastErrorStep: input.step, lastErrorCode: parts.code, refusals: { increment: 1 } } : {}),
      ...(parts ? this.reachedOnRefusal(journey, input.step, parts.code, now) : this.reached(journey, input.step, now)),
    };
    const id = journey.id;
    const keep = journey.eventCount < maxJourneyEvents;
    await this.prisma.$transaction(async tx => {
      await tx.signupJourney.update({ where: { id }, data });
      if (keep) {
        await tx.signupJourneyEvent.create({
          data: { journeyId: id, step: input.step, outcome: refused ? 'refused' : 'ok', code: parts?.code ?? null, param: parts?.param?.slice(0, 40) ?? null, device: input.device ?? null, createdAt: now },
        });
      }
    });
    if (!refused && checking.has(input.step)) await this.checkComplete(id, now);
  }

  private async open(input: JourneyInput, email: string, now: Date): Promise<Journey> {
    try {
      return await this.prisma.signupJourney.create({
        data: { surface: input.surface, email, method: input.step === 'google' ? 'google' : 'email', device: input.device ?? null, startedAt: now, lastEventAt: now },
      });
    } catch (error) {
      // Another step of the same person opened it first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.signupJourney.findFirstOrThrow({ where: { surface: input.surface, email, completedAt: null } });
      }
      throw error;
    }
  }

  /** The milestones a step reaches when it goes through (each kept from the first time). */
  private reached(journey: Journey, step: JourneyStep, now: Date): Prisma.SignupJourneyUpdateInput {
    const first = (field: 'emailEnteredAt' | 'emailVerifiedAt' | 'phoneEnteredAt' | 'phoneVerifiedAt' | 'accountCreatedAt' | 'signedInAt') => (journey[field] ? {} : { [field]: now });
    switch (step) {
      case 'email':
        return first('emailEnteredAt');
      case 'email_verify':
      case 'account_email_verify':
        return { ...first('emailEnteredAt'), ...first('emailVerifiedAt') };
      case 'phone':
      case 'account_phone':
        return first('phoneEnteredAt');
      case 'phone_verify':
      case 'account_phone_verify':
        return { ...first('phoneEnteredAt'), ...first('phoneVerifiedAt') };
      case 'signup':
        // The account comes with a session: signed in.
        return { ...first('emailEnteredAt'), ...first('accountCreatedAt'), ...first('signedInAt') };
      case 'google':
        // Google confirmed the email, and the account exists.
        return { method: 'google', ...first('emailEnteredAt'), ...first('emailVerifiedAt'), ...first('accountCreatedAt'), ...first('signedInAt') };
      case 'signin':
        return first('signedInAt');
      case 'phone_later':
        // Chose to confirm the mobile later: the mobile steps count as done, as where the country cannot text.
        return { phoneSkipped: true, ...first('phoneEnteredAt') };
      default:
        return {};
    }
  }

  /** A country that cannot text is no dead end: the number is kept unconfirmed, so the mobile steps count as done. */
  private reachedOnRefusal(journey: Journey, step: JourneyStep, code: string, now: Date): Prisma.SignupJourneyUpdateInput {
    if ((step === 'phone' || step === 'account_phone') && code === 'phone_verification_unavailable') {
      return { phoneSkipped: true, ...(journey.phoneEnteredAt ? {} : { phoneEnteredAt: now }) };
    }
    return {};
  }

  /** Completed once the account is usable: on udozo.com email and mobile confirmed and a country; on Seller HQ a business too. */
  private async checkComplete(journeyId: string, now: Date) {
    const journey = await this.prisma.signupJourney.findUnique({ where: { id: journeyId } });
    if (!journey || journey.completedAt) return;
    const done = journey.surface === 'udozo' ? await this.customerReady(journey) : await this.resellerReady(journey);
    if (!done) return;
    await this.prisma.signupJourney.updateMany({
      where: { id: journeyId, completedAt: null },
      data: { completedAt: now, accountId: done.accountId, ...(done.phoneSkipped && !journey.phoneVerifiedAt ? { phoneSkipped: true, ...(journey.phoneEnteredAt ? {} : { phoneEnteredAt: now }) } : {}), ...(journey.accountCreatedAt ? {} : { accountCreatedAt: now }), ...(journey.signedInAt ? {} : { signedInAt: now }) },
    });
  }

  private async customerReady(journey: Journey) {
    if (!journey.accountId) return null;
    const customer = await this.prisma.customer.findUnique({
      where: { id: journey.accountId },
      select: { id: true, emailVerifiedAt: true, phoneVerifiedAt: true, phoneDeferredAt: true, country: true, market: { select: { smsProvider: true } } },
    });
    if (!customer?.emailVerifiedAt || !customer.country) return null;
    // The mobile is confirmed, or the customer chose to confirm it later (or their country cannot text).
    if (!customer.phoneVerifiedAt && !customer.phoneDeferredAt && customer.market?.smsProvider) return null;
    return { accountId: customer.id, phoneSkipped: !customer.phoneVerifiedAt };
  }

  private async resellerReady(journey: Journey) {
    const user = await this.prisma.user.findUnique({
      where: { realm_email: { realm: 'reseller', email: journey.email } },
      select: { id: true, emailVerifiedAt: true, memberships: { select: { resellerId: true }, take: 1 } },
    });
    if (!user?.emailVerifiedAt || user.memberships.length === 0) return null;
    return { accountId: user.id, phoneSkipped: false };
  }

  /** A sign-up page was opened: counted for the day, nothing about the visitor kept. */
  async visit(surface: SignupSurface, now = new Date()) {
    const day = utcDay(now);
    await this.prisma.signupVisitDay.upsert({ where: { surface_day: { surface, day } }, create: { surface, day, visits: 1 }, update: { visits: { increment: 1 } } });
    return { object: 'notice' as const, message: 'Counted.' };
  }

  /**
   * Completed journeys after 7 days, unfinished ones 30 days after their last step: each is first rolled into its start
   * day's counts (`signup_funnel_days`, `signup_blocker_days`; no email, account or device), in the same transaction
   * that deletes it, so a run stopped part way counts nothing twice. Daily counts go after 400 days.
   */
  async purge(now = new Date()) {
    const due: Prisma.SignupJourneyWhereInput = {
      OR: [{ completedAt: { lt: new Date(now.getTime() - completedRetentionMs) } }, { completedAt: null, lastEventAt: { lt: new Date(now.getTime() - openRetentionMs) } }],
    };
    let deleted = 0;
    for (let round = 0; round < 40; round += 1) {
      const batch = await this.prisma.signupJourney.findMany({ where: due, take: 250, orderBy: { startedAt: 'asc' }, include: { events: { where: { outcome: 'refused' }, select: { step: true, code: true } } } });
      if (batch.length === 0) break;
      await this.prisma.$transaction(async tx => {
        for (const row of funnelRows(batch)) {
          const { surface, day, method, country, ...counts } = row;
          await tx.signupFunnelDay.upsert({
            where: { surface_day_method_country: { surface, day, method, country } },
            create: row,
            update: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, { increment: value }])),
          });
        }
        for (const row of blockerRows(batch)) {
          const { surface, day, step, code, country, refusals, journeys } = row;
          await tx.signupBlockerDay.upsert({
            where: { surface_day_step_code_country: { surface, day, step, code, country } },
            create: row,
            update: { refusals: { increment: refusals }, journeys: { increment: journeys } },
          });
        }
        await tx.signupJourney.deleteMany({ where: { id: { in: batch.map(row => row.id) } } });
      });
      deleted += batch.length;
    }
    const before = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    const visits = await this.prisma.signupVisitDay.deleteMany({ where: { day: { lt: before } } });
    const funnel = await this.prisma.signupFunnelDay.deleteMany({ where: { day: { lt: before } } });
    const blockers = await this.prisma.signupBlockerDay.deleteMany({ where: { day: { lt: before } } });
    return { journeys_rolled_up: deleted, daily_counts_deleted: visits.count + funnel.count + blockers.count };
  }
}

type RollUp = Journey & { events: Array<{ step: string; code: string | null }> };

export const utcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Whether a journey reached each milestone (the mobile counts as confirmed where the country cannot text). */
export function milestonesOf(journey: Pick<Journey, 'emailEnteredAt' | 'emailVerifiedAt' | 'phoneEnteredAt' | 'phoneVerifiedAt' | 'phoneSkipped' | 'accountCreatedAt' | 'completedAt'>): Record<Milestone, boolean> {
  return {
    email_entered: Boolean(journey.emailEnteredAt),
    email_verified: Boolean(journey.emailVerifiedAt),
    phone_entered: Boolean(journey.phoneEnteredAt),
    phone_verified: Boolean(journey.phoneVerifiedAt) || journey.phoneSkipped,
    account_created: Boolean(journey.accountCreatedAt),
    completed: Boolean(journey.completedAt),
  };
}

function funnelRows(journeys: RollUp[]) {
  const rows = new Map<string, { surface: string; day: Date; method: string; country: string; started: number; emailEntered: number; emailVerified: number; phoneEntered: number; phoneVerified: number; accountCreated: number; completed: number; minutesToComplete: bigint }>();
  for (const journey of journeys) {
    const day = utcDay(journey.startedAt);
    const country = journey.country ?? '';
    const key = `${journey.surface}|${day.toISOString()}|${journey.method}|${country}`;
    const row = rows.get(key) ?? { surface: journey.surface, day, method: journey.method, country, started: 0, emailEntered: 0, emailVerified: 0, phoneEntered: 0, phoneVerified: 0, accountCreated: 0, completed: 0, minutesToComplete: 0n };
    const reached = milestonesOf(journey);
    row.started += 1;
    row.emailEntered += Number(reached.email_entered);
    row.emailVerified += Number(reached.email_verified);
    row.phoneEntered += Number(reached.phone_entered);
    row.phoneVerified += Number(reached.phone_verified);
    row.accountCreated += Number(reached.account_created);
    row.completed += Number(reached.completed);
    if (journey.completedAt) row.minutesToComplete += BigInt(Math.max(0, Math.round((journey.completedAt.getTime() - journey.startedAt.getTime()) / 60000)));
    rows.set(key, row);
  }
  return [...rows.values()];
}

function blockerRows(journeys: RollUp[]) {
  const rows = new Map<string, { surface: string; day: Date; step: string; code: string; country: string; refusals: number; journeys: number }>();
  for (const journey of journeys) {
    const day = utcDay(journey.startedAt);
    const seen = new Set<string>();
    for (const event of journey.events) {
      const code = event.code ?? 'api_error';
      const key = `${journey.surface}|${day.toISOString()}|${event.step}|${code}|${journey.country ?? ''}`;
      const row = rows.get(key) ?? { surface: journey.surface, day, step: event.step, code, country: journey.country ?? '', refusals: 0, journeys: 0 };
      row.refusals += 1;
      if (!seen.has(key)) row.journeys += 1;
      seen.add(key);
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}
