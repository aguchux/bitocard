import type { Product } from '../products/product.js';
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
  'customer_verification.approved',
  'customer_verification.declined',
  'number.renewed',
  'number.expired',
  'number.deleted',
  'number.sms_received',
  'esim.updated',
  'vpn_subscription.updated',
  'dispute.opened',
  'dispute.message_received',
  'dispute.escalated',
  'dispute.returned',
  'dispute.contested',
  'dispute.resolved',
  'support_ticket.created',
  'support_ticket.updated',
  'support_ticket.message_received',
  'resale_order.created',
  'resale_order.updated',
] as const;

export type EventType = (typeof eventTypes)[number];

/**
 * Event types that belong to one product (docs/UDOZO_SPINOFF_PLAN.md): BitoCard's orders, numbers, eSIMs, VPN access,
 * order disputes and customers' checks; Udozo's resale orders. The rest (top-ups, payouts, support tickets) are both
 * products'. Each instance lets endpoints subscribe to, and documents, only its own and the shared ones.
 */
export const eventOwners: Partial<Record<EventType, Product>> = {
  'order.completed': 'bitocard',
  'order.failed': 'bitocard',
  'order.refunded': 'bitocard',
  'customer_verification.approved': 'bitocard',
  'customer_verification.declined': 'bitocard',
  'number.renewed': 'bitocard',
  'number.expired': 'bitocard',
  'number.deleted': 'bitocard',
  'number.sms_received': 'bitocard',
  'esim.updated': 'bitocard',
  'vpn_subscription.updated': 'bitocard',
  'dispute.opened': 'bitocard',
  'dispute.message_received': 'bitocard',
  'dispute.escalated': 'bitocard',
  'dispute.returned': 'bitocard',
  'dispute.contested': 'bitocard',
  'dispute.resolved': 'bitocard',
  'resale_order.created': 'udozo',
  'resale_order.updated': 'udozo',
};

/** The event types of a product's instance: its own and the shared ones. */
export const eventTypesFor = (product: Product): EventType[] => eventTypes.filter(type => (eventOwners[type] ?? product) === product);

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
