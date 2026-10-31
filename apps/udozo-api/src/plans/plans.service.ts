import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { apiKeyScopes } from '../api-keys/api-keys.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Plan, ResellerStatus } from '../generated/prisma/client.js';
import { FxService } from '../fx/fx.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { freePlanCode, isPlanFeature, isPlanLimit, type PlanLimit, planFeatureDetail, planFeatureGroups, planFeatures, planFeaturesFor, planLimitCatalogue, planLimitsFor } from './features.js';
import { inProductWords, type Product } from '../products/product.js';
import { PlanAccessService } from './plan-access.js';

export { freePlanCode, isPlanFeature, planFeatureCatalogue, planFeatureGroups, planFeatures, type PlanFeature } from './features.js';

export function presentPlan(plan: Plan, product: Product = 'bitocard') {
  const offered: readonly string[] = planFeaturesFor(product);
  return { object: 'plan' as const, code: plan.code, name: plan.name, price: { amount: plan.priceCents, currency: 'USD', interval: 'month' }, features: plan.features.filter(code => offered.includes(code)) };
}

/** What a reseller pays for a plan a month in one currency: the admin's fixed price, else the dollar price converted. */
export type LocalPrice = { amount: bigint; currency: string; fixed: boolean };

/** Every limit's value for a plan (null: unlimited). */
export type PlanLimitValues = Record<PlanLimit, number | null>;

/**
 * The plan as resellers see it: its description, its features in words, how much it allows (`limits`), and (when
 * asked) its price in their currency.
 */
export function presentPlanDetail(plan: Plan, local: LocalPrice | null, limits: PlanLimitValues, product: Product = 'bitocard') {
  return {
    ...presentPlan(plan, product),
    description: plan.description === null ? null : inProductWords(plan.description, product),
    feature_details: planFeaturesFor(product).filter(code => plan.features.includes(code)).map(code => ({ code, ...planFeatureDetail(code, product) })),
    limits,
    local_price: local ? { amount: Number(local.amount), currency: local.currency, fixed: local.fixed } : null,
  };
}

/** Plans with their fixed prices, in a form the audit log can store (no bigints). */
function auditable(plan: Plan & { localPrices: Array<{ currency: string; amountMinor: bigint }> }) {
  const { localPrices, ...rest } = plan;
  return { ...rest, local_prices: Object.fromEntries(localPrices.map(row => [row.currency, Number(row.amountMinor)])) };
}

const missingReseller = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');

/** Reseller plans, and the admin view of resellers (status and plan). */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly fx: FxService,
    private readonly access: PlanAccessService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Every limit's value for a plan: what it sets, else the default. */
  /** This product's limits (Udozo's plans have `free_domains`, BitoCard's never). */
  /** The product this instance serves, for presenting plans in its own features and words. */
  get product(): Product {
    return this.config.APP_PRODUCT;
  }

  private shownLimits() {
    return planLimitsFor(this.config.APP_PRODUCT);
  }

  limitsOf(plan: { limits: unknown }): PlanLimitValues {
    return Object.fromEntries(this.shownLimits().map(limit => [limit, this.access.limitOf(plan, limit)])) as PlanLimitValues;
  }

  list() {
    return this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }, { code: 'asc' }] });
  }

  /**
   * The public plan list: the plans resellers can choose (`available`); with `currency`, each plan's monthly price in it
   * (null where it cannot be priced).
   */
  async publicList(currency?: string) {
    // Udozo without paid plans offers none: every store has every feature.
    if (!(await this.access.paidPlans())) return [];
    const plans = (await this.list()).filter(plan => plan.available);
    const code = currency?.trim().toUpperCase();
    return Promise.all(plans.map(async plan => presentPlanDetail(plan, code ? await this.localPrice(plan, code) : null, this.limitsOf(plan), this.config.APP_PRODUCT)));
  }

  /**
   * A plan's monthly price in a currency: the admin's fixed price for it, else the US dollar price at BitoCard's `pay`
   * rate, rounded up (what a charge would take today). Null when it cannot be priced (no rate, or the rate is paused).
   */
  async localPrice(plan: Plan, currency: string): Promise<LocalPrice | null> {
    if (plan.priceCents === 0) return { amount: 0n, currency, fixed: true };
    if (currency === 'USD') return { amount: BigInt(plan.priceCents), currency, fixed: true };
    const fixed = await this.prisma.planPrice.findUnique({ where: { planCode_currency: { planCode: plan.code, currency } } });
    if (fixed) return { amount: fixed.amountMinor, currency, fixed: true };
    try {
      const { amount } = await this.fx.chargeForUsdCents(plan.priceCents, currency);
      return { amount, currency, fixed: false };
    } catch (error) {
      if (error instanceof ApiError) return null;
      throw error;
    }
  }

  /**
   * Admin: every plan with its price in each market currency (fixed, or converted today), whether resellers can choose
   * it and how many are on it; and every plan feature with its group (each plan's `features` say where it is on).
   */
  async adminOverview() {
    const plans = await this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }, { code: 'asc' }], include: { localPrices: true } });
    const markets = await this.prisma.country.findMany({ orderBy: { name: 'asc' }, select: { code: true, name: true, currency: true } });
    const currencies = [...new Set(markets.map(market => market.currency))].filter(currency => currency !== 'USD').sort();
    const counts = await this.prisma.reseller.groupBy({ by: ['planCode'], where: { house: false, platform: 'bitocard' }, _count: { _all: true } });
    return {
      object: 'plan_settings' as const,
      plans: await Promise.all(
        plans.map(async plan => ({
          ...presentPlan(plan, this.config.APP_PRODUCT),
          description: plan.description,
          free: plan.code === freePlanCode,
          available: plan.available,
          sort_order: plan.sortOrder,
          usage_margin_bps: plan.usageMarginBps,
          api_restrictions: plan.apiRestrictions,
          /** Every limit's value (null: unlimited). */
          limits: this.limitsOf(plan),
          /** The limits this plan sets itself; the others have their default. */
          limits_set: this.shownLimits().filter(limit => Object.prototype.hasOwnProperty.call(plan.limits ?? {}, limit)),
          resellers: counts.find(row => row.planCode === plan.code)?._count._all ?? 0,
          local_prices: await Promise.all(
            currencies.map(async currency => {
              const fixed = plan.localPrices.find(row => row.currency === currency);
              const local = await this.localPrice(plan, currency);
              return {
                currency,
                markets: markets.filter(market => market.currency === currency).map(market => market.name),
                /** The admin's fixed price; null when the dollar price is converted. */
                fixed: fixed ? Number(fixed.amountMinor) : null,
                /** What a charge would take today: the fixed price, else the conversion (null without a rate). */
                charged: local ? Number(local.amount) : null,
              };
            }),
          ),
        })),
      ),
      groups: Object.entries(planFeatureGroups).map(([code, name]) => ({ code, name })),
      features: planFeaturesFor(this.config.APP_PRODUCT).map(code => ({ code, ...planFeatureDetail(code, this.config.APP_PRODUCT) })),
      limits: this.shownLimits().map(code => {
        const { scope, group, name, unit, description, max } = planLimitCatalogue[code];
        return { code, scope, group, name, unit, description, max, default: this.access.limitOf({ limits: {} }, code) };
      }),
    };
  }

  /**
   * Admin: how much of a limit a plan allows: a number, `null` for unlimited, or `reset` back to the default. Lowering it
   * below what resellers already use only stops new additions; nothing is removed. Audited.
   */
  async setLimit(actorId: string | null, code: string, limit: string, input: { value?: number | null; reset?: boolean }) {
    if (!isPlanLimit(limit) || !this.shownLimits().includes(limit)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan limit.');
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    if (!plan) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan.');
    const { max, name } = planLimitCatalogue[limit];
    if (!input.reset) {
      if (input.value === undefined) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Send a value (null for unlimited), or reset.', 'value');
      if (input.value !== null && (!Number.isSafeInteger(input.value) || input.value < 0 || input.value > max)) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `${name} must be a whole number from 0 to ${max}, or unlimited.`, 'value');
      }
    }
    const before = { ...((plan.limits as Record<string, number | null> | null) ?? {}) };
    const after: Record<string, number | null> = { ...before };
    if (input.reset) delete after[limit];
    else after[limit] = input.value ?? null;
    await this.prisma.plan.update({ where: { code }, data: { limits: after } });
    await this.audit.record({ actorId, action: 'plan.limit_changed', targetType: 'plan', targetId: code, before: { limit, value: before[limit] }, after: { limit, value: input.reset ? 'default' : after[limit] } });
    return this.adminOverview();
  }

  /**
   * Admin: a new plan (paid: only the Startup plan is free) with the features it includes. Resellers can choose it at
   * once unless it is created hidden (`available: false`). Audited.
   */
  async create(actorId: string | null, input: { code: string; name: string; description?: string | null; price_cents: number; features?: string[]; available?: boolean; sort_order?: number }) {
    const code = input.code.trim().toLowerCase();
    const invalid = (message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(code)) throw invalid('Use 2 to 30 lower-case letters, numbers and underscores, starting with a letter.', 'code');
    if (!Number.isSafeInteger(input.price_cents) || input.price_cents <= 0) throw invalid('A new plan needs a price: only the Startup plan is free.', 'price_cents');
    const unknown = input.features?.find(feature => !isPlanFeature(feature));
    if (unknown) throw invalid(`Unknown feature ${unknown}.`, 'features');
    if (await this.prisma.plan.findUnique({ where: { code } })) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'plan_exists', `There is already a plan called ${code}.`, 'code');
    const last = await this.prisma.plan.aggregate({ _max: { sortOrder: true } });
    const plan = await this.prisma.plan.create({
      data: {
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        priceCents: input.price_cents,
        features: planFeaturesFor(this.config.APP_PRODUCT).filter(feature => input.features?.includes(feature)),
        available: input.available ?? true,
        sortOrder: input.sort_order ?? (last._max.sortOrder ?? 0) + 10,
      },
      include: { localPrices: true },
    });
    await this.audit.record({ actorId, action: 'plan.created', targetType: 'plan', targetId: code, before: null, after: auditable(plan) });
    return this.adminOverview();
  }

  /**
   * Admin: the plan's name, description, US dollar price, fixed prices per currency (`local_prices`: `{ NGN: 3500000 }`
   * in minor units, null to go back to converting), plan features and API features switched off for it (every API
   * feature is on by default). The free plan is never charged.
   */
  async update(
    actorId: string | null,
    code: string,
    input: { name?: string; description?: string | null; price_cents?: number; local_prices?: Record<string, number | null>; features?: string[]; api_restrictions?: string[]; available?: boolean; sort_order?: number; usage_margin_bps?: number },
  ) {
    const before = await this.prisma.plan.findUnique({ where: { code }, include: { localPrices: true } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan.');
    const invalid = (message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);
    const unknownFeature = input.features?.find(feature => !isPlanFeature(feature));
    if (unknownFeature) throw invalid(`Unknown feature ${unknownFeature}.`, 'features');
    const unknownScope = input.api_restrictions?.find(scope => !(apiKeyScopes as readonly string[]).includes(scope));
    if (unknownScope) throw invalid(`Unknown API scope ${unknownScope}.`, 'api_restrictions');
    const free = code === freePlanCode;
    if (free && input.price_cents !== undefined && input.price_cents !== 0) throw invalid('The free plan is never charged.', 'price_cents');
    if (!free && input.price_cents === 0) throw invalid('A paid plan needs a price.', 'price_cents');
    if (free && input.available === false) throw invalid('Every reseller starts on the free plan, so it cannot be hidden.', 'available');
    const local = Object.entries(input.local_prices ?? {}).map(([currency, amount]) => ({ currency: currency.toUpperCase(), amount }));
    if (local.length) {
      if (free) throw invalid('The free plan is never charged.', 'local_prices');
      const currencies = new Set((await this.prisma.country.findMany({ select: { currency: true } })).map(market => market.currency));
      for (const { currency, amount } of local) {
        if (currency === 'USD' || !currencies.has(currency)) throw invalid(`${currency} is not a market currency. The US dollar price is price_cents.`, 'local_prices');
        if (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)) throw invalid(`The ${currency} price must be a whole number of minor units above zero.`, 'local_prices');
      }
    }
    const after = await this.prisma.$transaction(async tx => {
      for (const { currency, amount } of local) {
        if (amount === null) await tx.planPrice.deleteMany({ where: { planCode: code, currency } });
        else await tx.planPrice.upsert({ where: { planCode_currency: { planCode: code, currency } }, create: { planCode: code, currency, amountMinor: BigInt(amount) }, update: { amountMinor: BigInt(amount) } });
      }
      return tx.plan.update({
        where: { code },
        data: {
          name: input.name?.trim() || undefined,
          description: input.description === undefined ? undefined : input.description?.trim() || null,
          priceCents: input.price_cents,
          features: input.features ? planFeaturesFor(this.config.APP_PRODUCT).filter(feature => input.features!.includes(feature)) : undefined,
          apiRestrictions: input.api_restrictions,
          available: input.available,
          sortOrder: input.sort_order,
          usageMarginBps: input.usage_margin_bps,
        },
        include: { localPrices: true },
      });
    });
    await this.audit.record({ actorId, action: 'plan.updated', targetType: 'plan', targetId: code, before: auditable(before), after: auditable(after) });
    await this.tellPlan(after.code, after.name, before.features.filter(feature => !after.features.includes(feature)));
    return { ...presentPlan(after, this.config.APP_PRODUCT), description: after.description, available: after.available, sort_order: after.sortOrder, usage_margin_bps: after.usageMarginBps, api_restrictions: after.apiRestrictions, local_prices: auditable(after).local_prices };
  }

  /**
   * Admin: switches one feature on or off for one plan. Resellers on the plan gain or lose it at once (an API call
   * using it is then refused, `plan_feature_required`), and are told when they lose it. Audited when anything changed.
   */
  async setFeature(actorId: string | null, code: string, feature: string, enabled: boolean) {
    if (!isPlanFeature(feature) || !planFeaturesFor(this.config.APP_PRODUCT).includes(feature)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan feature.');
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    if (!plan) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan.');
    if (enabled !== plan.features.includes(feature)) {
      const features = enabled ? [...plan.features, feature] : plan.features.filter(item => item !== feature);
      // Kept in the catalogue's order, so plan lists read the same everywhere.
      await this.prisma.plan.update({ where: { code }, data: { features: planFeatures.filter(item => features.includes(item)) } });
      await this.audit.record({ actorId, action: 'plan.feature_changed', targetType: 'plan', targetId: code, before: { feature, enabled: !enabled }, after: { feature, enabled } });
      if (!enabled) await this.tellPlan(code, plan.name, [feature]);
    }
    return this.adminOverview();
  }

  /**
   * Admin: deletes a plan nobody is on (resellers and BitoCard's own store accounts alike; `plan_in_use` otherwise), and
   * never the free plan. Hide a plan instead (`available: false`) to stop new subscribers and keep those on it.
   */
  async remove(actorId: string | null, code: string) {
    const plan = await this.prisma.plan.findUnique({ where: { code }, include: { localPrices: true } });
    if (!plan) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan.');
    if (code === freePlanCode) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'plan_in_use', 'The free plan cannot be deleted: every reseller starts on it.');
    // Accounts on it, and stores subscribed to it (plans are per store).
    const using = (await this.prisma.reseller.count({ where: { planCode: code } })) + (await this.prisma.storeSubscription.count({ where: { planCode: code } }));
    if (using) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'plan_in_use', `${using} account${using === 1 ? ' is' : 's are'} on ${plan.name}. Hide it instead, or move them to another plan first.`);
    }
    await this.prisma.plan.delete({ where: { code } });
    await this.audit.record({ actorId, action: 'plan.deleted', targetType: 'plan', targetId: code, before: auditable(plan), after: null });
    return this.adminOverview();
  }

  /** Tells every reseller on a plan which features it no longer includes (the reseller terms promise it). */
  private async tellPlan(code: string, planName: string, removed: string[]) {
    const features = removed.filter(isPlanFeature);
    if (!features.length) return;
    const at = new Date().toISOString();
    const names = features.map(feature => planFeatureDetail(feature, this.config.APP_PRODUCT).name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    for (let after: string | undefined; ; ) {
      const page = await this.prisma.reseller.findMany({ where: { planCode: code, house: false, platform: 'bitocard' }, select: { id: true }, orderBy: { id: 'asc' }, take: 500, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
      for (const reseller of page) {
        await this.inbox.reseller(reseller.id, 'plan.feature_changed', {
          subject: `${code}:${features.join(',')}:${at}`,
          title: `${list} ${names.length === 1 ? 'is' : 'are'} no longer part of ${planName}`,
          body: `Your ${planName} plan no longer includes ${list}. See Settings > Plan for the plans that do.`,
          link: '/settings/plan',
        });
      }
      if (page.length < 500) break;
      after = page[page.length - 1].id;
    }
  }

  async listResellers(filter: { status?: ResellerStatus; country?: string }) {
    const resellers = await this.prisma.reseller.findMany({
      // BitoCard's own store accounts are not resellers, and Afrippa's operator account is not BitoCard's.
      where: { status: filter.status, country: filter.country?.toUpperCase(), house: false, platform: 'bitocard' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { object: 'list' as const, data: resellers.map(r => ({ object: 'reseller' as const, id: r.id, name: r.name, country: r.country, status: r.status, verified_at: r.verifiedAt?.toISOString() ?? null, plan: r.planCode, created_at: r.createdAt.toISOString() })) };
  }

  async resellerDetail(id: string) {
    const reseller = await this.prisma.reseller.findUnique({
      where: { id },
      include: { members: { include: { user: true } }, plan: true, stores: true },
    });
    if (!reseller || reseller.platform !== 'bitocard') throw missingReseller();
    const waivedBy = reseller.identityWaivedBy ? await this.prisma.user.findUnique({ where: { id: reseller.identityWaivedBy }, select: { id: true, name: true } }) : null;
    return {
      object: 'reseller' as const,
      id: reseller.id,
      name: reseller.name,
      country: reseller.country,
      status: reseller.status,
      verified_at: reseller.verifiedAt?.toISOString() ?? null,
      verified_name: reseller.verifiedName,
      /** The mobile number the owner gave when opening the account (E.164), never confirmed. Null when none was given. */
      signup_phone: reseller.signupPhone,
      /** An admin let the reseller go live without the identity check: who, when and why. Null when not waived. */
      identity_waiver: reseller.identityWaivedAt
        ? { waived_at: reseller.identityWaivedAt.toISOString(), waived_by: waivedBy ? { id: waivedBy.id, name: waivedBy.name } : null, reason: reseller.identityWaiverReason }
        : null,
      plan: presentPlan(reseller.plan, this.config.APP_PRODUCT),
      /** `two_step`: the member's two-step sign-in method, or null when it is off. `phone`: their confirmed primary mobile number, or null. */
      members: reseller.members.map(m => ({ user_id: m.userId, name: m.user.name, email: m.user.email, role: m.role, two_step: m.user.mfaMethod, phone: m.user.phoneVerifiedAt ? m.user.phone : null })),
      stores: reseller.stores.map(s => ({ id: s.id, name: s.name, subdomain: s.subdomain, status: s.status })),
      options: await this.settings.effectiveOptions(reseller.id),
      features: await this.settings.switchesFor(reseller.id),
      created_at: reseller.createdAt.toISOString(),
    };
  }

  /** Admin: activate (after verification), suspend, or change plan. Suspension stops every API key at once. */
  async updateReseller(actorId: string | null, id: string, input: { status?: ResellerStatus; plan?: string }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.platform !== 'bitocard') throw missingReseller();
    if (input.plan && !(await this.prisma.plan.findUnique({ where: { code: input.plan } }))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such plan.', 'plan');
    }
    // Going live needs the owner's identity check first, unless an admin waived it.
    if (input.status === 'active' && before.status !== 'active' && !before.verifiedAt && !before.identityWaivedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_required', "The owner's identity has not been verified yet. Verify it, or waive the check first.", 'status');
    }
    const after = await this.prisma.$transaction(async tx => {
      if (input.plan) {
        // Plans are per store: an admin's plan goes on every store, not billed (as BitoCard set it); Startup clears them.
        if (input.plan === freePlanCode) await tx.storeSubscription.deleteMany({ where: { resellerId: id } });
        else {
          const stores = await tx.store.findMany({ where: { resellerId: id }, select: { id: true } });
          const data = { planCode: input.plan, renewsAt: null, periodStartedAt: null, paidMinor: 0n, paidCurrency: null, cancelAtPeriodEnd: false, nextPlanCode: null, pastDueSince: null, migrated: false };
          for (const store of stores) await tx.storeSubscription.upsert({ where: { storeId: store.id }, create: { storeId: store.id, resellerId: id, ...data }, update: data });
        }
      }
      return tx.reseller.update({ where: { id }, data: { status: input.status, planCode: input.plan, ...(input.plan ? { planRenewsAt: null, planCancelAtPeriodEnd: false, planPastDueSince: null } : {}) } });
    });
    await this.audit.record({ actorId, action: 'reseller.updated', targetType: 'reseller', targetId: id, before, after });
    if (after.status === 'suspended' && before.status !== 'suspended') {
      await this.inbox.reseller(id, 'account.suspended', {
        subject: `suspended:${after.updatedAt.toISOString()}`,
        title: 'Your account is suspended',
        body: 'Live orders and your store are paused, and your API keys stop working. Contact support to find out why and what to do next.',
        link: '/settings/business',
      });
    }
    return this.resellerDetail(id);
  }

  /**
   * Lifts a suspension (operations, audited with the reason): back to active when the owner's identity is verified or
   * the check was waived, otherwise to pending (they finish the identity check before going live). The team is told.
   */
  async unsuspend(actorId: string | null, id: string, input: { reason: string }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.house || before.platform !== 'bitocard') throw missingReseller();
    if (before.status !== 'suspended') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'not_suspended', 'This reseller is not suspended.');
    const status: ResellerStatus = before.verifiedAt || before.identityWaivedAt ? 'active' : 'pending';
    // Claimed on the status, so two admins lifting it at once record it once.
    const claimed = await this.prisma.reseller.updateMany({ where: { id, status: 'suspended' }, data: { status } });
    if (claimed.count === 0) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'not_suspended', 'This reseller is not suspended.');
    const after = await this.prisma.reseller.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId, action: 'reseller.unsuspended', targetType: 'reseller', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
    await this.inbox.reseller(id, 'account.reinstated', {
      subject: `reinstated:${after.updatedAt.toISOString()}`,
      title: 'Your account is no longer suspended',
      body: status === 'active' ? 'You can take live orders again, and your store and API keys work again.' : 'Finish the identity check to take live orders again.',
      link: status === 'active' ? '/settings/business' : '/settings/verification',
    });
    return this.resellerDetail(id);
  }

  /**
   * Lets a reseller go live without the owner's identity check (operations, audited with the reason), and activates
   * them at once when asked. Live selling, top-ups and API keys follow the reseller's status as usual; payout bank
   * accounts (named after the verified owner) and the startup allowance still need the check itself.
   */
  async waiveIdentity(actorId: string | null, id: string, input: { reason: string; activate?: boolean }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.house || before.platform !== 'bitocard') throw missingReseller();
    if (before.verifiedAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_verified', "The owner's identity is already verified: there is nothing to waive.");
    const activate = input.activate === true && before.status === 'pending';
    const after = await this.prisma.reseller.update({
      where: { id },
      data: { identityWaivedAt: before.identityWaivedAt ?? new Date(), identityWaivedBy: actorId, identityWaiverReason: input.reason.trim(), status: activate ? 'active' : undefined },
    });
    await this.audit.record({ actorId, action: 'reseller.identity_waived', targetType: 'reseller', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
    return this.resellerDetail(id);
  }

  /** Withdraws the waiver (audited). A reseller still unverified and active goes back to pending: they stop selling live. */
  async restoreIdentityCheck(actorId: string | null, id: string, input: { reason: string }) {
    const before = await this.prisma.reseller.findUnique({ where: { id } });
    if (!before || before.house || before.platform !== 'bitocard') throw missingReseller();
    if (!before.identityWaivedAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'not_waived', 'The identity check is not waived for this reseller.');
    const after = await this.prisma.reseller.update({
      where: { id },
      data: { identityWaivedAt: null, identityWaivedBy: null, identityWaiverReason: null, status: !before.verifiedAt && before.status === 'active' ? 'pending' : undefined },
    });
    await this.audit.record({ actorId, action: 'reseller.identity_waiver_removed', targetType: 'reseller', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
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
