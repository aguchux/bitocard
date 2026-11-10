import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ConnectApplicationsService, centreNumber } from './applications.service.js';

/** What finance and operations may change on a market's Connect settings (anything left out stays). */
export type ConnectSettingsInput = {
  deposit?: number | null;
  fee_kind?: 'percent' | 'fixed' | null;
  fee_bps?: number;
  fee?: number;
  centre_share_bps?: number;
  buyer_free_hours?: number;
  return_due_days?: number;
  return_answer_hours?: number;
  seller_collect_days?: number;
  demurrage_bps?: number;
  loc_penalty_bps?: number;
  loc_penalty_cap?: number;
  abandoned_after_days?: number;
  auction_after_days?: number;
  claim_days?: number;
};

/** The whole numbers each setting takes, and how it is told when out of range. */
const limits = {
  return_due_days: { field: 'returnDueDays', min: 1, max: 90, words: 'Give the days until a return is due as 1 to 90.' },
  return_answer_hours: { field: 'returnAnswerHours', min: 1, max: 720, words: 'Give the hours to answer a return as 1 to 720.' },
  seller_collect_days: { field: 'sellerCollectDays', min: 1, max: 90, words: "Give the seller's days to collect a return as 1 to 90." },
  demurrage_bps: { field: 'demurrageBps', min: 0, max: 10000, words: 'Give the daily demurrage as 0 to 100% of the shipping charge.' },
  loc_penalty_bps: { field: 'locPenaltyBps', min: 0, max: 10000, words: 'Give the daily Loss of care penalty as 0 to 100% of the shipping charge.' },
  abandoned_after_days: { field: 'abandonedAfterDays', min: 1, max: 365, words: 'Give the days in Loss of care before an item is abandoned as 1 to 365.' },
  auction_after_days: { field: 'auctionAfterDays', min: 1, max: 730, words: 'Give the days in Loss of care before an auction as 1 to 730.' },
  claim_days: { field: 'claimDays', min: 1, max: 365, words: 'Give the days to claim what an auction left over as 1 to 365.' },
} as const;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

export type VisitorInput = { country?: string; name?: string; phone?: string | null; email?: string | null; kind?: 'staff' | 'agent'; trained?: boolean; active?: boolean };

const visitorOf = (row: { id: string; country: string; name: string; phone: string | null; email: string | null; kind: string; trainedAt: Date | null; active: boolean; createdAt: Date }) => ({
  object: 'connect_visitor' as const,
  id: row.id,
  country: row.country,
  name: row.name,
  phone: row.phone,
  email: row.email,
  kind: row.kind as 'staff' | 'agent',
  trained_at: row.trainedAt?.toISOString() ?? null,
  /** Can be sent on a visit: active, and trained if an agent. */
  can_visit: row.active && (row.kind === 'staff' || row.trainedAt !== null),
  active: row.active,
  created_at: row.createdAt.toISOString(),
});

/**
 * Udozo's team's side of Udozo Connect that is not one application: who visits offices (staff or trained agents), the
 * states Connect is open in (each open unless switched off), each market's deposit, and the centres approval made.
 */
@Injectable()
export class ConnectAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applications: ConnectApplicationsService,
  ) {}

  private async market(code: string) {
    const country = await this.prisma.country.findUnique({ where: { code: code.toUpperCase() }, select: { code: true, currency: true, name: true } });
    if (!country) throw notFound('market');
    return country;
  }

  // ---- Visitors ----

  async visitors(country?: string) {
    const rows = await this.prisma.connectVisitor.findMany({ where: country ? { country: country.toUpperCase() } : {}, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return { object: 'list' as const, data: rows.map(visitorOf) };
  }

  async createVisitor(adminId: string | null, input: VisitorInput) {
    const country = await this.market(input.country ?? '');
    const name = input.name?.replace(/\s+/g, ' ').trim() ?? '';
    if (name.length < 2 || name.length > 80) throw invalid('parameter_invalid', 'Give the visitor’s name.', 'name');
    const kind = input.kind ?? 'staff';
    const row = await this.prisma.connectVisitor.create({
      data: {
        country: country.code,
        name,
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        kind,
        trainedAt: kind === 'agent' && input.trained ? new Date() : null,
        createdById: adminId,
      },
    });
    await this.audit.record({ actorId: adminId, action: 'connect_visitor.created', targetType: 'connect_visitor', targetId: row.id, after: visitorOf(row) });
    return visitorOf(row);
  }

  async updateVisitor(adminId: string | null, id: string, input: VisitorInput) {
    const before = await this.prisma.connectVisitor.findUnique({ where: { id } });
    if (!before) throw notFound('visitor');
    const name = input.name === undefined ? undefined : input.name.replace(/\s+/g, ' ').trim();
    if (name !== undefined && (name.length < 2 || name.length > 80)) throw invalid('parameter_invalid', 'Give the visitor’s name.', 'name');
    const row = await this.prisma.connectVisitor.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() || null } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.trained !== undefined ? { trainedAt: input.trained ? (before.trainedAt ?? new Date()) : null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await this.audit.record({ actorId: adminId, action: 'connect_visitor.updated', targetType: 'connect_visitor', targetId: id, before: visitorOf(before), after: visitorOf(row) });
    return visitorOf(row);
  }

  // ---- States ----

  async states(code: string) {
    const country = await this.market(code);
    return { object: 'list' as const, country: country.code, data: await this.applications.states(country.code) };
  }

  async setState(adminId: string | null, stateId: string, enabled: boolean) {
    const state = await this.prisma.classifiedArea.findFirst({ where: { id: stateId, kind: 'state' }, select: { id: true, country: true, name: true } });
    if (!state) throw notFound('state');
    const before = (await this.prisma.connectState.findUnique({ where: { stateId } }))?.enabled ?? true;
    await this.prisma.connectState.upsert({ where: { stateId }, create: { stateId, country: state.country, enabled }, update: { enabled } });
    await this.audit.record({ actorId: adminId, action: 'connect_state.changed', targetType: 'classified_area', targetId: stateId, before: { open: before }, after: { open: enabled } });
    return { object: 'connect_state' as const, id: state.id, name: state.name, country: state.country, open: enabled };
  }

  // ---- Each market's deposit, Connect fee and holding times ----

  async settings(code: string) {
    const country = await this.market(code);
    const row = await this.prisma.connectSettings.findUnique({ where: { country: country.code } });
    return this.presentSettings(country, row);
  }

  /**
   * Changes what was sent (anything left out stays): the deposit, the Connect fee (a percentage of the shipping charge or
   * a fixed amount; null switches Connect orders off), the centre's share, and the buyer's free time to collect.
   */
  async setSettings(adminId: string | null, code: string, input: ConnectSettingsInput) {
    const country = await this.market(code);
    const before = await this.prisma.connectSettings.findUnique({ where: { country: country.code } });
    const data: Prisma.ConnectSettingsUncheckedUpdateInput = {};
    if (input.deposit !== undefined) {
      if (input.deposit !== null && (!Number.isSafeInteger(input.deposit) || input.deposit < 0)) throw invalid('parameter_invalid', 'Give the deposit in minor units, 0 or more.', 'deposit');
      data.depositMinor = input.deposit === null ? null : BigInt(input.deposit);
    }
    if (input.fee_kind !== undefined) {
      if (input.fee_kind === null) Object.assign(data, { feeKind: null, feeBps: null, feeMinor: null });
      else if (input.fee_kind === 'percent') {
        if (!Number.isInteger(input.fee_bps) || input.fee_bps! < 0 || input.fee_bps! > 10000) throw invalid('parameter_invalid', 'Give the Connect fee as a share of the shipping charge, 0 to 100%.', 'fee_bps');
        Object.assign(data, { feeKind: 'percent', feeBps: input.fee_bps, feeMinor: null });
      } else {
        if (!Number.isSafeInteger(input.fee) || input.fee! < 0) throw invalid('parameter_invalid', 'Give the Connect fee in minor units, 0 or more.', 'fee');
        Object.assign(data, { feeKind: 'fixed', feeMinor: BigInt(input.fee!), feeBps: null });
      }
    }
    if (input.centre_share_bps !== undefined) {
      if (!Number.isInteger(input.centre_share_bps) || input.centre_share_bps < 0 || input.centre_share_bps > 10000) throw invalid('parameter_invalid', "Give the centre's share as 0 to 100%.", 'centre_share_bps');
      data.centreShareBps = input.centre_share_bps;
    }
    if (input.buyer_free_hours !== undefined) {
      if (!Number.isInteger(input.buyer_free_hours) || input.buyer_free_hours < 1 || input.buyer_free_hours > 720) throw invalid('parameter_invalid', 'Give the free time to collect as 1 to 720 hours.', 'buyer_free_hours');
      data.buyerFreeHours = input.buyer_free_hours;
    }
    for (const [key, rule] of Object.entries(limits) as Array<[keyof typeof limits, (typeof limits)[keyof typeof limits]]>) {
      const value = input[key];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) throw invalid('parameter_invalid', rule.words, key);
      (data as Record<string, number>)[rule.field] = value;
    }
    if (input.loc_penalty_cap !== undefined) {
      if (!Number.isSafeInteger(input.loc_penalty_cap) || input.loc_penalty_cap < 0) throw invalid('parameter_invalid', "Give the penalty's daily cap in minor units, 0 or more.", 'loc_penalty_cap');
      data.locPenaltyCapMinor = BigInt(input.loc_penalty_cap);
    }
    const saved = await this.prisma.connectSettings.upsert({
      where: { country: country.code },
      create: { ...(data as Prisma.ConnectSettingsUncheckedCreateInput), country: country.code, updatedById: adminId },
      update: { ...data, updatedById: adminId },
    });
    await this.audit.record({ actorId: adminId, action: 'connect_settings.changed', targetType: 'country', targetId: country.code, before: before ? this.presentSettings(country, before) : null, after: this.presentSettings(country, saved) });
    return this.presentSettings(country, saved);
  }

  private presentSettings(
    country: { code: string; currency: string; name: string },
    row: {
      depositMinor: bigint | null;
      feeKind: string | null;
      feeBps: number | null;
      feeMinor: bigint | null;
      centreShareBps: number;
      buyerFreeHours: number;
      returnDueDays: number;
      returnAnswerHours: number;
      sellerCollectDays: number;
      demurrageBps: number;
      locPenaltyBps: number;
      locPenaltyCapMinor: bigint;
      abandonedAfterDays: number;
      auctionAfterDays: number;
      claimDays: number;
    } | null,
  ) {
    return {
      object: 'connect_settings' as const,
      country: country.code,
      name: country.name,
      currency: country.currency,
      deposit: row?.depositMinor === null || row?.depositMinor === undefined ? null : Number(row.depositMinor),
      /** The Connect fee buyers pay on each Connect order: a share of the shipping charge, or fixed (null: not set, so no Connect orders). */
      fee: row?.feeKind === 'percent' ? { kind: 'percent' as const, bps: row.feeBps! } : row?.feeKind === 'fixed' ? { kind: 'fixed' as const, amount: Number(row.feeMinor) } : null,
      centre_share_bps: row?.centreShareBps ?? 7000,
      buyer_free_hours: row?.buyerFreeHours ?? 72,
      /** Returns to sellers: due days after ready, hours to answer before it is accepted by itself, the seller's days to collect. */
      return_due_days: row?.returnDueDays ?? 7,
      return_answer_hours: row?.returnAnswerHours ?? 48,
      seller_collect_days: row?.sellerCollectDays ?? 7,
      /** Storage: a share of the shipping charge a day past the free time (both sides), and the Loss of care penalty, capped a day. */
      demurrage_bps: row?.demurrageBps ?? 210,
      loc_penalty_bps: row?.locPenaltyBps ?? 210,
      loc_penalty_cap: Number(row?.locPenaltyCapMinor ?? 50000n),
      /** Abandoned, then auctioned, this many days into Loss of care; what an auction left over is claimed within claim_days of the sale. */
      abandoned_after_days: row?.abandonedAfterDays ?? 30,
      auction_after_days: row?.auctionAfterDays ?? 90,
      claim_days: row?.claimDays ?? 90,
    };
  }

  // ---- Centres (approval makes them; one centre's page is ConnectCentresService.adminGet) ----

  async centres(filter: { country?: string; status?: string }) {
    const rows = await this.prisma.connectCentre.findMany({
      where: { ...(filter.country ? { country: filter.country.toUpperCase() } : {}), ...(filter.status ? { status: filter.status } : {}) },
      include: { state: { select: { name: true } }, area: { select: { name: true } }, partner: { select: { id: true, name: true, email: true } }, application: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      object: 'list' as const,
      data: rows.map(row => ({
        object: 'connect_centre' as const,
        id: row.id,
        number: centreNumber(row.number),
        name: row.name,
        status: row.status,
        paused: row.status === 'paused' ? { by: row.pausedBy, reason: row.pausedReason, until: row.pausedUntil?.toISOString() ?? null } : null,
        country: row.country,
        state: row.state.name,
        area: row.area.name,
        address: row.address,
        hours: row.hours,
        phone: row.phone,
        capacity: row.capacity,
        deposit: { amount: Number(row.depositMinor), currency: row.currency },
        partner: row.partner,
        application_id: row.application?.id ?? null,
        created_at: row.createdAt.toISOString(),
      })),
    };
  }
}
