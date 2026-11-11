import { HttpStatus, Injectable } from '@nestjs/common';
import { heldUnits, maxStock } from '../classifieds/rules.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PosStockTransfer } from '../generated/prisma/client.js';
import { ownerBy, type PosBy } from './actor.js';
import { posCountedStatuses } from './catalogue-rules.js';
import { isShopOnly } from '../classifieds/listings.service.js';
import { stockChange } from '../classifieds/stock.js';
import { changeIncoming, changeLevel, freeAtShop, freeOnline, levelsOf, shopsOf } from './stock-levels.js';

export type TransferInput = {
  from_shop_id?: string | null;
  to_shop_id?: string | null;
  lines: Array<{ listing_id: string; quantity: number }>;
  note?: string | null;
  /** Sent now, received later by the shop it goes to (between shops only). */
  in_transit?: boolean;
};
/** What arrived of each line; a line left out arrived in full. */
export type ReceiveInput = { lines?: Array<{ listing_id: string; quantity: number }>; note?: string | null };
type TransferLine = { listing_id: string; title: string; quantity: number };
type ReceivedLine = { listing_id: string; sent: number; received: number; lost: number };

/** A transfer moves at most this many products at once. */
export const maxTransferLines = 100;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);
export const transferNumber = (number: number) => `ST-${String(number).padStart(6, '0')}`;
const notInTransit = (row: { number: number; status: string }) => conflict('transfer_not_in_transit', `${transferNumber(row.number)} is not on its way: it was ${row.status === 'received' ? 'received' : 'cancelled'} already.`);

/**
 * Moving stock between the owner's shops, or between a shop and online (docs/UDOZO_POS_PLAN.md, milestone 8): the
 * listings locked in id order, each line no more than the place it leaves can spare (a shop's free level, or the online
 * level less what online buyers hold), both levels moved in one transaction, the listing's stock unchanged, and a
 * movement in each place's history. Only with several shops (`single_shop`).
 *
 * In transit (`in_transit`, shop to shop): the units leave the sending shop now and wait as the receiving shop's
 * `incoming` (sold nowhere, not online) until it checks them in (`receive`: what arrived goes on its shelf, what did not is
 * written off as `transfer_lost`), or the sender takes them back (`cancel`).
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
    const transit = Boolean(input.in_transit);
    if (transit && (!fromShop || !toShop)) throw invalid('parameter_invalid', 'Only stock between two shops goes in transit.', 'in_transit');
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
        if (toShop && transit) await changeIncoming(tx, id, toShop.id, quantity, now);
        else if (toShop) await changeLevel(tx, id, toShop.id, quantity, now);
        lines.push({ listing_id: id, title: row.title ?? 'Untitled listing', quantity });
      }
      const made = await tx.posStockTransfer.create({
        data: { accountId: account.id, fromShopId: from, toShopId: to, lines, note, byName: by.name.slice(0, 120), byStaffId: by.staffId, status: transit ? 'in_transit' : 'received', receivedAt: transit ? null : now, receivedBy: transit ? null : by.name.slice(0, 120) },
      });
      for (const line of lines) {
        const stock = byId.get(line.listing_id)!.stock;
        const out = { accountId: account.id, listingId: line.listing_id, shopId: from, reason: 'transfer_out', delta: -line.quantity, stockAfter: stock, transferId: made.id, note: note?.slice(0, 200) ?? null, byCustomerId: by.customerId, byStaffId: by.staffId, byName: by.name };
        await tx.posStockMovement.createMany({ data: transit ? [out] : [out, { ...out, shopId: to, reason: 'transfer_in', delta: line.quantity }] });
      }
      return made;
    });
    return this.present(transfer, shops);
  }

  /**
   * The receiving shop checks a transfer in transit in: each line's units arrive on its shelf, and what did not arrive
   * (`lines`, less than was sent) is written off, the listing's stock going down by it (`transfer_lost`). Units the
   * database took meanwhile (stock lowered on udozo.com) were already taken, so nothing is written off twice.
   */
  async receive(customer: CustomerWithStore, id: string, input: ReceiveInput, by: PosBy = ownerBy(customer)) {
    const account = await this.account(customer);
    const shops = await this.allShops(account.id);
    const row = await this.prisma.posStockTransfer.findFirst({ where: { id, accountId: account.id } });
    if (!row) throw notFound('transfer');
    if (row.status !== 'in_transit') throw notInTransit(row);
    const sent = row.lines as TransferLine[];
    const arrived = new Map<string, number>();
    for (const [index, line] of (input.lines ?? []).entries()) {
      const was = sent.find(item => item.listing_id === line.listing_id);
      if (!was) throw invalid('parameter_invalid', 'That product is not in this transfer.', `lines[${index}].listing_id`);
      if (!Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > was.quantity) throw invalid('parameter_invalid', `Between 0 and ${was.quantity} of “${was.title}” arrived.`, `lines[${index}].quantity`);
      arrived.set(line.listing_id, line.quantity);
    }
    const note = input.note?.trim() ? input.note.trim().slice(0, 200) : null;
    const now = new Date();
    const toShopId = row.toShopId!;
    const received = await this.prisma.$transaction(async tx => {
      const claimed = await tx.posStockTransfer.updateMany({ where: { id, status: 'in_transit' }, data: { status: 'received', receivedAt: now, receivedBy: by.name.slice(0, 120) } });
      if (!claimed.count) throw conflict('transfer_not_in_transit', `${transferNumber(row.number)} was received or cancelled meanwhile.`);
      const ids = [...new Set(sent.map(line => line.listing_id))].sort();
      await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
      const rows = await tx.classifiedListing.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, stock: true, outOfStockAt: true, expiresAt: true, onShop: true, resale: true, posEnabledAt: true, country: true } });
      const byId = new Map(rows.map(item => [item.id, item]));
      const levels = await levelsOf(tx, ids);
      const result: ReceivedLine[] = [];
      for (const line of sent) {
        const listing = byId.get(line.listing_id);
        // What is still on its way of it (the database may have taken some meanwhile).
        const waiting = Math.min(line.quantity, levels.get(line.listing_id)?.incomingAt?.get(toShopId) ?? 0);
        const came = Math.min(arrived.get(line.listing_id) ?? line.quantity, waiting);
        const lost = waiting - came;
        result.push({ listing_id: line.listing_id, sent: line.quantity, received: came, lost });
        if (!listing || !waiting) continue;
        await changeIncoming(tx, line.listing_id, toShopId, -waiting, now);
        if (came) await changeLevel(tx, line.listing_id, toShopId, came, now);
        let stock = listing.stock;
        if (lost) {
          stock = Math.max(0, listing.stock - lost);
          const days = (await tx.classifiedMarketSettings.findUnique({ where: { country: listing.country }, select: { listingDays: true } }))?.listingDays ?? 30;
          const clock = isShopOnly(listing) || listing.status === 'draft' ? {} : stockChange(listing, stock, days, now);
          await tx.classifiedListing.update({ where: { id: listing.id }, data: { stock, ...clock } });
          listing.stock = stock;
        }
        const base = { accountId: account.id, listingId: line.listing_id, shopId: toShopId, transferId: id, note, byCustomerId: by.customerId, byStaffId: by.staffId, byName: by.name };
        if (came) await tx.posStockMovement.create({ data: { ...base, reason: 'transfer_in', delta: came, stockAfter: stock } });
        if (lost) await tx.posStockMovement.create({ data: { ...base, reason: 'transfer_lost', delta: -lost, stockAfter: stock } });
      }
      return tx.posStockTransfer.update({ where: { id }, data: { receivedLines: result } });
    });
    return this.present(received, shops);
  }

  /** The sender takes a transfer still on its way back: its units return to the sending shop's shelf (online if it closed). */
  async cancel(customer: CustomerWithStore, id: string, by: PosBy = ownerBy(customer)) {
    const account = await this.account(customer);
    const shops = await this.allShops(account.id);
    const row = await this.prisma.posStockTransfer.findFirst({ where: { id, accountId: account.id } });
    if (!row) throw notFound('transfer');
    if (row.status !== 'in_transit') throw notInTransit(row);
    const sent = row.lines as TransferLine[];
    const now = new Date();
    const back = row.fromShopId && shops.some(shop => shop.id === row.fromShopId && !shop.closedAt) ? row.fromShopId : null;
    const cancelled = await this.prisma.$transaction(async tx => {
      const claimed = await tx.posStockTransfer.updateMany({ where: { id, status: 'in_transit' }, data: { status: 'cancelled', receivedAt: now, receivedBy: by.name.slice(0, 120) } });
      if (!claimed.count) throw conflict('transfer_not_in_transit', `${transferNumber(row.number)} was received or cancelled meanwhile.`);
      const ids = [...new Set(sent.map(line => line.listing_id))].sort();
      await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;
      const levels = await levelsOf(tx, ids);
      const stocks = new Map((await tx.classifiedListing.findMany({ where: { id: { in: ids } }, select: { id: true, stock: true } })).map(item => [item.id, item.stock]));
      for (const line of sent) {
        if (!stocks.has(line.listing_id)) continue;
        const waiting = Math.min(line.quantity, levels.get(line.listing_id)?.incomingAt?.get(row.toShopId!) ?? 0);
        if (!waiting) continue;
        await changeIncoming(tx, line.listing_id, row.toShopId!, -waiting, now);
        if (back) await changeLevel(tx, line.listing_id, back, waiting, now);
        await tx.posStockMovement.create({ data: { accountId: account.id, listingId: line.listing_id, shopId: back, reason: 'transfer_in', delta: waiting, stockAfter: stocks.get(line.listing_id)!, transferId: id, note: 'Transfer cancelled', byCustomerId: by.customerId, byStaffId: by.staffId, byName: by.name } });
      }
      return tx.posStockTransfer.findUniqueOrThrow({ where: { id } });
    });
    return this.present(cancelled, shops);
  }

  /** Every shop of the account, closed ones too, to name the places of past transfers. */
  private allShops(accountId: string) {
    return this.prisma.posShop.findMany({ where: { accountId }, select: { id: true, name: true, closedAt: true } });
  }

  /** The latest transfers, newest first; a shop's, or those with a status (`in_transit`), when asked. */
  async list(customer: CustomerWithStore, filter: { shop?: string; status?: 'in_transit' | 'received' | 'cancelled'; limit?: number; offset?: number }) {
    const account = await this.account(customer);
    const shops = await this.allShops(account.id);
    const where = { accountId: account.id, ...(filter.status ? { status: filter.status } : {}), ...(filter.shop ? { OR: [{ fromShopId: filter.shop }, { toShopId: filter.shop }] } : {}) };
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
      /** `in_transit` (the receiving shop to check it in), `received` or `cancelled`, and when and by whom. */
      status: row.status,
      received_at: row.receivedAt ? row.receivedAt.toISOString() : null,
      received_by: row.receivedBy,
      /** What arrived of each line and what was lost on the way (transfers received from transit). */
      received_lines: (row.receivedLines as ReceivedLine[] | null) ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }
}
