import { HttpStatus, Injectable } from '@nestjs/common';
import { heldUnits, maxStock } from '../classifieds/rules.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PosStockTransfer } from '../generated/prisma/client.js';
import { ownerBy, type PosBy } from './actor.js';
import { posCountedStatuses } from './catalogue-rules.js';
import { changeLevel, freeAtShop, freeOnline, levelsOf, shopsOf } from './stock-levels.js';

export type TransferInput = { from_shop_id?: string | null; to_shop_id?: string | null; lines: Array<{ listing_id: string; quantity: number }>; note?: string | null };
type TransferLine = { listing_id: string; title: string; quantity: number };

/** A transfer moves at most this many products at once. */
export const maxTransferLines = 100;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);
export const transferNumber = (number: number) => `ST-${String(number).padStart(6, '0')}`;

/**
 * Moving stock between the owner's shops, or between a shop and online (docs/UDOZO_POS_PLAN.md, milestone 8): the
 * listings locked in id order, each line no more than the place it leaves can spare (a shop's free level, or the online
 * level less what online buyers hold), both levels moved in one transaction, the listing's stock unchanged, and a
 * movement in each place's history. Only with several shops (`single_shop`).
 */
@Injectable()
export class PosStockTransfersService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(customer: CustomerWithStore) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { id: true } });
    if (!account) throw noAccount();
    return account;
  }

  async transfer(customer: CustomerWithStore, input: TransferInput, by: PosBy = ownerBy(customer)) {
    const account = await this.account(customer);
    const { shops, split } = await shopsOf(this.prisma, account.id);
    if (!split) throw conflict('single_shop', 'Stock moves between shops once you have more than one.');
    const from = input.from_shop_id ?? null;
    const to = input.to_shop_id ?? null;
    const place = (id: string | null) => {
      if (id === null) return null;
      const shop = shops.find(item => item.id === id);
      if (!shop) throw notFound('shop');
      return shop;
    };
    const fromShop = place(from);
    const toShop = place(to);
    if (from === to) throw invalid('parameter_invalid', 'Choose two different places to move stock between.', 'to_shop_id');
    if (!input.lines.length || input.lines.length > maxTransferLines) throw invalid('parameter_invalid', `Move 1 to ${maxTransferLines} products at once.`, 'lines');
    // The same product twice is one line.
    const wanted = new Map<string, number>();
    for (const [index, line] of input.lines.entries()) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxStock) throw invalid('parameter_invalid', 'Move from 1 of each.', `lines[${index}].quantity`);
      wanted.set(line.listing_id, (wanted.get(line.listing_id) ?? 0) + line.quantity);
    }
    const ids = [...wanted.keys()].sort();
    const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
    const now = new Date();
    const transfer = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
      const rows = await tx.classifiedListing.findMany({ where: { id: { in: ids } }, select: { id: true, customerId: true, title: true, stock: true, status: true, posEnabledAt: true } });
      const byId = new Map(rows.map(row => [row.id, row]));
      const levels = await levelsOf(tx, ids);
      const lines: TransferLine[] = [];
      for (const [index, id] of input.lines.map(line => line.listing_id).entries()) {
        if (lines.some(line => line.listing_id === id)) continue;
        const row = byId.get(id);
        if (!row || row.customerId !== customer.id || !row.posEnabledAt || !posCountedStatuses.includes(row.status)) throw invalid('product_unavailable', 'This product is not at your till.', `lines[${index}].listing_id`);
        const quantity = wanted.get(id)!;
        const held = await heldUnits(tx, id);
        const spare = fromShop ? freeAtShop({ stock: row.stock, held, levels: levels.get(id), shopId: fromShop.id, fulfilsOnline: fromShop.fulfilsOnline }) : freeOnline(row.stock, held, levels.get(id));
        if (quantity > spare) throw conflict('stock_short', `Only ${spare} of “${row.title ?? 'this product'}” can move from ${fromShop ? fromShop.name : 'online'}.`, `lines[${index}].quantity`);
        if (fromShop) await changeLevel(tx, id, fromShop.id, -quantity, now);
        if (toShop) await changeLevel(tx, id, toShop.id, quantity, now);
        lines.push({ listing_id: id, title: row.title ?? 'Untitled listing', quantity });
      }
      const made = await tx.posStockTransfer.create({ data: { accountId: account.id, fromShopId: from, toShopId: to, lines, note, byName: by.name.slice(0, 120), byStaffId: by.staffId } });
      for (const line of lines) {
        const stock = byId.get(line.listing_id)!.stock;
        await tx.posStockMovement.createMany({
          data: [
            { accountId: account.id, listingId: line.listing_id, shopId: from, reason: 'transfer_out', delta: -line.quantity, stockAfter: stock, transferId: made.id, note: note?.slice(0, 200) ?? null, byCustomerId: by.customerId, byStaffId: by.staffId, byName: by.name },
            { accountId: account.id, listingId: line.listing_id, shopId: to, reason: 'transfer_in', delta: line.quantity, stockAfter: stock, transferId: made.id, note: note?.slice(0, 200) ?? null, byCustomerId: by.customerId, byStaffId: by.staffId, byName: by.name },
          ],
        });
      }
      return made;
    });
    return this.present(transfer, shops);
  }

  /** The latest transfers, newest first; a shop's when asked. */
  async list(customer: CustomerWithStore, filter: { shop?: string; limit?: number; offset?: number }) {
    const account = await this.account(customer);
    const { shops } = await shopsOf(this.prisma, account.id);
    const where = { accountId: account.id, ...(filter.shop ? { OR: [{ fromShopId: filter.shop }, { toShopId: filter.shop }] } : {}) };
    const take = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    const skip = Math.max(filter.offset ?? 0, 0);
    const [rows, total] = await Promise.all([this.prisma.posStockTransfer.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, skip }), this.prisma.posStockTransfer.count({ where })]);
    return { object: 'list' as const, total, has_more: skip + take < total, data: rows.map(row => this.present(row, shops)) };
  }

  private present(row: PosStockTransfer, shops: Array<{ id: string; name: string }>) {
    const place = (id: string | null) => (id === null ? { id: null, name: 'Online' } : { id, name: shops.find(shop => shop.id === id)?.name ?? 'A closed shop' });
    return {
      object: 'pos_stock_transfer' as const,
      id: row.id,
      number: transferNumber(row.number),
      /** Where it left and went: a shop, or online (`id` null). */
      from: place(row.fromShopId),
      to: place(row.toShopId),
      lines: row.lines as TransferLine[],
      units: (row.lines as TransferLine[]).reduce((sum, line) => sum + line.quantity, 0),
      note: row.note,
      by: row.byName,
      created_at: row.createdAt.toISOString(),
    };
  }
}
