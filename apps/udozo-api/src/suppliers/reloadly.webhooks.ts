import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Reloadly webhook signatures: `X-Reloadly-Signature` is the hex HMAC-SHA256 of `<raw body>:<X-Reloadly-Request-Timestamp>`,
 * keyed with the webhook signature secret from the Reloadly dashboard (not the API client secret).
 *
 * The timestamp's age is not checked: Reloadly retries a delivery for some time, and a replayed notification is
 * harmless here because its body is never trusted (it only makes BitoCard re-check that order with Reloadly).
 */
export function reloadlySignatureValid(secret: string | undefined, rawBody: Buffer | undefined, timestamp: string | undefined, signature: string | undefined) {
  if (!secret || !rawBody || !timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(Buffer.concat([rawBody, Buffer.from(`:${timestamp}`)])).digest('hex');
  const given = signature.trim().toLowerCase();
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null);

/**
 * What a notification is about: its event type, our reference (`customIdentifier`, which we send as the order's
 * supplier reference) and Reloadly's transaction ID. Reloadly's payload shape varies by product and version (`data`,
 * `transaction` or top level), so every known place is looked at; nothing else in the body is used.
 */
export function reloadlyNotice(payload: unknown) {
  const body = record(payload) ?? {};
  const places = [body, record(body.data), record(body.transaction), record(record(body.data)?.transaction)].filter((item): item is Json => item !== null);
  const first = (...keys: string[]) => {
    for (const place of places) for (const key of keys) if (text(place[key])) return text(place[key]);
    return null;
  };
  return {
    eventType: text(body.type) ?? text(body.event) ?? text(body.eventType),
    reference: first('customIdentifier', 'custom_identifier'),
    // A bare `id` counts only inside a transaction object: at the top level it may be the notification's own ID.
    supplierTransactionId: first('transactionId', 'transaction_id') ?? text(record(body.transaction)?.id) ?? text(record(record(body.data)?.transaction)?.id),
  };
}
