import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ownerBy, type PosBy } from './actor.js';
import { marketZone } from './collection-rules.js';

/** What a member of staff reaches of the shifts: their tills only (the owner, every till). */
export type ShiftScope = { tills?: string[] };
/**
 * Whether the caller sees the cash the drawer should hold. Staff without `cash_up` count blind: they never see what is
 * expected or how far out the count is (the owner and managers do).
 */
export type ShiftView = { blind?: boolean };

/** The most a float, a count or a cash movement may be, in minor units (a hundred million in the currency). */
const maxCash = 10_000_000_000;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const noAccount = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);
const cashAmount = (value: unknown, param: string, min = 0) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > maxCash) throw invalid('parameter_invalid', min ? 'Give an amount above nothing, in minor units.' : 'Give an amount from nothing up, in minor units.', param);
  return BigInt(value);
};
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const clock = (at: Date, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

/** What a shift took, as it is now (an open shift) or was at closing (kept on the shift). Amounts in minor units. */
export type ShiftTotals = {
  sales: number;
  sales_total: number;
  refunds: number;
  refunds_total: number;
  items: number;
  /** Every payment method's takings from the sales rung up in it. */
  by_method: Record<string, number>;
  cash_sales: number;
  cash_refunds: number;
  paid_in: number;
  paid_out: number;
};

type ShiftRow = Prisma.PosShiftGetPayload<{ include: { cash: true } }>;

/**
 * Shifts and cash-up (docs/UDOZO_POS_PLAN.md, milestone 7). A till's shift opens with its float (the cash in the
 * drawer), takes the sales rung up at the till while it is open and the refunds paid out of it (`pos_sales.shift_id`,
 * `refund_shift_id`, set by the sale's own transaction under a share lock), cash paid in and out with why, and closes
 * with the cash counted: expected is the float, plus cash taken, less cash refunded, plus paid in, less paid out; the
 * difference is counted less expected. One open shift a till (a partial unique index). Sales need no shift.
 */
@Injectable()
export class PosShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(customer: CustomerWithStore) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { id: true, currency: true, country: true } });
    if (!account) throw noAccount();
    return account;
  }

  private async till(accountId: string, tillId: string, scope: ShiftScope) {
    if (scope.tills && !scope.tills.includes(tillId)) throw notFound('till');
    const till = await this.prisma.posTill.findFirst({ where: { id: tillId, shop: { accountId } }, select: { id: true, name: true, shopId: true } });
    if (!till) throw notFound('till');
    return till;
  }

  private async shift(accountId: string, id: string, scope: ShiftScope) {
    const row = await this.prisma.posShift.findFirst({ where: { id, accountId, ...(scope.tills ? { tillId: { in: scope.tills } } : {}) }, include: { cash: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw notFound('shift');
    return row;
  }

  /** Opens a shift at a till with the cash in its drawer. */
  async open(customer: CustomerWithStore, input: { till_id: string; opening_float?: number; note?: string | null }, options: { by?: PosBy; scope?: ShiftScope; at?: Date; clientId?: string } & ShiftView = {}) {
    const account = await this.account(customer);
    const scope = options.scope ?? {};
    const till = await this.till(account.id, input.till_id, scope);
    const float = cashAmount(input.opening_float ?? 0, 'opening_float');
    const by = options.by ?? ownerBy(customer);
    try {
      const row = await this.prisma.posShift.create({
        data: { accountId: account.id, shopId: till.shopId, tillId: till.id, tillName: till.name, currency: account.currency, openedByName: by.name.slice(0, 120), openedByStaffId: by.staffId, openingFloatMinor: float, note: text(input.note, 300), ...(options.at ? { openedAt: options.at } : {}), ...(options.clientId ? { clientId: options.clientId } : {}) },
        include: { cash: true },
      });
      return this.present(row, await this.totals(row), options);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const open = await this.prisma.posShift.findFirst({ where: { tillId: till.id, status: 'open' }, select: { openedByName: true, openedAt: true } });
        throw conflict('shift_open', open ? `${till.name} already has a shift open, opened by ${open.openedByName} at ${clock(open.openedAt, marketZone(account.country))}. Close it first.` : `${till.name} already has a shift open.`, 'till_id');
      }
      throw error;
    }
  }

  /** A till's open shift, with what it has taken so far (null when none is open). */
  async current(customer: CustomerWithStore, tillId: string, options: { scope?: ShiftScope } & ShiftView = {}) {
    const account = await this.account(customer);
    const till = await this.till(account.id, tillId, options.scope ?? {});
    const row = await this.prisma.posShift.findFirst({ where: { tillId: till.id, status: 'open' }, include: { cash: { orderBy: { createdAt: 'asc' } } } });
    return { object: 'pos_current_shift' as const, till: { id: till.id, name: till.name }, shift: row ? this.present(row, await this.totals(row), options) : null };
  }

  async get(customer: CustomerWithStore, id: string, options: { scope?: ShiftScope } & ShiftView = {}) {
    const account = await this.account(customer);
    const row = await this.shift(account.id, id, options.scope ?? {});
    return this.present(row, row.status === 'open' ? await this.totals(row) : ((row.totals as ShiftTotals | null) ?? (await this.totals(row))), options);
  }

  /** Shifts, newest first: a shop's or a till's, open or closed, in a period. */
  async list(customer: CustomerWithStore, filter: { shop?: string; till?: string; status?: 'open' | 'closed'; from?: string; to?: string; limit?: number; offset?: number }, options: { scope?: ShiftScope } & ShiftView = {}) {
    const account = await this.account(customer);
    const scope = options.scope ?? {};
    const from = filter.from ? new Date(filter.from) : null;
    const to = filter.to ? new Date(filter.to) : null;
    const where: Prisma.PosShiftWhereInput = {
      accountId: account.id,
      ...(filter.shop ? { shopId: filter.shop } : {}),
      ...(filter.till ? { tillId: filter.till } : {}),
      ...(scope.tills ? { AND: [{ tillId: { in: scope.tills } }] } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(from || to ? { openedAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lt: to } : {}) } } : {}),
    };
    const take = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    const skip = Math.max(filter.offset ?? 0, 0);
    const [rows, total] = await Promise.all([this.prisma.posShift.findMany({ where, include: { cash: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], skip, take }), this.prisma.posShift.count({ where })]);
    const data = [];
    for (const row of rows) data.push(this.present(row, row.status === 'open' ? await this.totals(row) : ((row.totals as ShiftTotals | null) ?? (await this.totals(row))), options));
    return { object: 'list' as const, currency: account.currency, total, has_more: skip + take < total, data };
  }

  /** Cash paid into the drawer or out of it during an open shift, with why. */
  async cash(customer: CustomerWithStore, id: string, input: { kind: 'in' | 'out'; amount: number; reason: string }, options: { by?: PosBy; scope?: ShiftScope; at?: Date; clientId?: string } & ShiftView = {}) {
    const account = await this.account(customer);
    const row = await this.shift(account.id, id, options.scope ?? {});
    if (input.kind !== 'in' && input.kind !== 'out') throw invalid('parameter_invalid', 'Say whether cash went in or out.', 'kind');
    const amount = cashAmount(input.amount, 'amount', 1);
    const reason = text(input.reason, 200);
    if (!reason) throw invalid('parameter_missing', 'Say why the cash went in or out.', 'reason');
    const by = options.by ?? ownerBy(customer);
    await this.prisma.$transaction(async tx => {
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "pos_shifts" WHERE "id" = ${row.id}::uuid FOR UPDATE`;
      if (locked?.status !== 'open') throw conflict('shift_closed', 'This shift is closed.');
      await tx.posShiftCash.create({ data: { shiftId: row.id, kind: input.kind, amountMinor: amount, reason, byName: by.name.slice(0, 120), byStaffId: by.staffId, ...(options.at ? { createdAt: options.at } : {}), ...(options.clientId ? { clientId: options.clientId } : {}) } });
    });
    return this.get(customer, id, options);
  }

  /**
   * Closes a shift with the cash counted: what was expected and the difference are worked out and kept with its totals,
   * under the shift's own lock, so a sale still being rung up at the till is counted before it closes.
   */
  async close(customer: CustomerWithStore, id: string, input: { counted: number; note?: string | null }, options: { by?: PosBy; scope?: ShiftScope; at?: Date } & ShiftView = {}) {
    const account = await this.account(customer);
    const row = await this.shift(account.id, id, options.scope ?? {});
    const counted = cashAmount(input.counted, 'counted');
    const by = options.by ?? ownerBy(customer);
    await this.prisma.$transaction(async tx => {
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "pos_shifts" WHERE "id" = ${row.id}::uuid FOR UPDATE`;
      if (locked?.status !== 'open') throw conflict('shift_closed', 'This shift is closed already.');
      const fresh = await tx.posShift.findUniqueOrThrow({ where: { id: row.id }, include: { cash: true } });
      const totals = await this.totals(fresh, tx);
      const expected = this.expected(fresh.openingFloatMinor, totals);
      const note = text(input.note, 300);
      await tx.posShift.update({
        where: { id: row.id },
        data: {
          status: 'closed',
          closedAt: options.at ?? new Date(),
          closedByName: by.name.slice(0, 120),
          closedByStaffId: by.staffId,
          expectedCashMinor: expected,
          countedCashMinor: counted,
          differenceMinor: counted - expected,
          totals: totals as unknown as Prisma.InputJsonValue,
          ...(note ? { note } : {}),
        },
      });
    });
    return this.get(customer, id, options);
  }

  private expected(float: bigint, totals: ShiftTotals) {
    return float + BigInt(totals.cash_sales) - BigInt(totals.cash_refunds) + BigInt(totals.paid_in) - BigInt(totals.paid_out);
  }

  /** What a shift has taken: the sales rung up in it by method, the refunds paid out of it, and cash paid in and out. */
  async totals(row: Pick<ShiftRow, 'id'> & { cash: Array<{ kind: string; amountMinor: bigint }> }, client: Prisma.TransactionClient = this.prisma): Promise<ShiftTotals> {
    const [sold, refunded] = await Promise.all([
      client.posSale.findMany({ where: { shiftId: row.id }, select: { totalMinor: true, lines: { select: { quantity: true } }, payments: { select: { method: true, amountMinor: true } } } }),
      client.posSale.findMany({ where: { refundShiftId: row.id }, select: { totalMinor: true, payments: { select: { method: true, amountMinor: true } } } }),
    ]);
    const byMethod: Record<string, number> = {};
    for (const sale of sold) for (const payment of sale.payments) byMethod[payment.method] = (byMethod[payment.method] ?? 0) + Number(payment.amountMinor);
    const cashOf = (sales: Array<{ payments: Array<{ method: string; amountMinor: bigint }> }>) => sales.reduce((sum, sale) => sum + sale.payments.filter(payment => payment.method === 'cash').reduce((part, payment) => part + Number(payment.amountMinor), 0), 0);
    const moved = (kind: string) => row.cash.filter(item => item.kind === kind).reduce((sum, item) => sum + Number(item.amountMinor), 0);
    return {
      sales: sold.length,
      sales_total: sold.reduce((sum, sale) => sum + Number(sale.totalMinor), 0),
      refunds: refunded.length,
      refunds_total: refunded.reduce((sum, sale) => sum + Number(sale.totalMinor), 0),
      items: sold.reduce((sum, sale) => sum + sale.lines.reduce((part, line) => part + line.quantity, 0), 0),
      by_method: byMethod,
      cash_sales: cashOf(sold),
      cash_refunds: cashOf(refunded),
      paid_in: moved('in'),
      paid_out: moved('out'),
    };
  }

  present(row: ShiftRow, totals: ShiftTotals, options: ShiftView = {}) {
    const blind = Boolean(options.blind);
    const expected = row.status === 'open' ? this.expected(row.openingFloatMinor, totals) : row.expectedCashMinor;
    return {
      object: 'pos_shift' as const,
      id: row.id,
      status: row.status,
      shop_id: row.shopId,
      till: { id: row.tillId, name: row.tillName },
      currency: row.currency,
      opened_at: row.openedAt.toISOString(),
      opened_by: row.openedByName,
      opening_float: Number(row.openingFloatMinor),
      closed_at: row.closedAt?.toISOString() ?? null,
      closed_by: row.closedByName,
      counted_cash: row.countedCashMinor === null ? null : Number(row.countedCashMinor),
      /** The cash the drawer should hold, and counted less expected: never shown to staff who count blind. */
      expected_cash: blind || expected === null ? null : Number(expected),
      difference: blind || row.differenceMinor === null ? null : Number(row.differenceMinor),
      blind,
      /** What it took: sales and refunds, items and takings by method (cash hidden from staff who count blind). */
      totals: blind ? { ...totals, by_method: Object.fromEntries(Object.entries(totals.by_method).filter(([method]) => method !== 'cash')), cash_sales: null, cash_refunds: null } : totals,
      cash: row.cash.map(item => ({ id: item.id, kind: item.kind, amount: Number(item.amountMinor), reason: item.reason, by: item.byName, created_at: item.createdAt.toISOString() })),
      note: row.note,
    };
  }
}
