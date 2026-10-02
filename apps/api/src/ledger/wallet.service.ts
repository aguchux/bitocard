import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/errors/api-error';
import { PrismaService } from '../database/prisma.service';
import { type AccountKind, type Hold, type JournalEntry, type LedgerAccount, type LedgerMode, type LedgerPosting, Prisma } from '../generated/prisma/client';
import { type AccountRef, insufficientFunds, LedgerService } from './ledger.service';
import { minor } from './mode';

const day = 24 * 60 * 60 * 1000;

/** Reseller accounts that count towards money the reseller can spend now. */
const spendable = new Set<AccountKind>(['reseller_funding', 'reseller_earnings']);

type EntryWithPostings = JournalEntry & { postings: Array<LedgerPosting & { account: LedgerAccount }> };

export function presentEntry(entry: EntryWithPostings, resellerId: string) {
  const own = entry.postings.filter(p => p.account.resellerId === resellerId);
  // Reseller accounts grow with credits (negative postings), so the change to a balance is minus the posting.
  const change = (kinds: (kind: AccountKind) => boolean) => own.filter(p => kinds(p.account.kind)).reduce((sum, p) => sum - p.amountMinor, 0n);
  return {
    object: 'wallet_transaction' as const,
    id: entry.id,
    type: entry.type,
    description: entry.description,
    currency: own[0]?.account.currency ?? null,
    /** Change to the money available to spend. */
    amount: minor(change(kind => spendable.has(kind))),
    /** Change to money held for orders in progress. */
    reserved_change: minor(change(kind => kind === 'reseller_reserved')),
    /** Change to earnings still inside the payout hold. */
    earnings_on_hold_change: minor(change(kind => kind === 'reseller_earnings_held')),
    created_at: entry.createdAt.toISOString(),
  };
}

/** A reseller's wallet: what they can spend, what is held for orders, and their earnings. One per mode, in their country's currency. */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** The reseller's trading currency and country. Wallets need the business country to be set. */
  async currencyOf(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { countryRef: true } });
    if (!reseller.countryRef) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_required', 'Set your business country before using your wallet.');
    }
    return { reseller, country: reseller.countryRef, currency: reseller.countryRef.currency };
  }

  async wallet(resellerId: string, mode: LedgerMode) {
    const { currency, country } = await this.currencyOf(resellerId);
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { resellerId, mode, currency } });
    const balance = (kind: AccountKind) => accounts.find(a => a.kind === kind)?.balanceMinor ?? 0n;
    const nextLot = await this.prisma.earningsLot.findFirst({ where: { resellerId, mode, releasedAt: null }, orderBy: { releaseAt: 'asc' } });
    return {
      object: 'wallet' as const,
      mode,
      currency,
      /** Can pay wholesale cost now: topped-up funds plus withdrawable earnings. */
      available: minor(balance('reseller_funding') + balance('reseller_earnings')),
      /** Held for orders in progress. */
      reserved: minor(balance('reseller_reserved')),
      earnings: {
        withdrawable: minor(balance('reseller_earnings')),
        on_hold: minor(balance('reseller_earnings_held')),
        next_release_at: nextLot?.releaseAt.toISOString() ?? null,
      },
      payouts_in_progress: minor(balance('reseller_payouts_pending')),
      minimum_withdrawal: minor(country.minWithdrawalMinor),
    };
  }

  async transactions(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const entries = await this.prisma.journalEntry.findMany({
      where: { resellerId, mode },
      include: { postings: { include: { account: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: entries.slice(0, limit).map(entry => presentEntry(entry, resellerId)), has_more: entries.length > limit };
  }

  /** Reseller account reference in the reseller's currency. */
  ref(resellerId: string, currency: string, kind: AccountKind): AccountRef {
    return { kind, currency, resellerId };
  }

  /**
   * Holds wholesale cost for an order: from topped-up funds first, then earnings. Concurrent holds cannot overspend.
   * Repeating the same reference returns the existing hold.
   */
  async hold(input: { resellerId: string; mode: LedgerMode; amount: bigint; reference: string; description: string }) {
    const existing = await this.prisma.hold.findUnique({ where: { reference: input.reference } });
    if (existing) return existing;
    if (input.amount <= 0n) throw new Error('Hold amount must be positive');
    const { currency } = await this.currencyOf(input.resellerId);
    const fundingId = await this.ledger.accountId(input.mode, this.ref(input.resellerId, currency, 'reseller_funding'));
    const earningsId = await this.ledger.accountId(input.mode, this.ref(input.resellerId, currency, 'reseller_earnings'));
    const reservedId = await this.ledger.accountId(input.mode, this.ref(input.resellerId, currency, 'reseller_reserved'));

    const run = this.prisma.$transaction(async tx => {
      const balances = await this.ledger.lockBalances(tx, [fundingId, earningsId]);
      const funding = balances.get(fundingId) ?? 0n;
      const earnings = balances.get(earningsId) ?? 0n;
      if (funding + earnings < input.amount) throw insufficientFunds();
      const fromFunding = funding < input.amount ? funding : input.amount;
      const fromEarnings = input.amount - fromFunding;
      const hold = await tx.hold.create({
        data: { resellerId: input.resellerId, mode: input.mode, currency, amountMinor: input.amount, fromFundingMinor: fromFunding, fromEarningsMinor: fromEarnings, reference: input.reference },
      });
      // Accounts already exist, so the entry is built here rather than with prepare(), which would query outside the transaction.
      await this.ledger.write(tx, {
        mode: input.mode,
        type: 'hold',
        reference: `hold:${hold.id}`,
        resellerId: input.resellerId,
        description: input.description,
        metadata: { hold_id: hold.id, reference: input.reference },
        postings: [
          ...(fromFunding > 0n ? [{ accountId: fundingId, kind: 'reseller_funding' as const, amount: fromFunding }] : []),
          ...(fromEarnings > 0n ? [{ accountId: earningsId, kind: 'reseller_earnings' as const, amount: fromEarnings }] : []),
          { accountId: reservedId, kind: 'reseller_reserved' as const, amount: -input.amount },
        ],
      });
      return hold;
    });
    try {
      return await run;
    } catch (error) {
      // The same reference held at the same moment by another request: return that hold.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.hold.findUniqueOrThrow({ where: { reference: input.reference } });
      throw error;
    }
  }

  /** Returns a held amount to where it came from (the order failed without delivery). Repeating it does nothing. */
  async releaseHold(holdId: string, description = 'Order did not complete: funds released') {
    return this.resolveHold(holdId, 'released', hold => ({
      type: 'hold_release',
      description,
      lines: [
        { account: this.ref(hold.resellerId, hold.currency, 'reseller_reserved'), debit: hold.amountMinor },
        ...(hold.fromFundingMinor > 0n ? [{ account: this.ref(hold.resellerId, hold.currency, 'reseller_funding'), credit: hold.fromFundingMinor }] : []),
        ...(hold.fromEarningsMinor > 0n ? [{ account: this.ref(hold.resellerId, hold.currency, 'reseller_earnings'), credit: hold.fromEarningsMinor }] : []),
      ],
    }));
  }

  /**
   * Takes a held amount (the order was delivered). By default it is all BitoCard revenue; `split` sends parts to
   * other platform accounts (for example tax payable), and the rest is revenue. Repeating it does nothing.
   */
  async captureHold(holdId: string, description = 'Order delivered: wholesale cost paid', split: Array<{ kind: AccountKind; amount: bigint }> = []) {
    return this.resolveHold(holdId, 'captured', hold => {
      const parts = split.filter(part => part.amount > 0n);
      const revenue = hold.amountMinor - parts.reduce((sum, part) => sum + part.amount, 0n);
      return {
        type: 'hold_capture',
        description,
        lines: [
          { account: this.ref(hold.resellerId, hold.currency, 'reseller_reserved'), debit: hold.amountMinor },
          ...(revenue > 0n ? [{ account: { kind: 'platform_revenue' as const, currency: hold.currency }, credit: revenue }] : []),
          ...parts.map(part => ({ account: { kind: part.kind, currency: hold.currency }, credit: part.amount })),
        ],
      };
    });
  }

  private async resolveHold(
    holdId: string,
    status: 'released' | 'captured',
    build: (hold: Hold) => { type: string; description: string; lines: Array<{ account: AccountRef; debit?: bigint; credit?: bigint }> },
  ) {
    const hold = await this.prisma.hold.findUniqueOrThrow({ where: { id: holdId } });
    if (hold.status !== 'held') return hold;
    const spec = build(hold);
    const entry = await this.ledger.prepare({ mode: hold.mode, reference: `${spec.type}:${hold.id}`, resellerId: hold.resellerId, metadata: { hold_id: hold.id }, ...spec });
    return this.prisma.$transaction(async tx => {
      // Only one of release and capture can win, even if both run at once.
      const claimed = await tx.hold.updateMany({ where: { id: hold.id, status: 'held' }, data: { status, resolvedAt: new Date() } });
      if (claimed.count === 0) return tx.hold.findUniqueOrThrow({ where: { id: hold.id } });
      await this.ledger.write(tx, entry);
      return tx.hold.findUniqueOrThrow({ where: { id: hold.id } });
    });
  }

  /**
   * Credits a sale's profit to the reseller, withdrawable after the country's payout hold.
   * `source` is the account the profit comes from (for example the customer's payment).
   */
  async creditEarnings(input: { resellerId: string; mode: LedgerMode; amount: bigint; reference: string; description: string; source: AccountRef }) {
    const existing = await this.prisma.earningsLot.findUnique({ where: { reference: input.reference } });
    if (existing) return existing;
    const { currency, country } = await this.currencyOf(input.resellerId);
    if (input.source.currency !== currency) throw new Error('Earnings must be in the reseller currency');
    const entry = await this.ledger.prepare({
      mode: input.mode,
      type: 'earnings',
      reference: `earnings:${input.reference}`,
      resellerId: input.resellerId,
      description: input.description,
      lines: [
        { account: input.source, debit: input.amount },
        { account: this.ref(input.resellerId, currency, 'reseller_earnings_held'), credit: input.amount },
      ],
    });
    return this.prisma.$transaction(async tx => {
      const lot = await tx.earningsLot.create({
        data: {
          resellerId: input.resellerId,
          mode: input.mode,
          currency,
          amountMinor: input.amount,
          reference: input.reference,
          releaseAt: new Date(Date.now() + country.payoutHoldDays * day),
        },
      });
      await this.ledger.write(tx, entry);
      return lot;
    });
  }

  /** Moves earnings whose payout hold has ended to withdrawable earnings. Run on a schedule. */
  async releaseDueEarnings(now = new Date(), batch = 500) {
    const due = await this.prisma.earningsLot.findMany({ where: { releasedAt: null, releaseAt: { lte: now } }, orderBy: { releaseAt: 'asc' }, take: batch });
    let released = 0;
    for (const lot of due) {
      const entry = await this.ledger.prepare({
        mode: lot.mode,
        type: 'earnings_release',
        reference: `earnings_release:${lot.id}`,
        resellerId: lot.resellerId,
        description: 'Earnings are now withdrawable',
        metadata: { lot_id: lot.id },
        lines: [
          { account: this.ref(lot.resellerId, lot.currency, 'reseller_earnings_held'), debit: lot.amountMinor },
          { account: this.ref(lot.resellerId, lot.currency, 'reseller_earnings'), credit: lot.amountMinor },
        ],
      });
      const done = await this.prisma.$transaction(async tx => {
        const claimed = await tx.earningsLot.updateMany({ where: { id: lot.id, releasedAt: null }, data: { releasedAt: now } });
        if (claimed.count === 0) return false;
        await this.ledger.write(tx, entry);
        return true;
      });
      if (done) released += 1;
    }
    return { released };
  }

  /** Admin correction with a recorded reason. Positive adds to the wallet, negative takes from it. */
  async adjust(actorId: string | null, input: { resellerId: string; mode: LedgerMode; balance: 'funding' | 'earnings'; amount: number; reason: string }) {
    const { currency } = await this.currencyOf(input.resellerId);
    const amount = BigInt(input.amount);
    const resellerAccount = this.ref(input.resellerId, currency, input.balance === 'funding' ? 'reseller_funding' : 'reseller_earnings');
    const counterpart: AccountRef = { kind: 'adjustments', currency };
    const before = await this.wallet(input.resellerId, input.mode);
    const entry = await this.ledger.post({
      mode: input.mode,
      type: 'adjustment',
      reference: `adjustment:${randomUUID()}`,
      resellerId: input.resellerId,
      description: `Adjustment: ${input.reason}`,
      metadata: { actor_id: actorId, reason: input.reason },
      lines:
        amount > 0n
          ? [{ account: counterpart, debit: amount }, { account: resellerAccount, credit: amount }]
          : [{ account: resellerAccount, debit: -amount }, { account: counterpart, credit: -amount }],
    });
    const after = await this.wallet(input.resellerId, input.mode);
    await this.audit.record({ actorId, action: 'wallet.adjusted', targetType: 'reseller', targetId: input.resellerId, before, after: { ...after, entry_id: entry.id, reason: input.reason } });
    return after;
  }
}
