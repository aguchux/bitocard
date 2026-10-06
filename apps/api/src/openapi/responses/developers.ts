import { apiKeyScopes } from '../../api-keys/api-keys.service.js';
import { eventApiVersion, eventTypes, pingEvent } from '../../webhooks/events.js';
import { eventDocs } from '../../webhooks/openapi.js';
import { array, bool, constant, int, list, listExample, nullableInt, nullableStr, nullableTime, objectSchema, oneOf, ref, shape, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

/** The component name of an event type's envelope, as `addWebhooks` names it (`order.completed` → `OrderCompletedEvent`). */
const envelopeName = (type: string) => `${type.replace(/(^|[._])(\w)/g, (_m, _sep: string, char: string) => char.toUpperCase())}Event`;

const scopes = array(oneOf('A scope.', apiKeyScopes), 'What the key may do.');

const apiKeyProperties = {
  object: constant('api_key'),
  id: uuid('API key ID.'),
  name: str('The name you gave the key, such as the system that uses it.'),
  mode: str('`test` keys use the sandbox (simulated fulfilment, no real money); `live` keys move real money.', { enum: ['test', 'live'] }),
  prefix: str('The first characters of the secret (for example `bc_live_a1b2c3`), so you can tell keys apart. The full secret is never shown again.'),
  scopes,
  created_at: time('When the key was created.'),
  last_used_at: nullableTime('When the key last authenticated a request; null if never used.'),
  expires_at: nullableTime('When the key stops working: set when the key is rolled and the old secret keeps working for the overlap. Null if it does not expire.'),
  revoked_at: nullableTime('When the key was revoked; null while it is active.'),
};

const endpointProperties = {
  object: constant('webhook_endpoint'),
  id: uuid('Endpoint ID.'),
  mode: str('`test` endpoints receive sandbox events, `live` endpoints live events.', { enum: ['test', 'live'] }),
  url: str('Where events are sent (HTTPS on the public internet).', { format: 'uri' }),
  description: nullableStr('Your description of the endpoint.'),
  events: array(oneOf('An event type, or `*` for every type including types added later.', ['*', ...eventTypes]), 'Event types sent to this endpoint. `["*"]` means all of them.'),
  status: oneOf('`enabled`, or `disabled` (by you, or by BitoCard after 3 days of failed deliveries).', ['enabled', 'disabled']),
  disabled_reason: nullableStr('Why the endpoint is disabled: `failing` (3 days of failed deliveries) or `by_reseller` (you paused it). Null while enabled.', { enum: ['failing', 'by_reseller', null] }),
  disabled_at: nullableTime('When it was disabled; null while enabled.'),
  previous_secret_expires_at: nullableTime('After a secret rotation, when the previous secret stops signing. Until then each delivery carries two `v1` signatures. Null when there is no previous secret.'),
  created_at: time('When the endpoint was created.'),
};

const secretField = str('The signing secret (`whsec_…`). Shown only in this response: store it safely. Use it to verify the `BitoCard-Signature` header of each delivery.', { pattern: '^whsec_' });

const deliveryProperties = {
  object: constant('webhook_delivery'),
  id: uuid('Delivery ID.'),
  endpoint_id: uuid('The endpoint it was sent to.'),
  event: shape(
    {
      id: uuid('Event ID (the `id` in the payload).'),
      type: oneOf('Event type; `ping` for test events.', [pingEvent, ...eventTypes]),
      created_at: time('When the event happened.'),
    },
    'The event delivered.',
  ),
  status: oneOf('`pending` (not yet delivered, or waiting for its next retry), `succeeded` (your endpoint replied 2xx) or `failed` (retries ran out, or a test event that failed).', ['pending', 'succeeded', 'failed']),
  attempts: int('Scheduled attempts so far (manual resends are logged but not counted).'),
  next_attempt_at: nullableTime('When the next retry is due; null when none is scheduled.'),
  last_attempt_at: nullableTime('When it was last sent; null before the first attempt.'),
  last_response_status: nullableInt('The HTTP status of the last reply; null if there was none (timeout or connection error).'),
  last_error: nullableStr('What went wrong last time, for example `http_500`, `timeout`, `connection_error` or `endpoint_disabled`; null after a success.'),
  created_at: time('When the delivery was queued.'),
};

const attempt = shape({
  success: bool('Whether your endpoint replied 2xx within 10 seconds.'),
  manual: bool('Sent by a resend or test from you, rather than by the retry schedule.'),
  response_status: nullableInt('HTTP status of the reply; null if there was none.'),
  response_body: nullableStr('The start of the reply body, for troubleshooting.'),
  error: nullableStr('What went wrong, for example `http_500`, `timeout` or `connection_error`; null on success.'),
  duration_ms: int('How long the attempt took, in milliseconds.'),
  created_at: time('When the attempt was made.'),
});

const exampleKey = {
  object: 'api_key',
  id: '6b1f2e3d-4c5a-4b6c-8d7e-9f0a1b2c3d4e',
  name: 'Website backend',
  mode: 'test',
  prefix: 'bc_test_x7Kq2m',
  scopes: [...apiKeyScopes],
  created_at: '2026-10-06T09:00:00.000Z',
  last_used_at: '2026-10-06T09:12:41.000Z',
  expires_at: null,
  revoked_at: null,
};

const exampleEndpoint = {
  object: 'webhook_endpoint',
  id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
  mode: 'live',
  url: 'https://example.com/webhooks/bitocard',
  description: 'Order updates for the shop backend',
  events: ['order.completed', 'order.failed', 'order.refunded'],
  status: 'enabled',
  disabled_reason: null,
  disabled_at: null,
  previous_secret_expires_at: null,
  created_at: '2026-10-06T09:20:00.000Z',
};

const exampleDelivery = {
  object: 'webhook_delivery',
  id: '4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b',
  endpoint_id: exampleEndpoint.id,
  event: { id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', type: 'order.completed', created_at: '2026-10-06T09:15:04.870Z' },
  status: 'succeeded',
  attempts: 2,
  next_attempt_at: null,
  last_attempt_at: '2026-10-06T09:16:05.300Z',
  last_response_status: 200,
  last_error: null,
  created_at: '2026-10-06T09:15:04.900Z',
};

const exampleDeliveryDetail = {
  ...exampleDelivery,
  log: [
    { success: true, manual: false, response_status: 200, response_body: 'ok', error: null, duration_ms: 182, created_at: '2026-10-06T09:16:05.300Z' },
    { success: false, manual: false, response_status: 503, response_body: 'Service Unavailable', error: 'http_503', duration_ms: 95, created_at: '2026-10-06T09:15:05.010Z' },
  ],
};

const examplePing = {
  ...exampleDelivery,
  id: '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c',
  event: { id: '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d', type: 'ping', created_at: '2026-10-06T09:21:00.000Z' },
  attempts: 0,
  last_attempt_at: '2026-10-06T09:21:00.250Z',
  created_at: '2026-10-06T09:21:00.000Z',
  log: [{ success: true, manual: true, response_status: 200, response_body: 'ok', error: null, duration_ms: 240, created_at: '2026-10-06T09:21:00.250Z' }],
};

const exampleEvent = (type: (typeof eventTypes)[number], id: string) => {
  const object = eventDocs[type].example as { decided_at?: string; updated_at?: string; completed_at?: string };
  return { id, object: 'event', type, api_version: eventApiVersion, mode: 'live', created_at: object.updated_at ?? object.completed_at ?? object.decided_at, data: { object } };
};

export const developersDocs: DocsArea = {
  schemas: {
    ApiKey: objectSchema('API key', apiKeyProperties, 'A secret key for your own systems. Only its prefix is ever shown after it is created.'),
    CreatedApiKey: objectSchema(
      'API key with its secret',
      { ...apiKeyProperties, secret: str('The full secret key (`bc_test_…` or `bc_live_…`). Shown only in this response: store it safely, and send it as `Authorization: Bearer <secret>`.', { pattern: '^bc_(test|live)_' }) },
      'A newly created or rolled key, with its secret. The secret is never shown again.',
    ),
    WebhookEndpoint: objectSchema('Webhook endpoint', endpointProperties, 'An address of yours that receives signed events.'),
    CreatedWebhookEndpoint: objectSchema('Webhook endpoint with its secret', { ...endpointProperties, secret: secretField }, 'A new endpoint, or one whose secret was just rotated, with its signing secret. The secret is never shown again.'),
    WebhookDelivery: objectSchema('Webhook delivery', deliveryProperties, 'One event sent (or due to be sent) to one endpoint.'),
    WebhookDeliveryDetail: objectSchema(
      'Webhook delivery with its attempts',
      { ...deliveryProperties, log: array(attempt, 'Each attempt, newest first (up to 50).') },
      'One event sent to one endpoint, with each attempt: the reply status, the start of the reply body, any error and the time taken.',
    ),
    EventEnvelope: {
      title: 'Event',
      description: 'An event, exactly as it was sent to your webhook endpoints: same ID and body. `type` says which object `data.object` is.',
      oneOf: eventTypes.map(type => ref(envelopeName(type))),
    },
  },
  responses: {
    'POST /v1/api-keys': {
      status: 201,
      description: 'The new key, with its secret. The secret is returned only here.',
      schema: 'CreatedApiKey',
      example: { ...exampleKey, last_used_at: null, secret: 'bc_test_REPLACE_WITH_YOUR_OWN_SECRET_KEY_0000000' },
    },
    'GET /v1/api-keys': {
      status: 200,
      description: 'Every key, newest first, including revoked and expired ones. Secrets are never shown.',
      schema: list(ref('ApiKey'), {}, false),
      example: {
        object: 'list',
        data: [
          exampleKey,
          { ...exampleKey, id: '7c2a3f4e-5d6b-4c7d-9e8f-0a1b2c3d4e5f', name: 'Old backend', mode: 'live', prefix: 'bc_live_p3Rw9z', scopes: ['catalogue:read', 'quotes:write', 'orders:read', 'orders:write'], created_at: '2026-09-01T10:00:00.000Z', last_used_at: '2026-09-30T18:02:11.000Z', revoked_at: '2026-10-01T08:00:00.000Z' },
        ],
      },
    },
    'POST /v1/api-keys/{id}/roll': {
      status: 201,
      description: 'A replacement key with the same name, mode and scopes, with its new secret (returned only here). The old key keeps working for `overlap_hours`, then stops.',
      schema: 'CreatedApiKey',
      example: { ...exampleKey, id: '8d3b4a5f-6e7c-4d8e-8f9a-1b2c3d4e5f6a', prefix: 'bc_test_Lm4Tq8', created_at: '2026-10-06T11:00:00.000Z', last_used_at: null, secret: 'bc_test_REPLACE_WITH_YOUR_OWN_SECRET_KEY_1111111' },
    },
    'DELETE /v1/api-keys/{id}': {
      status: 200,
      description: 'The revoked key. It stops working at once. Revoking a revoked key returns it unchanged.',
      schema: 'ApiKey',
      example: { ...exampleKey, revoked_at: '2026-10-06T12:00:00.000Z' },
    },
    'POST /v1/webhook-endpoints': {
      status: 201,
      description: 'The new endpoint, with its signing secret. The secret is returned only here (and when you rotate it).',
      schema: 'CreatedWebhookEndpoint',
      example: { ...exampleEndpoint, secret: 'whsec_REPLACE_WITH_YOUR_OWN_SIGNING_SECRET' },
    },
    'GET /v1/webhook-endpoints': {
      status: 200,
      description: 'Every endpoint in this mode, oldest first. Secrets are never shown.',
      schema: list(ref('WebhookEndpoint'), {}, false),
      example: {
        object: 'list',
        data: [
          exampleEndpoint,
          { ...exampleEndpoint, id: '3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f7a', url: 'https://example.com/webhooks/payments', description: null, events: ['*'], status: 'disabled', disabled_reason: 'failing', disabled_at: '2026-10-05T07:00:00.000Z', created_at: '2026-10-01T09:00:00.000Z' },
        ],
      },
    },
    'GET /v1/webhook-endpoints/{id}': { status: 200, description: 'The endpoint.', schema: 'WebhookEndpoint', example: exampleEndpoint },
    'PATCH /v1/webhook-endpoints/{id}': {
      status: 200,
      description: 'The updated endpoint. Enabling a disabled endpoint clears its failure history; deliveries resume.',
      schema: 'WebhookEndpoint',
      example: { ...exampleEndpoint, events: ['*'] },
    },
    'DELETE /v1/webhook-endpoints/{id}': {
      status: 200,
      description: 'The endpoint and its delivery log are deleted. Its events stay available from `GET /v1/events`.',
      schema: objectSchema('Deleted webhook endpoint', { object: constant('webhook_endpoint'), id: uuid('The deleted endpoint’s ID.'), deleted: { type: 'boolean', const: true, description: 'Always `true`.' } }),
      example: { object: 'webhook_endpoint', id: exampleEndpoint.id, deleted: true },
    },
    'POST /v1/webhook-endpoints/{id}/rotate-secret': {
      status: 200,
      description: 'The endpoint with its new signing secret, returned only here. Until `previous_secret_expires_at`, each delivery is signed with both secrets.',
      schema: 'CreatedWebhookEndpoint',
      example: { ...exampleEndpoint, previous_secret_expires_at: '2026-10-07T10:00:00.000Z', secret: 'whsec_REPLACE_WITH_YOUR_NEW_SIGNING_SECRET' },
    },
    'POST /v1/webhook-endpoints/{id}/test': {
      status: 200,
      description: 'The `ping` delivery with the result of its one attempt. Test events are never retried and never listed by `GET /v1/events`.',
      schema: 'WebhookDeliveryDetail',
      example: examplePing,
    },
    'GET /v1/webhook-endpoints/{id}/deliveries': {
      status: 200,
      description: 'The delivery log, newest first.',
      schema: list(ref('WebhookDelivery')),
      example: listExample([exampleDelivery, { ...exampleDelivery, id: '6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d', event: { id: '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b', type: 'order.failed', created_at: '2026-10-06T08:40:00.000Z' }, status: 'pending', attempts: 1, next_attempt_at: '2026-10-06T08:46:00.000Z', last_attempt_at: '2026-10-06T08:41:00.000Z', last_response_status: 500, last_error: 'http_500', created_at: '2026-10-06T08:40:00.100Z' }], true),
    },
    'GET /v1/webhook-endpoints/{id}/deliveries/{deliveryId}': { status: 200, description: 'The delivery with each attempt, newest first.', schema: 'WebhookDeliveryDetail', example: exampleDeliveryDetail },
    'POST /v1/webhook-endpoints/{id}/deliveries/{deliveryId}/resend': {
      status: 200,
      description: 'The delivery after sending it again now (same event ID and body, newly signed), with the new attempt first in `log`.',
      schema: 'WebhookDeliveryDetail',
      example: { ...exampleDeliveryDetail, last_attempt_at: '2026-10-06T10:00:00.120Z', log: [{ success: true, manual: true, response_status: 200, response_body: 'ok', error: null, duration_ms: 150, created_at: '2026-10-06T10:00:00.120Z' }, ...exampleDeliveryDetail.log] },
    },
    'GET /v1/events': {
      status: 200,
      description: 'Events oldest first. Keep calling with the last ID as `since` while `has_more` is true.',
      schema: shape({
        object: constant('list'),
        data: array(ref('EventEnvelope')),
        has_more: bool('Whether there are more events after these; pass the last event’s ID as `since` to get them.'),
      }),
      example: listExample([exampleEvent('order.completed', '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a'), exampleEvent('customer_verification.approved', '8e9f0a1b-2c3d-4e5f-9a6b-7c8d9e0f1a2b')], true),
    },
    'GET /v1/events/{id}': { status: 200, description: 'The event, exactly as it was sent to your webhook endpoints.', schema: 'EventEnvelope', example: exampleEvent('order.completed', '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a') },
  },
};
