import type { Product } from '../products/product.js';
/**
 * What plans can include, in the order they are shown, grouped, with the words resellers read. Admins switch each on
 * or off for every plan (`PlansService.setFeature`); the API refuses a feature the reseller's plan does not include
 * (`PlanAccessService.require`, `plan_feature_required`). A new feature needs its check where it is used, and a
 * migration adding it to the plans that should keep today's behaviour.
 */
export const planFeatureGroups = {
  independence: 'Run independently',
  selling: 'Selling',
  support: 'Support and protection',
  team: 'Team',
} as const;
export type PlanFeatureGroup = keyof typeof planFeatureGroups;

/**
 * Where an entitlement applies: to one store (`store`) or to the reseller's whole account (`account`). Plans are still
 * chosen per account, so both read the account's plan today; per-store plans will read the store's own plan for
 * `store` entitlements and the highest plan among the reseller's stores for `account` ones.
 */
export type EntitlementScope = 'store' | 'account';

export const planFeatureCatalogue = {
  own_integrations: { scope: 'account', group: 'independence', name: 'Your own suppliers', description: 'Connect your own supplier accounts and sell from them.' },
  own_payment_gateways: { scope: 'account', group: 'independence', name: 'Your own payment gateway', description: 'Your customers pay into your own gateway account.' },
  multiple_stores: { scope: 'account', group: 'independence', name: 'Several stores', description: 'Run more than one store, each with its own address and design.' },
  custom_domains: { scope: 'store', group: 'independence', name: 'Your own domains', description: 'Buy or connect your own domain for your store.' },
  international_selling: { scope: 'store', group: 'selling', name: 'International selling', description: 'Sell to customers outside your country.' },
  white_label: { scope: 'store', group: 'selling', name: 'Your brand only', description: 'BitoCard’s name is left out of the store’s footer and pages (the terms of sale still name the seller).' },
  store_traffic: { scope: 'store', group: 'selling', name: 'Store traffic', description: 'See how many people visit your stores, day by day.' },
  chargeback_protection: { scope: 'store', group: 'support', name: 'Chargeback protection', description: 'Chargebacks are handled by BitoCard, not taken from your wallet.' },
  priority_support: { scope: 'account', group: 'support', name: 'Priority support', description: 'Faster answers from BitoCard, including live chat.' },
  ai_assistant: { scope: 'store', group: 'support', name: 'AI support assistant', description: 'BitoCard’s AI answers your customers, within a monthly allowance.' },
  team_members: { scope: 'account', group: 'team', name: 'Team members', description: 'Invite colleagues to work in SHQ with their own sign-in.' },
} as const satisfies Record<string, { scope: EntitlementScope; group: PlanFeatureGroup; name: string; description: string }>;
export type PlanFeature = keyof typeof planFeatureCatalogue;
export const planFeatures = Object.keys(planFeatureCatalogue) as PlanFeature[];

export function isPlanFeature(value: string): value is PlanFeature {
  return (planFeatures as readonly string[]).includes(value);
}

/**
 * How much of something a plan allows, beside its on/off features. Each plan stores its own value (`plans.limits`: a
 * number, or null for unlimited); a plan without one has the `default`, today's fixed value, so adding a limit changes
 * nothing for anyone. `fallback` names an integration setting that gives the default instead. Lowering a limit below
 * what a reseller already uses only stops new additions: nothing is removed. BitoCard's own store accounts have no
 * limits.
 */
export const planLimitCatalogue = {
  stores: { scope: 'account', group: 'independence', name: 'Stores', unit: 'stores', description: 'Stores the reseller can run (with Several stores on the plan).', default: 5, max: 1000 },
  domains_per_store: { scope: 'store', group: 'independence', name: 'Domains per store', unit: 'domains', description: 'Domains each store can have (with Your own domains on the plan).', default: 5, max: 100 },
  own_connections: { scope: 'account', group: 'independence', name: 'Own connections', unit: 'connections', description: 'Supplier and payment gateway accounts of their own connected at once, in each mode.', default: null, max: 1000 },
  ai_replies: { scope: 'store', group: 'support', name: 'AI replies a month', unit: 'replies', description: 'Replies each store’s assistant writes on BitoCard’s AI each month (their own AI key has no limit).', default: null, fallback: 'AI_MONTHLY_REPLIES', max: 10_000_000 },
  team_members: { scope: 'account', group: 'team', name: 'Team members', unit: 'people', description: 'People besides the owner on the team, invitations waiting included (with Team members on the plan).', default: null, max: 10_000 },
  free_domains: { scope: 'store', group: 'independence', name: 'Free domains', unit: 'domains', description: 'Domains each store gets free with the plan, bought and renewed while it keeps the plan (Udozo; never on BitoCard).', default: 0, max: 100 },
  webhook_endpoints: { scope: 'store', group: 'independence', name: 'Webhook endpoints', unit: 'endpoints', description: 'Webhook endpoints per store in each mode.', default: 16, max: 1000 },
} as const satisfies Record<string, { scope: EntitlementScope; group: PlanFeatureGroup; name: string; unit: string; description: string; default: number | null; fallback?: string; max: number }>;
export type PlanLimit = keyof typeof planLimitCatalogue;
export const planLimits = Object.keys(planLimitCatalogue) as PlanLimit[];

/** Limits only Udozo's plans have (docs/UDOZO_SPINOFF_PLAN.md): BitoCard's plans never show or set them. */
const udozoLimits: ReadonlySet<PlanLimit> = new Set<PlanLimit>(['free_domains']);

/** The limits a product's plans have. */
export const planLimitsFor = (product: Product) => planLimits.filter(limit => product === 'udozo' || !udozoLimits.has(limit));

export function isPlanLimit(value: string): value is PlanLimit {
  return (planLimits as readonly string[]).includes(value);
}

/**
 * A plan's value for a limit: what the plan sets (null: unlimited), else the catalogue's default (or, for a limit with a
 * `fallback`, that setting's value, read by the caller and passed in).
 */
export function planLimitValue(limits: unknown, limit: PlanLimit, fallback?: number | null): number | null {
  const set = limits && typeof limits === 'object' ? (limits as Record<string, unknown>)[limit] : undefined;
  if (set === null) return null;
  if (typeof set === 'number' && Number.isSafeInteger(set) && set >= 0) return set;
  const definition = planLimitCatalogue[limit];
  return 'fallback' in definition && fallback !== undefined ? fallback : definition.default;
}

/** The free plan: every reseller starts on it and is never charged; it cannot be deleted or hidden. */
export const freePlanCode = 'standard';
