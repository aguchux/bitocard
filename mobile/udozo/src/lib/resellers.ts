/**
 * My Resellers in the app (B2B reselling): a deal offered to a reseller and a note decided, in the bodies the API takes
 * (udozo.com's lib/shop-actions.ts `offerResaleDeal`, `decideResaleNote`). Kept free of React Native so they run under
 * `node --test`; the API checks every deal against the listing's limits again.
 */

/** A typed percentage ("15", "7.5") in basis points; null when it is not one. */
export const percentBps = (text: string) => (/^\s*\d{1,3}(\.\d{1,2})?\s*$/.test(text) ? Math.round(Number(text) * 100) : null);

/** The deal's body, or why it cannot be offered: a discount above nothing, an optional floor, an optional end date. */
export function dealBody(input: { listingId: string | null; discount: string; floor: string; endsOn: string }): { body: Record<string, unknown> } | { problem: string } {
  const discount = percentBps(input.discount);
  const floor = input.floor.trim() ? percentBps(input.floor) : 0;
  if (discount === null || discount < 1) return { problem: 'Give their discount as a percentage, such as 15.' };
  if (floor === null) return { problem: 'Give how far below your price as a percentage, or leave it empty.' };
  const ends = input.endsOn.trim();
  if (ends && (!/^\d{4}-\d{2}-\d{2}$/.test(ends) || Number.isNaN(Date.parse(`${ends}T00:00:00Z`)))) return { problem: 'Give the end date as year, month and day, such as 2026-12-31.' };
  return { body: { listing_id: input.listingId, discount_bps: discount, floor_bps: floor, ends_at: ends ? `${ends}T23:59:59.000Z` : null } };
}

/** A note's decision: approving names the exact text approved; refusing may say why. */
export function noteBody(decision: 'approve' | 'refuse' | 'withdraw', input: { note: string; reason?: string }) {
  if (decision === 'approve') return { note: input.note };
  const reason = input.reason?.trim();
  return decision === 'refuse' && reason ? { reason: reason.slice(0, 300) } : {};
}
