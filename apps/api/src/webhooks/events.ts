/**
 * The public event catalogue. Each type is documented in the OpenAPI `webhooks` section (see openapi.ts); an event
 * type without complete docs does not ship.
 */
export const eventTypes = [
  'order.completed',
  'order.failed',
  'order.refunded',
  'top_up.succeeded',
  'top_up.failed',
  'payout.paid',
  'payout.failed',
] as const;

export type EventType = (typeof eventTypes)[number];

/** Sent only to one endpoint, from its test button; never listed by GET /v1/events. */
export const pingEvent = 'ping';

/** The payload version. Adding fields keeps it; removing or renaming a field needs a new version. */
export const eventApiVersion = '2026-10-01';

/** The JSON body sent to endpoints and returned by GET /v1/events, serialised once so every retry is identical. */
export function eventPayload(event: { id: string; type: string; mode: string; createdAt: Date }, object: object) {
  return JSON.stringify({
    id: event.id,
    object: 'event',
    type: event.type,
    api_version: eventApiVersion,
    mode: event.mode,
    created_at: event.createdAt.toISOString(),
    data: { object },
  });
}
