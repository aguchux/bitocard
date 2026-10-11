import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type AccountKind, type Hold, type JournalEntry, type LedgerAccount, type LedgerMode, type LedgerPosting, Prisma } from '../generated/prisma/client.js';
import { FxService } from '../fx/fx.service.js';
import { allowanceStatus } from './allowance.service.js';
import { type AccountRef, insufficientFunds, LedgerService } from './ledger.service.js';
import { minor } from './mode.js';

const day = 24 * 60 * 60 * 1000;

/** Reseller accounts that count towards money the reseller can spend now. */
const spendable = new Set<AccountKind>(['reseller_funding', 'reseller_earnings']);

type EntryWithPostings = JournalEntry & { postings: Array<LedgerPosting & { account: LedgerAccount }> };

/** The US dollar wallet sits beside the country's: every reseller and customer has both. */
export const usd = 'USD';

/** The wallets an account holds: its country's currency first, then US dollars (one, where the country uses dollars). */
export const walletCurrencies = (local: string | null | undefined) => (local && local !== usd ? [local, usd] : [usd]);

export const currencyNotHeld = (currency: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'currency_unsupported', `There is no ${currency} wallet: wallets are in US dollars and your country's currency.`, 'currency');

/**
 * One ledger entry as a wallet transaction, in one currency (the first it touched in the reseller's balances unless
 * given): a conversion between the wallets touches both, so it is shown in each wallet with its own side.
 */
export function presentEntry(entry: EntryWithPostings, resellerId: string, inCurrency?: string) {
  const mine = entry.postings.filter(p => p.account.resellerId === resellerId);
  const currency = inCurrency ?? mine.find(p => spendable.has(p.account.kind))?.account.currency ?? mine[0]?.account.currency ?? null;
  // The startup allowance is in US dollars whatever the wallet: always reported (as `allowance_change`).
  const own = mine.filter(p => p.account.currency === currency || p.account.kind === 'reseller_allowance');
  // Reseller accounts grow with credits (negative postings), so the change to a balance is minus the posting.
  const change = (kinds: (kind: AccountKind) => boolean) => own.filter(p => kinds(p.account.kind)).reduce((sum, p) => sum - p.amountMinor, 0n);
  return {
    object: 'wallet_transaction' as const,
    id: entry.id,
    type: entry.type,
    description: entry.description,
    currency,
    /** Change to the money available to spend. */
    amount: minor(change(kind => spendable.has(kind))),
    /** Change to money held for orders in progress. */
    reserved_change: minor(change(kind => kind === 'reseller_reserved')),
    /** Change to earnings still inside the payout hold. */
    earnings_on_hold_change: minor(change(kind => kind === 'reseller_earnings_held')),
    /** Change to the startup allowance (US dollars, cents); never part of `amount`. */
    allowance_change: minor(change(kind => kind === 'reseller_allowance')),
    /** For BitoCard fees (`platform_fee`, `platform_fee_refund`, and the hold returned before a fee): the fee and what it was on. */
    fee: feeLink(entry),
    /** A conversion between the wallets: what left one and arrived in the other. */
    conversion: conversionLink(entry),
    created_at: entry.createdAt.toISOString(),
  };
}

function conversionLink(entry: JournalEntry) {
  const meta = (entry.metadata ?? {}) as { conversion?: { from: { amount: string; currency: string }; to: { amount: string; currency: string }; rate: string } };
  const c = meta.conversion;
  return c ? { from: { amount: Number(c.from.amount), currency: c.from.currency }, to: { amount: Number(c.to.amount), currency: c.to.currency }, rate: c.rate } : null;
}

function feeLink(entry: JournalEntry) {
  const meta = (entry.metadata ?? {}) as { fee_charge_id?: string; source_type?: string; source_id?: string };
  return meta.fee_charge_id ? { id: meta.fee_charge_id, source: meta.source_type ? { type: meta.source_type, id: meta.source_id ?? null } : null } : null;
}

/**
 * A reseller's wallets: what they can spend, what is held for orders, and their earnings. One per mode and currency:
 * their country's currency (where orders, earnings and withdrawals are) and US dollars (topped up in dollars, and
 * converted into the country wallet when needed: by hand, or by an order the country wallet cannot cover).
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly fx: FxService,
  ) {}

  /** The reseller's trading currency and country. Wallets need the business country to be set. */
  async currencyOf(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { countryRef: true } });
    if (!reseller.countryRef) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_required', 'Set your business country before using your wallet.');
    }
    return { reseller, country: reseller.countryRef, currency: reseller.countryRef.currency };
  }

  /** One of the reseller's wallet currencies (their country's by default); any other is refused. */
  async walletCurrency(resellerId: string, asked?: string | null) {
    const held = await this.currencyOf(resellerId);
    const currency = asked ? asked.toUpperCase() : held.currency;
    if (!walletCurrencies(held.currency).includes(currency)) throw currencyNotHeld(currency);
    return { ...held, currency, local: held.currency };
  }

  async wallet(resellerId: string, mode: LedgerMode, asked?: string | null) {
    const { currency, country, local } = await this.walletCurrency(resellerId, asked);
    const all = await this.prisma.ledgerAccount.findMany({ where: { resellerId, mode } });
    const accounts = all.filter(a => a.currency === currency);
    const balance = (kind: AccountKind) => accounts.find(a => a.kind === kind)?.balanceMinor ?? 0n;
    const sum = (code: string, kinds: AccountKind[]) => all.filter(a => a.currency === code && kinds.includes(a.kind)).reduce((total, a) => total + a.balanceMinor, 0n);
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
      /** Withdrawals are from the country wallet only (null on the US dollar wallet). */
      minimum_withdrawal: currency === local ? minor(country.minWithdrawalMinor) : null,
      /** The startup allowance (live only; null if never granted). Not cash: never part of `available`. */
      startup_allowance: mode === 'live' ? await allowanceStatus(this.prisma, resellerId) : null,
      /** Every wallet the reseller holds: their country's currency first, then US dollars. */
      wallets: walletCurrencies(local).map(code => ({
        currency: code,
        primary: code === local,
        available: minor(sum(code, ['reseller_funding', 'reseller_earnings'])),
        reserved: minor(sum(code, ['reseller_reserved'])),
      })),
    };
  }

  /** Newest first; with `currency`, only that wallet's (a conversion shows in both, each with its own side). */
  async transactions(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string; currency?: string }) {
    const limit = page.limit ?? 25;
    const currency = page.currency ? (await this.walletCurrency(resellerId, page.currency)).currency : undefined;
    const entries = await this.prisma.journalEntry.findMany({
      where: { resellerId, mode, ...(currency ? { postings: { some: { account: { resellerId, currency } } } } : {}) },
      include: { postings: { include: { account: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: entries.slice(0, limit).map(entry => presentEntry(entry, resellerId, currency)), has_more: entries.length > limit };
  }

  /** Reseller account reference in the reseller's currency. */
  ref(resellerId: string, currency: string, kind: AccountKind): AccountRef {
    return { kind, currency, resellerId };
  }

  /**
   * Holds wholesale cost for an order: from topped-up funds first, then earnings; or, for a customer's checkout
   * (`from: 'customer'`), from what the customer paid. Concurrent holds cannot overspend. Repeating the same reference
   * returns the existing hold.
   */
  async hold(input: { resellerId: string; mode: LedgerMode; amount: bigint; reference: string; description: string; from?: 'wallet' | 'customer' }) {
    const existing = await this.prisma.hold.findUnique({ where: { reference: input.reference } });
    if (existing) return existing;
    if (input.amount <= 0n) throw new Error('Hold amount must be positive');
    const { currency } = await this.currencyOf(input.resellerId);
    const fundingId = await this.ledger.accountId(input.mode, this.ref(input.resellerId, currency, 'reseller_funding'));
    const earningsId = await this.ledger.accountId(input.mode, this.ref(input.resellerId, currency, 'reseller_earnings'));
    const reservedId = await this.ledger.accountId(input.mode, this.ref(input.resellerId, currency, 'reseller_reserved'));
    if (input.from === 'customer') return this.holdFromCustomer({ ...input, currency, reservedId });
    await this.coverFromUsd({ ...input, currency, fundingId, earningsId });

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

  /**
   * Before a hold the country wallet cannot cover: the shortfall is converted from the US dollar wallet's topped-up
   * funds, if they cover it, at BitoCard's rate (once per hold reference). Otherwise nothing is converted and the hold
   * is refused as before. The converted money stays in the country wallet if the hold then fails.
   */
  private async coverFromUsd(input: { resellerId: string; mode: LedgerMode; amount: bigint; reference: string; currency: string; fundingId: string; earningsId: string }) {
    if (input.currency === usd) return;
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { id: { in: [input.fundingId, input.earningsId] } }, select: { balanceMinor: true } });
    const shortfall = input.amount - accounts.reduce((total, a) => total + a.balanceMinor, 0n);
    if (shortfall <= 0n) return;
    const dollars = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'reseller_funding', resellerId: input.resellerId, mode: input.mode, currency: usd }, select: { balanceMinor: true } });
    if (!dollars || dollars.balanceMinor <= 0n) return;
    const cover = await this.fx.usdCovering(shortfall, input.currency).catch(() => null);
    if (!cover || cover.amount > dollars.balanceMinor) return;
    await this.convert(input.resellerId, input.mode, { from: usd, to: input.currency, amount: Number(cover.amount), reference: `conversion:hold:${input.reference}`, reason: 'for an order' }).catch(() => undefined);
  }

  /**
   * Moves money between the reseller's wallets at BitoCard's rate (`FxService.exchange`): topped-up funds first, then
   * withdrawable earnings, from one; topped-up funds in the other. With `preview` nothing moves. Earnings converted
   * to US dollars become topped-up funds (spendable, not withdrawable).
   */
  async convert(resellerId: string, mode: LedgerMode, input: { from: string; to: string; amount: number; preview?: boolean; reference?: string; reason?: string }) {
    const { local } = await this.walletCurrency(resellerId, input.from);
    const from = input.from.toUpperCase();
    const to = input.to.toUpperCase();
    if (!walletCurrencies(local).includes(to)) throw currencyNotHeld(to);
    if (from === to) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose two different wallets.', 'to');
    const amount = BigInt(input.amount);
    const out = await this.fx.exchange(amount, from, to);
    if (out.amount <= 0n) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'amount_too_small', 'This amount is too small to convert.', 'amount');
    const quote = {
      object: 'wallet_conversion' as const,
      mode,
      from: { amount: minor(amount), currency: from },
      to: { amount: minor(out.amount), currency: to },
      /** Units of the country's currency per US dollar. */
      rate: out.rate.toDecimalPlaces(6).toString(),
    };
    if (input.preview || (input.reference && (await this.prisma.journalEntry.findUnique({ where: { reference: input.reference } })))) return { ...quote, id: null, created_at: null };

    const fundingId = await this.ledger.accountId(mode, this.ref(resellerId, from, 'reseller_funding'));
    const earningsId = await this.ledger.accountId(mode, this.ref(resellerId, from, 'reseller_earnings'));
    const toId = await this.ledger.accountId(mode, this.ref(resellerId, to, 'reseller_funding'));
    const exchangeFrom = await this.ledger.accountId(mode, { kind: 'currency_exchange', currency: from });
    const exchangeTo = await this.ledger.accountId(mode, { kind: 'currency_exchange', currency: to });
    const label = (code: string) => (code === usd ? 'US dollar' : code);
    const entry = await this.prisma.$transaction(async tx => {
      const balances = await this.ledger.lockBalances(tx, [fundingId, earningsId]);
      const funding = balances.get(fundingId) ?? 0n;
      const earnings = balances.get(earningsId) ?? 0n;
      if (funding + earnings < amount) throw insufficientFunds();
      const fromFunding = funding < amount ? funding : amount;
      const fromEarnings = amount - fromFunding;
      return this.ledger.write(tx, {
        mode,
        type: 'conversion',
        reference: input.reference ?? `conversion:${randomUUID()}`,
        resellerId,
        description: `Converted from your ${label(from)} wallet to your ${label(to)} wallet${input.reason ? ` ${input.reason}` : ''}`,
        metadata: { conversion: { from: { amount: String(amount), currency: from }, to: { amount: String(out.amount), currency: to }, rate: quote.rate } },
        postings: [
          ...(fromFunding > 0n ? [{ accountId: fundingId, kind: 'reseller_funding' as const, amount: fromFunding }] : []),
          ...(fromEarnings > 0n ? [{ accountId: earningsId, kind: 'reseller_earnings' as const, amount: fromEarnings }] : []),
          { accountId: exchangeFrom, kind: 'currency_exchange' as const, amount: -amount },
          { accountId: exchangeTo, kind: 'currency_exchange' as const, amount: out.amount },
          { accountId: toId, kind: 'reseller_funding' as const, amount: -out.amount },
        ],
      });
    });
    return { ...quote, id: entry.id, created_at: entry.createdAt.toISOString() };
  }

  private async holdFromCustomer(input: { resellerId: string; mode: LedgerMode; amount: bigint; reference: string; description: string; currency: string; reservedId: string }) {
    const paidId = await this.ledger.accountId(input.mode, this.ref(input.resellerId, input.currency, 'customer_payments'));
    const run = this.prisma.$transaction(async tx => {
      const balances = await this.ledger.lockBalances(tx, [paidId]);
      if ((balances.get(paidId) ?? 0n) < input.amount) throw insufficientFunds();
      const hold = await tx.hold.create({
        data: {
          resellerId: input.resellerId,
          mode: input.mode,
          currency: input.currency,
          amountMinor: input.amount,
          fromFundingMinor: 0n,
          fromEarningsMinor: 0n,
          fromCustomerMinor: input.amount,
          reference: input.reference,
        },
      });
      await this.ledger.write(tx, {
        mode: input.mode,
        type: 'hold',
        reference: `hold:${hold.id}`,
        resellerId: input.resellerId,
        description: input.description,
        metadata: { hold_id: hold.id, reference: input.reference },
        postings: [
          { accountId: paidId, kind: 'customer_payments' as const, amount: input.amount },
          { accountId: input.reservedId, kind: 'reseller_reserved' as const, amount: -input.amount },
        ],
      });
      return hold;
    });
    try {
      return await run;
    } catch (error) {
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
        ...(hold.fromCustomerMinor > 0n ? [{ account: this.ref(hold.resellerId, hold.currency, 'customer_payments'), credit: hold.fromCustomerMinor }] : []),
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

  /** Takes a held amount into one platform account (for example a gateway's balance, for a lost card dispute). Repeating it does nothing. */
  async captureHoldTo(holdId: string, description: string, account: AccountRef) {
    return this.resolveHold(holdId, 'captured', hold => ({
      type: 'hold_capture',
      description,
      lines: [
        { account: this.ref(hold.resellerId, hold.currency, 'reseller_reserved'), debit: hold.amountMinor },
        { account, credit: hold.amountMinor },
      ],
    }));
  }

  /**
   * Takes part of a held amount as BitoCard revenue and returns the rest to where it came from (topped-up funds first,
   * then earnings): for charges priced only after the fact, such as an SMS. Never takes more than was held. Repeating
   * it does nothing.
   */
  async settleHold(holdId: string, charge: bigint, description: string) {
    return this.resolveHold(holdId, 'captured', hold => {
      const taken = charge < 0n ? 0n : charge > hold.amountMinor ? hold.amountMinor : charge;
      const rest = hold.amountMinor - taken;
      // Return funding first (it is spent last), then earnings.
      const toFunding = rest < hold.fromFundingMinor ? rest : hold.fromFundingMinor;
      const toEarnings = rest - toFunding;
      return {
        type: 'hold_capture',
        description,
        lines: [
          { account: this.ref(hold.resellerId, hold.currency, 'reseller_reserved'), debit: hold.amountMinor },
          ...(taken > 0n ? [{ account: { kind: 'platform_revenue' as const, currency: hold.currency }, credit: taken }] : []),
          ...(toFunding > 0n ? [{ account: this.ref(hold.resellerId, hold.currency, 'reseller_funding'), credit: toFunding }] : []),
          ...(toEarnings > 0n ? [{ account: this.ref(hold.resellerId, hold.currency, 'reseller_earnings'), credit: toEarnings }] : []),
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
  /**
   * A finance adjustment. With `reference` (a dispute's credit, for example) it is posted once: running it again
   * changes nothing.
   */
  async adjust(actorId: string | null, input: { resellerId: string; mode: LedgerMode; balance: 'funding' | 'earnings'; amount: number; reason: string; reference?: string }) {
    if (input.reference && (await this.prisma.journalEntry.findUnique({ where: { reference: input.reference } }))) return this.wallet(input.resellerId, input.mode);
    const { currency } = await this.currencyOf(input.resellerId);
    const amount = BigInt(input.amount);
    const resellerAccount = this.ref(input.resellerId, currency, input.balance === 'funding' ? 'reseller_funding' : 'reseller_earnings');
    const counterpart: AccountRef = { kind: 'adjustments', currency };
    const before = await this.wallet(input.resellerId, input.mode);
    const entry = await this.ledger.post({
      mode: input.mode,
      type: 'adjustment',
      reference: input.reference ?? `adjustment:${randomUUID()}`,
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
