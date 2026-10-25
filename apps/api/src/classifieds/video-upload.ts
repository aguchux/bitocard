import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a video upload link works: long enough to send 50 MB over a slow phone connection. */
export const videoUploadLifetimeMs = 15 * 60_000;

export type VideoUploadClaim = { listingId: string; sessionId: string; expires: number };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sign = (key: string, body: string) => createHmac('sha256', key).update(`classified-video-upload:${body}`).digest('base64url');

/**
 * A link for the seller's browser to send a listing's video straight to the API (a store's server cannot pass 50 MB on).
 * It names the listing and the customer session that asked, signed with ENCRYPTION_KEY and never stored: `bcv_up_` then
 * `<listing>.<session>.<expires>.<signature>`. Signing out, or the session ending, ends it.
 */
export function videoUploadToken(key: string, claim: Omit<VideoUploadClaim, 'expires'>, now = Date.now()) {
  const expires = now + videoUploadLifetimeMs;
  const body = `${claim.listingId}.${claim.sessionId}.${expires}`;
  return { token: `bcv_up_${body}.${sign(key, body)}`, expires_at: new Date(expires).toISOString() };
}

/** The claim in a link this API made and that has not expired, else null. */
export function readVideoUploadToken(key: string, token: string, now = Date.now()): VideoUploadClaim | null {
  if (!token.startsWith('bcv_up_')) return null;
  const parts = token.slice('bcv_up_'.length).split('.');
  if (parts.length !== 4) return null;
  const [listingId, sessionId, expiresText, signature] = parts as [string, string, string, string];
  const expires = Number(expiresText);
  if (!uuid.test(listingId) || !uuid.test(sessionId) || !/^\d{13}$/.test(expiresText) || expires < now) return null;
  const expected = sign(key, `${listingId}.${sessionId}.${expiresText}`);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { listingId, sessionId, expires };
}
