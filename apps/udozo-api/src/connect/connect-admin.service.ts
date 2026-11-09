import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { ConnectApplicationsService, centreNumber } from './applications.service.js';

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

  // ---- Each market's deposit ----

  async settings(code: string) {
    const country = await this.market(code);
    const row = await this.prisma.connectSettings.findUnique({ where: { country: country.code } });
    return this.presentSettings(country, row?.depositMinor ?? null);
  }

  async setSettings(adminId: string | null, code: string, deposit: number | null) {
    const country = await this.market(code);
    if (deposit !== null && (!Number.isSafeInteger(deposit) || deposit < 0)) throw invalid('parameter_invalid', 'Give the deposit in minor units, 0 or more.', 'deposit');
    const before = (await this.prisma.connectSettings.findUnique({ where: { country: country.code } }))?.depositMinor ?? null;
    const value = deposit === null ? null : BigInt(deposit);
    await this.prisma.connectSettings.upsert({ where: { country: country.code }, create: { country: country.code, depositMinor: value, updatedById: adminId }, update: { depositMinor: value, updatedById: adminId } });
    await this.audit.record({ actorId: adminId, action: 'connect_settings.changed', targetType: 'country', targetId: country.code, before: { deposit: before === null ? null : Number(before) }, after: { deposit } });
    return this.presentSettings(country, value);
  }

  private presentSettings(country: { code: string; currency: string; name: string }, deposit: bigint | null) {
    return { object: 'connect_settings' as const, country: country.code, name: country.name, currency: country.currency, deposit: deposit === null ? null : Number(deposit) };
  }

  // ---- Centres (approval makes them; their own dashboard comes with phase 3) ----

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
