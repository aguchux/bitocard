import type { PosPlan } from '../generated/prisma/client.js';

/**
 * Udozo POS's plans (docs/UDOZO_POS_PLAN.md, The three plans): Free, Premium and Multi-shop, their prices per market
 * currency and their limits, as finance sets them. Pure.
 */
export const posPlanCodes = ['free', 'premium', 'multi_shop'] as const;
export type PosPlanCode = (typeof posPlanCodes)[number];
export const freePlan: PosPlanCode = 'free';

export const posLimitKeys = ['products', 'shops', 'tills', 'staff'] as const;
export type PosLimitKey = (typeof posLimitKeys)[number];
/** Null is unlimited. */
export type PosLimits = Record<PosLimitKey, number | null>;

/** A paid plan that lapses falls back to these, whatever Free's row says (Free cannot be made worse than this). */
export const freeDefaults: PosLimits = { products: 50, shops: 1, tills: 2, staff: 3 };

/** Days a failed renewal keeps the plan before it drops to Free. */
export const graceDays = 7;
/** Days before a renewal that the owner is reminded. */
export const remindDays = 3;

export const isPosPlanCode = (code: string): code is PosPlanCode => (posPlanCodes as readonly string[]).includes(code);

export function limitsOf(plan: Pick<PosPlan, 'limits'>): PosLimits {
  const raw = (plan.limits ?? {}) as Record<string, unknown>;
  const out = {} as PosLimits;
  for (const key of posLimitKeys) {
    const value = raw[key];
    out[key] = typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  }
  return out;
}

/** The plan's monthly price in a currency, in minor units: 0 for Free, null where a paid plan has none. */
export function priceIn(plan: Pick<PosPlan, 'code' | 'prices'>, currency: string): bigint | null {
  if (plan.code === freePlan) return 0n;
  const value = ((plan.prices ?? {}) as Record<string, unknown>)[currency];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
}

/** Whether an owner in this currency can choose it: Free always, a paid plan once it is shown and priced there. */
export const offered = (plan: Pick<PosPlan, 'code' | 'prices' | 'shown'>, currency: string) => plan.code === freePlan || (plan.shown && priceIn(plan, currency) !== null);

export function presentPlan(plan: PosPlan, currency: string | null) {
  const price = currency ? priceIn(plan, currency) : null;
  return {
    object: 'pos_plan' as const,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    price: currency ? (price === null ? null : { amount: Number(price), currency }) : null,
    available: currency ? offered(plan, currency) : plan.code === freePlan || plan.shown,
    paid: plan.code !== freePlan,
    limits: limitsOf(plan),
    trial_days: plan.code === freePlan ? 0 : plan.trialDays,
  };
}

/** A shop code: three letters of the shop's name (X where it has fewer) and four digits, such as ADA-4821. */
export function shopCodeFor(name: string, random: () => number = Math.random) {
  const letters = name
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
  return `${letters}-${String(Math.floor(random() * 9000) + 1000)}`;
}

export const shopCodePattern = /^[A-Z]{3}-\d{4}$/;

/** Invoice numbers shown to owners. */
export const chargeNumber = (number: number) => `PI-${String(number).padStart(6, '0')}`;
