import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, type Payment, Prisma, type ReservedAccount } from '../generated/prisma/client.js';
import { type Line, LedgerService, type Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { PaymentProviders } from './payment-providers.js';
import { ProviderError } from './provider-error.js';
import { EventsService } from '../webhooks/events.service.js';
import type { ChargeResult } from './providers.js';

const day = 24 * 60 * 60 * 1000;
/** A checkout not paid within this time is closed as failed. */
const checkoutLifetimeMs = day;

export const testModeOnly = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'livemode_not_allowed', 'Simulations work only in test mode (the sandbox).');

export const resellerNotVerified = () =>
  new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'reseller_not_verified', 'Live money movements are available once your business is verified. Use the sandbox until then.');

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

export function presentTopUp(payment: Payment) {
  return {
    object: 'top_up' as const,
    id: payment.id,
    mode: payment.mode,
    status: payment.status,
    /** checkout (card or other payment page) or bank_transfer (into a reserved bank account). */
    source: payment.purpose === 'reserved_account_deposit' ? ('bank_transfer' as const) : ('checkout' as const),
    amount: minor(payment.amountMinor),
    currency: payment.currency,
    checkout_url: payment.status === 'pending' ? payment.checkoutUrl : null,
    failure_reason: payment.failureReason,
    created_at: payment.createdAt.toISOString(),
    completed_at: payment.completedAt?.toISOString() ?? null,
  };
}

export function presentReservedAccount(account: ReservedAccount) {
  return {
    object: 'reserved_account' as const,
    id: account.id,
    mode: account.mode,
    currency: account.currency,
    bank_name: account.bankName,
    account_number: account.accountNumber,
    account_name: account.accountName,
    created_at: account.createdAt.toISOString(),
  };
}

/**
 * Money coming into reseller wallets: checkout top-ups and transfers into reserved bank accounts.
 * A wallet is credited only after the provider confirms the payment, and each provider transaction exactly once.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  /** Admin integration settings over the environment, read fresh on every use. */
  private get config() {
    return this.integrations.config;
  }

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly providers: PaymentProviders,
    private readonly events: EventsService,
  ) {}

  /** Who the provider should treat as the payer: the signed-in person, or the business owner for API keys. */
  async contactFor(resellerId: string, userId: string | null) {
    const user = userId
      ? await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
      : (await this.prisma.resellerMember.findFirstOrThrow({ where: { resellerId, role: 'owner' }, include: { user: true } })).user;
    return { email: user.email, name: user.name };
  }

  // -- Checkout top-ups ------------------------------------------------------------------------------------------

  async createTopUp(resellerId: string, mode: LedgerMode, payer: { email: string; name: string }, input: { amount: number; return_url?: string }) {
    const { reseller, country, currency } = await this.wallets.currencyOf(resellerId);
    if (mode === 'live' && reseller.status !== 'active') throw resellerNotVerified();
    const provider = this.providers.checkout(mode, country.code);
    const payment = await this.prisma.payment.create({
      data: {
        resellerId,
        mode,
        purpose: 'wallet_top_up',
        provider: provider.name,
        reference: `bc_top_${randomUUID().replaceAll('-', '')}`,
        amountMinor: BigInt(input.amount),
        currency,
        returnUrl: input.return_url ?? this.config.PAYMENT_RETURN_URL,
      },
    });
    try {
      const { checkoutUrl } = await provider.createCheckout({
        reference: payment.reference,
        amount: payment.amountMinor,
        currency,
        email: payer.email,
        name: reseller.name,
        returnUrl: payment.returnUrl ?? this.config.PAYMENT_RETURN_URL,
        description: 'Wallet top-up',
      });
      return presentTopUp(await this.prisma.payment.update({ where: { id: payment.id }, data: { checkoutUrl } }));
    } catch (error) {
      // No money can have moved without a payment page, so the top-up is simply closed.
      this.logger.warn({ err: error, paymentId: payment.id }, 'Could not start a checkout');
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: 'The payment could not be started.', completedAt: new Date() } });
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The payment could not be started. Try again shortly.');
    }
  }

  async listTopUps(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const payments = await this.prisma.payment.findMany({
      where: { resellerId, mode, purpose: 'wallet_top_up' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: payments.slice(0, limit).map(presentTopUp), has_more: payments.length > limit };
  }

  /** A pending live top-up is checked with the provider before it is returned. */
  async getTopUp(resellerId: string, mode: LedgerMode, id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, resellerId, mode, purpose: 'wallet_top_up' } });
    if (!payment) throw notFound('top-up');
    if (payment.status !== 'pending' || payment.mode === 'test') return presentTopUp(payment);
    return presentTopUp(await this.requery(payment).catch(() => payment));
  }

  /** Asks the provider what happened to a pending top-up. Unclear answers leave it pending. */
  async requery(payment: Payment) {
    if (payment.status !== 'pending' || payment.provider === 'sandbox') return payment;
    const provider = payment.provider === 'flutterwave' ? this.providers.flutterwave : null;
    if (!provider) return payment;
    const result = await provider.verifyByReference(payment.reference);
    if (result) return this.settle(payment, result);
    if (Date.now() - payment.createdAt.getTime() > checkoutLifetimeMs) return this.fail(payment, 'The payment was not completed in time.');
    return payment;
  }

  /** Requeries live top-ups still pending after a couple of minutes. Run on a schedule. */
  async requeryPending(olderThanMs = 2 * 60_000) {
    const pending = await this.prisma.payment.findMany({
      where: { status: 'pending', purpose: 'wallet_top_up', mode: 'live', createdAt: { lt: new Date(Date.now() - olderThanMs) } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let settled = 0;
    for (const payment of pending) {
      try {
        if ((await this.requery(payment)).status !== 'pending') settled += 1;
      } catch (error) {
        this.logger.warn({ err: error, paymentId: payment.id }, 'Requery failed; will retry');
      }
    }
    return { checked: pending.length, settled };
  }

  /** Applies a confirmed result from the provider. Safe to call repeatedly and concurrently. */
  async settle(payment: Payment, result: ChargeResult) {
    if (result.status === 'pending') return payment;
    if (result.status === 'failed') return this.fail(payment, result.failureReason ?? 'The payment failed.');
    if (result.reference !== payment.reference || result.currency !== payment.currency || result.amount !== payment.amountMinor) {
      this.logger.error({ paymentId: payment.id, result: { ...result, amount: String(result.amount), fee: String(result.fee) } }, 'Payment does not match the top-up; needs review');
      return this.fail(payment, 'The amount paid did not match. Our team will review it and contact you.');
    }
    await this.credit(payment, result);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private async fail(payment: Payment, reason: string) {
    const failed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed', failureReason: reason, completedAt: new Date() } });
      if (claimed.count === 1) await this.recordEvent(tx, 'top_up.failed', payment.id);
      return claimed.count === 1;
    });
    if (failed) this.events.committed();
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private async recordEvent(tx: Tx, type: 'top_up.succeeded' | 'top_up.failed', paymentId: string) {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await this.events.record(tx, { resellerId: payment.resellerId, mode: payment.mode, type, object: presentTopUp(payment) });
  }

  private creditLines(payment: Pick<Payment, 'resellerId' | 'currency' | 'provider' | 'amountMinor'>, fee: bigint): Line[] {
    // The reseller receives the full amount; the provider's fee is BitoCard's cost.
    const safeFee = fee > 0n && fee < payment.amountMinor ? fee : 0n;
    return [
      { account: { kind: 'provider_balance', currency: payment.currency, provider: payment.provider }, debit: payment.amountMinor - safeFee },
      ...(safeFee > 0n ? [{ account: { kind: 'processing_fees' as const, currency: payment.currency, provider: payment.provider }, debit: safeFee }] : []),
      { account: { kind: 'reseller_funding', currency: payment.currency, resellerId: payment.resellerId }, credit: payment.amountMinor },
    ];
  }

  private async credit(payment: Payment, result: ChargeResult) {
    const entry = await this.ledger.prepare({
      mode: payment.mode,
      type: 'top_up',
      reference: `payment:${payment.id}`,
      resellerId: payment.resellerId,
      description: 'Wallet top-up',
      metadata: { payment_id: payment.id, provider: payment.provider, provider_transaction_id: result.providerTransactionId },
      lines: this.creditLines(payment, result.fee),
    });
    try {
      const credited = await this.prisma.$transaction(async tx => {
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: { status: 'succeeded', providerTransactionId: result.providerTransactionId, feeMinor: result.fee, completedAt: new Date() },
        });
        if (claimed.count === 1) {
          await this.ledger.write(tx, entry);
          await this.recordEvent(tx, 'top_up.succeeded', payment.id);
        }
        return claimed.count === 1;
      });
      if (credited) this.events.committed();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.error({ paymentId: payment.id, providerTransactionId: result.providerTransactionId }, 'Provider transaction already credited elsewhere; needs review');
        return;
      }
      throw error;
    }
  }

  async simulateTopUp(resellerId: string, mode: LedgerMode, id: string, outcome: 'succeeded' | 'failed') {
    if (mode !== 'test') throw testModeOnly();
    const payment = await this.prisma.payment.findFirst({ where: { id, resellerId, mode: 'test', purpose: 'wallet_top_up' } });
    if (!payment) throw notFound('top-up');
    const settled = await this.settle(payment, {
      status: outcome,
      providerTransactionId: `sandbox_${payment.id}`,
      reference: payment.reference,
      amount: payment.amountMinor,
      currency: payment.currency,
      fee: 0n,
      failureReason: outcome === 'failed' ? 'Simulated failure.' : undefined,
    });
    return presentTopUp(settled);
  }

  // -- Reserved bank accounts ------------------------------------------------------------------------------------

  async listReservedAccounts(resellerId: string, mode: LedgerMode) {
    const accounts = await this.prisma.reservedAccount.findMany({ where: { resellerId, mode }, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: accounts.map(presentReservedAccount) };
  }

  /**
   * Creates the wallet's reserved bank account(s), trying each provider in turn (Flutterwave, then Monnify in Nigeria).
   * Asking again returns the existing accounts. The BVN is passed to the provider and never stored.
   */
  async createReservedAccounts(resellerId: string, mode: LedgerMode, owner: { email: string }, input: { bvn?: string }) {
    const { reseller, country, currency } = await this.wallets.currencyOf(resellerId);
    if (!country.reservedAccounts) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'reserved_accounts_unavailable', 'Reserved bank accounts are not available in your country yet. Top up through checkout instead.');
    }
    if (mode === 'live' && reseller.status !== 'active') throw resellerNotVerified();
    const existing = await this.listReservedAccounts(resellerId, mode);
    if (existing.data.length) return existing;

    let refused = false;
    for (const provider of this.providers.reservedAccounts(mode, country.code, currency)) {
      const reference = `bc_ra_${mode}_${resellerId.replaceAll('-', '')}`;
      try {
        const accounts = await provider.createReservedAccount({ reference, email: owner.email, name: reseller.name, currency, bvn: input.bvn });
        await this.prisma.reservedAccount.createMany({
          data: accounts.map(account => ({ resellerId, mode, provider: provider.name, currency, providerReference: reference, ...account })),
          skipDuplicates: true,
        });
        return this.listReservedAccounts(resellerId, mode);
      } catch (error) {
        refused ||= error instanceof ProviderError && error.definite;
        this.logger.warn({ err: error, provider: provider.name, resellerId }, 'Reserved account provider failed; trying the next one');
      }
    }
    if (refused) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'reserved_account_refused', 'The bank could not create your account. Check your BVN and business details, then try again.', 'bvn');
    }
    throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'Reserved accounts are unavailable right now. Try again shortly.');
  }

  /**
   * Credits a confirmed transfer into a reserved account. The provider transaction ID makes it happen once,
   * however many times the provider notifies us.
   */
  async recordDeposit(provider: string, result: ChargeResult) {
    if (result.status !== 'succeeded') return { credited: false, reason: 'not_successful' };
    const account = await this.prisma.reservedAccount.findFirst({ where: { provider, providerReference: result.reference } });
    if (!account) {
      this.logger.warn({ provider, reference: result.reference, providerTransactionId: result.providerTransactionId }, 'Deposit for an unknown reserved account; needs review');
      return { credited: false, reason: 'unknown_account' };
    }
    if (result.currency !== account.currency) {
      this.logger.error({ provider, accountId: account.id, currency: result.currency }, 'Deposit in the wrong currency; needs review');
      return { credited: false, reason: 'currency_mismatch' };
    }
    const reference = `bc_dep_${provider}_${result.providerTransactionId}`;
    if (await this.prisma.payment.findUnique({ where: { reference } })) return { credited: false, reason: 'duplicate' };

    const id = randomUUID();
    const base = { resellerId: account.resellerId, currency: account.currency, provider, amountMinor: result.amount };
    const entry = await this.ledger.prepare({
      mode: account.mode,
      type: 'deposit',
      reference: `payment:${id}`,
      resellerId: account.resellerId,
      description: `Bank transfer to ${account.bankName} ${account.accountNumber}`,
      metadata: { payment_id: id, provider, provider_transaction_id: result.providerTransactionId },
      lines: this.creditLines(base, result.fee),
    });
    try {
      await this.prisma.$transaction(async tx => {
        await tx.payment.create({
          data: {
            id,
            ...base,
            mode: account.mode,
            purpose: 'reserved_account_deposit',
            reference,
            providerTransactionId: result.providerTransactionId,
            feeMinor: result.fee,
            status: 'succeeded',
            reservedAccountId: account.id,
            completedAt: new Date(),
          },
        });
        await this.ledger.write(tx, entry);
        await this.recordEvent(tx, 'top_up.succeeded', id);
      });
      this.events.committed();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { credited: false, reason: 'duplicate' };
      throw error;
    }
    return { credited: true, payment_id: id };
  }

  async simulateDeposit(resellerId: string, mode: LedgerMode, accountId: string, amount: number) {
    if (mode !== 'test') throw testModeOnly();
    const account = await this.prisma.reservedAccount.findFirst({ where: { id: accountId, resellerId, mode: 'test' } });
    if (!account) throw notFound('reserved account');
    const outcome = await this.recordDeposit('sandbox', {
      status: 'succeeded',
      providerTransactionId: randomUUID(),
      reference: account.providerReference,
      amount: BigInt(amount),
      currency: account.currency,
      fee: 0n,
    });
    return { object: 'simulated_deposit' as const, credited: outcome.credited, amount, currency: account.currency };
  }

  // -- Provider notifications ------------------------------------------------------------------------------------

  /**
   * A Flutterwave charge notification. The notification only says something happened: the result is always
   * re-read from Flutterwave before any money moves.
   */
  async flutterwaveCharge(transactionId: string) {
    const flutterwave = this.providers.flutterwave;
    if (!flutterwave) return { handled: false };
    const result = await flutterwave.verifyById(transactionId);
    const payment = await this.prisma.payment.findUnique({ where: { reference: result.reference } });
    if (payment && payment.provider === 'flutterwave') {
      const settled = await this.settle(payment, result);
      return { handled: true, status: settled.status };
    }
    return { handled: true, ...(await this.recordDeposit('flutterwave', result)) };
  }

  async monnifyDeposit(transactionReference: string) {
    const monnify = this.providers.monnify;
    if (!monnify) return { handled: false };
    return { handled: true, ...(await this.recordDeposit('monnify', await monnify.verifyTransaction(transactionReference))) };
  }
}
