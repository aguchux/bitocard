import type { Prisma } from '../generated/prisma/client.js';

/**
 * In stock and out of stock (6 November 2026, the owner's request). Every listing's stock is tracked from posting: a
 * new one starts at none (out of stock) until its seller says how many they have, and buying (Safe pay, buy orders,
 * offers) needs some. A live listing at none stays on Udozo, out of stock, for `outOfStockDays`, then Anjio (the
 * `classifieds` job) takes it off; restocking gives it a listing period again.
 */
export const outOfStockDays = 90;
const dayMs = 86_400_000;

/** When a listing going live now has its time end: a listing period with stock, else 90 days out of stock. */
export function liveUntil(listing: { stock: number }, listingDays: number, now: Date) {
  return new Date(now.getTime() + (listing.stock > 0 ? listingDays : outOfStockDays) * dayMs);
}

/** What a stock change does to a posted listing's out-of-stock clock and, while it is live, its time. */
export function stockChange(listing: { status: string; stock: number; outOfStockAt: Date | null; expiresAt: Date | null }, stock: number, listingDays: number, now: Date) {
  if (listing.status === 'draft') return {};
  if (stock === 0 && listing.stock > 0) {
    // It runs out now: 90 days live from here.
    return { outOfStockAt: now, ...(listing.status === 'active' ? { expiresAt: new Date(now.getTime() + outOfStockDays * dayMs) } : {}) };
  }
  if (stock > 0 && listing.stock === 0) {
    // Restocked: a listing period from now, never shorter than the time it had.
    const period = new Date(now.getTime() + listingDays * dayMs);
    const expiresAt = listing.expiresAt && listing.expiresAt > period ? listing.expiresAt : period;
    return { outOfStockAt: null, ...(listing.status === 'active' ? { expiresAt } : {}) };
  }
  return {};
}

/**
 * Takes sold units off a listing's stock, in the sale's own transaction. One that runs out stays live, out of stock,
 * for 90 days (never marked sold: its seller may restock it, or mark it sold themselves). Says whether it ran out now.
 */
export async function takeStock(tx: Prisma.TransactionClient, listingId: string, quantity: number, now: Date) {
  const until = new Date(now.getTime() + outOfStockDays * dayMs);
  const [row] = await tx.$queryRaw<Array<{ stock: number; ran_out: boolean }>>`
    UPDATE "classified_listings" SET
      "stock" = GREATEST("stock" - ${quantity}, 0),
      "out_of_stock_at" = CASE WHEN "stock" > 0 AND "stock" <= ${quantity} THEN ${now} ELSE "out_of_stock_at" END,
      "expires_at" = CASE WHEN "stock" > 0 AND "stock" <= ${quantity} AND "status" = 'active' THEN ${until} ELSE "expires_at" END,
      "updated_at" = ${now}
    WHERE "id" = ${listingId}::uuid
    RETURNING "stock", ("stock" = 0 AND "out_of_stock_at" = ${now}) AS "ran_out"`;
  return { stock: row?.stock ?? 0, ranOut: Boolean(row?.ran_out) };
}

/** What the seller is told when a sale takes the last one: restock, or Anjio takes it off in 90 days. */
export function outOfStockNotice(listing: { id: string; title: string | null }, now: Date) {
  const until = new Date(now.getTime() + outOfStockDays * dayMs);
  const date = until.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    subject: `${listing.id}:out_of_stock:${now.toISOString()}`,
    title: 'Your ad is out of stock',
    body: `"${listing.title ?? 'Your listing'}" has none left, so buyers cannot buy it. Add stock from My listings to keep selling: if it is still out of stock on ${date}, Anjio takes it off Udozo.`,
    link: `/account/listings/${listing.id}`,
  };
}
