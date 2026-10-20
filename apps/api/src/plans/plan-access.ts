import { Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type PlanFeature, planFeatureCatalogue } from './features.js';

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

/** Checks a reseller's plan for a feature. Global, so any service can ask without importing the plans module. */
@Injectable()
export class PlanAccessService {
  constructor(private readonly prisma: PrismaService) {}

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
