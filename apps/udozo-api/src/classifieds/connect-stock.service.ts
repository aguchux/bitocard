import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';

const dayMs = 86_400_000;
const unknown = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'centre_unknown', 'No such centre.');
const ownerOnly = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'centre_role_required', 'Only the centre’s owner can do this.');
const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const minor = (value: bigint) => Number(value);
const orderNumber = (number: bigint | number) => `SP-${number}`;
const centreNumber = (number: bigint | number) => `CC-${String(number).padStart(6, '0')}`;

/**
 * The items that should be at a centre: received and not handed over (at the centre, with Udozo after a refusal, or
 * refunded and kept for their seller until the seller collects them).
 */
export const heldWhere: Prisma.ClassifiedOrderWhereInput = {
  connectCentreId: { not: null },
  AND: [
    {
      OR: [
        { status: 'at_centre' },
        { status: { in: ['disputed', 'refunded', 'partly_refunded'] }, receivedAt: { not: null }, releasedAt: null, NOT: { connectReturn: { is: { status: 'collected' } } } },
      ],
    },
    // Abandoned items stay the centre's until Udozo's pickup collects them.
    { OR: [{ connectPlace: null }, { connectPlace: 'awaiting_pickup' }] },
  ],
};
export const atCentreWhere = (centreId: string): Prisma.ClassifiedOrderWhereInput => ({ ...heldWhere, connectCentreId: centreId });

type StockInput = { shelf_id?: string | null; found: string[]; note?: string | null };

/**
 * A Connect Centre's stock checks and earnings (docs/UDOZO_CONNECT_PLAN.md, phase 5f).
 *
 * Stock check: its people list what should be on each storage place and mark what is there. Anything not found is
 * flagged to Udozo at once (`connect_missing_at`, admins told) and cleared when a later check finds it or it leaves.
 *
 * Earnings: the centre's 70% of Connect fees, storage and penalties is credited to its partner's
 * `connect_centre_earnings` as each is paid. Its owner sees what was earned, what is still inside the market's payout
 * hold, and moves what is not into their payouts (`customer_withdrawable`), paid to their bank from udozo.com.
 */
@Injectable()
export class ConnectStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly inbox: InboxService,
  ) {}

  private async member(customer: CustomerWithStore, centreId: string) {
    const member = await this.prisma.connectCentreMember.findUnique({ where: { centreId_customerId: { centreId, customerId: customer.id } } });
    if (!member) throw unknown();
    return member;
  }

  // ---- Stock checks ----

  /** What should be at the centre, by storage place (items not on one last), each with whether it is flagged missing. */
  async expected(customer: CustomerWithStore, centreId: string) {
    await this.member(customer, centreId);
    const [shelves, orders] = await Promise.all([
      this.prisma.connectShelf.findMany({ where: { centreId }, orderBy: [{ position: 'asc' }, { code: 'asc' }] }),
      this.prisma.classifiedOrder.findMany({
        where: atCentreWhere(centreId),
        orderBy: { receivedAt: 'asc' },
        take: 1000,
        select: { id: true, number: true, status: true, connectShelfId: true, connectMissingAt: true, connectSeenAt: true, receivedAt: true, listing: { select: { title: true } } },
      }),
    ]);
    const item = (order: (typeof orders)[number]) => ({
      order_id: order.id,
      number: orderNumber(order.number),
      title: order.listing.title,
      status: order.status,
      received_at: order.receivedAt?.toISOString() ?? null,
      missing_since: order.connectMissingAt?.toISOString() ?? null,
      seen_at: order.connectSeenAt?.toISOString() ?? null,
    });
    type Group = { shelf: { id: string; code: string; label: string | null; active: boolean } | null; items: ReturnType<typeof item>[] };
    const groups: Group[] = shelves
      .map(shelf => ({ shelf: { id: shelf.id, code: shelf.code, label: shelf.label, active: shelf.active }, items: orders.filter(order => order.connectShelfId === shelf.id).map(item) }))
      .filter(group => group.items.length || group.shelf.active);
    const loose = orders.filter(order => !order.connectShelfId || !shelves.some(shelf => shelf.id === order.connectShelfId)).map(item);
    if (loose.length) groups.push({ shelf: null, items: loose });
    return { object: 'connect_stock' as const, total: orders.length, missing: orders.filter(order => order.connectMissingAt).length, groups };
  }

  /** A stock check of one storage place (or the whole centre): what was there; the rest is flagged to Udozo at once. */
  async record(customer: CustomerWithStore, centreId: string, input: StockInput) {
    const member = await this.member(customer, centreId);
    const centre = await this.prisma.connectCentre.findUniqueOrThrow({ where: { id: centreId }, select: { id: true, name: true } });
    const shelfId = input.shelf_id ?? null;
    if (shelfId && !(await this.prisma.connectShelf.findFirst({ where: { id: shelfId, centreId } }))) throw invalid('parameter_invalid', 'No such storage place at this centre.', 'shelf_id');
    const expected = await this.prisma.classifiedOrder.findMany({
      where: { AND: [atCentreWhere(centreId), shelfId ? { connectShelfId: shelfId } : {}] },
      select: { id: true, number: true, connectShelfId: true, connectMissingAt: true },
    });
    if (!expected.length) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'nothing_to_check', shelfId ? 'Nothing should be on this storage place.' : 'Nothing should be at the centre.');
    const ids = new Set(expected.map(order => order.id));
    const found = new Set(input.found);
    if ([...found].some(id => !ids.has(id))) throw invalid('parameter_invalid', 'Mark only items this check lists.', 'found');
    const missing = expected.filter(order => !found.has(order.id));
    const now = new Date();
    const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
    const { check, flagged } = await this.prisma.$transaction(async tx => {
      const check = await tx.connectStockCheck.create({
        data: {
          centreId,
          shelfId,
          checkedById: member.customerId,
          expected: expected.length,
          found: expected.length - missing.length,
          missing: missing.length,
          note,
          items: { create: expected.map(order => ({ orderId: order.id, shelfId: order.connectShelfId, found: found.has(order.id) })) },
        },
      });
      if (found.size) await tx.classifiedOrder.updateMany({ where: { id: { in: [...found] } }, data: { connectSeenAt: now, connectMissingAt: null } });
      const fresh = missing.filter(order => !order.connectMissingAt);
      if (fresh.length) await tx.classifiedOrder.updateMany({ where: { id: { in: fresh.map(order => order.id) }, connectMissingAt: null }, data: { connectMissingAt: now } });
      return { check, flagged: fresh };
    });
    if (flagged.length) {
      const numbers = flagged.map(order => orderNumber(order.number));
      await this.inbox.admins('admin.connect.missing', {
        subject: `stock_check:${check.id}`,
        title: `${flagged.length === 1 ? 'An item is' : `${flagged.length} items are`} missing at ${centre.name}`,
        body: `${numbers.slice(0, 10).join(', ')}${numbers.length > 10 ? ` and ${numbers.length - 10} more` : ''} not found at a stock check.`,
        link: '/connect/missing',
      });
    }
    return this.presentCheck(check, await this.names([check.checkedById]), flagged.length);
  }

  /** The centre's latest stock checks. */
  async checks(customer: CustomerWithStore, centreId: string) {
    await this.member(customer, centreId);
    const rows = await this.prisma.connectStockCheck.findMany({ where: { centreId }, orderBy: { createdAt: 'desc' }, take: 30, include: { shelf: { select: { code: true } } } });
    const names = await this.names(rows.map(row => row.checkedById));
    return { object: 'list' as const, data: rows.map(row => this.presentCheck(row, names)) };
  }

  private async names(ids: string[]) {
    const people = await this.prisma.customer.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(people.map(person => [person.id, person.name]));
  }

  private presentCheck(row: { id: string; shelfId: string | null; checkedById: string; expected: number; found: number; missing: number; note: string | null; createdAt: Date; shelf?: { code: string } | null }, names: Map<string, string>, flagged?: number) {
    return {
      object: 'connect_stock_check' as const,
      id: row.id,
      shelf: row.shelfId ? { id: row.shelfId, code: row.shelf?.code ?? null } : null,
      checked_by: names.get(row.checkedById) ?? null,
      expected: row.expected,
      found: row.found,
      missing: row.missing,
      ...(flagged === undefined ? {} : { flagged }),
      note: row.note,
      created_at: row.createdAt.toISOString(),
    };
  }

  /** Udozo's team: every item flagged missing that has not left its centre. */
  async missingForAdmin(country?: string) {
    const rows = await this.prisma.classifiedOrder.findMany({
      where: { connectMissingAt: { not: null }, fulfilment: 'connect', ...(country ? { country } : {}) },
      orderBy: { connectMissingAt: 'asc' },
      take: 200,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        priceMinor: true,
        connectMissingAt: true,
        connectSeenAt: true,
        receivedAt: true,
        listing: { select: { title: true } },
        connectShelf: { select: { code: true } },
        connectCentre: { select: { id: true, name: true, number: true, country: true } },
      },
    });
    return {
      object: 'list' as const,
      data: rows.map(row => ({
        object: 'connect_missing_item' as const,
        order_id: row.id,
        number: orderNumber(row.number),
        title: row.listing.title,
        status: row.status,
        price: minor(row.priceMinor),
        currency: row.currency,
        centre: row.connectCentre ? { id: row.connectCentre.id, name: row.connectCentre.name, number: centreNumber(row.connectCentre.number), country: row.connectCentre.country } : null,
        shelf: row.connectShelf?.code ?? null,
        received_at: row.receivedAt?.toISOString() ?? null,
        missing_since: row.connectMissingAt!.toISOString(),
        seen_at: row.connectSeenAt?.toISOString() ?? null,
      })),
    };
  }

  // ---- Earnings ----

  private async owner(customer: CustomerWithStore, centreId: string) {
    const member = await this.member(customer, centreId);
    if (member.role !== 'owner') throw ownerOnly();
    const centre = await this.prisma.connectCentre.findUniqueOrThrow({ where: { id: centreId }, select: { id: true, partnerId: true, country: true } });
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: centre.country }, select: { payoutHoldDays: true } });
    return { centre, holdDays: Math.max(country.payoutHoldDays, 0) };
  }

  /** Earned inside the payout hold: credits to the account in the last `holdDays` days. */
  private async held(accountId: string, holdDays: number, db: Pick<Prisma.TransactionClient, 'ledgerPosting'> = this.prisma) {
    if (holdDays <= 0) return 0n;
    const recent = await db.ledgerPosting.aggregate({ where: { accountId, amountMinor: { lt: 0n }, entry: { createdAt: { gt: new Date(Date.now() - holdDays * dayMs) } } }, _sum: { amountMinor: true } });
    return -(recent._sum.amountMinor ?? 0n);
  }

  /** The owner's earnings: each currency's balance, what is held and what can move to payouts, the latest lines, and this centre's totals. */
  async earnings(customer: CustomerWithStore, centreId: string) {
    const { centre, holdDays } = await this.owner(customer, centreId);
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { kind: 'connect_centre_earnings', customerId: centre.partnerId }, orderBy: [{ mode: 'asc' }, { currency: 'asc' }] });
    const balances = await Promise.all(
      accounts.map(async account => {
        const held = await this.held(account.id, holdDays);
        const available = account.balanceMinor > held ? account.balanceMinor - held : 0n;
        return { mode: account.mode, currency: account.currency, balance: minor(account.balanceMinor), held: minor(account.balanceMinor - available), available: minor(available) };
      }),
    );
    const postings = accounts.length
      ? await this.prisma.ledgerPosting.findMany({ where: { accountId: { in: accounts.map(account => account.id) } }, orderBy: { entry: { createdAt: 'desc' } }, take: 50, include: { entry: { select: { type: true, description: true, createdAt: true } }, account: { select: { mode: true, currency: true } } } })
      : [];
    const handedOver = await this.prisma.classifiedOrder.aggregate({ where: { connectCentreId: centreId, status: 'released' }, _count: true, _sum: { centreShareMinor: true } });
    return {
      object: 'connect_earnings' as const,
      hold_days: holdDays,
      accounts: balances,
      lines: postings.map(posting => ({
        id: posting.id,
        kind: posting.amountMinor < 0n ? ('earned' as const) : ('moved' as const),
        description: posting.entry.description,
        amount: minor(posting.amountMinor < 0n ? -posting.amountMinor : posting.amountMinor),
        mode: posting.account.mode,
        currency: posting.account.currency,
        created_at: posting.entry.createdAt.toISOString(),
      })),
      centre: { handed_over: handedOver._count, connect_fees: minor(handedOver._sum.centreShareMinor ?? 0n) },
    };
  }

  /** Moves earnings past the payout hold into the owner's payouts, from where udozo.com pays them to their bank. */
  async move(customer: CustomerWithStore, centreId: string, input: { mode: LedgerMode; currency: string; amount: number }) {
    const { centre, holdDays } = await this.owner(customer, centreId);
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw invalid('parameter_invalid', 'Give the amount in minor units, more than 0.', 'amount');
    const amount = BigInt(input.amount);
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'connect_centre_earnings', customerId: centre.partnerId, mode: input.mode, currency: input.currency } });
    if (!account) throw invalid('parameter_invalid', 'There are no earnings in this currency.', 'currency');
    const payoutsId = await this.ledger.accountId(input.mode, { kind: 'customer_withdrawable', currency: input.currency, customerId: centre.partnerId });
    await this.prisma.$transaction(async tx => {
      const balances = await this.ledger.lockBalances(tx, [account.id, payoutsId]);
      const available = (balances.get(account.id) ?? 0n) - (await this.held(account.id, holdDays, tx));
      if (amount > available) {
        throw new ApiError(
          HttpStatus.PAYMENT_REQUIRED,
          'invalid_request_error',
          'insufficient_funds',
          `You can move up to ${formatMoney(available > 0n ? available : 0n, input.currency)} now: earnings can move ${holdDays} days after they are earned.`,
          'amount',
        );
      }
      await this.ledger.write(tx, {
        mode: input.mode,
        type: 'connect_earnings_move',
        reference: `connect_earnings:${randomUUID()}`,
        description: 'Udozo Connect earnings moved to your payouts',
        metadata: { centre_id: centre.id },
        postings: [
          { accountId: account.id, kind: 'connect_centre_earnings', amount },
          { accountId: payoutsId, kind: 'customer_withdrawable', amount: -amount },
        ],
      });
    });
    return this.earnings(customer, centreId);
  }
}
