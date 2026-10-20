import { HttpStatus, Injectable } from '@nestjs/common';
import { apiKeyScopes } from '../api-keys/api-keys.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Plan, ResellerStatus } from '../generated/prisma/client.js';
import { FxService } from '../fx/fx.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * What plans can include, in the order they are shown, with the words resellers read. Admins place each on the free
 * plan (every plan has it) or on paid plans only (`setFeatureTier`); code checks a reseller's plan with
 * `plan.features.includes(code)`.
 */
export const planFeatureCatalogue = {
  chargeback_protection: { name: 'Chargeback protection', description: 'Chargebacks are handled by BitoCard, not taken from your wallet.' },
  priority_support: { name: 'Priority support', description: 'Faster answers from BitoCard, including chat.' },
  international_selling: { name: 'International selling', description: 'Sell to customers outside your country.' },
  own_integrations: { name: 'Your own suppliers', description: 'Connect your own supplier accounts and sell from them.' },
  own_payment_gateways: { name: 'Your own payment gateway', description: 'Your customers pay into your own gateway account.' },
  onchain_crypto: { name: 'Coins on chain', description: 'Deposit and withdraw your own coins on chain.' },
  ai_assistant: { name: 'AI support assistant', description: 'BitoCard’s AI answers your customers, within a monthly allowance.' },
} as const;
export type PlanFeature = keyof typeof planFeatureCatalogue;
export const planFeatures = Object.keys(planFeatureCatalogue) as PlanFeature[];

/** The free plan: every reseller starts on it, it is never charged, and a feature placed "free" is on it. */
export const freePlanCode = 'standard';

export function presentPlan(plan: Plan) {
  return { object: 'plan' as const, code: plan.code, name: plan.name, price: { amount: plan.priceCents, currency: 'USD', interval: 'month' }, features: plan.features };
}

/** What a reseller pays for a plan a month in one currency: the admin's fixed price, else the dollar price converted. */
export type LocalPrice = { amount: bigint; currency: string; fixed: boolean };

/** The plan as resellers see it: its description, its features in words, and (when asked) its price in their currency. */
export function presentPlanDetail(plan: Plan, local: LocalPrice | null) {
  return {
    ...presentPlan(plan),
    description: plan.description,
    feature_details: planFeatures.filter(code => plan.features.includes(code)).map(code => ({ code, ...planFeatureCatalogue[code] })),
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
  ) {}

  list() {
    return this.prisma.plan.findMany({ orderBy: { priceCents: 'asc' } });
  }

  /** The public plan list; with `currency`, each plan's monthly price in it (null where it cannot be priced). */
  async publicList(currency?: string) {
    const plans = await this.list();
    const code = currency?.trim().toUpperCase();
    return Promise.all(plans.map(async plan => presentPlanDetail(plan, code ? await this.localPrice(plan, code) : null)));
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
   * Admin: every plan with its price in each market currency (fixed, or converted today) and how many resellers are on
   * it, and every plan feature with where it sits (`free`: on every plan; `premium`: on paid plans only).
   */
  async adminOverview() {
    const plans = await this.prisma.plan.findMany({ orderBy: { priceCents: 'asc' }, include: { localPrices: true } });
    const markets = await this.prisma.country.findMany({ orderBy: { name: 'asc' }, select: { code: true, name: true, currency: true } });
    const currencies = [...new Set(markets.map(market => market.currency))].filter(currency => currency !== 'USD').sort();
    const free = plans.find(plan => plan.code === freePlanCode);
    const counts = await this.prisma.reseller.groupBy({ by: ['planCode'], where: { house: false }, _count: { _all: true } });
    return {
      object: 'plan_settings' as const,
      plans: await Promise.all(
        plans.map(async plan => ({
          ...presentPlan(plan),
          description: plan.description,
          free: plan.code === freePlanCode,
          api_restrictions: plan.apiRestrictions,
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
      features: planFeatures.map(code => ({ code, ...planFeatureCatalogue[code], tier: free?.features.includes(code) ? ('free' as const) : ('premium' as const) })),
    };
  }

  /**
   * Admin: the plan's name, description, US dollar price, fixed prices per currency (`local_prices`: `{ NGN: 3500000 }`
   * in minor units, null to go back to converting), plan features and API features switched off for it (every API
   * feature is on by default). The free plan is never charged.
   */
  async update(
    actorId: string | null,
    code: string,
    input: { name?: string; description?: string | null; price_cents?: number; local_prices?: Record<string, number | null>; features?: string[]; api_restrictions?: string[] },
  ) {
    const before = await this.prisma.plan.findUnique({ where: { code }, include: { localPrices: true } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan.');
    const invalid = (message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);
    const unknownFeature = input.features?.find(feature => !(planFeatures as readonly string[]).includes(feature));
    if (unknownFeature) throw invalid(`Unknown feature ${unknownFeature}.`, 'features');
    const unknownScope = input.api_restrictions?.find(scope => !(apiKeyScopes as readonly string[]).includes(scope));
    if (unknownScope) throw invalid(`Unknown API scope ${unknownScope}.`, 'api_restrictions');
    const free = code === freePlanCode;
    if (free && input.price_cents !== undefined && input.price_cents !== 0) throw invalid('The free plan is never charged.', 'price_cents');
    if (!free && input.price_cents === 0) throw invalid('A paid plan needs a price.', 'price_cents');
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
          features: input.features,
          apiRestrictions: input.api_restrictions,
        },
        include: { localPrices: true },
      });
    });
    await this.audit.record({ actorId, action: 'plan.updated', targetType: 'plan', targetId: code, before: auditable(before), after: auditable(after) });
    return { ...presentPlan(after), description: after.description, api_restrictions: after.apiRestrictions, local_prices: auditable(after).local_prices };
  }

  /**
   * Admin: puts a feature on the free plan (every plan has it) or on paid plans only. Resellers on the free plan gain or
   * lose it at once. Audited when anything changed.
   */
  async setFeatureTier(actorId: string | null, feature: string, tier: 'free' | 'premium') {
    if (!(planFeatures as readonly string[]).includes(feature)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such plan feature.');
    const plans = await this.prisma.plan.findMany();
    const changed: string[] = [];
    for (const plan of plans) {
      const wanted = tier === 'free' || plan.code !== freePlanCode;
      if (wanted === plan.features.includes(feature)) continue;
      const features = wanted ? [...plan.features, feature] : plan.features.filter(item => item !== feature);
      // Kept in the catalogue's order, so plan lists read the same everywhere.
      await this.prisma.plan.update({ where: { code: plan.code }, data: { features: planFeatures.filter(code => features.includes(code)) } });
      changed.push(plan.code);
    }
    if (changed.length) {
      await this.audit.record({ actorId, action: 'plan.feature_tier_changed', targetType: 'plan_feature', targetId: feature, before: null, after: { feature, tier, plans: changed } });
      if (tier === 'premium') await this.tellFreePlan(feature as PlanFeature);
    }
    return this.adminOverview();
  }

  /** Tells every reseller on the free plan that a feature now needs Premium (the reseller terms promise it). */
  private async tellFreePlan(feature: PlanFeature) {
    const { name } = planFeatureCatalogue[feature];
    const at = new Date().toISOString();
    for (let after: string | undefined; ; ) {
      const page = await this.prisma.reseller.findMany({ where: { planCode: freePlanCode, house: false }, select: { id: true }, orderBy: { id: 'asc' }, take: 500, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
      for (const reseller of page) {
        await this.inbox.reseller(reseller.id, 'plan.feature_changed', {
          subject: `${feature}:${at}`,
          title: `${name} is now part of Premium`,
          body: `${planFeatureCatalogue[feature].description} It is no longer on the Standard plan. Upgrade to Premium to keep it.`,
          link: '/settings/plan',
        });
      }
      if (page.length < 500) break;
      after = page[page.length - 1].id;
    }
  }

  async listResellers(filter: { status?: ResellerStatus; country?: string }) {
    const resellers = await this.prisma.reseller.findMany({
      // BitoCard's own store accounts are not resellers.
      where: { status: filter.status, country: filter.country?.toUpperCase(), house: false },
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
    if (!reseller) throw missingReseller();
    const waivedBy = reseller.identityWaivedBy ? await this.prisma.user.findUnique({ where: { id: reseller.identityWaivedBy }, select: { id: true, name: true } }) : null;
    return {
      object: 'reseller' as const,
      id: reseller.id,
      name: reseller.name,
      country: reseller.country,
      status: reseller.status,
      verified_at: reseller.verifiedAt?.toISOString() ?? null,
      verified_name: reseller.verifiedName,
      /** An admin let the reseller go live without the identity check: who, when and why. Null when not waived. */
      identity_waiver: reseller.identityWaivedAt
        ? { waived_at: reseller.identityWaivedAt.toISOString(), waived_by: waivedBy ? { id: waivedBy.id, name: waivedBy.name } : null, reason: reseller.identityWaiverReason }
        : null,
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
    // Going live needs the owner's identity check first, unless an admin waived it.
    if (input.status === 'active' && before.status !== 'active' && !before.verifiedAt && !before.identityWaivedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_required', "The owner's identity has not been verified yet. Verify it, or waive the check first.", 'status');
    }
    const after = await this.prisma.reseller.update({ where: { id }, data: { status: input.status, planCode: input.plan } });
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
    if (!before || before.house) throw missingReseller();
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
    if (!before || before.house) throw missingReseller();
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
    if (!before || before.house) throw missingReseller();
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
