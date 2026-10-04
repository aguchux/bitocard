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
} as const;

export type ProductFeature = keyof typeof productFeatures;

export const productFeatureKeys = Object.keys(productFeatures) as ProductFeature[];

export const isProductFeature = (value: string): value is ProductFeature => value in productFeatures;
