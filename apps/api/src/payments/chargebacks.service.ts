import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Chargeback, type Payment, Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { PaymentProviders } from './payment-providers.js';

export const chargebackOutcomes = ['won', 'lost'] as const;
export type ChargebackOutcome = (typeof chargebackOutcomes)[number];

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such chargeback.');

export function presentChargeback(chargeback: Chargeback) {
  return {
    object: 'chargeback' as const,
    id: chargeback.id,
    payment_id: chargeback.paymentId,
    reseller_id: chargeback.resellerId,
    mode: chargeback.mode,
    provider: chargeback.provider,
    provider_dispute_id: chargeback.providerDisputeId,
    amount: minor(chargeback.amountMinor),
    currency: chargeback.currency,
    status: chargeback.status,
    protected: chargeback.protected,
    held: minor(chargeback.heldMinor),
    shortfall: minor(chargeback.shortfallMinor),
    reason: chargeback.reason,
    opened_at: chargeback.openedAt.toISOString(),
    resolved_at: chargeback.resolvedAt?.toISOString() ?? null,
    cleared_at: chargeback.clearedAt?.toISOString() ?? null,
  };
}

/** What a reseller sees of a chargeback on one of their payments: no admin notes or gateway chargeback IDs. */
export function presentResellerChargeback(chargeback: Chargeback) {
  return {
    object: 'chargeback' as const,
    id: chargeback.id,
    mode: chargeback.mode,
    payment_id: chargeback.paymentId,
    amount: minor(chargeback.amountMinor),
    currency: chargeback.currency,
    status: chargeback.status as 'open' | 'won' | 'lost',
    protected: chargeback.protected,
    held: minor(chargeback.heldMinor),
    shortfall: minor(chargeback.shortfallMinor),
    payouts_on_hold: !chargeback.protected && (chargeback.status === 'open' || (chargeback.status === 'lost' && chargeback.shortfallMinor > 0n && !chargeback.clearedAt)),
    opened_at: chargeback.openedAt.toISOString(),
    resolved_at: chargeback.resolvedAt?.toISOString() ?? null,
  };
}

/** What follows a chargeback: the dispute the reseller investigates. */
/** Not yet held: unprotected, and no hold or shortfall recorded (a recorded hold or shortfall means it was tried). */
const needsHold = (chargeback: Chargeback) => !chargeback.protected && chargeback.holdId === null && chargeback.heldMinor === 0n && chargeback.shortfallMinor === 0n;

const reportedByStripe = () =>
  new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'chargeback_reported_by_stripe', 'Stripe reports this chargeback and its outcome itself; BitoCard reads them from Stripe.');

export type ChargebackListener = {
  opened(chargeback: Chargeback, payment: Payment): Promise<void>;
  decided(chargeback: Chargeback, outcome: ChargebackOutcome): Promise<void>;
};

/**
 * Card payments the cardholder disputed with their bank (chargebacks), for payments into BitoCard's own gateway accounts: wallet
 * top-ups and store checkouts. The money is the reseller's responsibility (taken from their wallet) unless their plan
 * has `chargeback_protection`, when BitoCard bears it.
 *
 * - Opened: the disputed amount is held from the reseller's wallet at once (as much as it has; the rest is the
 *   shortfall), so it cannot be spent or withdrawn while the chargeback runs, and their withdrawals wait.
 * - Won: the hold goes back.
 * - Lost: the hold pays the gateway back (`provider_balance`); anything BitoCard pays beyond it (protection, or the
 *   shortfall) is BitoCard's `chargebacks` expense. Withdrawals wait until finance clears a shortfall.
 *
 * Stripe disputes arrive by webhook and are always re-read from Stripe; other gateways' are recorded by finance.
 * Payments into a reseller's own gateway are the reseller's to handle with that gateway.
 */
@Injectable()
export class ChargebacksService {
  private readonly logger = new Logger('Chargebacks');
  private disputes?: ChargebackListener;

  /** The disputes service follows chargebacks (registered once at start-up). */
  onDispute(listener: ChargebackListener) {
    this.disputes = listener;
  }

  private async tellDisputes(run: (listener: ChargebackListener) => Promise<void>) {
    if (!this.disputes) return;
    try {
      await run(this.disputes);
    } catch (error) {
      this.logger.error({ err: error }, 'The chargeback’s dispute could not be updated');
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly providers: PaymentProviders,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** A Stripe dispute notice: re-read from Stripe, then opened, kept or decided to match. */
  async stripeNotice(disputeId: string) {
    const stripe = this.providers.stripe;
    if (!stripe) return { handled: false };
    const chargeback = await stripe.dispute(disputeId);
    const payment = chargeback.sessionId
      ? await this.prisma.payment.findUnique({ where: { provider_providerTransactionId: { provider: 'stripe', providerTransactionId: chargeback.sessionId } } })
      : null;
    if (!payment) {
      this.logger.warn({ disputeId }, 'Stripe dispute for a payment BitoCard does not know');
      return { handled: false, reason: 'unknown_payment' };
    }
    const opened = await this.open(payment, { providerDisputeId: chargeback.id, amount: chargeback.amount, currency: chargeback.currency, reason: chargeback.reason });
    if (chargeback.outcome) await this.resolve(opened.id, chargeback.outcome, null, `Stripe: ${chargeback.status}`);
    return { handled: true, status: (await this.prisma.chargeback.findUniqueOrThrow({ where: { id: opened.id } })).status };
  }

  /** Finance records a chargeback from another gateway's dashboard (Flutterwave, Monnify). */
  async record(actorId: string | null, input: { payment_id: string; provider_dispute_id: string; amount?: number; reason: string }) {
    const payment = await this.prisma.payment.findUnique({ where: { id: input.payment_id } });
    if (!payment) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such payment.', 'payment_id');
    if (payment.provider === 'stripe') throw reportedByStripe();
    const amount = input.amount === undefined ? payment.amountMinor : BigInt(input.amount);
    if (amount <= 0n || amount > payment.amountMinor) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'The disputed amount must be more than nothing and at most what was paid.', 'amount');
    }
    const chargeback = await this.open(payment, { providerDisputeId: input.provider_dispute_id, amount, currency: payment.currency, reason: input.reason });
    await this.audit.record({ actorId, action: 'chargeback.recorded', targetType: 'chargeback', targetId: chargeback.id, after: { ...presentChargeback(chargeback), reason: input.reason } });
    return presentChargeback(chargeback);
  }

  /** Opens a chargeback once (per gateway chargeback ID) and holds its amount from the reseller's wallet. */
  private async open(payment: Payment, input: { providerDisputeId: string; amount: bigint; currency: string; reason: string | null }) {
    const existing = await this.prisma.chargeback.findUnique({ where: { provider_providerDisputeId: { provider: payment.provider, providerDisputeId: input.providerDisputeId } } });
    if (existing) return this.finishOpening(existing, payment);
    if (payment.status !== 'succeeded') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'payment_not_succeeded', 'Only a payment that was credited can be charged back.', 'payment_id');
    if (payment.connectionId) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'own_gateway_payment', 'This payment went to the reseller’s own gateway account: they handle its chargebacks with their gateway.', 'payment_id');
    }
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: payment.resellerId }, include: { plan: true } });
    const isProtected = reseller.plan.features.includes('chargeback_protection');
    let chargeback: Chargeback;
    try {
      chargeback = await this.prisma.chargeback.create({
        data: {
          paymentId: payment.id,
          resellerId: payment.resellerId,
          mode: payment.mode,
          provider: payment.provider,
          providerDisputeId: input.providerDisputeId,
          amountMinor: input.amount,
          currency: input.currency,
          protected: isProtected,
          reason: input.reason?.slice(0, 500) ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.chargeback.findUniqueOrThrow({ where: { provider_providerDisputeId: { provider: payment.provider, providerDisputeId: input.providerDisputeId } } });
        return this.finishOpening(raced, payment);
      }
      throw error;
    }
    return this.finishOpening(chargeback, payment);
  }

  /**
   * The rest of opening a chargeback, safe to run again: the hold (once), the notices (deduplicated by the inbox) and
   * the dispute (once per chargeback). A run that stopped after creating the row is completed by the next notice or
   * check, so a chargeback is never left without its hold.
   */
  private async finishOpening(found: Chargeback, payment: Payment) {
    let chargeback = found;
    if (chargeback.status !== 'open') return chargeback;
    if (needsHold(chargeback)) chargeback = await this.holdFor(chargeback);
    const amount = formatMoney(chargeback.amountMinor, chargeback.currency);
    await this.inbox.reseller(chargeback.resellerId, 'chargeback.opened', {
      subject: chargeback.id,
      title: `Chargeback of ${amount}`,
      body: chargeback.protected
        ? 'The cardholder disputed a payment with their bank. Your plan’s chargeback protection covers it: nothing is taken from your wallet.'
        : `The cardholder disputed a payment with their bank. ${formatMoney(chargeback.heldMinor, chargeback.currency)} is held from your wallet until the card network decides, and withdrawals wait until then.`,
      link: '/wallet',
      mode: chargeback.mode,
    });
    await this.inbox.admins('admin.chargeback.opened', {
      subject: chargeback.id,
      title: `Chargeback of ${amount}`,
      body: `${payment.provider} payment ${payment.reference}. ${chargeback.protected ? 'Chargeback protection: BitoCard bears it.' : chargeback.shortfallMinor > 0n ? `The reseller’s wallet was ${formatMoney(chargeback.shortfallMinor, chargeback.currency)} short.` : 'Held from the reseller’s wallet.'}`,
      link: '/orders/chargebacks',
      mode: chargeback.mode,
    });
    const opened = chargeback;
    await this.tellDisputes(listener => listener.opened(opened, payment));
    return chargeback;
  }

  /** Holds the disputed amount, or as much of it as the wallet has; the rest is the shortfall. */
  private async holdFor(chargeback: Chargeback) {
    const { currency } = await this.wallets.currencyOf(chargeback.resellerId);
    let held = 0n;
    let holdId: string | null = null;
    if (currency === chargeback.currency) {
      const wallet = await this.wallets.wallet(chargeback.resellerId, chargeback.mode);
      const available = BigInt(wallet.available);
      const amount = available < chargeback.amountMinor ? available : chargeback.amountMinor;
      if (amount > 0n) {
        try {
          const hold = await this.wallets.hold({ resellerId: chargeback.resellerId, mode: chargeback.mode, amount, reference: `chargeback:${chargeback.id}`, description: 'Chargeback: held until decided' });
          held = hold.amountMinor;
          holdId = hold.id;
        } catch (error) {
          // Spent in the meantime: the whole amount is the shortfall.
          if (!(error instanceof ApiError && error.code === 'insufficient_funds')) throw error;
        }
      }
    } else {
      this.logger.error({ disputeId: chargeback.id }, 'Disputed payment is not in the reseller’s wallet currency; finance must settle it');
    }
    const recorded = await this.prisma.chargeback.updateMany({
      where: { id: chargeback.id, status: 'open', holdId: null, heldMinor: 0n, shortfallMinor: 0n },
      data: { holdId, heldMinor: held, shortfallMinor: chargeback.amountMinor - held },
    });
    const now = await this.prisma.chargeback.findUniqueOrThrow({ where: { id: chargeback.id } });
    // Decided (or held by another run) in the meantime: a hold this run made and the row does not name is released.
    if (recorded.count === 0 && holdId && now.holdId !== holdId) await this.wallets.releaseHold(holdId, 'Chargeback decided before it was held: funds released');
    return now;
  }

  /** Moves a decided chargeback's money: each step happens once, so it can be run again after a failure. */
  private async settleMoney(before: Chargeback, outcome: ChargebackOutcome) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: before.paymentId } });
    if (outcome === 'won') {
      if (before.holdId) await this.wallets.releaseHold(before.holdId, 'Card chargeback won: funds released');
    } else {
      // The gateway took the money back from BitoCard's balance with it.
      const provider = { kind: 'provider_balance' as const, currency: before.currency, provider: payment.provider };
      if (before.holdId) await this.wallets.captureHoldTo(before.holdId, 'Card chargeback lost: returned to the cardholder', provider);
      const borne = before.amountMinor - before.heldMinor;
      if (borne > 0n) {
        const reference = `chargeback:lost:${before.id}`;
        if (!(await this.prisma.journalEntry.findUnique({ where: { reference } }))) await this.ledger.post({
          mode: before.mode,
          type: 'chargeback',
          reference,
          resellerId: before.resellerId,
          description: before.protected ? 'Card chargeback lost: covered by chargeback protection' : 'Card chargeback lost: more than the wallet held',
          metadata: { chargeback_id: before.id, payment_id: payment.id },
          lines: [
            { account: { kind: 'chargebacks', currency: before.currency }, debit: borne },
            { account: provider, credit: borne },
          ],
        }).catch(error => {
          // Another run posted it at the same moment: the unique reference keeps it once.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        });
      }
    }
  }

  /** The card network decided. Applied once, whoever reports it first. */
  async resolve(id: string, outcome: ChargebackOutcome, actorId: string | null, reason: string) {
    let before = await this.prisma.chargeback.findUnique({ where: { id } });
    if (!before) throw notFound();
    // Stripe reports its own decisions (re-read from Stripe); a hand-made one could contradict Stripe's later.
    if (actorId !== null && before.provider === 'stripe') throw reportedByStripe();
    // Never decided without its hold: one that was never made is made first.
    if (before.status === 'open' && needsHold(before)) before = await this.holdFor(before);
    const claimed = await this.prisma.chargeback.updateMany({ where: { id, status: 'open' }, data: { status: outcome, resolvedAt: new Date() } });
    if (claimed.count === 0) {
      const current = await this.prisma.chargeback.findUniqueOrThrow({ where: { id } });
      if (current.status !== outcome) {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'chargeback_closed', `This chargeback was already decided (${current.status}).`);
      }
      // Already decided this way: finish moving its money if an earlier run stopped part way (every step is once only).
      await this.settleMoney(current, outcome);
      return presentChargeback(current);
    }
    await this.settleMoney(before, outcome);
    const after = await this.prisma.chargeback.findUniqueOrThrow({ where: { id } });
    await this.tellDisputes(listener => listener.decided(after, outcome));
    if (actorId !== null) await this.audit.record({ actorId, action: `chargeback.${outcome}`, targetType: 'chargeback', targetId: id, before: presentChargeback(before), after: { ...presentChargeback(after), reason } });
    const amount = formatMoney(after.amountMinor, after.currency);
    await this.inbox.reseller(after.resellerId, 'chargeback.closed', {
      subject: `${after.id}:${outcome}`,
      title: outcome === 'won' ? `Chargeback of ${amount} won` : `Chargeback of ${amount} lost`,
      body:
        outcome === 'won'
          ? 'The card network decided in your favour: the held amount is back in your wallet.'
          : after.protected
            ? 'The card network decided for the cardholder. Your plan’s chargeback protection covered it.'
            : after.shortfallMinor > 0n
              ? `The card network decided for the cardholder. The held amount was returned to them; ${formatMoney(after.shortfallMinor, after.currency)} is still owed, and withdrawals wait until BitoCard has settled it with you.`
              : 'The card network decided for the cardholder: the held amount was returned to them.',
      link: '/wallet',
      mode: after.mode,
    });
    return presentChargeback(after);
  }

  /** Finance has settled a lost chargeback's shortfall with the reseller (or written it off): withdrawals can resume. */
  async clear(actorId: string | null, id: string, reason: string) {
    const before = await this.prisma.chargeback.findUnique({ where: { id } });
    if (!before) throw notFound();
    if (before.status !== 'lost' || before.shortfallMinor === 0n) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'nothing_to_clear', 'Only a lost chargeback with a shortfall is cleared.');
    await this.prisma.chargeback.updateMany({ where: { id, clearedAt: null }, data: { clearedAt: new Date() } });
    const after = await this.prisma.chargeback.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId, action: 'chargeback.cleared', targetType: 'chargeback', targetId: id, before: presentChargeback(before), after: { ...presentChargeback(after), reason } });
    return presentChargeback(after);
  }

  /** The reseller's own chargebacks in this mode, newest first. */
  async forReseller(resellerId: string, mode: Payment['mode'], page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 20;
    const rows = await this.prisma.chargeback.findMany({
      where: { resellerId, mode },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(presentResellerChargeback), has_more: rows.length > limit };
  }

  async list(filter: { status?: string; reseller_id?: string }) {
    const rows = await this.prisma.chargeback.findMany({
      where: { status: filter.status, resellerId: filter.reseller_id },
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
    return { object: 'list' as const, data: rows.map(presentChargeback) };
  }
}
