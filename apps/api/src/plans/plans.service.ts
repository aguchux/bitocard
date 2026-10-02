import { HttpStatus, Injectable } from '@nestjs/common';
import { apiKeyScopes } from '../api-keys/api-keys.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/errors/api-error';
import { PrismaService } from '../database/prisma.service';
import type { Plan, ResellerStatus } from '../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';

export const planFeatures = ['chargeback_protection', 'priority_support', 'international_selling'] as const;

export function presentPlan(plan: Plan) {
  return { object: 'plan' as const, code: plan.code, name: plan.name, price: { amount: plan.priceCents, currency: 'USD', interval: 'month' }, features: plan.features };
}

const missingReseller = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');

/** Reseller plans, and the admin view of resellers (status and plan). */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  list() {
    return this.prisma.plan.findMany({ orderBy: { priceCents: 'asc' } });
  }

  /** Admin: price, features, and API features switched off for the plan (every API feature is on by default). */
  async update(actorId: string | null, code: string, input: { price_cents?: number; features?: string[]; api_restrictions?: string[] }) {
    const before = await this.prisma.plan.findUnique({ where: { code } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan.');
    const unknownFeature = input.features?.find(feature => !(planFeatures as readonly string[]).includes(feature));
    if (unknownFeature) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `Unknown feature ${unknownFeature}.`, 'features');
    const unknownScope = input.api_restrictions?.find(scope => !(apiKeyScopes as readonly string[]).includes(scope));
    if (unknownScope) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `Unknown API scope ${unknownScope}.`, 'api_restrictions');
    const after = await this.prisma.plan.update({
      where: { code },
      data: { priceCents: input.price_cents, features: input.features, apiRestrictions: input.api_restrictions },
    });
    await this.audit.record({ actorId, action: 'plan.updated', targetType: 'plan', targetId: code, before, after });
    return { ...presentPlan(after), api_restrictions: after.apiRestrictions };
  }

  async listResellers(filter: { status?: ResellerStatus; country?: string }) {
    const resellers = await this.prisma.reseller.findMany({
      where: { status: filter.status, country: filter.country?.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { object: 'list' as const, data: resellers.map(r => ({ object: 'reseller' as const, id: r.id, name: r.name, country: r.country, status: r.status, plan: r.planCode, created_at: r.createdAt.toISOString() })) };
  }

  async resellerDetail(id: string) {
    const reseller = await this.prisma.reseller.findUnique({
      where: { id },
      include: { members: { include: { user: true } }, plan: true, stores: true },
    });
    if (!reseller) throw missingReseller();
    return {
      object: 'reseller' as const,
      id: reseller.id,
      name: reseller.name,
      country: reseller.country,
      status: reseller.status,
      plan: presentPlan(reseller.plan),
      members: reseller.members.map(m => ({ user_id: m.userId, name: m.user.name, email: m.user.email, role: m.role })),
      stores: reseller.stores.map(s => ({ id: s.id, name: s.name, subdomain: s.subdomain, status: s.status })),
      options: await this.settings.effectiveOptions(reseller.id),
      features: await this.settings.switchesFor(reseller.id),
      created_at: reseller.createdAt.toISOString(),
    };
  }

  /** Admin: activate (after verification), suspend, or change plan. Suspension stops every API key at once. */
  async updateReseller(actorId: string | null, id: string, input: { status?: ResellerStatus; plan?: string }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before) throw missingReseller();
    if (input.plan && !(await this.prisma.plan.findUnique({ where: { code: input.plan } }))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such plan.', 'plan');
    }
    // Going live needs the owner's identity check first.
    if (input.status === 'active' && before.status !== 'active' && !before.verifiedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_required', "The owner's identity has not been verified yet.", 'status');
    }
    const after = await this.prisma.reseller.update({ where: { id }, data: { status: input.status, planCode: input.plan } });
    await this.audit.record({ actorId, action: 'reseller.updated', targetType: 'reseller', targetId: id, before, after });
    return this.resellerDetail(id);
  }

  async history(id: string) {
    const entries = await this.audit.list('reseller', id);
    return {
      object: 'list' as const,
      data: entries.map(e => ({ object: 'audit_entry' as const, action: e.action, actor_id: e.actorId, before: e.before, after: e.after, created_at: e.createdAt.toISOString() })),
    };
  }
}
