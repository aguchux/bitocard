import { ticketVisibilities } from '../../support/tickets.service.js';
import { eventObjectSchemas, exampleTicket } from '../../webhooks/openapi.js';
import { array, bool, list, listExample, nullableStr, objectSchema, oneOf, ref, type Schema, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

/** The ticket's own fields: defined once with the webhook events (`SupportTicketSummary`), which carry the same object. */
const summaryFields = (eventObjectSchemas.SupportTicketSummary as { properties: Record<string, Schema> }).properties;

const SupportTicketMessage = objectSchema('SupportTicketMessage', {
  id: uuid('Message ID.'),
  author: oneOf('Who wrote it: `customer`, `reseller` (you), `bitocard`, `bot` (a support assistant) or `system`.', ['customer', 'reseller', 'bitocard', 'bot', 'system']),
  author_name: nullableStr('The person’s (or assistant’s) name, when known.'),
  author_avatar_url: nullableStr('The support assistant’s picture (HTTPS) on its messages; null for people and assistants without one.'),
  visibility: oneOf('`all` (the requester sees it too) or `staff` (on a customer’s ticket, you and BitoCard only).', ticketVisibilities),
  body: str('The message.'),
  draft: bool('A reply your support assistant suggested, waiting for you to send or discard (never shown to the customer).'),
  created_at: time('When it was written.'),
});

const SupportTicket = objectSchema('SupportTicketDetail', { ...summaryFields, messages: array(ref('SupportTicketMessage'), 'Its messages, oldest first: on your customers’ tickets, staff notes included.') }, 'A support ticket with its messages.');

const customerTicket = exampleTicket();
const ownTicket = exampleTicket({
  id: '7b6c5d4e-3f2a-4b1c-8d9e-0f1a2b3c4d5e',
  reference: 'T-000043',
  requester: 'reseller',
  queue: 'bitocard',
  category: 'technical',
  subject: 'Webhook deliveries failing since this morning',
  source: 'api',
  store_id: null,
  customer_id: null,
});

const question = {
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  author: 'customer',
  author_name: 'Chidi Okafor',
  author_avatar_url: null,
  visibility: 'all',
  body: 'I paid for ₦5,000 of Ikeja Electric an hour ago and have no token yet.',
  draft: false,
  created_at: '2026-10-19T09:12:00.000Z',
};

const answer = {
  id: '8b7c6d5e-4f3a-4b2c-9d1e-0f9a8b7c6d5e',
  author: 'reseller',
  author_name: 'Ada Obi',
  author_avatar_url: null,
  visibility: 'all',
  body: 'Sorry for the wait: your token is on the order page now.',
  draft: false,
  created_at: '2026-10-19T09:40:00.000Z',
};

const ownQuestion = { ...question, id: '6d5e4f3a-2b1c-4d0e-8f9a-8b7c6d5e4f3a', author: 'reseller', author_name: 'Ada Obi', body: 'Our endpoint answers 200 but deliveries show as failed.' };

export const supportDocs: DocsArea = {
  schemas: { SupportTicketDetail: SupportTicket, SupportTicketMessage },
  responses: {
    'GET /v1/support/tickets': { status: 200, description: 'Your tickets in this mode, most recently active first.', schema: list(ref('SupportTicketSummary')), example: listExample([customerTicket, ownTicket]) },
    'POST /v1/support/tickets': { status: 201, description: 'The new ticket with its first message.', schema: 'SupportTicketDetail', example: { ...ownTicket, messages: [ownQuestion] } },
    'GET /v1/support/tickets/{id}': { status: 200, description: 'The ticket with its messages.', schema: 'SupportTicketDetail', example: { ...customerTicket, messages: [question] } },
    'POST /v1/support/tickets/{id}/messages': {
      status: 201,
      description: 'The ticket with your message added.',
      schema: 'SupportTicketDetail',
      example: { ...customerTicket, status: 'pending', last_message_at: answer.created_at, updated_at: answer.created_at, messages: [question, answer] },
    },
    'POST /v1/support/tickets/{id}/escalate': {
      status: 200,
      description: 'The ticket, now with BitoCard.',
      schema: 'SupportTicketDetail',
      example: {
        ...customerTicket,
        queue: 'bitocard',
        escalated_at: '2026-10-19T09:30:00.000Z',
        last_message_at: '2026-10-19T09:30:00.000Z',
        updated_at: '2026-10-19T09:30:00.000Z',
        messages: [question, { ...answer, visibility: 'staff', body: 'The order shows delivered but the customer has no token: please check with the biller.', created_at: '2026-10-19T09:30:00.000Z' }],
      },
    },
    'POST /v1/support/tickets/{id}/resolve': {
      status: 200,
      description: 'The ticket, resolved.',
      schema: 'SupportTicketDetail',
      example: { ...customerTicket, status: 'resolved', resolved_at: '2026-10-19T10:00:00.000Z', updated_at: '2026-10-19T10:00:00.000Z', messages: [question, answer] },
    },
    'POST /v1/support/tickets/{id}/drafts/{draft}/send': {
      status: 200,
      description: 'The ticket with the assistant’s draft sent (by the assistant when unchanged, by you when edited).',
      schema: 'SupportTicketDetail',
      example: { ...customerTicket, status: 'pending', messages: [question, { ...answer, author: 'bot', author_name: 'Kemi', author_avatar_url: 'https://cdn.bitocard.com/resellers/1f2e3d4c-5b6a-4978-8d7c-6b5a49382716/bots/kemi.png', body: 'Your token is on your order page: open it and press Reveal.' }] },
    },
    'POST /v1/support/tickets/{id}/drafts/{draft}/discard': { status: 200, description: 'The ticket without the draft.', schema: 'SupportTicketDetail', example: { ...customerTicket, messages: [question] } },
    'PATCH /v1/support/tickets/{id}': {
      status: 200,
      description: 'The ticket with its new priority or assignee.',
      schema: 'SupportTicketDetail',
      example: { ...customerTicket, priority: 'high', assignee_id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', messages: [question] },
    },
  },
};
