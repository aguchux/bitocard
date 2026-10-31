import { createHmac, timingSafeEqual } from 'node:crypto';

/** The header a store's server sends the shopper's address in: `t=<unix seconds>,ip=<address>,v1=<hex signature>`. */
export const clientHeader = 'bitocard-client';

/** How far the signed time may be from ours. */
const toleranceSeconds = 300;
const address = /^[0-9a-fA-F:.]{2,45}$/;

/** `v1`: hex HMAC-SHA256 of `"<t>.<ip>"` keyed with `STORE_SERVER_SECRET`, shared by the API and the store's server. */
export function signClient(secret: string, ip: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},ip=${ip},v1=${createHmac('sha256', secret).update(`${t}.${ip}`).digest('hex')}`;
}

/**
 * The shopper's address the store's server vouched for, or null. Store customers' requests all come from the store's
 * server, so without this every shopper would share the server's rate limit. Anything unsigned, wrongly signed or stale
 * is ignored (the caller's own address is used).
 */
export function signedClientIp(header: string | undefined, secret: string | undefined, now = Date.now()) {
  if (!header || !secret) return null;
  const parts = Object.fromEntries(header.split(',').map(part => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)]));
  const { t, ip, v1 } = parts as { t?: string; ip?: string; v1?: string };
  if (!t || !ip || !v1 || !/^\d+$/.test(t) || !address.test(ip)) return null;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSeconds) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${ip}`).digest('hex'));
  const given = Buffer.from(v1);
  return given.length === expected.length && timingSafeEqual(given, expected) ? ip : null;
}
