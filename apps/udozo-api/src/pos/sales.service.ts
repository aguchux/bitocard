import { HttpStatus, Injectable } from '@nestjs/common';
import { isShopOnly } from '../classifieds/listings.service.js';
import { heldUnits, maxStock } from '../classifieds/rules.js';
import { stockChange } from '../classifieds/stock.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { posCountedStatuses, tillBlock } from './catalogue-rules.js';
import { saleTotals } from './money.js';
import { limitsOf } from './plans.js';
import { adjustedStock, checkPayments, maxLineQuantity, maxSaleLines, type PaymentInput, saleNumber, type StockAdjustment } from './sale-rules.js';

export type SaleInput = {
  till_id: string;
  client_sale_id: string;
  lines: Array<{ listing_id: string; quantity: number; discount?: number }>;
  discount?: number;
  payments: Array<{ method: PaymentInput['method']; amount: number; tendered?: number | null; reference?: string | null }>;
  /** The total the till showed, in minor units: a different one is refused (`price_changed`). */
  expected_total: number;
  note?: string | null;
  /** When the till rang it up (offline sales, later). */
  client_created_at?: string;
};

export type SalesFilter = { shop?: string; till?: string; status?: 'completed' | 'refunded'; q?: string; from?: string; to?: string; limit?: number; offset?: number };

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);

const saleInclude = { lines: { orderBy: { position: 'asc' } }, payments: { orderBy: { position: 'asc' } }, shop: { select: { id: true, name: true } } } satisfies Prisma.PosSaleInclude;
type SaleRow = Prisma.PosSaleGetPayload<{ include: typeof saleInclude }>;

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);
const minor = (value: number | undefined | null, param: string) => {
  if (value === undefined || value === null) return 0n;
  if (!Number.isSafeInteger(value) || value < 0) throw invalid('parameter_invalid', 'Amounts are whole minor units, never negative.', param);
  return BigInt(value);
};

/**
 * Ringing up sales at the till (docs/UDOZO_POS_PLAN.md, milestone 3). One inventory: a sale takes its units from the
 * listing's own stock, in one transaction with the listings locked, and never what online buyers hold (UdozoPay orders
 * and accepted buy orders), so udozo.com and the shop never sell the same unit. Payment is recorded only (cash with its
 * change, a transfer to the shop's own account, a card on its own terminal, other): nothing moves in Udozo's ledger. A
 * refund puts the units back; every change to stock from the POS is kept as a movement.
 */
@Injectable()
export class PosSalesService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(customer: CustomerWithStore) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, include: { plan: true } });
    if (!account) throw noAccount();
    return account;
  }

  async sell(customer: CustomerWithStore, input: SaleInput) {
    const account = await this.account(customer);
    const till = await this.prisma.posTill.findFirst({ where: { id: input.till_id, shop: { accountId: account.id } }, include: { shop: true } });
    if (!till) throw notFound('till');

    // Sent before (a lost reply): the same sale.
    const before = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: account.id, clientSaleId: input.client_sale_id } }, include: saleInclude });
    if (before) return this.present(before);

    if (!input.lines.length || input.lines.length > maxSaleLines) throw invalid('parameter_invalid', `A sale holds 1 to ${maxSaleLines} products.`, 'lines');
    const ids = input.lines.map(line => line.listing_id);
    if (new Set(ids).size !== ids.length) throw invalid('parameter_invalid', 'Each product once: change its quantity instead.', 'lines');
    input.lines.forEach((line, index) => {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxLineQuantity) throw invalid('parameter_invalid', `A quantity is 1 to ${maxLineQuantity.toLocaleString('en-GB')}.`, `lines[${index}].quantity`);
    });
    const saleDiscount = minor(input.discount, 'discount');
    const clientCreatedAt = input.client_created_at ? new Date(input.client_created_at) : null;
    if (clientCreatedAt && Number.isNaN(clientCreatedAt.getTime())) throw invalid('parameter_invalid', 'Give the time as an ISO date.', 'client_created_at');
    const limit = limitsOf(account.plan).products;
    const now = new Date();

    try {
      const saleId = await this.prisma.$transaction(async tx => {
        // The listings locked in one order, so two tills selling the same products never wait on each other forever.
        await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${[...ids].sort()}::uuid[]) ORDER BY "id" FOR UPDATE`;
        const rows = await tx.classifiedListing.findMany({
          where: { id: { in: ids } },
          select: { id: true, customerId: true, title: true, sku: true, barcode: true, status: true, priceKind: true, priceMinor: true, currency: true, stock: true, posEnabledAt: true, onShop: true, resale: true, outOfStockAt: true, expiresAt: true, country: true },
        });
        const byId = new Map(rows.map(row => [row.id, row]));
        // The plan's product limit keeps the first ticked selling (as the catalogue shows).
        const within = limit === null ? null : new Set((await tx.classifiedListing.findMany({ where: { customerId: customer.id, posEnabledAt: { not: null }, status: { in: posCountedStatuses } }, select: { id: true }, orderBy: [{ posEnabledAt: 'asc' }, { id: 'asc' }], take: limit })).map(row => row.id));

        const lines = [];
        for (const [index, line] of input.lines.entries()) {
          const param = `lines[${index}]`;
          const row = byId.get(line.listing_id);
          if (!row || row.customerId !== customer.id || !row.posEnabledAt || !posCountedStatuses.includes(row.status)) throw invalid('product_unavailable', 'This product is not at your till: tick Sell at POS on it on udozo.com.', param);
          const block = tillBlock(row, within === null || within.has(row.id));
          if (block === 'plan_limit') throw conflict('plan_limit', `Over ${account.plan.name}'s product limit: change plan to sell it.`, param);
          if (block) throw conflict('product_unavailable', `“${row.title ?? 'This product'}” has no title or price yet: finish it on udozo.com.`, param);
          if (row.currency !== account.currency) throw conflict('product_unavailable', `“${row.title}” is priced in ${row.currency}, not your shop's ${account.currency}.`, param);
          const free = row.stock - (await heldUnits(tx, row.id));
          if (line.quantity > free) throw conflict('stock_short', free > 0 ? `Only ${free} of “${row.title}” left to sell.` : `“${row.title}” is out of stock.`, param);
          lines.push({ row, quantity: line.quantity, unit: row.priceMinor!, discount: minor(line.discount, `${param}.discount`) });
        }

        const totals = saleTotals(lines, { discount: saleDiscount, vatBps: till.shop.vatBps });
        if (BigInt(input.expected_total) !== totals.total) throw conflict('price_changed', 'A price changed since the till showed the total. Look again, then take payment.', 'expected_total');
        const paid = checkPayments(
          input.payments.map((payment, index) => ({ method: payment.method, amount: minor(payment.amount, `payments[${index}].amount`), tendered: payment.tendered === undefined || payment.tendered === null ? null : minor(payment.tendered, `payments[${index}].tendered`), reference: payment.reference ?? null })),
          totals.total,
        );

        const [counter] = await tx.$queryRaw<Array<{ n: number }>>`UPDATE "pos_shops" SET "sale_next" = "sale_next" + 1 WHERE "id" = ${till.shopId}::uuid RETURNING "sale_next" - 1 AS "n"`;
        // Each line's own share of the discounts, as saleTotals worked them out.
        const lineTotals = lines.map(line => {
          const gross = line.unit * BigInt(line.quantity);
          const off = line.discount > gross ? gross : line.discount;
          return { gross, off };
        });
        const sale = await tx.posSale.create({
          data: {
            accountId: account.id,
            shopId: till.shopId,
            tillId: till.id,
            tillName: till.name,
            number: saleNumber(Number(counter!.n)),
            clientSaleId: input.client_sale_id,
            currency: account.currency,
            subtotalMinor: totals.subtotal,
            discountMinor: totals.discount,
            vatBps: till.shop.vatBps,
            vatMinor: totals.vat,
            totalMinor: totals.total,
            changeMinor: paid.change,
            soldByCustomerId: customer.id,
            soldByName: customer.name,
            note: text(input.note, 300),
            clientCreatedAt,
            lines: {
              create: lines.map((line, position) => ({
                listingId: line.row.id,
                position,
                title: line.row.title!,
                sku: line.row.sku,
                barcode: line.row.barcode,
                quantity: line.quantity,
                unitPriceMinor: line.unit,
                discountMinor: lineTotals[position]!.off,
                totalMinor: lineTotals[position]!.gross - lineTotals[position]!.off,
              })),
            },
            payments: { create: paid.payments.map((payment, position) => ({ position, method: payment.method, amountMinor: payment.amount, tenderedMinor: payment.tendered, changeMinor: payment.change, reference: payment.reference })) },
          },
        });

        for (const line of lines) {
          const stock = line.row.stock - line.quantity;
          await this.setStock(tx, line.row, stock, now);
          await tx.posStockMovement.create({ data: { accountId: account.id, listingId: line.row.id, shopId: till.shopId, reason: 'sale', delta: -line.quantity, stockAfter: stock, saleId: sale.id, byCustomerId: customer.id, byName: customer.name } });
        }
        return sale.id;
      });
      return this.present(await this.prisma.posSale.findUniqueOrThrow({ where: { id: saleId }, include: saleInclude }));
    } catch (error) {
      // Two sends of the same sale at once: the one that won is the sale.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const won = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: account.id, clientSaleId: input.client_sale_id } }, include: saleInclude });
        if (won) return this.present(won);
      }
      throw error;
    }
  }

  /** A listing's new stock, with udozo.com's out-of-stock clock kept for a public listing (a shop-only one has none). */
  private async setStock(tx: Prisma.TransactionClient, row: { id: string; status: string; stock: number; outOfStockAt: Date | null; expiresAt: Date | null; onShop: boolean; resale: boolean; posEnabledAt: Date | null; country: string }, stock: number, now: Date) {
    const clock = isShopOnly(row) || row.status === 'draft' ? {} : stockChange(row, stock, await this.listingDays(tx, row.country), now);
    await tx.classifiedListing.update({ where: { id: row.id }, data: { stock, ...clock } });
  }

  private async listingDays(tx: Prisma.TransactionClient, country: string) {
    return (await tx.classifiedMarketSettings.findUnique({ where: { country }, select: { listingDays: true } }))?.listingDays ?? 30;
  }

  async list(customer: CustomerWithStore, filter: SalesFilter) {
    const account = await this.account(customer);
    const from = filter.from ? new Date(filter.from) : null;
    const to = filter.to ? new Date(filter.to) : null;
    const where: Prisma.PosSaleWhereInput = {
      accountId: account.id,
      ...(filter.shop ? { shopId: filter.shop } : {}),
      ...(filter.till ? { tillId: filter.till } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q?.trim() ? { number: { contains: filter.q.trim().toUpperCase() } } : {}),
      ...(from || to ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lt: to } : {}) } } : {}),
    };
    const take = filter.limit ?? 25;
    const offset = filter.offset ?? 0;
    const [rows, total, sums] = await Promise.all([
      this.prisma.posSale.findMany({ where, include: saleInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take }),
      this.prisma.posSale.count({ where }),
      this.prisma.posSale.groupBy({ by: ['status'], where, _sum: { totalMinor: true }, _count: { _all: true } }),
    ]);
    const completed = sums.find(group => group.status === 'completed');
    const refunded = sums.find(group => group.status === 'refunded');
    return {
      object: 'list' as const,
      currency: account.currency,
      /** The filter's sales: what was taken (completed sales) and what was refunded. */
      summary: { sales: completed?._count._all ?? 0, takings: Number(completed?._sum.totalMinor ?? 0n), refunds: refunded?._count._all ?? 0, refunded: Number(refunded?._sum.totalMinor ?? 0n) },
      total,
      has_more: offset + take < total,
      data: rows.map(row => this.present(row)),
    };
  }

  async get(customer: CustomerWithStore, id: string) {
    const account = await this.account(customer);
    const sale = await this.prisma.posSale.findFirst({ where: { id, accountId: account.id }, include: saleInclude });
    if (!sale) throw notFound('sale');
    return this.present(sale);
  }

  /** Refunds a whole sale (paid back as it was paid, by the shop), putting its units back unless `restock` is false. */
  async refund(customer: CustomerWithStore, id: string, input: { reason: string; restock?: boolean }) {
    const account = await this.account(customer);
    const reason = text(input.reason, 300);
    if (!reason) throw invalid('parameter_missing', 'Say why it is refunded.', 'reason');
    const restock = input.restock ?? true;
    const sale = await this.prisma.posSale.findFirst({ where: { id, accountId: account.id }, include: { lines: true } });
    if (!sale) throw notFound('sale');
    if (sale.status === 'refunded') throw conflict('sale_refunded', `${sale.number} was refunded already.`);
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.posSale.updateMany({ where: { id, status: 'completed' }, data: { status: 'refunded', refundedAt: now, refundReason: reason, restocked: restock } });
      if (claimed.count === 0) throw conflict('sale_refunded', `${sale.number} was refunded already.`);
      if (!restock) return;
      const listingIds = [...new Set(sale.lines.map(line => line.listingId))].sort();
      await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${listingIds}::uuid[]) ORDER BY "id" FOR UPDATE`;
      const rows = await tx.classifiedListing.findMany({ where: { id: { in: listingIds } }, select: { id: true, status: true, stock: true, outOfStockAt: true, expiresAt: true, onShop: true, resale: true, posEnabledAt: true, country: true } });
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const line of sale.lines) {
        const row = byId.get(line.listingId);
        // A listing sold, removed or deleted since keeps no stock to put back.
        if (!row || !posCountedStatuses.includes(row.status)) continue;
        const stock = Math.min(maxStock, row.stock + line.quantity);
        await this.setStock(tx, row, stock, now);
        row.stock = stock;
        await tx.posStockMovement.create({ data: { accountId: account.id, listingId: row.id, shopId: sale.shopId, reason: 'refund', delta: line.quantity, stockAfter: stock, saleId: sale.id, note: reason.slice(0, 200), byCustomerId: customer.id, byName: customer.name } });
      }
    });
    return this.get(customer, id);
  }

  /** Restocks, counts or writes off damaged units of one of the owner's products at the till. */
  async adjustStock(customer: CustomerWithStore, listingId: string, input: { kind: StockAdjustment; quantity: number; note?: string | null; shop_id?: string | null }) {
    const account = await this.account(customer);
    if (!Number.isInteger(input.quantity) || input.quantity < (input.kind === 'count' ? 0 : 1) || input.quantity > maxStock) throw invalid('parameter_invalid', input.kind === 'count' ? 'Count what is on the shelf: 0 or more.' : 'Give how many, from 1.', 'quantity');
    const shopId = input.shop_id ? ((await this.prisma.posShop.findFirst({ where: { id: input.shop_id, accountId: account.id }, select: { id: true } }))?.id ?? null) : null;
    if (input.shop_id && !shopId) throw notFound('shop');
    const now = new Date();
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ${listingId}::uuid FOR UPDATE`;
      const row = await tx.classifiedListing.findUnique({ where: { id: listingId }, select: { id: true, customerId: true, status: true, stock: true, outOfStockAt: true, expiresAt: true, onShop: true, resale: true, posEnabledAt: true, country: true } });
      if (!row || row.customerId !== customer.id || !row.posEnabledAt || !posCountedStatuses.includes(row.status)) throw notFound('product');
      const held = await heldUnits(tx, row.id);
      const stock = adjustedStock(row.stock, input.kind, input.quantity, held, maxStock);
      await this.setStock(tx, row, stock, now);
      const movement = await tx.posStockMovement.create({ data: { accountId: account.id, listingId: row.id, shopId, reason: input.kind, delta: stock - row.stock, stockAfter: stock, note: text(input.note, 200), byCustomerId: customer.id, byName: customer.name } });
      return { object: 'pos_stock' as const, listing_id: row.id, stock, held, available: Math.max(0, stock - held), movement: this.presentMovement(movement) };
    });
  }

  async movements(customer: CustomerWithStore, listingId: string, limit = 50) {
    const account = await this.account(customer);
    const listing = await this.prisma.classifiedListing.findFirst({ where: { id: listingId, customerId: customer.id }, select: { id: true, title: true, stock: true } });
    if (!listing) throw notFound('product');
    const rows = await this.prisma.posStockMovement.findMany({ where: { accountId: account.id, listingId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, include: { sale: { select: { number: true } } } });
    return { object: 'list' as const, listing: { id: listing.id, title: listing.title, stock: listing.stock }, data: rows.map(row => this.presentMovement(row)) };
  }

  private presentMovement(row: { id: string; reason: string; delta: number; stockAfter: number; saleId: string | null; note: string | null; byName: string | null; createdAt: Date; sale?: { number: string } | null }) {
    return { object: 'pos_stock_movement' as const, id: row.id, reason: row.reason, delta: row.delta, stock_after: row.stockAfter, sale: row.saleId ? { id: row.saleId, number: row.sale?.number ?? null } : null, note: row.note, by: row.byName, created_at: row.createdAt.toISOString() };
  }

  private present(sale: SaleRow) {
    return {
      object: 'pos_sale' as const,
      id: sale.id,
      number: sale.number,
      client_sale_id: sale.clientSaleId,
      status: sale.status,
      shop: { id: sale.shop.id, name: sale.shop.name },
      till: { id: sale.tillId, name: sale.tillName },
      currency: sale.currency,
      items: sale.lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotal: Number(sale.subtotalMinor),
      discount: Number(sale.discountMinor),
      vat_bps: sale.vatBps,
      vat: Number(sale.vatMinor),
      total: Number(sale.totalMinor),
      change: Number(sale.changeMinor),
      lines: sale.lines.map(line => ({ listing_id: line.listingId, title: line.title, sku: line.sku, barcode: line.barcode, quantity: line.quantity, unit_price: Number(line.unitPriceMinor), discount: Number(line.discountMinor), total: Number(line.totalMinor) })),
      payments: sale.payments.map(payment => ({ method: payment.method, amount: Number(payment.amountMinor), tendered: payment.tenderedMinor === null ? null : Number(payment.tenderedMinor), change: Number(payment.changeMinor), reference: payment.reference })),
      sold_by: sale.soldByName,
      note: sale.note,
      refunded_at: iso(sale.refundedAt),
      refund_reason: sale.refundReason,
      restocked: sale.restocked,
      created_at: sale.createdAt.toISOString(),
      client_created_at: iso(sale.clientCreatedAt),
    };
  }
}
