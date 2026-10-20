import { Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { type PlanFeature, type PlanLimit, planFeatureCatalogue, planLimitCatalogue, planLimitValue } from './features.js';

/**
 * Whether a reseller's plan includes a feature. BitoCard's own store accounts (`house`) have every feature, whatever
 * the plans say, so changing a plan never takes anything from bitocard.com.
 */
export function planIncludes(reseller: { house: boolean; plan: { features: string[] } }, feature: PlanFeature) {
  return reseller.house || reseller.plan.features.includes(feature);
}

/** The refusal for a feature the reseller's plan does not include (the same everywhere, so SHQ can offer an upgrade). */
export function planFeatureRequired(feature: PlanFeature, planName: string) {
  return new ApiError(
    HttpStatus.FORBIDDEN,
    'permission_error',
    'plan_feature_required',
    `${planFeatureCatalogue[feature].name} is not part of your ${planName} plan. Change your plan in Settings > Plan to use it.`,
    feature,
  );
}

/** The refusal for a limit reached, naming the plan (so SHQ can offer a bigger one). */
export function planLimitReached(limit: PlanLimit, value: number, planName: string, code = 'plan_limit_reached', param: string = limit, invalid = false) {
  const { name, unit } = planLimitCatalogue[limit];
  return new ApiError(
    invalid ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT,
    invalid ? 'invalid_request_error' : 'conflict_error',
    code,
    `Your ${planName} plan allows ${value} ${value === 1 ? unit.replace(/s$/, '') : unit} (${name.toLowerCase()}). Remove one, or change your plan in Settings > Plan.`,
    param,
  );
}

/** Checks a reseller's plan for a feature or a limit. Global, so any service can ask without importing the plans module. */
@Injectable()
export class PlanAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** A limit's fallback setting (an integration setting), when the plan sets none. */
  private fallback(limit: PlanLimit) {
    const definition = planLimitCatalogue[limit];
    if (!('fallback' in definition)) return undefined;
    const value = Number((this.integrations.config as Record<string, unknown>)[definition.fallback]);
    return Number.isFinite(value) ? value : undefined;
  }

  /** How much of a limit the reseller's plan allows: a number, or null for unlimited (BitoCard's own accounts always). */
  async limit(resellerId: string, limit: PlanLimit) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { house: true, plan: { select: { name: true, limits: true } } } });
    return { value: reseller.house ? null : planLimitValue(reseller.plan.limits, limit, this.fallback(limit)), planName: reseller.plan.name };
  }

  /** The value for a plan row the caller already has (no lookup). */
  limitOf(plan: { limits: unknown }, limit: PlanLimit) {
    return planLimitValue(plan.limits, limit, this.fallback(limit));
  }

  /**
   * Refuses adding one more when `used` already reaches what the plan allows (409, or 400 with `invalid` where an
   * older limit always answered so; `code`, by default `plan_limit_reached`; `param` the limit unless given).
   * Unlimited never refuses.
   */
  async requireRoom(resellerId: string, limit: PlanLimit, used: number, options: { code?: string; param?: string; invalid?: boolean } = {}) {
    const { value, planName } = await this.limit(resellerId, limit);
    if (value !== null && used >= value) throw planLimitReached(limit, value, planName, options.code, options.param, options.invalid);
  }

  async has(resellerId: string, feature: PlanFeature) {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { house: true, plan: { select: { features: true } } } });
    return Boolean(reseller && planIncludes(reseller, feature));
  }

  /** Refuses (403 `plan_feature_required`, `param` the feature) unless the reseller's plan includes the feature. */
  async require(resellerId: string, feature: PlanFeature) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { house: true, plan: { select: { name: true, features: true } } } });
    if (!planIncludes(reseller, feature)) throw planFeatureRequired(feature, reseller.plan.name);
  }
}

@Global()
@Module({ providers: [PlanAccessService], exports: [PlanAccessService] })
export class PlanAccessModule {}
