import { createHash, createHmac } from 'node:crypto';

/**
 * Udozo's personalised discovery (docs/UDOZO_PERSONALISATION_PLAN.md): who is recorded, what each event weighs, how a
 * search's words are cleaned before they are kept, and the 10% holdout. No emotion is ever inferred: interest is
 * measured only by what people do (time on a listing, photos opened, saving, contacting, buying).
 */

export const browserEventKinds = ['view', 'engaged', 'search', 'filter', 'result_click', 'rail_click', 'impression', 'share', 'not_interested'] as const;
export const serverEventKinds = ['save', 'unsave', 'chat', 'contact', 'call', 'offer', 'order'] as const;
export type BrowserEventKind = (typeof browserEventKinds)[number];
export type ServerEventKind = (typeof serverEventKinds)[number];
export type DiscoveryKind = BrowserEventKind | ServerEventKind;

/** Kinds that say someone wanted to get in touch or buy: a listing they did this to is never suggested again. */
export const contactKinds: readonly DiscoveryKind[] = ['chat', 'contact', 'call', 'offer', 'order'];
export const clickKinds: readonly DiscoveryKind[] = ['result_click', 'rail_click'];
export const personalRowKinds = ['for_you', 'recent', 'searched', 'price_drops'] as const;
export type PersonalRowKind = (typeof personalRowKinds)[number];

/** udozo.com's visitor ID (`udz_vid`, set only after Accept all): `v_` and 32 base64url characters. */
export const visitorIdPattern = /^v_[A-Za-z0-9_-]{32}$/;
export const visitorHeader = 'udozo-visitor';

/** Robots, link previews and empty browsers are never recorded (as for listing views). */
export const robots = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|monitor/i;

export const customerSubject = (customerId: string) => `c:${customerId}`;

/** A visitor is recorded only by an HMAC of their ID, keyed apart from everything else ENCRYPTION_KEY keys. */
export function visitorSubject(visitorId: string, encryptionKey: string) {
  const key = createHmac('sha256', encryptionKey).update('discovery-visitor').digest();
  return `v:${createHmac('sha256', key).update(visitorId).digest('base64url')}`;
}

/** About 10% of people (by subject) keep the popular order, so every change can be measured against them. */
export const holdout = (subject: string) => createHash('sha256').update(subject).digest()[0]! < 26;

const halfLifeMs = 14 * 86_400_000;
/** How much interest is left after `ms`: it halves every 14 days. */
export const decayFactor = (ms: number) => (ms <= 0 ? 1 : 0.5 ** (ms / halfLifeMs));

/** What an event says about interest in its listing (tuned later from the holdout). */
export function weightOf(event: { kind: DiscoveryKind; seconds?: number | null; photos?: number | null }) {
  switch (event.kind) {
    case 'view':
    case 'result_click':
    case 'rail_click':
      return 1;
    case 'engaged':
      return Math.min(4, 2 + ((event.seconds ?? 0) >= 60 ? 1 : 0) + ((event.photos ?? 0) >= 3 ? 1 : 0));
    case 'save':
      return 6;
    case 'share':
      return 4;
    case 'chat':
    case 'contact':
    case 'call':
    case 'offer':
      return 10;
    case 'order':
      return 15;
    case 'unsave':
      return -3;
    case 'not_interested':
      return -20;
    default:
      return 0;
  }
}

const email = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
/** Digits with spaces or dashes: a phone number once it has 9 digits or more ("2015 2020" is two years). */
const phone = /\+?\d[\d\s().-]{6,}\d/g;
const longDigits = /\d{6,}/g;
/** A word of 8 or more characters mixing letters and digits, as codes and references are. */
const codeLike = /\b(?=[a-z0-9_-]*\d)(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{8,}\b/g;

/** A search's words as they are kept: lower case, single spaces, no emails, phone numbers, long digit runs or codes. */
export function cleanQuery(text: string | null | undefined) {
  if (!text) return null;
  const cleaned = text
    .toLowerCase()
    .replace(email, ' ')
    .replace(phone, match => (match.replace(/\D/g, '').length >= 9 ? ' ' : match))
    .replace(longDigits, ' ')
    .replace(codeLike, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  return cleaned || null;
}

/** Filters as kept: at most 20 keys of up to 40 characters, each a value or up to 20 values of up to 100 characters. */
export function cleanFilters(input: unknown): Record<string, string | string[]> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (!/^[A-Za-z0-9_.:-]{1,40}$/.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 100);
    else if (Array.isArray(value)) out[key] = value.filter((item): item is string => typeof item === 'string').slice(0, 20).map(item => item.slice(0, 100));
  }
  return Object.keys(out).length ? out : null;
}

/** Whether someone born on `birthDate` is under 18 now (they get no profile). */
export function underEighteen(birthDate: Date | null, now = new Date()) {
  if (!birthDate) return false;
  const eighteen = new Date(Date.UTC(birthDate.getUTCFullYear() + 18, birthDate.getUTCMonth(), birthDate.getUTCDate()));
  return eighteen > now;
}
