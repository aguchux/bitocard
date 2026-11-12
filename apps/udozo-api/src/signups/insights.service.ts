import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { completedRetentionMs, type Milestone, milestones, milestonesOf, openRetentionMs, type SignupSurface, stuckAfterMs, utcDay } from './journeys.service.js';

export const journeyStatuses = ['in_progress', 'stuck', 'completed'] as const;
export type JourneyStatus = (typeof journeyStatuses)[number];
export const summaryDays = [7, 30, 90, 365] as const;

type Journey = Prisma.SignupJourneyGetPayload<object>;
type Event = Prisma.SignupJourneyEventGetPayload<object>;

const dayMs = 24 * 60 * 60 * 1000;

/** In progress while a step was taken within the hour, stuck after it, completed once the account is usable. */
export function statusOf(journey: Pick<Journey, 'completedAt' | 'lastEventAt'>, now = new Date()): JourneyStatus {
  if (journey.completedAt) return 'completed';
  return now.getTime() - journey.lastEventAt.getTime() < stuckAfterMs ? 'in_progress' : 'stuck';
}

/** The first milestone an unfinished journey has not reached: where the person is (or got stuck). */
export function stuckAt(journey: Parameters<typeof milestonesOf>[0]): Milestone | null {
  const reached = milestonesOf(journey);
  if (reached.completed) return null;
  // A Google sign-up has its email and account from the start, so it is stuck at the mobile, never before.
  return milestones.find(milestone => !reached[milestone]) ?? 'completed';
}

function presentJourney(journey: Journey, now = new Date()) {
  const deletesAt = journey.completedAt ? new Date(journey.completedAt.getTime() + completedRetentionMs) : new Date(journey.lastEventAt.getTime() + openRetentionMs);
  const at = (date: Date | null) => date?.toISOString() ?? null;
  return {
    object: 'signup_journey' as const,
    id: journey.id,
    surface: journey.surface as SignupSurface,
    email: journey.email,
    method: journey.method,
    country: journey.country,
    device: journey.device,
    status: statusOf(journey, now),
    stuck_at: stuckAt(journey),
    milestones: {
      email_entered: at(journey.emailEnteredAt),
      email_verified: at(journey.emailVerifiedAt),
      phone_entered: at(journey.phoneEnteredAt),
      phone_verified: at(journey.phoneVerifiedAt),
      account_created: at(journey.accountCreatedAt),
      signed_in: at(journey.signedInAt),
      completed: at(journey.completedAt),
    },
    phone_skipped: journey.phoneSkipped,
    last_error: journey.lastErrorCode ? { step: journey.lastErrorStep, code: journey.lastErrorCode } : null,
    refusals: journey.refusals,
    steps: journey.eventCount,
    started_at: journey.startedAt.toISOString(),
    last_event_at: journey.lastEventAt.toISOString(),
    deletes_at: deletesAt.toISOString(),
  };
}

const presentEvent = (event: Event) => ({ id: event.id, step: event.step, outcome: event.outcome, code: event.code, param: event.param, device: event.device, at: event.createdAt.toISOString() });

/** Reports > Sign-up journeys in Udozo's admin: the funnel, what blocks people, and each journey's own history. */
@Injectable()
export class SignupInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The funnel over the last `days` (by the day a journey started): journeys still kept, plus the daily counts of those
   * already deleted (`purge`), so long ranges keep their history. "In progress", "stuck", where people are stuck and
   * devices come from the journeys still kept (the last 30 days at most).
   */
  async summary(input: { surface: SignupSurface; days: number; country?: string }, now = new Date()) {
    const from = new Date(utcDay(now).getTime() - (input.days - 1) * dayMs);
    const country = input.country ? { country: input.country } : {};
    const [journeys, funnelDays, blockerDays, visitDays] = await Promise.all([
      this.prisma.signupJourney.findMany({ where: { surface: input.surface, startedAt: { gte: from }, ...country }, take: 50_000 }),
      this.prisma.signupFunnelDay.findMany({ where: { surface: input.surface, day: { gte: from }, ...country } }),
      this.prisma.signupBlockerDay.findMany({ where: { surface: input.surface, day: { gte: from }, ...country } }),
      this.prisma.signupVisitDay.findMany({ where: { surface: input.surface, day: { gte: from } } }),
    ]);
    const refused = journeys.length
      ? await this.prisma.signupJourneyEvent.findMany({ where: { outcome: 'refused', journeyId: { in: journeys.map(row => row.id) } }, select: { journeyId: true, step: true, code: true } })
      : [];

    const funnel = Object.fromEntries(milestones.map(milestone => [milestone, 0])) as Record<Milestone, number>;
    const daily = new Map<string, { day: string; visits: number; started: number; completed: number }>();
    for (let day = from.getTime(); day <= utcDay(now).getTime(); day += dayMs) {
      const key = new Date(day).toISOString().slice(0, 10);
      daily.set(key, { day: key, visits: 0, started: 0, completed: 0 });
    }
    const methods = new Map<string, { method: string; started: number; completed: number }>();
    const countries = new Map<string, { country: string | null; started: number; completed: number }>();
    const tally = <T extends { started: number; completed: number }>(map: Map<string, T>, key: string, make: () => T, started: number, completed: number) => {
      const row = map.get(key) ?? make();
      row.started += started;
      row.completed += completed;
      map.set(key, row);
    };
    let started = 0;
    let completed = 0;
    let minutes = 0;
    const statuses: Record<JourneyStatus, number> = { in_progress: 0, stuck: 0, completed: 0 };
    const stuck = Object.fromEntries(milestones.map(milestone => [milestone, 0])) as Record<Milestone, number>;
    const devices = new Map<string, { device: string; started: number; completed: number }>();

    for (const journey of journeys) {
      const reached = milestonesOf(journey);
      for (const milestone of milestones) funnel[milestone] += Number(reached[milestone]);
      started += 1;
      completed += Number(reached.completed);
      if (journey.completedAt) minutes += Math.max(0, (journey.completedAt.getTime() - journey.startedAt.getTime()) / 60000);
      const status = statusOf(journey, now);
      statuses[status] += 1;
      if (status === 'stuck') stuck[stuckAt(journey) ?? 'completed'] += 1;
      const day = daily.get(journey.startedAt.toISOString().slice(0, 10));
      if (day) {
        day.started += 1;
        day.completed += Number(reached.completed);
      }
      tally(methods, journey.method, () => ({ method: journey.method, started: 0, completed: 0 }), 1, Number(reached.completed));
      tally(countries, journey.country ?? '', () => ({ country: journey.country, started: 0, completed: 0 }), 1, Number(reached.completed));
      const device = journey.device ?? 'Unknown';
      tally(devices, device, () => ({ device, started: 0, completed: 0 }), 1, Number(reached.completed));
    }
    for (const row of funnelDays) {
      funnel.email_entered += row.emailEntered;
      funnel.email_verified += row.emailVerified;
      funnel.phone_entered += row.phoneEntered;
      funnel.phone_verified += row.phoneVerified;
      funnel.account_created += row.accountCreated;
      funnel.completed += row.completed;
      started += row.started;
      completed += row.completed;
      minutes += Number(row.minutesToComplete);
      const day = daily.get(row.day.toISOString().slice(0, 10));
      if (day) {
        day.started += row.started;
        day.completed += row.completed;
      }
      tally(methods, row.method, () => ({ method: row.method, started: 0, completed: 0 }), row.started, row.completed);
      tally(countries, row.country, () => ({ country: row.country || null, started: 0, completed: 0 }), row.started, row.completed);
    }
    let visits = 0;
    for (const row of visitDays) {
      visits += row.visits;
      const day = daily.get(row.day.toISOString().slice(0, 10));
      if (day) day.visits += row.visits;
    }

    const blockers = new Map<string, { step: string; code: string; refusals: number; journeys: Set<string> | number }>();
    for (const event of refused) {
      const code = event.code ?? 'api_error';
      const key = `${event.step}|${code}`;
      const row = blockers.get(key) ?? { step: event.step, code, refusals: 0, journeys: new Set<string>() };
      row.refusals += 1;
      (row.journeys as Set<string>).add(event.journeyId);
      blockers.set(key, row);
    }
    const blockerList = [...blockers.values()].map(row => ({ step: row.step, code: row.code, refusals: row.refusals, journeys: (row.journeys as Set<string>).size }));
    for (const row of blockerDays) {
      const found = blockerList.find(item => item.step === row.step && item.code === row.code);
      if (found) {
        found.refusals += row.refusals;
        found.journeys += row.journeys;
      } else blockerList.push({ step: row.step, code: row.code, refusals: row.refusals, journeys: row.journeys });
    }
    blockerList.sort((a, b) => b.journeys - a.journeys || b.refusals - a.refusals);

    const byCount = <T extends { started: number }>(rows: Iterable<T>) => [...rows].sort((a, b) => b.started - a.started);
    return {
      object: 'signup_summary' as const,
      surface: input.surface,
      days: input.days,
      country: input.country ?? null,
      from: from.toISOString().slice(0, 10),
      to: utcDay(now).toISOString().slice(0, 10),
      visits,
      totals: {
        started,
        completed,
        completion_rate: started ? completed / started : null,
        average_minutes_to_complete: completed ? Math.round((minutes / completed) * 10) / 10 : null,
        // Of the journeys still kept.
        in_progress: statuses.in_progress,
        stuck: statuses.stuck,
      },
      funnel: milestones.map(milestone => ({ milestone, count: funnel[milestone] })),
      stuck_at: milestones.map(milestone => ({ milestone, count: stuck[milestone] })),
      blockers: blockerList.slice(0, 20),
      daily: [...daily.values()],
      methods: byCount(methods.values()),
      countries: byCount(countries.values()),
      devices: byCount(devices.values()).slice(0, 10),
    };
  }

  async list(input: { surface?: SignupSurface; status?: JourneyStatus; stuck_at?: Milestone; code?: string; country?: string; q?: string; limit?: number; offset?: number }, now = new Date()) {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const quiet = new Date(now.getTime() - stuckAfterMs);
    const where: Prisma.SignupJourneyWhereInput = {
      ...(input.surface ? { surface: input.surface } : {}),
      ...(input.country ? { country: input.country } : {}),
      ...(input.code ? { events: { some: { code: input.code } } } : {}),
      ...(input.q ? { email: { contains: input.q.toLowerCase() } } : {}),
      ...(input.status === 'completed' ? { completedAt: { not: null } } : {}),
      ...(input.status === 'in_progress' ? { completedAt: null, lastEventAt: { gte: quiet } } : {}),
      ...(input.status === 'stuck' ? { completedAt: null, lastEventAt: { lt: quiet } } : {}),
    };
    if (input.stuck_at) {
      // Worked out from the milestones, so filtered here: journeys are few (kept 30 days at most).
      const rows = await this.prisma.signupJourney.findMany({ where: { ...where, completedAt: null }, orderBy: { lastEventAt: 'desc' }, take: 5000 });
      const matching = rows.filter(row => stuckAt(row) === input.stuck_at);
      return { object: 'list' as const, data: matching.slice(offset, offset + limit).map(row => presentJourney(row, now)), total: matching.length, has_more: matching.length > offset + limit };
    }
    const [rows, total] = await Promise.all([
      this.prisma.signupJourney.findMany({ where, orderBy: { lastEventAt: 'desc' }, take: limit + 1, skip: offset }),
      this.prisma.signupJourney.count({ where }),
    ]);
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => presentJourney(row, now)), total, has_more: rows.length > limit };
  }

  /** One journey with every step it took; viewing it (the person's email) is audited. */
  async get(id: string, actorId: string | null, now = new Date()) {
    const journey = await this.prisma.signupJourney.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    if (!journey) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This sign-up journey no longer exists: it may have been deleted after its time.');
    await this.audit.record({ actorId, action: 'signup_journey.viewed', targetType: 'signup_journey', targetId: journey.id });
    return {
      ...presentJourney(journey, now),
      account: journey.accountId ? { kind: journey.surface === 'shq' ? 'user' : 'customer', id: journey.accountId } : null,
      events: journey.events.map(presentEvent),
    };
  }
}
