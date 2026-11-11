import type { LedgerMode } from '../generated/prisma/client.js';

/**
 * Udozo POS collection accounts' rules (docs/UDOZO_POS_PLAN.md, milestone 4), pure so the API and its tests agree: the
 * collection fee, the market's own date, which days are working days, and how references and numbers are written.
 */

/** How long a till waits for a transfer into its collection account. */
export const transferRequestMs = 30 * 60_000;
/** How long one request holds a collection account while it asks the gateways, so a double click opens one. */
export const collectionClaimMs = 60_000;

/** The markets' own clocks, for the day a collection belongs to and the next working day. */
const marketZones: Record<string, string> = { NG: 'Africa/Lagos', GH: 'Africa/Accra', KE: 'Africa/Nairobi', ZA: 'Africa/Johannesburg', GB: 'Europe/London' };
export const marketZone = (country: string) => marketZones[country] ?? 'UTC';

/** Our reference for a collection account, sent as the gateway's and carried back by every transfer into it. */
export const collectionReference = (mode: LedgerMode, id: string) => `bc_rp_${mode}_${id.replaceAll('-', '')}`;

export const transferNumber = (n: number) => `PT-${String(n).padStart(6, '0')}`;
export const collectionNumber = (n: number) => `PC-${String(n).padStart(6, '0')}`;
export const settlementNumber = (n: number) => `PS-${String(n).padStart(6, '0')}`;

export type FeeSettings = { collectionFeeBps: number; collectionFeeMinMinor: bigint; collectionFeeCapMinor: bigint | null };

/**
 * Udozo's fee on a transfer: what the gateway charged, plus the market's margin (its basis points of the transfer,
 * rounded up, held between its minimum and cap), never more than the transfer itself.
 */
export function collectionFee(amount: bigint, gatewayFee: bigint, settings: FeeSettings | null) {
  const gateway = gatewayFee < 0n ? 0n : gatewayFee > amount ? amount : gatewayFee;
  let margin = 0n;
  if (settings) {
    margin = (amount * BigInt(settings.collectionFeeBps) + 9_999n) / 10_000n;
    if (margin < settings.collectionFeeMinMinor) margin = settings.collectionFeeMinMinor;
    if (settings.collectionFeeCapMinor !== null && margin > settings.collectionFeeCapMinor) margin = settings.collectionFeeCapMinor;
  }
  const fee = gateway + margin > amount ? amount : gateway + margin;
  return { gateway, fee, collected: amount - fee };
}

/** The market's date of an instant: `2026-11-11`. */
export function zonedDay(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** How far the zone is ahead of UTC at an instant, in milliseconds. */
function offsetMs(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const part = (type: string) => Number(parts.find(item => item.type === type)!.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a market's day begins (its midnight). */
export function zonedDayStart(day: string, zone: string) {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, date);
  return new Date(guess - offsetMs(new Date(guess), zone));
}

/** Monday to Friday: banks pay settlements on working days (public holidays are not yet known to Udozo). */
export function isWorkingDay(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** The next working day after a market's date, for "paid on" lines. */
export function nextWorkingDay(day: string) {
  const at = new Date(`${day}T12:00:00Z`);
  do at.setUTCDate(at.getUTCDate() + 1);
  while (!isWorkingDay(at.toISOString().slice(0, 10)));
  return at.toISOString().slice(0, 10);
}
