import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex digest. Used to store tokens, codes and API keys without keeping the secret itself. */
export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/** A URL-safe random secret with 256 bits of entropy. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/** A numeric one-time code, for example 6 digits for email and SMS verification. */
export function numericCode(digits = 6) {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/** Constant-time comparison of two hex digests of equal length. */
export function sameDigest(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
