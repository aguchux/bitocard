/**
 * What plans can include, in the order they are shown, grouped, with the words resellers read. Admins switch each on
 * or off for every plan (`PlansService.setFeature`); the API refuses a feature the reseller's plan does not include
 * (`PlanAccessService.require`, `plan_feature_required`). A new feature needs its check where it is used, and a
 * migration adding it to the plans that should keep today's behaviour.
 */
export const planFeatureGroups = {
  independence: 'Run independently',
  selling: 'Selling',
  crypto: 'Crypto',
  support: 'Support and protection',
  team: 'Team',
} as const;
export type PlanFeatureGroup = keyof typeof planFeatureGroups;

export const planFeatureCatalogue = {
  own_integrations: { group: 'independence', name: 'Your own suppliers', description: 'Connect your own supplier accounts and sell from them.' },
  own_payment_gateways: { group: 'independence', name: 'Your own payment gateway', description: 'Your customers pay into your own gateway account.' },
  multiple_stores: { group: 'independence', name: 'Several stores', description: 'Run more than one store, each with its own address and design.' },
  custom_domains: { group: 'independence', name: 'Your own domains', description: 'Buy or connect your own domain for your store.' },
  international_selling: { group: 'selling', name: 'International selling', description: 'Sell to customers outside your country.' },
  store_traffic: { group: 'selling', name: 'Store traffic', description: 'See how many people visit your stores, day by day.' },
  onchain_crypto: { group: 'crypto', name: 'Coins on chain', description: 'Deposit and withdraw your own coins on chain.' },
  reseller_desks: { group: 'crypto', name: 'Your own exchange desk', description: 'Your customers buy and sell crypto at your desk, from your reserves.' },
  chargeback_protection: { group: 'support', name: 'Chargeback protection', description: 'Chargebacks are handled by BitoCard, not taken from your wallet.' },
  priority_support: { group: 'support', name: 'Priority support', description: 'Faster answers from BitoCard, including live chat.' },
  ai_assistant: { group: 'support', name: 'AI support assistant', description: 'BitoCard’s AI answers your customers, within a monthly allowance.' },
  team_members: { group: 'team', name: 'Team members', description: 'Invite colleagues to work in SHQ with their own sign-in.' },
} as const satisfies Record<string, { group: PlanFeatureGroup; name: string; description: string }>;
export type PlanFeature = keyof typeof planFeatureCatalogue;
export const planFeatures = Object.keys(planFeatureCatalogue) as PlanFeature[];

export function isPlanFeature(value: string): value is PlanFeature {
  return (planFeatures as readonly string[]).includes(value);
}

/** The free plan: every reseller starts on it and is never charged; it cannot be deleted or hidden. */
export const freePlanCode = 'standard';
