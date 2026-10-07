import { Encryption } from '../common/encryption.js';
import { SettingsService } from '../settings/settings.service.js';
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, type Payment, Prisma, type ReservedAccount } from '../generated/prisma/client.js';
import { type Line, LedgerService, type Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { PaymentMethodsService, presentMethod } from './payment-methods.service.js';
import { PaymentProviders } from './payment-providers.js';
import { ProviderError } from './provider-error.js';
import { EventsService } from '../webhooks/events.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import type { ChargeResult, CheckoutProvider, PaymentRef } from './providers.js';

/** What a payment record gives its provider to look it up. */
export const paymentRef = (payment: Payment): PaymentRef => ({
  reference: payment.reference,
  providerTransactionId: payment.providerTransactionId,
  amount: payment.amountMinor,
  currency: payment.currency,
});

/** Told when a checkout payment is confirmed or fails (the checkout then places the order or closes). */
export type CheckoutListener = { paid(paymentId: string): Promise<void>; failed(paymentId: string): Promise<void> };

/** Finds the provider for a payment taken through a reseller's own gateway connection (null when it is no longer usable). */
export type OwnGatewayResolver = (connectionId: string, gateway: string) => Promise<CheckoutProvider | null>;

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
    /** The gateway the payer used (`stripe`, `flutterwave`, `monnify`, `pawapay`; `sandbox` in test mode); bank transfers name the account's provider. */
    method: payment.provider,
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
  private checkoutListener: CheckoutListener | null = null;
  private ownGateway: OwnGatewayResolver = async () => null;

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
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly methods: PaymentMethodsService,
  ) {}

  /** The checkout service listens for its payments (registered once at start-up). */
  onCheckout(listener: CheckoutListener) {
    this.checkoutListener = listener;
  }

  /** The checkout service builds providers for resellers' own gateway connections (registered once at start-up). */
  onOwnGateway(resolver: OwnGatewayResolver) {
    this.ownGateway = resolver;
  }

  /**
   * The provider that took a payment: the sandbox, BitoCard's gateway, or the reseller's own account for payments
   * through their connection. Null when it is no longer set up (it is then left pending, never guessed).
   */
  async providerFor(payment: Pick<Payment, 'provider' | 'connectionId' | 'mode'>): Promise<CheckoutProvider | null> {
    if (payment.provider === 'sandbox') return this.providers.sandbox;
    if (payment.connectionId) return this.ownGateway(payment.connectionId, payment.provider);
    return this.providers.checkoutByName(payment.provider);
  }

  /** Tells the owner and finance that money reached the wallet. */
  private toppedUp(payment: { id: string; resellerId: string; mode: LedgerMode; amountMinor: bigint; currency: string }, how: string) {
    return this.inbox.reseller(payment.resellerId, 'top_up.credited', {
      subject: payment.id,
      title: `${formatMoney(payment.amountMinor, payment.currency)} added to your wallet`,
      body: `Your ${how} has been confirmed and added to your wallet.`,
      link: '/wallet',
      mode: payment.mode,
    });
  }

  /** Who the provider should treat as the payer: the signed-in person, or the business owner for API keys. */
  async contactFor(resellerId: string, userId: string | null) {
    const user = userId
      ? await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
      : (await this.prisma.resellerMember.findFirstOrThrow({ where: { resellerId, role: 'owner' }, include: { user: true } })).user;
    return { email: user.email, name: user.name };
  }

  // -- Checkout top-ups ------------------------------------------------------------------------------------------

  /** The ways a reseller can top up now, best first (the market's methods an admin switched on). */
  async topUpMethods(resellerId: string, mode: LedgerMode) {
    const { country } = await this.wallets.currencyOf(resellerId);
    const offered = await this.methods.offered('wallet_top_up', country, mode);
    return { object: 'list' as const, data: offered.map(presentMethod) };
  }

  async createTopUp(resellerId: string, mode: LedgerMode, payer: { email: string; name: string }, input: { amount: number; method?: string; return_url?: string }) {
    const { reseller, country, currency } = await this.wallets.currencyOf(resellerId);
    if (mode === 'live' && reseller.status !== 'active') throw resellerNotVerified();
    const gateway = await this.methods.choose('wallet_top_up', country, mode, input.method);
    const payment = await this.openPayment({
      resellerId,
      mode,
      purpose: 'wallet_top_up',
      gateway,
      reference: `bc_top_${randomUUID().replaceAll('-', '')}`,
      amount: BigInt(input.amount),
      country: country.code,
      currency,
      payer: { email: payer.email, name: reseller.name },
      returnUrl: input.return_url ?? this.config.PAYMENT_RETURN_URL,
      description: 'Wallet top-up',
    });
    return presentTopUp(payment);
  }

  /**
   * Records a payment and opens its payment page with the gateway (the sandbox in test mode). If the page cannot be
   * opened no money can have moved, so the payment is closed as failed and the caller told to try again.
   */
  async openPayment(input: {
    resellerId: string;
    mode: LedgerMode;
    purpose: 'wallet_top_up' | 'checkout';
    gateway: string;
    reference: string;
    amount: bigint;
    country: string;
    currency: string;
    payer: { email: string; name: string };
    returnUrl: string;
    description: string;
    /** A reseller's own gateway: its connection and provider (their account). The payment never enters BitoCard's ledger. */
    own?: { connectionId: string; provider: CheckoutProvider };
    id?: string;
  }) {
    const provider: CheckoutProvider =
      input.mode === 'test' || input.gateway === 'sandbox' ? this.providers.sandbox : (input.own?.provider ?? this.providers.checkout(input.mode, input.gateway, input.country, input.currency));
    const payment = await this.prisma.payment.create({
      data: {
        id: input.id,
        connectionId: input.own?.connectionId ?? null,
        resellerId: input.resellerId,
        mode: input.mode,
        purpose: input.purpose,
        provider: provider.name,
        reference: input.reference,
        amountMinor: input.amount,
        currency: input.currency,
        returnUrl: input.returnUrl,
      },
    });
    try {
      const page = await provider.createCheckout({
        reference: payment.reference,
        amount: payment.amountMinor,
        currency: input.currency,
        country: input.country,
        email: input.payer.email,
        name: input.payer.name,
        returnUrl: input.returnUrl,
        description: input.description,
      });
      return await this.prisma.payment.update({ where: { id: payment.id }, data: { checkoutUrl: page.checkoutUrl, providerTransactionId: page.providerTransactionId ?? null } });
    } catch (error) {
      this.logger.warn({ err: error, paymentId: payment.id, provider: provider.name }, 'Could not start a payment');
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: 'The payment could not be started.', completedAt: new Date() } });
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The payment could not be started. Try again shortly, or choose another payment method.');
    }
  }

  async listTopUps(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const payments = await this.prisma.payment.findMany({
      // Checkout payments and bank transfers into reserved accounts (`source` tells them apart).
      where: { resellerId, mode, purpose: { in: ['wallet_top_up', 'reserved_account_deposit'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: payments.slice(0, limit).map(presentTopUp), has_more: payments.length > limit };
  }

  /**
   * Any top-up the list shows: a checkout payment or a bank transfer into a reserved account. A pending live checkout
   * is checked with the provider before it is returned (transfers are only recorded once they settle).
   */
  async getTopUp(resellerId: string, mode: LedgerMode, id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, resellerId, mode, purpose: { in: ['wallet_top_up', 'reserved_account_deposit'] } } });
    if (!payment) throw notFound('top-up');
    if (payment.status !== 'pending' || payment.mode === 'test' || payment.purpose !== 'wallet_top_up') return presentTopUp(payment);
    return presentTopUp(await this.requery(payment).catch(() => payment));
  }

  /** Asks the provider what happened to a pending top-up or checkout payment. Unclear answers leave it pending. */
  async requery(payment: Payment) {
    if (payment.status !== 'pending' || payment.provider === 'sandbox') return payment;
    const provider = await this.providerFor(payment);
    if (!provider) return payment;
    const result = await provider.verify(paymentRef(payment));
    if (result && result.status !== 'pending') return this.settle(payment, result);
    if (Date.now() - payment.createdAt.getTime() > checkoutLifetimeMs) return this.fail(payment, 'The payment was not completed in time.');
    return payment;
  }

  /** Requeries live top-ups and checkout payments still pending after a couple of minutes. Run on a schedule. */
  async requeryPending(olderThanMs = 2 * 60_000) {
    const pending = await this.prisma.payment.findMany({
      where: { status: 'pending', purpose: { in: ['wallet_top_up', 'checkout'] }, mode: 'live', createdAt: { lt: new Date(Date.now() - olderThanMs) } },
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
      // Checkout payments are the customer's, not the reseller's: no top-up event.
      if (claimed.count === 1 && payment.purpose !== 'checkout') await this.recordEvent(tx, 'top_up.failed', payment.id);
      return claimed.count === 1;
    });
    if (failed) {
      this.events.committed();
      if (payment.purpose === 'checkout') await this.tellCheckout('failed', payment.id);
    }
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private async tellCheckout(what: 'paid' | 'failed', paymentId: string) {
    try {
      await this.checkoutListener?.[what](paymentId);
    } catch (error) {
      // The checkout job finds paid checkouts without an order and closes unpaid ones, so nothing is lost.
      this.logger.error({ err: error, paymentId }, `Checkout could not handle a ${what} payment; the checkout job retries`);
    }
  }

  private async recordEvent(tx: Tx, type: 'top_up.succeeded' | 'top_up.failed', paymentId: string) {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await this.events.record(tx, { resellerId: payment.resellerId, mode: payment.mode, type, object: presentTopUp(payment) });
  }

  /**
   * The payer's money in: the reseller's topped-up funds, or for a checkout what the customer paid (held for their
   * order). The full amount is credited; the provider's fee is BitoCard's cost.
   */
  private creditLines(payment: Pick<Payment, 'resellerId' | 'currency' | 'provider' | 'amountMinor'>, fee: bigint, to: 'reseller_funding' | 'customer_payments' = 'reseller_funding'): Line[] {
    const safeFee = fee > 0n && fee < payment.amountMinor ? fee : 0n;
    return [
      { account: { kind: 'provider_balance', currency: payment.currency, provider: payment.provider }, debit: payment.amountMinor - safeFee },
      ...(safeFee > 0n ? [{ account: { kind: 'processing_fees' as const, currency: payment.currency, provider: payment.provider }, debit: safeFee }] : []),
      { account: { kind: to, currency: payment.currency, resellerId: payment.resellerId }, credit: payment.amountMinor },
    ];
  }

  private async credit(payment: Payment, result: ChargeResult) {
    const checkout = payment.purpose === 'checkout';
    if (payment.connectionId) {
      // Paid into the reseller's own gateway account: the money is theirs, so nothing is posted to BitoCard's ledger.
      const claimed = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'succeeded', providerTransactionId: result.providerTransactionId, feeMinor: result.fee, completedAt: new Date() },
      });
      if (claimed.count === 1 && checkout) await this.tellCheckout('paid', payment.id);
      return;
    }
    const entry = await this.ledger.prepare({
      mode: payment.mode,
      type: checkout ? 'checkout_payment' : 'top_up',
      reference: `payment:${payment.id}`,
      resellerId: payment.resellerId,
      description: checkout ? 'Customer payment at checkout' : 'Wallet top-up',
      metadata: { payment_id: payment.id, provider: payment.provider, provider_transaction_id: result.providerTransactionId },
      lines: this.creditLines(payment, result.fee, checkout ? 'customer_payments' : 'reseller_funding'),
    });
    try {
      const credited = await this.prisma.$transaction(async tx => {
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: { status: 'succeeded', providerTransactionId: result.providerTransactionId, feeMinor: result.fee, completedAt: new Date() },
        });
        if (claimed.count === 1) {
          await this.ledger.write(tx, entry);
          if (!checkout) await this.recordEvent(tx, 'top_up.succeeded', payment.id);
        }
        return claimed.count === 1;
      });
      if (credited && checkout) await this.tellCheckout('paid', payment.id);
      if (credited && !checkout) {
        this.events.committed();
        await this.toppedUp(payment, 'top-up');
      }
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
    return presentTopUp(await this.simulate(payment, outcome));
  }

  /** Finishes a sandbox payment as paid or failed (top-ups, and customer checkouts in the sandbox). */
  async simulate(payment: Payment, outcome: 'succeeded' | 'failed') {
    if (payment.mode !== 'test') throw testModeOnly();
    return this.settle(payment, {
      status: outcome,
      providerTransactionId: `sandbox_${payment.id}`,
      reference: payment.reference,
      amount: payment.amountMinor,
      currency: payment.currency,
      fee: 0n,
      failureReason: outcome === 'failed' ? 'Simulated failure.' : undefined,
    });
  }

  // -- Reserved bank accounts ------------------------------------------------------------------------------------

  async listReservedAccounts(resellerId: string, mode: LedgerMode) {
    const accounts = await this.prisma.reservedAccount.findMany({ where: { resellerId, mode }, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: accounts.map(presentReservedAccount) };
  }

  /**
   * Creates the wallet's reserved bank account(s), trying each provider in turn (Flutterwave, then Monnify in Nigeria).
   * Asking again returns the existing accounts. Live accounts need the country to offer them, BitoCard's
   * `reserved_accounts` switch on for the reseller, and an active reseller; in Nigeria the owner's BVN check must have
   * passed, and its BVN (held encrypted only for this) goes to the bank and is erased once the accounts exist.
   */
  async createReservedAccounts(resellerId: string, mode: LedgerMode, owner: { email: string }) {
    const { reseller, country, currency } = await this.wallets.currencyOf(resellerId);
    if (!country.reservedAccounts) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'reserved_accounts_unavailable', 'Reserved bank accounts are not available in your country yet. Top up through checkout instead.');
    }
    const existing = await this.listReservedAccounts(resellerId, mode);
    if (existing.data.length) return existing;
    let bvn: { recordId: string; value: string } | undefined;
    if (mode === 'live') {
      if (reseller.status !== 'active') throw resellerNotVerified();
      if (!(await this.settings.isOn('reserved_accounts', resellerId))) {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'reserved_accounts_not_enabled', 'Bank transfer accounts are not switched on for your account yet. Contact BitoCard support, or top up through checkout.');
      }
      if (country.code === 'NG') bvn = await this.verifiedBvn(resellerId);
    }

    let refused = false;
    for (const provider of this.providers.reservedAccounts(mode, country.code, currency)) {
      const reference = `bc_ra_${mode}_${resellerId.replaceAll('-', '')}`;
      try {
        const accounts = await provider.createReservedAccount({ reference, email: owner.email, name: reseller.name, currency, bvn: bvn?.value });
        await this.prisma.reservedAccount.createMany({
          data: accounts.map(account => ({ resellerId, mode, provider: provider.name, currency, providerReference: reference, ...account })),
          skipDuplicates: true,
        });
        // The bank has it now: BitoCard keeps no BVN.
        if (bvn) await this.prisma.identityVerification.update({ where: { id: bvn.recordId }, data: { secretEncrypted: null } });
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

  /** The owner's verified BVN, held encrypted on their passed BVN check until the accounts are opened. */
  private async verifiedBvn(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const check = await this.prisma.identityVerification.findFirst({
      where: { resellerId, subject: 'reseller', method: 'bvn', status: 'approved', secretEncrypted: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!reseller.bvnVerifiedAt || !check?.secretEncrypted) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'bvn_check_required', "The business owner's BVN must be checked first (POST /v1/account/bvn).");
    }
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return { recordId: check.id, value: new Encryption(key).decrypt(check.secretEncrypted) };
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
      await this.toppedUp({ id, ...base, mode: account.mode }, 'bank transfer');
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

  /**
   * A notification naming a payment by the provider's own ID (Stripe's session, pawaPay's deposit) or our reference
   * (Monnify's paymentReference). It only says something happened: the payment is re-read from the provider.
   */
  async paymentNotice(provider: string, by: { providerTransactionId?: string; reference?: string }) {
    const payment = by.providerTransactionId
      ? await this.prisma.payment.findUnique({ where: { provider_providerTransactionId: { provider, providerTransactionId: by.providerTransactionId } } })
      : by.reference
        ? await this.prisma.payment.findUnique({ where: { reference: by.reference } })
        : null;
    if (!payment || payment.provider !== provider) return { handled: false, reason: 'unknown_payment' };
    const settled = await this.requery(payment);
    return { handled: true, status: settled.status };
  }

  async monnifyDeposit(transactionReference: string) {
    const monnify = this.providers.monnify;
    if (!monnify) return { handled: false };
    return { handled: true, ...(await this.recordDeposit('monnify', await monnify.verifyTransaction(transactionReference))) };
  }
}
