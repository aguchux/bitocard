import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Watermarked listing photos (docs/UDOZO_WATERMARK_PLAN.md): the pure parts, shared by the service, the controllers and
 * the tests. Photos are served by udozo.com at `/img/<media id>.jpg?m=<mark version>[&w=480|960|1600]`, which draws the
 * mark into each copy; the API only says where.
 */

/** Udozo's text until an admin changes it (the migration seeds it). */
export const defaultWatermarkText = 'udozo.com';

/** Widths udozo.com's image route resizes to (never larger than the original); anything else is the original's size. */
export const photoWidths = [480, 960, 1600] as const;
export type PhotoWidth = (typeof photoWidths)[number];

/** Where photos are served while watermarks are on: a site's origin and the version of the mark it draws. Null: off. */
export type PhotoContext = { base: string; version: string } | null;

/**
 * A listing photo's address. Watermarks off (no context): the stored `url`, as before. On: udozo.com's image route (or a
 * resale shop's own address), with the mark's version, so a new text gets new addresses. A photo not ready yet has no
 * `url` and stays null.
 */
export function photoUrl(media: { id: string; url: string | null }, context: PhotoContext, width?: PhotoWidth): string | null {
  if (!context || !media.url) return media.url;
  return `${context.base.replace(/\/+$/, '')}/img/${media.id}.jpg?m=${context.version}${width ? `&w=${width}` : ''}`;
}

/** The version string of the mark shown: Udozo's (`u3`), or Udozo's with the store's own text (`u3s2`). */
export const markVersion = (udozoVersion: number, storeVersion?: number | null) => (storeVersion === undefined || storeVersion === null ? `u${udozoVersion}` : `u${udozoVersion}s${storeVersion}`);

/** 2 to 30 characters: Latin letters (with accents, which Inter draws), digits, spaces and `. - _ @`. */
const textPattern = /^[A-Za-z0-9À-ÖØ-öø-ÿ ._@-]{2,30}$/;

/** A watermark text as kept (spaces trimmed and single), or a reason it cannot be used. */
export function cleanWatermarkText(raw: string): { text: string } | { problem: string } {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 30) return { problem: 'Use 2 to 30 characters.' };
  if (!textPattern.test(text)) return { problem: 'Use letters, digits, spaces and . - _ @ only.' };
  return { text };
}

/** The header udozo.com's server signs a request for an original with. */
export const mediaSignatureHeader = 'udozo-media-signature';
const toleranceSeconds = 300;

/** `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<id>" keyed with STORE_SERVER_SECRET>` (as udozo.com's image route sends it). */
export function signMedia(secret: string, id: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${id}`).digest('hex')}`;
}

/** Whether a request for an original carries a fresh signature for that photo (five minutes either side). */
/** The original's header naming its seller's username (empty when they have none), for the mark across the middle. */
export const photoOwnerHeader = 'udozo-photo-owner';

export function mediaSignatureValid(header: string | undefined, secret: string | undefined, id: string, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(part => [part.slice(0, part.indexOf('=')).trim(), part.slice(part.indexOf('=') + 1).trim()]));
  const { t, v1 } = parts as { t?: string; v1?: string };
  if (!t || !v1 || !/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${id}`).digest('hex'));
  return timingSafeEqual(Buffer.from(v1), expected);
}
