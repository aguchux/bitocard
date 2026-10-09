import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Dispute, type Payment, Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { PaymentProviders } from './payment-providers.js';

export const disputeOutcomes = ['won', 'lost'] as const;
export type DisputeOutcome = (typeof disputeOutcomes)[number];

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such dispute.');

export function presentDispute(dispute: Dispute) {
  return {
    object: 'dispute' as const,
    id: dispute.id,
    payment_id: dispute.paymentId,
    reseller_id: dispute.resellerId,
    mode: dispute.mode,
    provider: dispute.provider,
    provider_dispute_id: dispute.providerDisputeId,
    amount: minor(dispute.amountMinor),
    currency: dispute.currency,
    status: dispute.status,
    protected: dispute.protected,
    held: minor(dispute.heldMinor),
    shortfall: minor(dispute.shortfallMinor),
    reason: dispute.reason,
    opened_at: dispute.openedAt.toISOString(),
    resolved_at: dispute.resolvedAt?.toISOString() ?? null,
    cleared_at: dispute.clearedAt?.toISOString() ?? null,
  };
}

/**
 * Card payments disputed with the gateway (chargebacks), for payments into BitoCard's own gateway accounts: wallet
 * top-ups and store checkouts. The money is the reseller's responsibility (taken from their wallet) unless their plan
 * has `chargeback_protection`, when BitoCard bears it.
 *
 * - Opened: the disputed amount is held from the reseller's wallet at once (as much as it has; the rest is the
 *   shortfall), so it cannot be spent or withdrawn while the dispute runs, and their withdrawals wait.
 * - Won: the hold goes back.
 * - Lost: the hold pays the gateway back (`provider_balance`); anything BitoCard pays beyond it (protection, or the
 *   shortfall) is BitoCard's `chargebacks` expense. Withdrawals wait until finance clears a shortfall.
 *
 * Stripe disputes arrive by webhook and are always re-read from Stripe; other gateways' are recorded by finance.
 * Payments into a reseller's own gateway are the reseller's to handle with that gateway.
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger('Disputes');

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
    const dispute = await stripe.dispute(disputeId);
    const payment = dispute.sessionId
      ? await this.prisma.payment.findUnique({ where: { provider_providerTransactionId: { provider: 'stripe', providerTransactionId: dispute.sessionId } } })
      : null;
    if (!payment) {
      this.logger.warn({ disputeId }, 'Stripe dispute for a payment BitoCard does not know');
      return { handled: false, reason: 'unknown_payment' };
    }
    const opened = await this.open(payment, { providerDisputeId: dispute.id, amount: dispute.amount, currency: dispute.currency, reason: dispute.reason });
    if (dispute.outcome) await this.resolve(opened.id, dispute.outcome, null, `Stripe: ${dispute.status}`);
    return { handled: true, status: (await this.prisma.dispute.findUniqueOrThrow({ where: { id: opened.id } })).status };
  }

  /** Finance records a dispute from another gateway's dashboard (Flutterwave, Monnify). */
  async record(actorId: string | null, input: { payment_id: string; provider_dispute_id: string; amount?: number; reason: string }) {
    const payment = await this.prisma.payment.findUnique({ where: { id: input.payment_id } });
    if (!payment) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such payment.', 'payment_id');
    const amount = input.amount === undefined ? payment.amountMinor : BigInt(input.amount);
    if (amount <= 0n || amount > payment.amountMinor) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'The disputed amount must be more than nothing and at most what was paid.', 'amount');
    }
    const dispute = await this.open(payment, { providerDisputeId: input.provider_dispute_id, amount, currency: payment.currency, reason: input.reason });
    await this.audit.record({ actorId, action: 'dispute.recorded', targetType: 'dispute', targetId: dispute.id, after: { ...presentDispute(dispute), reason: input.reason } });
    return presentDispute(dispute);
  }

  /** Opens a dispute once (per gateway dispute ID) and holds its amount from the reseller's wallet. */
  private async open(payment: Payment, input: { providerDisputeId: string; amount: bigint; currency: string; reason: string | null }) {
    const existing = await this.prisma.dispute.findUnique({ where: { provider_providerDisputeId: { provider: payment.provider, providerDisputeId: input.providerDisputeId } } });
    if (existing) return existing;
    if (payment.status !== 'succeeded') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'payment_not_succeeded', 'Only a payment that was credited can be disputed.', 'payment_id');
    if (payment.connectionId) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'own_gateway_payment', 'This payment went to the reseller’s own gateway account: they handle its disputes with their gateway.', 'payment_id');
    }
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: payment.resellerId }, include: { plan: true } });
    const isProtected = reseller.plan.features.includes('chargeback_protection');
    let dispute: Dispute;
    try {
      dispute = await this.prisma.dispute.create({
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
        return this.prisma.dispute.findUniqueOrThrow({ where: { provider_providerDisputeId: { provider: payment.provider, providerDisputeId: input.providerDisputeId } } });
      }
      throw error;
    }
    if (!isProtected) dispute = await this.holdFor(dispute);
    const amount = formatMoney(dispute.amountMinor, dispute.currency);
    await this.inbox.reseller(dispute.resellerId, 'dispute.opened', {
      subject: dispute.id,
      title: `A card payment of ${amount} is disputed`,
      body: dispute.protected
        ? 'The cardholder disputed a payment. Your plan’s chargeback protection covers it: nothing is taken from your wallet.'
        : `The cardholder disputed a payment. ${formatMoney(dispute.heldMinor, dispute.currency)} is held from your wallet until the card network decides, and withdrawals wait until then.`,
      link: '/wallet',
      mode: dispute.mode,
    });
    await this.inbox.admins('admin.dispute.opened', {
      subject: dispute.id,
      title: `Card payment of ${amount} disputed`,
      body: `${payment.provider} payment ${payment.reference}. ${dispute.protected ? 'Chargeback protection: BitoCard bears it.' : dispute.shortfallMinor > 0n ? `The reseller’s wallet was ${formatMoney(dispute.shortfallMinor, dispute.currency)} short.` : 'Held from the reseller’s wallet.'}`,
      link: '/orders',
      mode: dispute.mode,
    });
    return dispute;
  }

  /** Holds the disputed amount, or as much of it as the wallet has; the rest is the shortfall. */
  private async holdFor(dispute: Dispute) {
    const { currency } = await this.wallets.currencyOf(dispute.resellerId);
    let held = 0n;
    let holdId: string | null = null;
    if (currency === dispute.currency) {
      const wallet = await this.wallets.wallet(dispute.resellerId, dispute.mode);
      const available = BigInt(wallet.available);
      const amount = available < dispute.amountMinor ? available : dispute.amountMinor;
      if (amount > 0n) {
        try {
          const hold = await this.wallets.hold({ resellerId: dispute.resellerId, mode: dispute.mode, amount, reference: `dispute:${dispute.id}`, description: 'Card payment disputed: held until decided' });
          held = hold.amountMinor;
          holdId = hold.id;
        } catch (error) {
          // Spent in the meantime: the whole amount is the shortfall.
          if (!(error instanceof ApiError && error.code === 'insufficient_funds')) throw error;
        }
      }
    } else {
      this.logger.error({ disputeId: dispute.id }, 'Disputed payment is not in the reseller’s wallet currency; finance must settle it');
    }
    return this.prisma.dispute.update({ where: { id: dispute.id }, data: { holdId, heldMinor: held, shortfallMinor: dispute.amountMinor - held } });
  }

  /** The card network decided. Applied once, whoever reports it first. */
  async resolve(id: string, outcome: DisputeOutcome, actorId: string | null, reason: string) {
    const before = await this.prisma.dispute.findUnique({ where: { id } });
    if (!before) throw notFound();
    const claimed = await this.prisma.dispute.updateMany({ where: { id, status: 'open' }, data: { status: outcome, resolvedAt: new Date() } });
    if (claimed.count === 0) {
      if (before.status === outcome) return presentDispute(before);
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'dispute_closed', `This dispute was already decided (${before.status}).`);
    }
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: before.paymentId } });
    if (outcome === 'won') {
      if (before.holdId) await this.wallets.releaseHold(before.holdId, 'Card dispute won: funds released');
    } else {
      // The gateway took the money back from BitoCard's balance with it.
      const provider = { kind: 'provider_balance' as const, currency: before.currency, provider: payment.provider };
      if (before.holdId) await this.wallets.captureHoldTo(before.holdId, 'Card dispute lost: returned to the cardholder', provider);
      const borne = before.amountMinor - before.heldMinor;
      if (borne > 0n) {
        await this.ledger.post({
          mode: before.mode,
          type: 'chargeback',
          reference: `dispute:lost:${before.id}`,
          resellerId: before.resellerId,
          description: before.protected ? 'Card dispute lost: covered by chargeback protection' : 'Card dispute lost: more than the wallet held',
          metadata: { dispute_id: before.id, payment_id: payment.id },
          lines: [
            { account: { kind: 'chargebacks', currency: before.currency }, debit: borne },
            { account: provider, credit: borne },
          ],
        });
      }
    }
    const after = await this.prisma.dispute.findUniqueOrThrow({ where: { id } });
    if (actorId !== null) await this.audit.record({ actorId, action: `dispute.${outcome}`, targetType: 'dispute', targetId: id, before: presentDispute(before), after: { ...presentDispute(after), reason } });
    const amount = formatMoney(after.amountMinor, after.currency);
    await this.inbox.reseller(after.resellerId, 'dispute.closed', {
      subject: `${after.id}:${outcome}`,
      title: outcome === 'won' ? `Dispute of ${amount} won` : `Dispute of ${amount} lost`,
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
    return presentDispute(after);
  }

  /** Finance has settled a lost dispute's shortfall with the reseller (or written it off): withdrawals can resume. */
  async clear(actorId: string | null, id: string, reason: string) {
    const before = await this.prisma.dispute.findUnique({ where: { id } });
    if (!before) throw notFound();
    if (before.status !== 'lost' || before.shortfallMinor === 0n) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'nothing_to_clear', 'Only a lost dispute with a shortfall is cleared.');
    await this.prisma.dispute.updateMany({ where: { id, clearedAt: null }, data: { clearedAt: new Date() } });
    const after = await this.prisma.dispute.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId, action: 'dispute.cleared', targetType: 'dispute', targetId: id, before: presentDispute(before), after: { ...presentDispute(after), reason } });
    return presentDispute(after);
  }

  async list(filter: { status?: string; reseller_id?: string }) {
    const rows = await this.prisma.dispute.findMany({
      where: { status: filter.status, resellerId: filter.reseller_id },
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
    return { object: 'list' as const, data: rows.map(presentDispute) };
  }
}
