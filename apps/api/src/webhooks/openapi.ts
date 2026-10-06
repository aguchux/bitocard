import { eventApiVersion, type EventType, eventTypes } from './events.js';
import { signatureHeader, signatureTestVector, signatureToleranceSeconds, signatureValue } from './signing.js';

/**
 * The `webhooks` section of the OpenAPI document: one entry per event type, with its payload schema, a full example
 * and when it fires. The docs app generates the event reference from it; a test checks it against real payloads.
 */
type Schema = Record<string, unknown>;

const str = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const nullableStr = (description: string, extra: Schema = {}): Schema => ({ type: ['string', 'null'], description, ...extra });
const int = (description: string): Schema => ({ type: 'integer', description });
const time = (description: string): Schema => str(description, { format: 'date-time' });
const nullableTime = (description: string): Schema => nullableStr(description, { format: 'date-time' });
const mode: Schema = str('`test` (sandbox) or `live`.', { enum: ['test', 'live'] });
const money = (what: string) => int(`${what}, in minor units of \`currency\` (for example kobo).`);

const objectSchema = (name: string, properties: Record<string, Schema>): Schema => ({ type: 'object', title: name, required: Object.keys(properties), properties });

export const eventObjectSchemas: Record<string, Schema> = {
  Order: {
    ...objectSchema('Order', {
    object: str('Always `order`.', { const: 'order' }),
    id: str('Order ID.', { format: 'uuid' }),
    mode,
    status: str('`processing` until the supplier confirms; then `completed` or `failed`. A completed order can later be `refunded`.', { enum: ['processing', 'completed', 'failed', 'refunded'] }),
    quote_id: str('The quote the order used.', { format: 'uuid' }),
    product: {
      type: 'object',
      required: ['id', 'name', 'category'],
      additionalProperties: false,
      properties: { id: str('Product ID.', { format: 'uuid' }), name: str('Product name.'), category: str('Product category, for example `gift_cards`, `airtime`, `pay_tv`.') },
    },
    face_value: int('Face value of one item, in minor units of `face_currency`.'),
    face_currency: str('ISO 4217 currency of the face value.'),
    quantity: int('Number of items.'),
    currency: str('ISO 4217 currency of the amounts below (your wallet currency).'),
    wholesale: money('Your wholesale cost'),
    tax: money('Tax BitoCard collects as seller of record'),
    charged: money('Taken from your wallet: wholesale plus tax'),
    price: money('Price your customer pays'),
    reseller_profit: money('Your profit'),
    recipient: { type: ['object', 'null'], description: 'Who received it: `phone` for airtime and data, `account_number` (smartcard or meter) for pay-TV and bills.', additionalProperties: { type: 'string' } },
    customer_reference: nullableStr('Your own reference for the customer, as given on the quote.'),
    source: str('`bitocard`, or `own`: fulfilled through your own supplier account (you are the seller; `charged` is only BitoCard’s fee).', { enum: ['bitocard', 'own'] }),
    integration: {
      type: ['object', 'null'],
      description: 'For `own` orders: your supplier account that fulfilled it.',
      required: ['id', 'name'],
      additionalProperties: false,
      properties: { id: str('Integration ID, for example `reloadly`.'), name: str('Integration name.') },
    },
    failure_reason: nullableStr('Why the order failed, for failed orders.'),
    receipt_number: nullableStr('Receipt number, for completed orders.'),
    created_at: time('When the order was placed.'),
    updated_at: time('When the order last changed. Use it to ignore an older event that arrives after a newer one.'),
    completed_at: nullableTime('When the order completed or failed.'),
    }),
    additionalProperties: false,
  },
  TopUp: objectSchema('Top-up', {
    object: str('Always `top_up`.', { const: 'top_up' }),
    id: str('Top-up ID.', { format: 'uuid' }),
    mode,
    status: str('`pending` until the payment is confirmed, then `succeeded` or `failed` (events carry only the final status).', { enum: ['pending', 'succeeded', 'failed'] }),
    source: str('`checkout` (payment page) or `bank_transfer` (into your reserved bank account).', { enum: ['checkout', 'bank_transfer'] }),
    amount: money('Amount added to your wallet'),
    currency: str('ISO 4217 currency.'),
    checkout_url: nullableStr('The payment page to send the payer to, while a checkout top-up is pending; null otherwise, and always null in events.'),
    failure_reason: nullableStr('Why the payment failed, for failed top-ups.'),
    created_at: time('When the top-up started.'),
    completed_at: nullableTime('When it succeeded or failed.'),
  }),
  Payout: objectSchema('Payout', {
    object: str('Always `payout`.', { const: 'payout' }),
    id: str('Payout ID.', { format: 'uuid' }),
    mode,
    status: str('Final status.', { enum: ['pending', 'processing', 'paid', 'failed'] }),
    amount: money('Amount withdrawn'),
    currency: str('ISO 4217 currency.'),
    bank_account_id: str('The bank account paid.', { format: 'uuid' }),
    failure_reason: nullableStr('Why the transfer failed, for failed payouts.'),
    created_at: time('When the withdrawal was requested.'),
    completed_at: nullableTime('When it was paid or failed.'),
  }),
  CustomerVerification: objectSchema('Customer verification', {
    object: str('Always `customer_verification`.', { const: 'customer_verification' }),
    id: str('Verification ID.', { format: 'uuid' }),
    mode,
    customer_reference: str('Your own reference for the customer.'),
    status: str('`in_progress` (waiting for the customer at `url`), `in_review`, `approved`, `declined` or `expired` (not finished within 7 days). Only `approved` or `declined` in events.', { enum: ['in_progress', 'approved', 'declined', 'in_review', 'expired'] }),
    method: str('`bvn` (Nigeria: BVN with the customer’s consent) or `document` (ID document and face check).', { enum: ['bvn', 'document'] }),
    country: str('ISO 3166-1 alpha-2 country of the customer.'),
    url: nullableStr('Where to send the customer to finish the check, while it is `in_progress` in live mode; otherwise null (always null in test mode and in events).'),
    verified_name: nullableStr('The name on the verified record, for approved checks.'),
    reason: nullableStr('Why it did not pass: `name_mismatch` (the BVN record has a different name), `bvn_consent_declined` or `not_verified` for declined checks; `expired` for expired ones. Null otherwise.', { enum: ['name_mismatch', 'bvn_consent_declined', 'not_verified', 'expired', null] }),
    created_at: time('When the check started.'),
    decided_at: nullableTime('When it was decided.'),
  }),
};

const exampleOrder = (status: string, extra: Schema = {}) => ({
  object: 'order',
  id: '5f0c6a8e-3b1d-4c9a-9e2f-7a1b2c3d4e5f',
  mode: 'live',
  status,
  quote_id: '0b9d8c7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e',
  product: { id: 'c2a4e6f8-1b3d-4f5a-8c7e-9d0b1a2c3e4f', name: 'MTN Nigeria airtime', category: 'airtime' },
  face_value: 100_000,
  face_currency: 'NGN',
  quantity: 1,
  currency: 'NGN',
  wholesale: 97_000,
  tax: 0,
  charged: 97_000,
  price: 100_000,
  reseller_profit: 3_000,
  recipient: { phone: '+2348031234567' },
  customer_reference: 'cust-1042',
  source: 'bitocard',
  integration: null,
  failure_reason: null,
  receipt_number: 'BC-000123',
  created_at: '2026-10-06T09:15:02.114Z',
  updated_at: '2026-10-06T09:15:04.870Z',
  completed_at: '2026-10-06T09:15:04.870Z',
  ...extra,
});

const exampleTopUp = (status: string, extra: Schema = {}) => ({
  object: 'top_up',
  id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  mode: 'live',
  status,
  source: 'checkout',
  amount: 5_000_000,
  currency: 'NGN',
  checkout_url: null,
  failure_reason: null,
  created_at: '2026-10-06T08:00:00.000Z',
  completed_at: '2026-10-06T08:01:12.000Z',
  ...extra,
});

const examplePayout = (status: string, extra: Schema = {}) => ({
  object: 'payout',
  id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
  mode: 'live',
  status,
  amount: 2_500_000,
  currency: 'NGN',
  bank_account_id: '7e6d5c4b-3a2f-4e1d-9c0b-8a7f6e5d4c3b',
  failure_reason: null,
  created_at: '2026-10-21T10:00:00.000Z',
  completed_at: '2026-10-21T10:02:30.000Z',
  ...extra,
});

const exampleVerification = (status: string, extra: Schema = {}) => ({
  object: 'customer_verification',
  id: '8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e',
  mode: 'live',
  customer_reference: 'cust-1042',
  status,
  method: 'bvn',
  country: 'NG',
  url: null,
  verified_name: status === 'approved' ? 'Chinedu Okafor' : null,
  reason: null,
  created_at: '2026-10-06T09:00:00.000Z',
  decided_at: '2026-10-06T09:04:10.000Z',
  ...extra,
});

type EventDoc = { schema: string; summary: string; description: string; example: object };

/** When each event fires, when it does not, and what comes before and after it. */
export const eventDocs: Record<EventType, EventDoc> = {
  'order.completed': {
    schema: 'Order',
    summary: 'An order was delivered',
    description: [
      'Fires once when the supplier confirms delivery: straight away for most orders, or after a later status check if the order was `processing` when you placed it. The wholesale cost and tax have been taken from your wallet.',
      'Does not fire for orders that fail, and never carries gift card codes, PINs or electricity tokens: call `GET /v1/orders/{id}` to fetch them.',
      'Comes after you place the order (`POST /v1/orders`). Can be followed by `order.refunded`.',
    ].join('\n\n'),
    example: exampleOrder('completed'),
  },
  'order.failed': {
    schema: 'Order',
    summary: 'An order could not be fulfilled',
    description: [
      'Fires once when an order fails for good: every eligible supplier refused it, or the supplier confirmed it failed. The amount held from your wallet has been returned.',
      'Does not fire while an order is still `processing` (an unclear supplier answer is checked again, not treated as failure).',
      'Comes after you place the order. Nothing follows it.',
    ].join('\n\n'),
    example: exampleOrder('failed', { failure_reason: 'The order could not be fulfilled. The amount held has been returned to your wallet.', receipt_number: null }),
  },
  'order.refunded': {
    schema: 'Order',
    summary: 'A completed order was refunded',
    description: [
      'Fires when BitoCard refunds a completed order after reviewing it. The wholesale cost and tax are back in your wallet as topped-up funds.',
      'Does not fire for failed orders (their hold is simply released).',
      'Comes after `order.completed`. Nothing follows it.',
    ].join('\n\n'),
    example: exampleOrder('refunded', { updated_at: '2026-10-07T14:30:00.000Z' }),
  },
  'top_up.succeeded': {
    schema: 'TopUp',
    summary: 'Money was added to your wallet',
    description: [
      'Fires once when a payment into your wallet is confirmed: a checkout top-up (`source: checkout`) or a transfer into your reserved bank account (`source: bank_transfer`). The amount is available to spend.',
      'Does not fire for payments still pending with the payment provider.',
      'For checkout, comes after you create the top-up. Nothing follows it.',
    ].join('\n\n'),
    example: exampleTopUp('succeeded'),
  },
  'top_up.failed': {
    schema: 'TopUp',
    summary: 'A checkout top-up failed',
    description: [
      'Fires once when a checkout top-up fails or is abandoned, or the amount paid does not match. Nothing was added to your wallet.',
      'Does not fire for reserved bank account transfers (they only arrive once they have succeeded).',
      'Comes after you create the top-up. Nothing follows it.',
    ].join('\n\n'),
    example: exampleTopUp('failed', { failure_reason: 'The payment failed.' }),
  },
  'payout.paid': {
    schema: 'Payout',
    summary: 'A withdrawal reached your bank',
    description: [
      'Fires once when the bank transfer for a withdrawal of your earnings is confirmed.',
      'Does not fire while the transfer is still in progress.',
      'Comes after you request the payout. Nothing follows it.',
    ].join('\n\n'),
    example: examplePayout('paid'),
  },
  'payout.failed': {
    schema: 'Payout',
    summary: 'A withdrawal failed',
    description: [
      'Fires once when the bank refuses or fails the transfer. The amount is back in your withdrawable earnings.',
      'Does not fire while the outcome is unclear: BitoCard keeps checking with the bank.',
      'Comes after you request the payout. Nothing follows it.',
    ].join('\n\n'),
    example: examplePayout('failed', { failure_reason: 'The bank transfer was refused.' }),
  },
  'customer_verification.approved': {
    schema: 'CustomerVerification',
    summary: "A customer's identity was verified",
    description: [
      'Fires once when a customer check you started (`POST /v1/customers/{reference}/verification`) passes: the BVN record released with the customer’s consent matches their name, or their ID document and face check passed.',
      'Does not fire while the customer has not finished the check, or for checks still in review.',
      'Comes after you start the check. Nothing follows it.',
    ].join('\n\n'),
    example: exampleVerification('approved'),
  },
  'customer_verification.declined': {
    schema: 'CustomerVerification',
    summary: "A customer's identity check did not pass",
    description: [
      'Fires once when a customer check fails: the name on the BVN record differs, the customer refused consent, or the document or face check failed. `reason` says which.',
      'Does not fire for checks that simply expire unfinished (the check shows `expired` when you get it).',
      'Comes after you start the check. You can start a new check for the same customer afterwards.',
    ].join('\n\n'),
    example: exampleVerification('declined', { reason: 'name_mismatch' }),
  },
};

const exampleEventIds: Record<EventType, string> = {
  'order.completed': '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a',
  'order.failed': '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b',
  'order.refunded': '3f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c',
  'top_up.succeeded': '4a5b6c7d-8e9f-4a0b-9c2d-3e4f5a6b7c8d',
  'top_up.failed': '5b6c7d8e-9f0a-4b1c-8d3e-4f5a6b7c8d9e',
  'payout.paid': '6c7d8e9f-0a1b-4c2d-9e4f-5a6b7c8d9e0f',
  'payout.failed': '7d8e9f0a-1b2c-4d3e-8f5a-6b7c8d9e0f1a',
  'customer_verification.approved': '8e9f0a1b-2c3d-4e5f-9a6b-7c8d9e0f1a2b',
  'customer_verification.declined': '9f0a1b2c-3d4e-4f5a-8b7c-8d9e0f1a2b3c',
};

const exampleTime = (object: object) => {
  const times = object as { updated_at?: string; completed_at?: string; decided_at?: string };
  return times.updated_at ?? times.completed_at ?? times.decided_at;
};

function envelope(type: EventType): Schema {
  return {
    type: 'object',
    title: `${type} event`,
    required: ['id', 'object', 'type', 'api_version', 'mode', 'created_at', 'data'],
    properties: {
      id: str('Unique event ID. Deliveries can repeat: ignore IDs you have already handled.', { format: 'uuid' }),
      object: str('Always `event`.', { const: 'event' }),
      type: str('The event type.', { const: type }),
      api_version: str('Payload version. Adding fields keeps the version; removing or renaming one needs a new version.', { const: eventApiVersion }),
      mode,
      created_at: time('When the event happened.'),
      data: { type: 'object', required: ['object'], properties: { object: { $ref: `#/components/schemas/${eventDocs[type].schema}` } } },
    },
  };
}

const headers = [
  { name: signatureHeader, description: `\`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" keyed with your endpoint secret>\`. During a secret rotation there are two \`v1\` values; accept either. Reject timestamps more than ${signatureToleranceSeconds} seconds from now.`, example: signatureValue([signatureTestVector.secret], signatureTestVector.timestamp, signatureTestVector.body) },
  { name: 'BitoCard-Event-Id', description: 'The event ID (also in the body).', example: exampleEventIds['order.completed'] },
  { name: 'BitoCard-Event-Type', description: 'The event type (also in the body).', example: 'order.completed' },
  { name: 'BitoCard-Delivery-Attempt', description: 'Which attempt this is for this endpoint, starting at 1.', example: '1' },
].map(header => ({ in: 'header', required: true, name: header.name, description: header.description, schema: { type: 'string' }, example: header.example }));

/** Adds the webhook events to the OpenAPI document (which becomes OpenAPI 3.1, where `webhooks` exists). */
export function addWebhooks<T extends { openapi: string; components?: { schemas?: Record<string, unknown> } }>(document: T) {
  const schemas: Record<string, unknown> = { ...(document.components?.schemas ?? {}), ...eventObjectSchemas };
  const webhooks: Record<string, unknown> = {};
  for (const type of eventTypes) {
    const name = `${type.replace(/(^|[._])(\w)/g, (_m, _sep: string, char: string) => char.toUpperCase())}Event`;
    schemas[name] = envelope(type);
    const doc = eventDocs[type];
    webhooks[type] = {
      post: {
        operationId: `webhook_${type.replace('.', '_')}`,
        summary: doc.summary,
        description: doc.description,
        tags: ['Webhook events'],
        parameters: headers,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${name}` },
              example: { id: exampleEventIds[type], object: 'event', type, api_version: eventApiVersion, mode: 'live', created_at: exampleTime(doc.example), data: { object: doc.example } },
            },
          },
        },
        responses: {
          '2XX': { description: 'Received. Reply within 10 seconds, before doing any slow work; anything else (including redirects) is retried.' },
        },
      },
    };
  }
  return { ...document, openapi: '3.1.0', components: { ...document.components, schemas }, webhooks };
}
