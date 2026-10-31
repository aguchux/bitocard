/**
 * What a product can do, as shown to customers and resellers: virtual numbers' calls and SMS for now. Adapters map
 * their supplier's own names onto these (`DidwwAdapter`); stores show them as labelled icons and filter by them
 * (`/v1/store/products?features=sms_in,app_codes`). Never a supplier's name for a feature.
 */
export const productFeatures = {
  calls_in: 'Incoming calls',
  calls_out: 'Outgoing calls',
  sms_in: 'Receives SMS',
  sms_out: 'Sends SMS',
  sms_people: 'SMS from people',
  app_codes: 'Receives app codes',
  emergency: 'Emergency calls',
  caller_name: 'Shows caller name',
  fax: 'Receives fax',
} as const;

export type ProductFeature = keyof typeof productFeatures;

export const productFeatureKeys = Object.keys(productFeatures) as ProductFeature[];

export const isProductFeature = (value: string): value is ProductFeature => value in productFeatures;

/**
 * An admin's rule for one feature of a supplier's products (Catalog > Suppliers > Features): products must have it
 * (`required`), must not have it (`excluded`), or may either way (`allowed`, the default). Only suppliers whose adapter
 * lists `gatedFeatures` take rules; the sync leaves out products that break any of them.
 */
export const featureRuleValues = ['required', 'allowed', 'excluded'] as const;
export type FeatureRule = (typeof featureRuleValues)[number];
export type FeatureRules = Partial<Record<ProductFeature, FeatureRule>>;

/** The saved rules, read defensively (unknown features and values are ignored). */
export function readFeatureRules(value: unknown): FeatureRules {
  const rules: FeatureRules = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rules;
  for (const [feature, rule] of Object.entries(value)) {
    if (isProductFeature(feature) && (featureRuleValues as readonly string[]).includes(rule as string)) rules[feature] = rule as FeatureRule;
  }
  return rules;
}

/** Whether a product with these features keeps to the rules: every required feature present, no excluded one. */
export function meetsFeatureRules(features: readonly ProductFeature[], rules: FeatureRules) {
  const has = new Set(features);
  return Object.entries(rules).every(([feature, rule]) => (rule === 'required' ? has.has(feature as ProductFeature) : rule === 'excluded' ? !has.has(feature as ProductFeature) : true));
}
