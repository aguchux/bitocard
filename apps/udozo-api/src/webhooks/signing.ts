import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const signatureHeader = 'BitoCard-Signature';

/** Deliveries older than this are rejected by receivers (and by `verifySignature`). */
export const signatureToleranceSeconds = 300;

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** HMAC-SHA256 over `<timestamp>.<raw body>`, keyed with the whole secret string (including `whsec_`), as hex. */
export function sign(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** `t=<unix seconds>,v1=<signature>[,v1=<signature with the previous secret>]`. */
export function signatureValue(secrets: string[], timestamp: number, body: string) {
  return [`t=${timestamp}`, ...secrets.map(secret => `v1=${sign(secret, timestamp, body)}`)].join(',');
}

/** What receivers do; used by the tests and to check the published test vector. */
export function verifySignature(header: string, body: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > signatureToleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, timestamp, body));
  return parts
    .filter(([key]) => key === 'v1')
    .some(([, value]) => value !== undefined && value.length === expected.length && timingSafeEqual(Buffer.from(value), expected));
}

/** The published test vector (docs: webhooks guide). A test checks it against `sign`. */
export const signatureTestVector = {
  secret: 'whsec_test_vector_do_not_use_0123456789',
  timestamp: 1790000000,
  body: '{"id":"7d6f1b8e-2c4a-4f57-9a3e-1b2c3d4e5f60","object":"event","type":"ping"}',
};
