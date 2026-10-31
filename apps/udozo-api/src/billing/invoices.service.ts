import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import type { AccountKind, Invoice, InvoiceLine, Prisma } from '../generated/prisma/client.js';
import { LedgerService, type PreparedEntry, type Tx } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { freePlanCode } from '../plans/features.js';

/** The credit limit's steps, in US cents: raised one at a time, each after a full month's invoice is paid in full. */
export const creditSteps = [1000, 2500, 5000, 10000] as const;
export const maxCreditCents = 10000;
/** Days after an invoice closes that it is due (sooner when one of the store's subscriptions renews first). */
export const invoiceDueDays = 7;
const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';
const day = 24 * 60 * 60 * 1000;

export type InvoiceLineKind = 'subscription' | 'domain' | 'platform_fee' | 'usage';

/** The calendar month (UTC) a moment falls in. */
export function monthOf(at: Date) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start, end };
}

/** The next step up from a limit (null at the top). An admin's value between steps rises to the next one. */
export const nextStep = (cents: number) => creditSteps.find(step => step > cents) ?? null;
/** One step down; below the first step the limit is zero. */
export const previousStep = (cents: number) => [...creditSteps].reverse().find(step => step < cents) ?? 0;

export const invoiceNumber = (number: number) => `INV-${String(number).padStart(6, '0')}`;

const creditLimitReached = (currency: string) =>
  new ApiError(
    HttpStatus.PAYMENT_REQUIRED,
    'invalid_request_error',
    'credit_limit_reached',
    `You have reached your credit limit in ${currency}. Top up your wallet to pay what you owe; billable usage resumes once it is paid.`,
  );

export function presentInvoiceLine(line: InvoiceLine) {
  return {
    object: 'invoice_line' as const,
    id: line.id,
    kind: line.kind,
    description: line.description,
    amount: Number(line.amountMinor),
    paid: Number(line.paidMinor),
    owed: Number(line.amountMinor - line.paidMinor),
    created_at: line.createdAt.toISOString(),
  };
}

export function presentInvoice(invoice: Invoice & { lines?: InvoiceLine[] }) {
  return {
    object: 'invoice' as const,
    id: invoice.id,
    number: invoiceNumber(invoice.number),
    store_id: invoice.storeId,
    currency: invoice.currency,
    period_start: invoice.periodStart.toISOString(),
    period_end: invoice.periodEnd.toISOString(),
    status: invoice.status,
    total: Number(invoice.totalMinor),
    paid: Number(invoice.paidMinor),
    owed: Number(invoice.totalMinor - invoice.paidMinor),
    closed_at: invoice.closedAt?.toISOString() ?? null,
    due_at: invoice.dueAt?.toISOString() ?? null,
    paid_at: invoice.paidAt?.toISOString() ?? null,
    overdue: Boolean(invoice.overdueAt),
    ...(invoice.lines ? { lines: invoice.lines.map(presentInvoiceLine) } : {}),
  };
}

/**
 * Monthly invoices per store (and one for the account's own usage), live only. Every charge is a line, taken from the
 * wallet when it happens (topped-up funds, then earnings); what the wallet cannot cover is owed (`reseller_owed`, a
 * ledger account of its own, never a negative balance), up to the credit limit. Top-ups pay what is owed first, oldest
 * first. At the limit, billable usage stops until it is paid (`requireCredit`).
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger('Invoices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** The month's invoice for a store (or the account), made on first use. */
  private async invoiceFor(tx: Tx, resellerId: string, storeId: string | null, currency: string, at: Date) {
    const { start, end } = monthOf(at);
    const scopeKey = storeId ?? 'account';
    return tx.invoice.upsert({
      where: { resellerId_scopeKey_currency_periodStart: { resellerId, scopeKey, currency, periodStart: start } },
      create: { resellerId, storeId, scopeKey, currency, periodStart: start, periodEnd: end },
      update: {},
    });
  }

  /**
   * Makes the month's invoice before a transaction uses it: two charges at once both upserting it inside their own
   * transactions could collide on its unique key and fail one of them (Postgres aborts the transaction).
   */
  private async ensureInvoice(resellerId: string, storeId: string | null, currency: string, at: Date) {
    try {
      await this.prisma.$transaction(tx => this.invoiceFor(tx, resellerId, storeId, currency, at));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  private async addLine(tx: Tx, input: { resellerId: string; storeId: string | null; currency: string; kind: InvoiceLineKind; description: string; amount: bigint; paid: bigint; reference: string; at: Date }) {
    if (await tx.invoiceLine.findUnique({ where: { reference: input.reference }, select: { id: true } })) return;
    const invoice = await this.invoiceFor(tx, input.resellerId, input.storeId, input.currency, input.at);
    await tx.invoiceLine.create({ data: { invoiceId: invoice.id, kind: input.kind, description: input.description, amountMinor: input.amount, paidMinor: input.paid, reference: input.reference, createdAt: input.at } });
    await tx.invoice.update({ where: { id: invoice.id }, data: { totalMinor: { increment: input.amount }, paidMinor: { increment: input.paid } } });
  }

  /**
   * Adds a charge the wallet already paid (a subscription, a domain, a fee) to the month's invoice. Once per reference;
   * never throws: the charge has happened, and its line is a record of it.
   */
  async recordPaid(input: { resellerId: string; storeId?: string | null; currency: string; kind: InvoiceLineKind; description: string; amount: bigint; reference: string; at?: Date }) {
    if (input.amount <= 0n) return;
    try {
      await this.ensureInvoice(input.resellerId, input.storeId ?? null, input.currency, input.at ?? new Date());
      await this.prisma.$transaction(tx => this.addLine(tx, { ...input, storeId: input.storeId ?? null, paid: input.amount, at: input.at ?? new Date() }));
    } catch (error) {
      this.logger.error({ err: error, reference: input.reference }, 'Could not add a paid charge to its invoice');
    }
  }

  /** The credit limit in a currency's minor units (zero when it cannot be converted today). */
  private async limitIn(cents: number, currency: string) {
    if (cents <= 0) return 0n;
    if (currency === 'USD') return BigInt(cents);
    try {
      return (await this.fx.chargeForUsdCents(cents, currency)).amount;
    } catch {
      return 0n;
    }
  }

  private accounts(resellerId: string, currency: string) {
    return Promise.all([
      this.ledger.accountId('live', { kind: 'reseller_funding', currency, resellerId }),
      this.ledger.accountId('live', { kind: 'reseller_earnings', currency, resellerId }),
      this.ledger.accountId('live', { kind: 'reseller_owed', currency, resellerId }),
    ]);
  }

  /**
   * Billable usage: takes `amount` from the live wallet (topped-up funds, then earnings) and owes the rest, as long as
   * what is owed stays within the credit limit (`credit_limit_reached` otherwise, nothing taken). One line per reference.
   */
  async charge(input: { resellerId: string; storeId?: string | null; currency: string; kind: InvoiceLineKind; description: string; amount: bigint; reference: string; revenue: AccountKind; force?: boolean }) {
    if (input.amount <= 0n) return { paid: 0n, owed: 0n };
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: input.resellerId }, select: { creditLimitCents: true } });
    const limit = await this.limitIn(reseller.creditLimitCents, input.currency);
    const [funding, earnings, owed] = await this.accounts(input.resellerId, input.currency);
    const revenue = await this.ledger.accountId('live', { kind: input.revenue, currency: input.currency });
    const at = new Date();
    await this.ensureInvoice(input.resellerId, input.storeId ?? null, input.currency, at);
    // Once per reference: a repeat (a retried job, a second notice) answers what the first charge did.
    const already = async () => {
      const line = await this.prisma.invoiceLine.findUnique({ where: { reference: input.reference } });
      return line ? { paid: line.paidMinor, owed: line.amountMinor - line.paidMinor } : null;
    };
    const earlier = await already();
    if (earlier) return earlier;
    try {
      return await this.chargeOnce(input, { funding, earnings, owed, revenue, limit, at });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const done = await already();
      if (done) return done;
      throw error;
    }
  }

  private chargeOnce(
    input: { resellerId: string; storeId?: string | null; currency: string; kind: InvoiceLineKind; description: string; amount: bigint; reference: string; revenue: AccountKind; force?: boolean },
    ids: { funding: string; earnings: string; owed: string; revenue: string; limit: bigint; at: Date },
  ) {
    const { funding, earnings, owed, revenue, limit } = ids;
    return this.prisma.$transaction(async tx => {
      const balances = await this.ledger.lockBalances(tx, [funding, earnings, owed]);
      let left = input.amount;
      const fromFunding = (balances.get(funding) ?? 0n) < left ? (balances.get(funding) ?? 0n) : left;
      left -= fromFunding;
      const fromEarnings = (balances.get(earnings) ?? 0n) < left ? (balances.get(earnings) ?? 0n) : left;
      left -= fromEarnings;
      // `force`: usage already consumed (checked against the limit before it started) is owed even past the limit.
      if (left > 0n && !input.force && (balances.get(owed) ?? 0n) + left > limit) throw creditLimitReached(input.currency);
      const entry: PreparedEntry = {
        mode: 'live',
        type: 'usage_charge',
        reference: input.reference,
        resellerId: input.resellerId,
        description: input.description,
        metadata: { owed: left.toString() },
        postings: [
          ...(fromFunding > 0n ? [{ accountId: funding, kind: 'reseller_funding' as const, amount: fromFunding }] : []),
          ...(fromEarnings > 0n ? [{ accountId: earnings, kind: 'reseller_earnings' as const, amount: fromEarnings }] : []),
          ...(left > 0n ? [{ accountId: owed, kind: 'reseller_owed' as const, amount: left }] : []),
          { accountId: revenue, kind: input.revenue, amount: -input.amount },
        ],
      };
      await this.ledger.write(tx, entry);
      await this.addLine(tx, { ...input, storeId: input.storeId ?? null, paid: input.amount - left, at: ids.at });
      return { paid: input.amount - left, owed: left };
    });
  }

  /** BitoCard's margin on usage for a store (its plan's; Startup's without one) or the account (its plan's). */
  async usageMarginBps(resellerId: string, storeId?: string | null) {
    if (storeId) {
      const subscription = await this.prisma.storeSubscription.findUnique({ where: { storeId }, include: { plan: true } });
      if (subscription) return subscription.plan.usageMarginBps;
      return (await this.prisma.plan.findUnique({ where: { code: freePlanCode } }))?.usageMarginBps ?? 0;
    }
    return (await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { plan: true } })).plan.usageMarginBps;
  }

  /** A cost plus BitoCard's usage margin, rounded up to a whole minor unit. */
  async withMargin(amount: bigint, resellerId: string, storeId?: string | null) {
    const bps = BigInt(await this.usageMarginBps(resellerId, storeId));
    return (amount * (10_000n + bps) + 9_999n) / 10_000n;
  }

  /**
   * Usage BitoCard paid for in US dollars (millionths of one), billed in the reseller's currency at BitoCard's `pay`
   * rate plus the usage margin, rounded up; owed past the credit limit if need be (it has happened). Once per reference;
   * nothing for a cost of zero.
   */
  async chargeUsdUsage(input: { resellerId: string; storeId?: string | null; micros: bigint; description: string; reference: string }) {
    if (input.micros <= 0n) return null;
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: input.resellerId }, select: { house: true, country: true } });
    if (reseller.house) return null;
    const currency = (reseller.country ? (await this.prisma.country.findUnique({ where: { code: reseller.country }, select: { currency: true } }))?.currency : null) ?? 'USD';
    const marked = await this.withMargin(input.micros, input.resellerId, input.storeId);
    // One US cent is 10,000 millionths of a dollar; `pay` is the currency's minor units per US cent.
    const amount = currency === 'USD' ? (marked + 9_999n) / 10_000n : BigInt((await this.fx.rate(currency)).pay.mul(marked.toString()).div(10_000).toDecimalPlaces(0, 0).toFixed(0));
    return this.charge({ resellerId: input.resellerId, storeId: input.storeId, currency, kind: 'usage', description: input.description, amount, reference: input.reference, revenue: 'platform_revenue', force: true });
  }

  /** What the reseller owes in each currency, from the ledger. */
  async owed(resellerId: string) {
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { kind: 'reseller_owed', mode: 'live', resellerId, balanceMinor: { gt: 0 } }, select: { currency: true, balanceMinor: true } });
    return accounts.map(account => ({ currency: account.currency, amount: account.balanceMinor }));
  }

  /** Refuses billable usage while anything owed has reached the credit limit (in its currency). */
  async requireCredit(resellerId: string) {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { creditLimitCents: true, house: true } });
    if (!reseller || reseller.house) return;
    for (const owed of await this.owed(resellerId)) {
      if (owed.amount >= (await this.limitIn(reseller.creditLimitCents, owed.currency))) throw creditLimitReached(owed.currency);
    }
  }

  /**
   * Pays what is owed in a currency from the live wallet: topped-up funds (and earnings when the reseller pays an
   * invoice themselves), oldest line first, or only one invoice's lines. Returns the amount paid.
   */
  async payOwed(resellerId: string, currency: string, options: { earnings?: boolean; invoiceId?: string } = {}) {
    const [funding, earnings, owed] = await this.accounts(resellerId, currency);
    const now = new Date();
    const paid = await this.prisma.$transaction(async tx => {
      const balances = await this.ledger.lockBalances(tx, [funding, earnings, owed]);
      const lines = await tx.invoiceLine.findMany({
        where: { invoice: { resellerId, currency, ...(options.invoiceId ? { id: options.invoiceId } : {}) } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const open = lines.filter(line => line.paidMinor < line.amountMinor);
      const due = open.reduce((sum, line) => sum + line.amountMinor - line.paidMinor, 0n);
      const owedBalance = balances.get(owed) ?? 0n;
      let budget = due < owedBalance ? due : owedBalance;
      const fromFunding = (balances.get(funding) ?? 0n) < budget ? (balances.get(funding) ?? 0n) : budget;
      const fromEarnings = options.earnings ? ((balances.get(earnings) ?? 0n) < budget - fromFunding ? (balances.get(earnings) ?? 0n) : budget - fromFunding) : 0n;
      budget = fromFunding + fromEarnings;
      if (budget <= 0n) return 0n;
      await this.ledger.write(tx, {
        mode: 'live',
        type: 'owed_payment',
        reference: `owed_payment:${randomUUID()}`,
        resellerId,
        description: `Paid what you owed: ${formatMoney(budget, currency)}`,
        postings: [
          ...(fromFunding > 0n ? [{ accountId: funding, kind: 'reseller_funding' as const, amount: fromFunding }] : []),
          ...(fromEarnings > 0n ? [{ accountId: earnings, kind: 'reseller_earnings' as const, amount: fromEarnings }] : []),
          { accountId: owed, kind: 'reseller_owed', amount: -budget },
        ],
      });
      let left = budget;
      const touched = new Map<string, bigint>();
      for (const line of open) {
        if (left <= 0n) break;
        const part = line.amountMinor - line.paidMinor < left ? line.amountMinor - line.paidMinor : left;
        await tx.invoiceLine.update({ where: { id: line.id }, data: { paidMinor: { increment: part } } });
        touched.set(line.invoiceId, (touched.get(line.invoiceId) ?? 0n) + part);
        left -= part;
      }
      for (const [id, part] of touched) {
        const invoice = await tx.invoice.update({ where: { id }, data: { paidMinor: { increment: part } } });
        if (invoice.status === 'closed' && invoice.paidMinor >= invoice.totalMinor) await tx.invoice.update({ where: { id }, data: { status: 'paid', paidAt: now } });
      }
      return budget;
    });
    return paid;
  }

  /** Pays every currency's debt from topped-up funds: after each top-up, and from the `invoices` job. */
  async payFromTopUps(resellerId: string) {
    for (const owed of await this.owed(resellerId)) await this.payOwed(resellerId, owed.currency).catch(error => this.logger.error({ err: error, resellerId }, 'Could not pay what is owed'));
  }

  /**
   * The `invoices` job: closes last month's invoices (paid at once when nothing is owed; due 7 days later, or when the
   * store's subscription renews first), drops the credit limit a step for each invoice that goes past its due date
   * unpaid, and pays what is owed from top-ups.
   */
  async run(now = new Date()) {
    const ended = await this.prisma.invoice.findMany({ where: { status: 'open', periodEnd: { lte: now } }, take: 500 });
    let closed = 0;
    for (const invoice of ended) {
      const renews = invoice.storeId ? await this.prisma.storeSubscription.findUnique({ where: { storeId: invoice.storeId }, select: { renewsAt: true } }) : null;
      const week = new Date(now.getTime() + invoiceDueDays * day);
      const dueAt = renews?.renewsAt && renews.renewsAt > now && renews.renewsAt < week ? renews.renewsAt : week;
      const paid = invoice.paidMinor >= invoice.totalMinor;
      const claimed = await this.prisma.invoice.updateMany({
        where: { id: invoice.id, status: 'open' },
        data: { status: paid ? 'paid' : 'closed', closedAt: now, dueAt, ...(paid ? { paidAt: now } : {}) },
      });
      if (claimed.count === 0) continue;
      closed += 1;
      if (!paid) {
        await this.inbox.reseller(invoice.resellerId, 'invoice.closed', {
          subject: invoice.id,
          title: `${invoiceNumber(invoice.number)}: ${formatMoney(invoice.totalMinor - invoice.paidMinor, invoice.currency)} to pay`,
          body: `Due ${dueAt.toISOString().slice(0, 10)}. Your next top-up pays it, or pay it from your wallet now.`,
          link: `/wallet/invoices/${invoice.id}`,
        });
      }
    }
    const late = await this.prisma.invoice.findMany({ where: { status: 'closed', overdueAt: null, dueAt: { lt: now } }, take: 500 });
    let overdue = 0;
    for (const invoice of late) {
      if (invoice.paidMinor >= invoice.totalMinor) {
        // Paid while it was being closed: it is paid, not overdue.
        await this.prisma.invoice.updateMany({ where: { id: invoice.id, status: 'closed' }, data: { status: 'paid', paidAt: invoice.paidAt ?? now } });
        continue;
      }
      const claimed = await this.prisma.invoice.updateMany({ where: { id: invoice.id, overdueAt: null }, data: { overdueAt: now } });
      if (claimed.count === 0) continue;
      overdue += 1;
      const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: invoice.resellerId }, select: { creditLimitCents: true } });
      const lowered = previousStep(reseller.creditLimitCents);
      await this.prisma.reseller.update({ where: { id: invoice.resellerId }, data: { creditLimitCents: lowered } });
      await this.inbox.reseller(invoice.resellerId, 'invoice.overdue', {
        subject: invoice.id,
        title: `${invoiceNumber(invoice.number)} is overdue`,
        body: `Your credit limit is now ${formatMoney(BigInt(lowered), 'USD')}. Top up to pay ${formatMoney(invoice.totalMinor - invoice.paidMinor, invoice.currency)}.`,
        link: `/wallet/invoices/${invoice.id}`,
      });
    }
    const owing = await this.prisma.ledgerAccount.findMany({ where: { kind: 'reseller_owed', mode: 'live', balanceMinor: { gt: 0 } }, select: { resellerId: true }, distinct: ['resellerId'], take: 500 });
    for (const { resellerId } of owing) if (resellerId) await this.payFromTopUps(resellerId);
    return { closed, overdue, owing: owing.length };
  }

  private async find(resellerId: string, id: string, storeId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, resellerId, ...(storeId ? { OR: [{ storeId }, { storeId: null }] } : {}) },
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!invoice) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such invoice.');
    return invoice;
  }

  async list(resellerId: string, filter: { store_id?: string; status?: string; limit?: number; starting_after?: string }, keyStore?: string) {
    const limit = filter.limit ?? 25;
    const where: Prisma.InvoiceWhereInput = {
      resellerId,
      status: filter.status,
      ...(keyStore ? { OR: [{ storeId: keyStore }, { storeId: null }] } : filter.store_id ? { storeId: filter.store_id } : {}),
    };
    const rows = await this.prisma.invoice.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(invoice => presentInvoice(invoice)), has_more: rows.length > limit };
  }

  async get(resellerId: string, id: string, keyStore?: string) {
    return presentInvoice(await this.find(resellerId, id, keyStore));
  }

  /** Pays what an invoice still owes from the live wallet now (topped-up funds, then earnings). */
  async pay(resellerId: string, id: string) {
    const invoice = await this.find(resellerId, id);
    if (invoice.totalMinor <= invoice.paidMinor) return presentInvoice(invoice);
    const paid = await this.payOwed(resellerId, invoice.currency, { earnings: true, invoiceId: id });
    if (paid === 0n) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'insufficient_funds', 'Your live wallet has nothing available to pay this invoice. Top up first.');
    return presentInvoice(await this.find(resellerId, id));
  }

  /** Whether the reseller may raise the limit now: nothing owed, and a full month's invoice paid in full since the last raise. */
  private async raiseCheck(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { creditLimitCents: true, creditLimitRaisedAt: true, createdAt: true } });
    const next = nextStep(reseller.creditLimitCents);
    if (!next) return { reseller, next, reason: 'maximum' as const };
    if ((await this.owed(resellerId)).length) return { reseller, next, reason: 'owing' as const };
    const fullMonth = await this.prisma.invoice.findFirst({
      where: { resellerId, status: 'paid', periodStart: { gte: reseller.createdAt }, totalMinor: { gt: 0 }, ...(reseller.creditLimitRaisedAt ? { paidAt: { gt: reseller.creditLimitRaisedAt } } : {}) },
      select: { id: true },
    });
    if (!fullMonth) return { reseller, next, reason: 'no_paid_month' as const };
    return { reseller, next, reason: null };
  }

  async credit(resellerId: string) {
    const check = await this.raiseCheck(resellerId);
    const owed = await this.owed(resellerId);
    return {
      object: 'credit' as const,
      limit_usd_cents: check.reseller.creditLimitCents,
      steps: [...creditSteps],
      owed: await Promise.all(owed.map(async item => ({ currency: item.currency, amount: Number(item.amount), limit: Number(await this.limitIn(check.reseller.creditLimitCents, item.currency)) }))),
      next_limit_usd_cents: check.next,
      can_raise: check.reason === null,
      raise_blocked_by: check.reason,
    };
  }

  /** The reseller raises their limit one step (after a full month paid in full, with nothing owed). */
  async raise(resellerId: string, actorId: string) {
    const check = await this.raiseCheck(resellerId);
    if (check.reason) {
      const message = {
        maximum: 'Your credit limit is already at its maximum.',
        owing: 'Pay what you owe first, then raise your credit limit.',
        no_paid_month: 'Your credit limit can be raised after a full month’s invoice is paid in full.',
      }[check.reason];
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'credit_raise_unavailable', message);
    }
    // Claimed on the limit it was raised from, so two raises at once go up one step, not two.
    const raised = await this.prisma.reseller.updateMany({ where: { id: resellerId, creditLimitCents: check.reseller.creditLimitCents }, data: { creditLimitCents: check.next!, creditLimitRaisedAt: new Date() } });
    if (raised.count === 0) return this.credit(resellerId);
    await this.audit.record({ actorId, action: 'reseller.credit_limit_raised', targetType: 'reseller', targetId: resellerId, before: { cents: check.reseller.creditLimitCents }, after: { cents: check.next } });
    return this.credit(resellerId);
  }

  /** Admins set any limit up to US$100 (or lower it). Audited. */
  async setLimit(actorId: string | null, resellerId: string, cents: number, reason: string) {
    if (!Number.isInteger(cents) || cents < 0 || cents > maxCreditCents) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `The credit limit is 0 to ${maxCreditCents} US cents.`, 'cents');
    }
    const before = await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { creditLimitCents: true } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');
    await this.prisma.reseller.update({ where: { id: resellerId }, data: { creditLimitCents: cents } });
    await this.audit.record({ actorId, action: 'reseller.credit_limit_set', targetType: 'reseller', targetId: resellerId, before: { cents: before.creditLimitCents }, after: { cents, reason } });
    return this.credit(resellerId);
  }
}
