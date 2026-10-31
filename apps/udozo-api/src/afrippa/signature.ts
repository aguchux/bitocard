import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Afrippa's server signs every request it sends to Afrippa's routes (`/v1/afrippa/`), so only it can reach them
 * (docs/CRYPTO_SPINOFF_PLAN.md, Architecture 1):
 *
 *   Afrippa-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<METHOD>.<path and query>.<hex SHA-256 of the body>">
 *
 * keyed with `AFRIPPA_SERVER_SECRET`. The method, the whole address and the body are signed, so a signed request cannot
 * be turned into another; it is accepted for five minutes either side of its time. An empty body hashes as "".
 */
export const afrippaSignatureHeader = 'afrippa-signature';
export const afrippaSignatureToleranceSeconds = 300;

const bodyHash = (body: Buffer | string | undefined) => createHash('sha256').update(body ?? '').digest('hex');
const mac = (secret: string, t: string, method: string, url: string, body: Buffer | string | undefined) =>
  createHmac('sha256', secret).update(`${t}.${method.toUpperCase()}.${url}.${bodyHash(body)}`).digest('hex');

/** The header value for a request (what Afrippa's server sends; the tests use it too). */
export function signAfrippaRequest(secret: string, request: { method: string; url: string; body?: Buffer | string }, now = Date.now()) {
  const t = String(Math.floor(now / 1000));
  return `t=${t},v1=${mac(secret, t, request.method, request.url, request.body)}`;
}

/** Whether the header signs exactly this request with the secret, within the tolerance. Never throws. */
export function verifyAfrippaRequest(
  header: string | undefined,
  secret: string | undefined,
  request: { method: string; url: string; body?: Buffer | string },
  now = Date.now(),
): boolean {
  if (!header || !secret || header.length > 200) return false;
  const parts = Object.fromEntries(header.split(',').map(part => [part.slice(0, part.indexOf('=')).trim(), part.slice(part.indexOf('=') + 1).trim()]));
  const { t, v1 } = parts as { t?: string; v1?: string };
  if (!t || !v1 || !/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(now / 1000 - Number(t)) > afrippaSignatureToleranceSeconds) return false;
  const expected = Buffer.from(mac(secret, t, request.method, request.url, request.body), 'hex');
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}
