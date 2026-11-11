import { HttpStatus, Injectable } from '@nestjs/common';
import { isShopOnly } from '../classifieds/listings.service.js';
import { heldUnits, maxStock } from '../classifieds/rules.js';
import { stockChange } from '../classifieds/stock.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { formatMoney } from '../notifications/templates.js';
import { Prisma } from '../generated/prisma/client.js';
import { posCountedStatuses, tillBlock } from './catalogue-rules.js';
import { saleTotals } from './money.js';
import { limitsOf } from './plans.js';
import { customerUnknown } from './customers.service.js';
import { adjustedStock, checkPayments, maxLineQuantity, maxSaleLines, type PaymentInput, saleNumber, type StockAdjustment, tillPaymentMethods, type TillPaymentMethod } from './sale-rules.js';

export type SaleInput = {
  till_id: string;
  client_sale_id: string;
  lines: Array<{ listing_id: string; quantity: number; discount?: number }>;
  discount?: number;
  payments: Array<{ method: TillPaymentMethod; amount: number; tendered?: number | null; reference?: string | null }>;
  /** The shop's customer the sale is made to (needed to sell on credit). */
  customer_id?: string | null;
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

const saleInclude = { lines: { orderBy: { position: 'asc' } }, payments: { orderBy: { position: 'asc' } }, shop: { select: { id: true, name: true } }, customer: { select: { id: true, name: true, number: true } } } satisfies Prisma.PosSaleInclude;
type SaleRow = Prisma.PosSaleGetPayload<{ include: typeof saleInclude }>;
type Account = Prisma.PosAccountGetPayload<{ include: { plan: true } }>;
type Till = Prisma.PosTillGetPayload<{ include: { shop: true } }>;
export type Built = Awaited<ReturnType<PosSalesService['build']>>;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async account(customer: CustomerWithStore) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, include: { plan: true } });
    if (!account) throw noAccount();
    return account;
  }

  async sell(customer: CustomerWithStore, input: SaleInput) {
    const account = await this.account(customer);
    const till = await this.till(account.id, input.till_id);

    // Sent before (a lost reply): the same sale.
    const before = await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: account.id, clientSaleId: input.client_sale_id } }, include: saleInclude });
    if (before) return this.present(before);
    this.checkShape(input);
    const now = new Date();

    try {
      const saleId = await this.prisma.$transaction(async tx => {
        const built = await this.build(tx, { account, till, ownerId: customer.id, input });
        return this.record(tx, { account, till, soldBy: { id: customer.id, name: customer.name }, input, built, now });
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

  /** One of the account's tills with its shop, else not found. */
  async till(accountId: string, tillId: string) {
    const till = await this.prisma.posTill.findFirst({ where: { id: tillId, shop: { accountId } }, include: { shop: true } });
    if (!till) throw notFound('till');
    return till;
  }

  /** What a basket must be before anything is read: 1 to 100 products, each once, with whole quantities. */
  checkShape(input: Pick<SaleInput, 'lines' | 'client_created_at'>) {
    if (!input.lines.length || input.lines.length > maxSaleLines) throw invalid('parameter_invalid', `A sale holds 1 to ${maxSaleLines} products.`, 'lines');
    const ids = input.lines.map(line => line.listing_id);
    if (new Set(ids).size !== ids.length) throw invalid('parameter_invalid', 'Each product once: change its quantity instead.', 'lines');
    input.lines.forEach((line, index) => {
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxLineQuantity) throw invalid('parameter_invalid', `A quantity is 1 to ${maxLineQuantity.toLocaleString('en-GB')}.`, `lines[${index}].quantity`);
    });
    if (input.client_created_at && Number.isNaN(new Date(input.client_created_at).getTime())) throw invalid('parameter_invalid', 'Give the time as an ISO date.', 'client_created_at');
  }

  /**
   * Checks a basket inside `tx`, the listings locked in id order (so two tills selling the same products never wait on
   * each other forever): each the owner's, ticked, sellable within the plan, in the shop's currency and with enough free
   * stock; the totals as the till showed them; and the payments adding up to the total, with `wallet` (minor units) the
   * part paid from a Udozo wallet. Takes nothing.
   */
  async build(tx: Prisma.TransactionClient, args: { account: Account; till: Till; ownerId: string; input: SaleInput; wallet?: bigint }) {
    const { account, till, ownerId, input } = args;
    const ids = input.lines.map(line => line.listing_id);
    await tx.$queryRaw`SELECT 1 FROM "classified_listings" WHERE "id" = ANY(${[...ids].sort()}::uuid[]) ORDER BY "id" FOR UPDATE`;
    const rows = await tx.classifiedListing.findMany({
      where: { id: { in: ids } },
      select: { id: true, customerId: true, title: true, sku: true, barcode: true, status: true, priceKind: true, priceMinor: true, currency: true, stock: true, posEnabledAt: true, onShop: true, resale: true, outOfStockAt: true, expiresAt: true, country: true },
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    // The plan's product limit keeps the first ticked selling (as the catalogue shows).
    const limit = limitsOf(account.plan).products;
    const within = limit === null ? null : new Set((await tx.classifiedListing.findMany({ where: { customerId: ownerId, posEnabledAt: { not: null }, status: { in: posCountedStatuses } }, select: { id: true }, orderBy: [{ posEnabledAt: 'asc' }, { id: 'asc' }], take: limit })).map(row => row.id));

    const lines = [];
    for (const [index, line] of input.lines.entries()) {
      const param = `lines[${index}]`;
      const row = byId.get(line.listing_id);
      if (!row || row.customerId !== ownerId || !row.posEnabledAt || !posCountedStatuses.includes(row.status)) throw invalid('product_unavailable', 'This product is not at your till: tick Sell at POS on it on udozo.com.', param);
      const block = tillBlock(row, within === null || within.has(row.id));
      if (block === 'plan_limit') throw conflict('plan_limit', `Over ${account.plan.name}'s product limit: change plan to sell it.`, param);
      if (block) throw conflict('product_unavailable', `“${row.title ?? 'This product'}” has no title or price yet: finish it on udozo.com.`, param);
      if (row.currency !== account.currency) throw conflict('product_unavailable', `“${row.title}” is priced in ${row.currency}, not your shop's ${account.currency}.`, param);
      const free = row.stock - (await heldUnits(tx, row.id));
      if (line.quantity > free) throw conflict('stock_short', free > 0 ? `Only ${free} of “${row.title}” left to sell.` : `“${row.title}” is out of stock.`, param);
      lines.push({ row, quantity: line.quantity, unit: row.priceMinor!, discount: minor(line.discount, `${param}.discount`) });
    }

    const totals = saleTotals(lines, { discount: minor(input.discount, 'discount'), vatBps: till.shop.vatBps });
    if (BigInt(input.expected_total) !== totals.total) throw conflict('price_changed', 'A price changed since the till showed the total. Look again, then take payment.', 'expected_total');
    const parts: PaymentInput[] = input.payments.map((payment, index) => {
      if (!tillPaymentMethods.includes(payment.method as TillPaymentMethod)) throw invalid('parameter_invalid', 'Choose cash, transfer, card, other or pay later.', `payments[${index}].method`);
      return { method: payment.method, amount: minor(payment.amount, `payments[${index}].amount`), tendered: payment.tendered === undefined || payment.tendered === null ? null : minor(payment.tendered, `payments[${index}].tendered`), reference: payment.reference ?? null };
    });
    if (args.wallet !== undefined) parts.push({ method: 'udozo_wallet', amount: args.wallet, tendered: null, reference: null });
    const paid = checkPayments(parts, totals.total);

    // The customer: needed to sell on credit, which their limit (if the shop set one) may not pass.
    const customer = input.customer_id ? await tx.posCustomer.findFirst({ where: { id: input.customer_id, accountId: account.id } }) : null;
    if (input.customer_id && !customer) throw customerUnknown('customer_id');
    const credit = paid.payments.filter(payment => payment.method === 'credit').reduce((sum, payment) => sum + payment.amount, 0n);
    if (credit > 0n && !customer) throw invalid('customer_required', 'Choose the customer who will pay later.', 'customer_id');
    if (credit > 0n && customer!.creditLimitMinor !== null && customer!.owedMinor + credit > customer!.creditLimitMinor) {
      throw conflict('credit_limit_reached', `${customer!.name} may owe at most ${formatMoney(customer!.creditLimitMinor, account.currency)} and owes ${formatMoney(customer!.owedMinor, account.currency)} already.`, 'customer_id');
    }
    return { lines, totals, paid, customer, credit };
  }

  /** Makes the sale `build` checked, in the same `tx`: numbered for its shop, its units taken off stock with a movement each. */
  async record(
    tx: Prisma.TransactionClient,
    args: { account: Account; till: Till; soldBy: { id: string | null; name: string }; input: SaleInput; built: Built; now: Date; walletRequest?: { id: string; number: string } },
  ) {
    const { account, till, soldBy, input, built, now } = args;
    const { lines, totals, paid } = built;
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
        soldByCustomerId: soldBy.id,
        soldByName: soldBy.name,
        customerId: built.customer?.id ?? null,
        note: text(input.note, 300),
        clientCreatedAt: input.client_created_at ? new Date(input.client_created_at) : null,
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
        payments: {
          create: paid.payments.map((payment, position) => ({
            position,
            method: payment.method,
            amountMinor: payment.amount,
            tenderedMinor: payment.tendered,
            changeMinor: payment.change,
            reference: payment.method === 'udozo_wallet' ? (args.walletRequest?.number ?? null) : payment.reference,
            walletRequestId: payment.method === 'udozo_wallet' ? (args.walletRequest?.id ?? null) : null,
          })),
        },
      },
    });

    if (built.customer) {
      // Their purchases, and what they now owe (the limit held again here, as two tills may sell to them at once).
      const [after] = await tx.$queryRaw<Array<{ owed: bigint }>>`
        UPDATE "pos_customers" SET "owed_minor" = "owed_minor" + ${built.credit}, "sales_count" = "sales_count" + 1, "spent_minor" = "spent_minor" + ${totals.total}, "last_sale_at" = ${now}, "updated_at" = ${now}
        WHERE "id" = ${built.customer.id}::uuid AND ("credit_limit_minor" IS NULL OR "owed_minor" + ${built.credit} <= "credit_limit_minor")
        RETURNING "owed_minor" AS "owed"`;
      if (!after) throw conflict('credit_limit_reached', `${built.customer.name} has reached their credit limit.`, 'customer_id');
      if (built.credit > 0n) await tx.posCustomerEntry.create({ data: { customerId: built.customer.id, kind: 'credit_sale', amountMinor: built.credit, owedAfterMinor: after.owed, saleId: sale.id, byName: soldBy.name } });
    }

    for (const line of lines) {
      const stock = line.row.stock - line.quantity;
      await this.setStock(tx, line.row, stock, now);
      await tx.posStockMovement.create({ data: { accountId: account.id, listingId: line.row.id, shopId: till.shopId, reason: 'sale', delta: -line.quantity, stockAfter: stock, saleId: sale.id, byCustomerId: soldBy.id, byName: soldBy.name } });
    }
    return sale.id;
  }

  /** A sale as presented, by id. */
  async presentById(id: string) {
    return this.present(await this.prisma.posSale.findUniqueOrThrow({ where: { id }, include: saleInclude }));
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

  /**
   * Refunds a whole sale, putting its units back unless `restock` is false. The shop pays back what it took itself;
   * a Udozo wallet part goes back from the owner's payouts to the buyer's wallet (`pos_wallet_refund:<request>`), and
   * while the owner's payouts hold less than it, the refund waits (`refund_funds_short`).
   */
  async refund(customer: CustomerWithStore, id: string, input: { reason: string; restock?: boolean }) {
    const account = await this.account(customer);
    const reason = text(input.reason, 300);
    if (!reason) throw invalid('parameter_missing', 'Say why it is refunded.', 'reason');
    const restock = input.restock ?? true;
    const sale = await this.prisma.posSale.findFirst({ where: { id, accountId: account.id }, include: { lines: true, payments: { include: { walletRequest: { select: { id: true, buyerCustomerId: true } } } } } });
    if (!sale) throw notFound('sale');
    if (sale.status === 'refunded') throw conflict('sale_refunded', `${sale.number} was refunded already.`);
    const now = new Date();
    const reversals = await Promise.all(
      sale.payments
        .filter(payment => payment.method === 'udozo_wallet' && payment.walletRequest?.buyerCustomerId)
        .map(payment =>
          this.ledger.prepare({
            mode: account.mode,
            type: 'pos_wallet_refund',
            reference: `pos_wallet_refund:${payment.walletRequest!.id}`,
            description: `Refund of ${sale.number}`,
            lines: [
              { account: { kind: 'customer_withdrawable', currency: sale.currency, customerId: customer.id }, debit: payment.amountMinor },
              { account: { kind: 'customer_wallet', currency: sale.currency, customerId: payment.walletRequest!.buyerCustomerId! }, credit: payment.amountMinor },
            ],
          }),
        ),
    );
    try {
      await this.refundIn(sale, { account, customer, reason, restock, now, reversals });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') {
        throw conflict('refund_funds_short', 'Your Udozo payouts hold less than the wallet part of this sale, as it was paid out. Refund it once more money has come in.');
      }
      throw error;
    }
    return this.get(customer, id);
  }

  private async refundIn(
    sale: { id: string; number: string; shopId: string; customerId: string | null; totalMinor: bigint; lines: Array<{ listingId: string; quantity: number }>; payments: Array<{ method: string; amountMinor: bigint }> },
    args: { account: Account; customer: CustomerWithStore; reason: string; restock: boolean; now: Date; reversals: Awaited<ReturnType<LedgerService['prepare']>>[] },
  ) {
    const { account, customer, reason, restock, now } = args;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.posSale.updateMany({ where: { id: sale.id, status: 'completed' }, data: { status: 'refunded', refundedAt: now, refundReason: reason, restocked: restock } });
      if (claimed.count === 0) throw conflict('sale_refunded', `${sale.number} was refunded already.`);
      for (const entry of args.reversals) await this.ledger.write(tx, entry);
      if (sale.customerId) {
        // What they spent goes down, and what they owe by as much as the sale put on credit (never below nothing).
        const credit = sale.payments.filter(payment => payment.method === 'credit').reduce((sum, payment) => sum + payment.amountMinor, 0n);
        const [before] = await tx.$queryRaw<Array<{ owed: bigint }>>`SELECT "owed_minor" AS "owed" FROM "pos_customers" WHERE "id" = ${sale.customerId}::uuid FOR UPDATE`;
        if (before) {
          const off = credit < before.owed ? credit : before.owed;
          await tx.$executeRaw`UPDATE "pos_customers" SET "owed_minor" = "owed_minor" - ${off}, "spent_minor" = GREATEST("spent_minor" - ${sale.totalMinor}, 0), "updated_at" = ${now} WHERE "id" = ${sale.customerId}::uuid`;
          if (off > 0n) await tx.posCustomerEntry.create({ data: { customerId: sale.customerId, kind: 'refund', amountMinor: -off, owedAfterMinor: before.owed - off, saleId: sale.id, note: reason.slice(0, 300), byName: customer.name } });
        }
      }
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
      /** The shop's customer it was sold to, if one was chosen. */
      customer: sale.customer ? { id: sale.customer.id, name: sale.customer.name, number: `C-${String(sale.customer.number).padStart(6, '0')}` } : null,
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
