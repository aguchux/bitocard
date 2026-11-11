import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import { limitsOf } from './plans.js';

/**
 * Several shops (docs/UDOZO_POS_PLAN.md, Stock; milestone 8). A listing's one stock is split between the owner's shops
 * once there is more than one: each shop's level in `pos_stock_levels`, the rest the online level. Till sales, counts,
 * damage, refunds and transfers move a shop's level with the listing's stock in one transaction (the level first when
 * stock goes down, so the database's trigger finds nothing to take); stock going down anywhere else (an online sale, the
 * seller on udozo.com) is taken by the trigger from the shop that fulfils online orders first. With one shop no split is
 * kept: its level is the listing's stock.
 */

export type ShopRow = { id: string; name: string; position: number; fulfilsOnline: boolean };

const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

/** An account's open shops in their order (the first is the main shop), and whether their stock is split. */
export async function shopsOf(db: Prisma.TransactionClient, accountId: string) {
  const shops: ShopRow[] = await db.posShop.findMany({ where: { accountId, closedAt: null }, select: { id: true, name: true, position: true, fulfilsOnline: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  return { shops, split: shops.length > 1 };
}

/**
 * The shops a plan keeps selling: the first ones, up to its shop limit. Past it (a Multi-shop account dropped to a plan
 * of one shop), the others pause: their tills sell nothing until the owner pays again; nothing is deleted.
 */
export function pausedShops(shops: Array<{ id: string }>, plan: { limits: Prisma.JsonValue }) {
  const limit = limitsOf(plan).shops;
  return new Set(limit === null ? [] : shops.slice(Math.max(limit, 1)).map(shop => shop.id));
}

/** A listing's level in each shop, with the units on their way between shops (`incoming`, in no shop yet). */
export type LevelMap = Map<string, number> & { incoming?: number; incomingAt?: Map<string, number> };

/** Each shop's level of some listings. */
export async function levelsOf(db: Prisma.TransactionClient, listingIds: string[]) {
  const rows = listingIds.length ? await db.posStockLevel.findMany({ where: { listingId: { in: listingIds } }, select: { listingId: true, shopId: true, quantity: true, incoming: true } }) : [];
  const levels = new Map<string, LevelMap>();
  for (const row of rows) {
    if (!levels.has(row.listingId)) levels.set(row.listingId, Object.assign(new Map<string, number>(), { incoming: 0, incomingAt: new Map<string, number>() }));
    const map = levels.get(row.listingId)!;
    map.set(row.shopId, row.quantity);
    map.incoming = (map.incoming ?? 0) + row.incoming;
    if (row.incoming) map.incomingAt!.set(row.shopId, row.incoming);
  }
  return levels;
}

/** What is in no shop and not on its way to one: the listing's stock less every shop's level and what is in transit. */
export const onlineLevel = (stock: number, levels: LevelMap | undefined) => Math.max(0, stock - [...(levels?.values() ?? [])].reduce((sum, quantity) => sum + quantity, 0) - (levels?.incoming ?? 0));

/**
 * What a shop may sell or move of a listing: its level, less what online buyers hold beyond the online level when it is
 * the shop that fulfils online orders, and never more than the listing's stock less what is held.
 */
export function freeAtShop(input: { stock: number; held: number; levels: LevelMap | undefined; shopId: string; fulfilsOnline: boolean }) {
  const level = input.levels?.get(input.shopId) ?? 0;
  const shortfall = input.fulfilsOnline ? Math.max(0, input.held - onlineLevel(input.stock, input.levels)) : 0;
  return Math.max(0, Math.min(level - shortfall, input.stock - input.held));
}

/** What online orders may take of a listing before reaching the shop that fulfils them: the online level less what is held. */
export const freeOnline = (stock: number, held: number, levels: LevelMap | undefined) => Math.max(0, onlineLevel(stock, levels) - held);

/** Moves a shop's level by `delta` (never below nothing: `stock_short`). */
export async function changeLevel(db: Prisma.TransactionClient, listingId: string, shopId: string, delta: number, now = new Date()) {
  if (delta === 0) return;
  if (delta > 0) {
    await db.posStockLevel.upsert({ where: { listingId_shopId: { listingId, shopId } }, create: { listingId, shopId, quantity: delta, updatedAt: now }, update: { quantity: { increment: delta }, updatedAt: now } });
    return;
  }
  const moved = await db.posStockLevel.updateMany({ where: { listingId, shopId, quantity: { gte: -delta } }, data: { quantity: { increment: delta }, updatedAt: now } });
  if (!moved.count) throw conflict('stock_short', 'This shop does not have that many.', 'quantity');
}

/** Units on their way to a shop: added on sending, taken on receiving (never below nothing). */
export async function changeIncoming(db: Prisma.TransactionClient, listingId: string, shopId: string, delta: number, now = new Date()) {
  if (delta === 0) return;
  if (delta > 0) {
    await db.posStockLevel.upsert({ where: { listingId_shopId: { listingId, shopId } }, create: { listingId, shopId, quantity: 0, incoming: delta, updatedAt: now }, update: { incoming: { increment: delta }, updatedAt: now } });
    return;
  }
  await db.$executeRaw`UPDATE "pos_stock_levels" SET "incoming" = GREATEST("incoming" + ${delta}, 0), "updated_at" = ${now} WHERE "listing_id" = ${listingId}::uuid AND "shop_id" = ${shopId}::uuid`;
}

/** A shop's own prices of some listings (listing id to price in minor units). */
export async function shopPricesOf(db: Prisma.TransactionClient, listingIds: string[], shopId: string | null) {
  if (!shopId || !listingIds.length) return new Map<string, bigint>();
  const rows = await db.posShopPrice.findMany({ where: { shopId, listingId: { in: listingIds } }, select: { listingId: true, priceMinor: true } });
  return new Map(rows.map(row => [row.listingId, row.priceMinor]));
}

/**
 * Starts the split as a second shop opens: every listing at the till has its stock in the first shop (as it was all
 * there), so nothing changes at its tills; the new shop starts empty, filled by transfers.
 */
export async function startSplit(db: Prisma.TransactionClient, ownerId: string, firstShopId: string) {
  await db.$executeRaw`
    INSERT INTO "pos_stock_levels" ("listing_id", "shop_id", "quantity", "updated_at")
    SELECT l."id", ${firstShopId}::uuid, l."stock", CURRENT_TIMESTAMP FROM "classified_listings" l
    WHERE l."customer_id" = ${ownerId}::uuid AND l."pos_enabled_at" IS NOT NULL AND l."stock" > 0
    ON CONFLICT ("listing_id", "shop_id") DO NOTHING`;
}
