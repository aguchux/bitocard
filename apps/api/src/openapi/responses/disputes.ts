import { disputeActions, disputeKinds, disputeStatuses, disputeTopics, messageVisibilities } from '../../disputes/disputes.service.js';
import { array, constant, list, listExample, mode, nullable, nullableInt, nullableStr, nullableTime, nullableUuid, objectSchema, oneOf, ref, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

const outcomes = ['resolved_by_reseller', 'refunded_customer', 'credited_reseller', 'rejected', 'chargeback_won', 'chargeback_lost'] as const;

const summaryFields = {
  object: constant('dispute'),
  id: uuid('Dispute ID.'),
  reference: str('The reference people quote, for example `D-000123`.'),
  mode,
  kind: oneOf('`customer` (a customer’s, for you to investigate), `reseller` (yours with BitoCard) or `chargeback` (a card payment disputed with the bank).', disputeKinds),
  topic: oneOf('What it is about: `order`, `payment`, `funding` (a wallet top-up), `trade` or `other`.', disputeTopics),
  status: oneOf('`open` (with you), `escalated` (with BitoCard), `contested` (BitoCard is contesting a chargeback) or `resolved`.', disputeStatuses),
  subject: str('A short summary.'),
  customer_reference: nullableStr('Your own reference for the customer, if any.'),
  customer_id: nullableUuid('The store customer, for disputes raised on your hosted store.'),
  order_id: nullableUuid('The order it is about, if any.'),
  payment_id: nullableUuid('The payment it is about (a top-up or a store payment), if any.'),
  checkout_id: nullableUuid('The store checkout it is about, if any.'),
  chargeback_id: nullableUuid('The chargeback, for `kind: chargeback`.'),
  currency: str('Currency of amounts on the dispute (ISO 4217).'),
  recommendation: nullable(oneOf('What you recommended when escalating.', disputeActions)),
  recommended_amount: nullableInt('For `credit_reseller`: the amount you recommended, in minor units of `currency`.'),
  report: nullableStr('Your report when escalating.'),
  escalated_at: nullableTime('When it was escalated to BitoCard.'),
  outcome: nullable(oneOf('What was done, once resolved.', outcomes)),
  outcome_amount: nullableInt('For `credited_reseller`: the amount credited, in minor units of `currency`.'),
  outcome_note: nullableStr('The note with the decision.'),
  resolved_at: nullableTime('When it was resolved.'),
  created_at: time('When it was opened.'),
  updated_at: time('When it last changed (a message, an escalation or a decision).'),
};

const DisputeMessage = objectSchema('DisputeMessage', {
  id: uuid('Message ID.'),
  author: oneOf('Who wrote it: `customer`, `reseller` (you), `bitocard` or `system`.', ['customer', 'reseller', 'bitocard', 'system']),
  author_name: nullableStr('The person’s name, when known.'),
  visibility: oneOf('`all` (the customer sees it too) or `staff` (you and BitoCard only).', messageVisibilities),
  body: str('The message.'),
  created_at: time('When it was written.'),
});

const DisputeSummary = objectSchema('DisputeSummary', summaryFields, 'A dispute, without its messages.');
const Dispute = objectSchema('Dispute', { ...summaryFields, messages: array(ref('DisputeMessage'), 'Every message, oldest first, staff notes included.') }, 'A dispute with its messages.');

const base = {
  object: 'dispute',
  id: '3e2d1c0b-9a8f-4e7d-a6c5-b4a3f2e1d0c9',
  reference: 'D-000123',
  mode: 'live',
  kind: 'customer',
  topic: 'order',
  status: 'open',
  subject: 'Gift card code says already used',
  customer_reference: 'cust_8812',
  customer_id: null,
  order_id: '2c7a9e14-5b3d-4f6a-8e1c-0d9b7a5f3e21',
  payment_id: null,
  checkout_id: null,
  chargeback_id: null,
  currency: 'NGN',
  recommendation: null,
  recommended_amount: null,
  report: null,
  escalated_at: null,
  outcome: null,
  outcome_amount: null,
  outcome_note: null,
  resolved_at: null,
  created_at: '2026-10-08T09:14:02.000Z',
  updated_at: '2026-10-08T09:14:02.000Z',
};

const firstMessage = {
  id: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
  author: 'reseller',
  author_name: 'Ada Obi',
  visibility: 'staff',
  body: 'The customer says the Amazon code was already redeemed when they tried it.',
  created_at: '2026-10-08T09:14:02.000Z',
};

const escalated = {
  ...base,
  status: 'escalated',
  recommendation: 'refund_customer',
  report: 'The customer tried the code within an hour of delivery and sent a screenshot of the redemption error. Recommend a refund.',
  escalated_at: '2026-10-08T11:02:40.000Z',
  updated_at: '2026-10-08T11:02:40.000Z',
};

const systemMessage = {
  id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  author: 'system',
  author_name: null,
  visibility: 'staff',
  body: 'Escalated to BitoCard by Ada Obi. Recommendation: refund the customer.',
  created_at: '2026-10-08T11:02:40.000Z',
};

const resolved = {
  ...base,
  status: 'resolved',
  outcome: 'resolved_by_reseller',
  outcome_note: 'We sent a replacement code; the customer confirmed it worked.',
  resolved_at: '2026-10-08T12:30:00.000Z',
  updated_at: '2026-10-08T12:30:00.000Z',
};

export const disputesDocs: DocsArea = {
  schemas: { Dispute, DisputeSummary, DisputeMessage },
  responses: {
    'GET /v1/disputes': { status: 200, description: 'Your disputes in this mode, newest first.', schema: list(ref('DisputeSummary')), example: listExample([base]) },
    'POST /v1/disputes': { status: 201, description: 'The new dispute with its first message.', schema: 'Dispute', example: { ...base, messages: [firstMessage] } },
    'GET /v1/disputes/{id}': { status: 200, description: 'The dispute with every message.', schema: 'Dispute', example: { ...base, messages: [firstMessage] } },
    'POST /v1/disputes/{id}/messages': {
      status: 201,
      description: 'The dispute with your message added.',
      schema: 'Dispute',
      example: { ...base, updated_at: '2026-10-08T10:01:12.000Z', messages: [firstMessage, { ...firstMessage, id: '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7', visibility: 'all', body: 'Thanks, we are checking with our supplier.', created_at: '2026-10-08T10:01:12.000Z' }] },
    },
    'POST /v1/disputes/{id}/escalate': { status: 200, description: 'The dispute, now with BitoCard.', schema: 'Dispute', example: { ...escalated, messages: [firstMessage, systemMessage] } },
    'POST /v1/disputes/{id}/resolve': {
      status: 200,
      description: 'The dispute, resolved by you.',
      schema: 'Dispute',
      example: { ...resolved, messages: [firstMessage, { ...firstMessage, id: '6b5a4938-2716-4504-93a2-b1c0d9e8f7a6', visibility: 'all', body: resolved.outcome_note, created_at: resolved.resolved_at }] },
    },
  },
};
