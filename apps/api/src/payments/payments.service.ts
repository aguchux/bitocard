import { Encryption } from '../common/encryption.js';
import { SettingsService } from '../settings/settings.service.js';
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, type Payment, Prisma, type ReservedAccount } from '../generated/prisma/client.js';

const Decimal = Prisma.Decimal;
import { type Line, LedgerService, type Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { FxService } from '../fx/fx.service.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { type PaymentGateway, paymentGateways, PaymentProviders } from './payment-providers.js';
import { ProviderError } from './provider-error.js';
import { EventsService } from '../webhooks/events.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import type { ChargeResult, CheckoutProvider, PaymentRef } from './providers.js';

/** What a payment record gives its provider to look it up: what the gateway charged (another currency, if it did). */
export const paymentRef = (payment: Payment): PaymentRef => ({
  reference: payment.reference,
  providerTransactionId: payment.providerTransactionId,
  amount: payment.chargeAmountMinor ?? payment.amountMinor,
  currency: payment.chargeCurrency ?? payment.currency,
});

/** An amount the gateway reported in the payment's charge currency, in the payment's own currency (proportionally). */
export function inPaymentCurrency(payment: Pick<Payment, 'amountMinor' | 'chargeAmountMinor'>, charged: bigint) {
  if (!payment.chargeAmountMinor) return charged;
  return (charged * payment.amountMinor) / payment.chargeAmountMinor;
}

/** Told when a checkout payment is confirmed or fails (the checkout then places the order or closes). */
export type CheckoutListener = { paid(paymentId: string): Promise<void>; failed(paymentId: string): Promise<void> };

/** Finds the provider for a payment taken through a reseller's own gateway connection (null when it is no longer usable). */
export type OwnGatewayResolver = (connectionId: string, gateway: string) => Promise<CheckoutProvider | null>;

const day = 24 * 60 * 60 * 1000;
/** A checkout not paid within this time is closed as failed. */
const checkoutLifetimeMs = day;
/** Refusals before finance is asked to refund unmatched money by hand. */
const maxUnmatchedRefundAttempts = 5;

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
    private readonly fx: FxService,
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
    return { object: 'list' as const, data: await Promise.all(offered.map(gateway => this.methods.describe(gateway, country))) };
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
    purpose: 'wallet_top_up' | 'checkout' | 'customer_top_up';
    /** A customer's wallet top-up: whose wallet it is credited to. */
    customerId?: string;
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
      input.mode === 'test' || input.gateway === 'sandbox' ? this.providers.sandbox : (input.own?.provider ?? (await this.providers.checkout(input.mode, input.gateway, input.country, input.currency)));
    const payment = await this.prisma.payment.create({
      data: {
        id: input.id,
        connectionId: input.own?.connectionId ?? null,
        resellerId: input.resellerId,
        customerId: input.customerId ?? null,
        mode: input.mode,
        purpose: input.purpose,
        provider: provider.name,
        reference: input.reference,
        amountMinor: input.amount,
        currency: input.currency,
        returnUrl: input.returnUrl,
      },
    });
    const open = (charge: { amount: bigint; currency: string }) =>
      provider.createCheckout({
        reference: payment.reference,
        amount: charge.amount,
        currency: charge.currency,
        country: input.country,
        email: input.payer.email,
        name: input.payer.name,
        returnUrl: input.returnUrl,
        description: input.description,
      });
    try {
      const fallback = provider.fallbackCurrency && provider.fallbackCurrency !== input.currency.toUpperCase() ? provider.fallbackCurrency : null;
      let charge: { amount: bigint; currency: string } | null = fallback && provider.takesCurrency?.(input.currency) === false ? await this.convertCharge(input.amount, input.currency, fallback) : null;
      let page;
      try {
        page = await open(charge ?? { amount: input.amount, currency: input.currency });
      } catch (error) {
        // The gateway cannot take the local currency: charge its fallback (Stripe: US dollars) instead.
        if (charge || !fallback || !(error instanceof ProviderError) || error.code !== 'currency_unsupported') throw error;
        charge = await this.convertCharge(input.amount, input.currency, fallback);
        page = await open(charge);
      }
      return await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          checkoutUrl: page.checkoutUrl,
          providerTransactionId: page.providerTransactionId ?? null,
          ...(charge ? { chargeAmountMinor: charge.amount, chargeCurrency: charge.currency } : {}),
        },
      });
    } catch (error) {
      this.logger.warn({ err: error, paymentId: payment.id, provider: provider.name }, 'Could not start a payment');
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: 'The payment could not be started.', completedAt: new Date() } });
      // A clear refusal (bad credentials, a disabled product) needs an admin: say why, once a day per gateway and mode.
      if (error instanceof ProviderError && error.definite && !input.own) {
        await this.inbox.admins('admin.payment.gateway_refused', {
          subject: `${provider.name}:${input.mode}:${new Date().toISOString().slice(0, 10)}`,
          title: `${paymentGateways[provider.name as PaymentGateway]?.name ?? provider.name} refused to open a payment`,
          body: `${error.message} Customers and resellers paying with it see "The payment could not be started" until this is fixed.`,
          link: '/settings/integrations',
          mode: input.mode,
        });
      }
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The payment could not be started. Try again shortly, or choose another payment method.');
    }
  }

  /**
   * The amount to charge in another currency for an amount owed: converted at the `receive` rate (what BitoCard gets
   * when converting the charge back), rounded up, so the charge always covers what is owed. Only US dollars for now.
   */
  private async convertCharge(amount: bigint, currency: string, to: string) {
    if (to !== 'USD') throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', 'This payment method cannot take your currency.');
    const rate = await this.fx.rate(currency.toUpperCase());
    const usd = new Decimal(amount.toString()).div(rate.receive).toDecimalPlaces(0, Decimal.ROUND_UP);
    return { amount: BigInt(usd.toFixed(0)) > 0n ? BigInt(usd.toFixed(0)) : 1n, currency: to };
  }

  async listTopUps(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const payments = await this.prisma.payment.findMany({
      // Checkout payments and bank transfers into reserved accounts (`source` tells them apart).
      where: { resellerId, mode, customerId: null, purpose: { in: ['wallet_top_up', 'reserved_account_deposit'] } },
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
    const payment = await this.prisma.payment.findFirst({ where: { id, resellerId, mode, customerId: null, purpose: { in: ['wallet_top_up', 'reserved_account_deposit'] } } });
    if (!payment) throw notFound('top-up');
    if (payment.status !== 'pending' || payment.mode === 'test' || payment.purpose !== 'wallet_top_up') return presentTopUp(payment);
    return presentTopUp(await this.requery(payment).catch(() => payment));
  }

  /** Asks the provider what happened to a pending top-up or checkout payment. Unclear answers leave it pending. */
  async requery(payment: Payment) {
    if (payment.status !== 'pending' || payment.provider === 'sandbox') return payment;
    const provider = await this.providerFor(payment);
    if (!provider) {
      // The gateway is no longer usable (a reseller's own connection suspended, rejected or switched off): it can never be
      // checked, so after its lifetime it is closed instead of holding the checkout and BitoCard's fee open for ever.
      if (Date.now() - payment.createdAt.getTime() <= checkoutLifetimeMs) return payment;
      this.logger.error({ paymentId: payment.id, provider: payment.provider, own: Boolean(payment.connectionId) }, 'Pending payment closed: its gateway can no longer be checked');
      return this.fail(payment, 'The payment could not be confirmed.');
    }
    const result = await provider.verify(paymentRef(payment));
    if (result && result.status !== 'pending') return this.settle(payment, result);
    if (Date.now() - payment.createdAt.getTime() > checkoutLifetimeMs) return this.fail(payment, 'The payment was not completed in time.');
    return payment;
  }

  /** Requeries live top-ups and checkout payments still pending after a couple of minutes. Run on a schedule. */
  async requeryPending(olderThanMs = 2 * 60_000) {
    const pending = await this.prisma.payment.findMany({
      where: { status: 'pending', purpose: { in: ['wallet_top_up', 'checkout', 'customer_top_up'] }, mode: 'live', createdAt: { lt: new Date(Date.now() - olderThanMs) } },
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
    // Money that could not be credited, still to refund (or whose refund is still to confirm).
    const unmatched = await this.prisma.payment.findMany({
      where: { unmatchedAt: { not: null }, unmatchedRefundedAt: null, unmatchedRefundAttempts: { lt: maxUnmatchedRefundAttempts } },
      select: { id: true },
      take: 50,
    });
    for (const payment of unmatched) await this.refundUnmatched(payment.id);
    return { checked: pending.length, settled };
  }

  /** Applies a confirmed result from the provider. Safe to call repeatedly and concurrently. */
  async settle(payment: Payment, result: ChargeResult) {
    if (result.status === 'pending') return payment;
    if (result.status === 'failed') return this.fail(payment, result.failureReason ?? 'The payment failed.');
    // Checked against what the gateway was asked to charge (in its charge currency, if it used another one).
    const asked = paymentRef(payment);
    if (result.reference !== payment.reference || result.currency !== asked.currency || result.amount !== asked.amount) {
      this.logger.error({ paymentId: payment.id, result: { ...result, amount: String(result.amount), fee: String(result.fee) } }, 'Payment does not match the top-up; refunding');
      await this.fail(payment, 'The amount paid did not match, so it is being refunded.');
      // Only money paid against this payment's own reference is ours to refund.
      if (result.reference === payment.reference) await this.unmatched(payment, result, 'mismatch');
      return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }
    await this.credit(payment, result);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private async fail(payment: Payment, reason: string) {
    const failed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed', failureReason: reason, completedAt: new Date() } });
      // Checkout payments and customers' wallet top-ups are the customer's, not the reseller's: no top-up event.
      if (claimed.count === 1 && payment.purpose === 'wallet_top_up') await this.recordEvent(tx, 'top_up.failed', payment.id);
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
  private creditLines(
    payment: Pick<Payment, 'resellerId' | 'currency' | 'provider' | 'amountMinor'> & { customerId?: string | null },
    fee: bigint,
    to: 'reseller_funding' | 'customer_payments' = 'reseller_funding',
  ): Line[] {
    const safeFee = fee > 0n && fee < payment.amountMinor ? fee : 0n;
    // A customer's top-up goes to their own wallet; the gateway's fee is still BitoCard's cost.
    const credited: Line = payment.customerId
      ? { account: { kind: 'customer_wallet', currency: payment.currency, customerId: payment.customerId }, credit: payment.amountMinor }
      : { account: { kind: to, currency: payment.currency, resellerId: payment.resellerId }, credit: payment.amountMinor };
    return [
      { account: { kind: 'provider_balance', currency: payment.currency, provider: payment.provider }, debit: payment.amountMinor - safeFee },
      ...(safeFee > 0n ? [{ account: { kind: 'processing_fees' as const, currency: payment.currency, provider: payment.provider }, debit: safeFee }] : []),
      credited,
    ];
  }

  /** Tells the customer their wallet was topped up (in their store's app). */
  private async customerToppedUp(payment: { id: string; customerId: string | null; mode: LedgerMode; amountMinor: bigint; currency: string }, how: string) {
    if (!payment.customerId) return;
    const customer = await this.prisma.customer.findUnique({ where: { id: payment.customerId }, select: { id: true, storeId: true } });
    if (!customer) return;
    await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.wallet.credited', {
      subject: payment.id,
      title: `${formatMoney(payment.amountMinor, payment.currency)} added to your wallet`,
      body: `Your ${how} has been confirmed and added to your wallet.`,
      link: '/account/wallet',
      mode: payment.mode,
    });
  }

  private async credit(payment: Payment, charged: ChargeResult) {
    const checkout = payment.purpose === 'checkout';
    // The gateway's fee comes in what it charged; booked in the payment's own currency (proportionally).
    const result = { ...charged, fee: inPaymentCurrency(payment, charged.fee) };
    if (payment.connectionId) {
      // Paid into the reseller's own gateway account: the money is theirs, so nothing is posted to BitoCard's ledger.
      const claimed = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'succeeded', providerTransactionId: result.providerTransactionId, feeMinor: result.fee, completedAt: new Date() },
      });
      if (claimed.count === 1 && checkout) await this.tellCheckout('paid', payment.id);
      if (claimed.count === 0) await this.paidAfterClosing(payment.id, result);
      return;
    }
    const customerTopUp = payment.purpose === 'customer_top_up';
    const entry = await this.ledger.prepare({
      mode: payment.mode,
      type: checkout ? 'checkout_payment' : customerTopUp ? 'customer_top_up' : 'top_up',
      reference: `payment:${payment.id}`,
      // A customer's wallet is not the reseller's money: kept out of the reseller's wallet transactions.
      resellerId: customerTopUp ? null : payment.resellerId,
      description: checkout ? 'Customer payment at checkout' : customerTopUp ? 'Customer wallet top-up' : 'Wallet top-up',
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
          if (payment.purpose === 'wallet_top_up') await this.recordEvent(tx, 'top_up.succeeded', payment.id);
        }
        return claimed.count === 1;
      });
      if (credited && checkout) await this.tellCheckout('paid', payment.id);
      if (credited && customerTopUp) await this.customerToppedUp(payment, 'top-up');
      if (credited && payment.purpose === 'wallet_top_up') {
        this.events.committed();
        await this.toppedUp(payment, 'top-up');
      }
      if (!credited) await this.paidAfterClosing(payment.id, result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.error({ paymentId: payment.id, providerTransactionId: result.providerTransactionId }, 'Provider transaction already credited elsewhere; needs review');
        return;
      }
      throw error;
    }
  }

  /**
   * A success for a payment that could not be claimed: already credited (nothing to do), or already closed as failed,
   * for example a declined card retried on the same gateway page. That money can never be credited, so it is refunded.
   */
  private async paidAfterClosing(paymentId: string, result: ChargeResult) {
    const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (current.status !== 'failed' || current.mode !== 'live' || result.reference !== current.reference) return;
    this.logger.error({ paymentId, providerTransactionId: result.providerTransactionId }, 'Payment succeeded after it was closed; refunding');
    await this.unmatched(current, result, 'late');
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
    const accounts = await this.prisma.reservedAccount.findMany({ where: { resellerId, mode, customerId: null }, orderBy: { createdAt: 'asc' } });
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

  /**
   * A store customer's reserved bank account(s), through Flutterwave (the sandbox in test mode): transfers into them top
   * up the customer's wallet in the seller's currency. Asking again returns the existing ones. In Nigeria Flutterwave
   * needs the customer's BVN: passed to it and never kept.
   */
  async createCustomerReservedAccounts(input: {
    customer: { id: string; email: string; name: string };
    sellerId: string;
    mode: LedgerMode;
    country: { code: string; currency: string; reservedAccounts: boolean };
    bvn?: string;
  }) {
    const { customer, mode, country } = input;
    if (!country.reservedAccounts) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'reserved_accounts_unavailable', 'Bank account numbers are not available in your country yet. Top up with a card or mobile money instead.');
    }
    const existing = await this.customerReservedAccounts(customer.id, mode, country.currency);
    if (existing.length) return existing;
    if (mode === 'live' && country.code === 'NG' && !input.bvn) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Enter your BVN: the bank needs it to open your account number. We do not keep it.', 'bvn');
    }
    const providers = mode === 'test' ? this.providers.reservedAccounts(mode, country.code, country.currency) : this.providers.reservedAccounts(mode, country.code, country.currency).filter(provider => provider.name === 'flutterwave');
    if (providers.length === 0) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', 'Bank account numbers are unavailable right now. Top up with a card or mobile money instead.');
    let refused = false;
    for (const provider of providers) {
      const reference = `bc_rc_${mode}_${customer.id.replaceAll('-', '')}`;
      try {
        const accounts = await provider.createReservedAccount({ reference, email: customer.email, name: customer.name, currency: country.currency, bvn: input.bvn });
        await this.prisma.reservedAccount.createMany({
          data: accounts.map(account => ({ resellerId: input.sellerId, customerId: customer.id, mode, provider: provider.name, currency: country.currency, providerReference: reference, ...account })),
          skipDuplicates: true,
        });
        return this.customerReservedAccounts(customer.id, mode, country.currency);
      } catch (error) {
        refused ||= error instanceof ProviderError && error.definite;
        this.logger.warn({ err: error, provider: provider.name, customerId: customer.id }, 'Customer reserved account provider failed');
      }
    }
    if (refused) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'reserved_account_refused', 'The bank could not open your account number. Check your BVN and name, then try again.', 'bvn');
    }
    throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'Bank account numbers are unavailable right now. Try again shortly.');
  }

  /** A customer's reserved bank accounts in one mode and currency. */
  customerReservedAccounts(customerId: string, mode: LedgerMode, currency: string) {
    return this.prisma.reservedAccount.findMany({ where: { customerId, mode, currency }, orderBy: { createdAt: 'asc' } });
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
    const base = { resellerId: account.resellerId, customerId: account.customerId, currency: account.currency, provider, amountMinor: result.amount };
    const entry = await this.ledger.prepare({
      mode: account.mode,
      type: account.customerId ? 'customer_deposit' : 'deposit',
      reference: `payment:${id}`,
      resellerId: account.customerId ? null : account.resellerId,
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
        if (!account.customerId) await this.recordEvent(tx, 'top_up.succeeded', id);
      });
      if (account.customerId) {
        await this.customerToppedUp({ id, ...base, mode: account.mode }, 'bank transfer');
      } else {
        this.events.committed();
        await this.toppedUp({ id, ...base, mode: account.mode }, 'bank transfer');
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { credited: false, reason: 'duplicate' };
      throw error;
    }
    return { credited: true, payment_id: id };
  }

  async simulateDeposit(resellerId: string, mode: LedgerMode, accountId: string, amount: number) {
    if (mode !== 'test') throw testModeOnly();
    const account = await this.prisma.reservedAccount.findFirst({ where: { id: accountId, resellerId, mode: 'test', customerId: null } });
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
    if (payment.status === 'failed') {
      await this.recheckClosed(payment);
      return { handled: true, status: payment.status };
    }
    const settled = await this.requery(payment);
    return { handled: true, status: settled.status };
  }

  // -- Money that cannot be credited -------------------------------------------------------------------------------

  /**
   * A notification for a payment already closed as failed: some gateways' pages still take money after BitoCard has
   * given up on them. Re-read it; money taken now cannot be credited (the checkout or top-up is closed), so it is refunded.
   */
  private async recheckClosed(payment: Payment) {
    if (payment.unmatchedAt || payment.provider === 'sandbox') return;
    const provider = await this.providerFor(payment);
    if (!provider) return;
    const result = await provider.verify(paymentRef(payment));
    if (result?.status === 'succeeded' && result.reference === payment.reference) await this.unmatched(payment, result, 'late');
  }

  /** Records money that cannot be credited, tells finance once, and refunds it in full through the same gateway. */
  private async unmatched(payment: Payment, result: ChargeResult, reason: 'late' | 'mismatch') {
    const flagged = await this.prisma.payment.updateMany({
      where: { id: payment.id, unmatchedAt: null },
      data: {
        unmatchedReason: reason,
        unmatchedAmountMinor: result.amount,
        unmatchedCurrency: result.currency,
        unmatchedTransactionId: result.providerTransactionId,
        unmatchedAt: new Date(),
      },
    });
    if (flagged.count === 1) {
      const where = payment.connectionId ? `the reseller's own ${payment.provider} account` : payment.provider;
      const paid = formatMoney(result.amount, result.currency);
      await this.inbox.admins('admin.payment.unmatched', {
        subject: payment.id,
        title: 'A payment could not be credited',
        body:
          reason === 'late'
            ? `${paid} was paid through ${where} after the payment had closed. It is being refunded to the payer.`
            : `${paid} was paid through ${where} for a payment of ${formatMoney(payment.amountMinor, payment.currency)}. It is being refunded to the payer.`,
        link: '/orders',
        mode: payment.mode,
      });
    }
    await this.refundUnmatched(payment.id);
  }

  /**
   * Refunds unmatched money: the same reference on every retry (a new one only after the gateway refused), so a retry
   * after a timeout finds the refund already made. Never throws; the payments job retries.
   */
  async refundUnmatched(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.unmatchedAt || payment.unmatchedRefundedAt || payment.unmatchedAmountMinor === null || !payment.unmatchedCurrency) return;
    if (payment.unmatchedRefundAttempts >= maxUnmatchedRefundAttempts) return;
    let refused = false;
    const provider = await this.providerFor(payment).catch(() => null);
    if (!provider) {
      refused = true;
      this.logger.error({ paymentId, provider: payment.provider }, 'Unmatched payment needs a gateway that is no longer set up');
    } else {
      const base = `bc_rf_pay_${payment.id.replaceAll('-', '')}`;
      const ref = {
        reference: payment.reference,
        providerTransactionId: payment.unmatchedTransactionId,
        amount: payment.unmatchedAmountMinor,
        currency: payment.unmatchedCurrency,
        refundReference: payment.unmatchedRefundAttempts > 0 ? `${base}_${payment.unmatchedRefundAttempts}` : base,
      };
      try {
        const result = payment.unmatchedRefundId ? await provider.refundStatus({ ...ref, providerRefundId: payment.unmatchedRefundId }) : await provider.refund(ref);
        refused = result.status === 'failed';
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: refused ? { unmatchedRefundId: null } : { unmatchedRefundId: result.providerRefundId, ...(result.status === 'refunded' ? { unmatchedRefundedAt: new Date() } : {}) },
        });
      } catch (error) {
        refused = error instanceof ProviderError && error.definite;
        this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', paymentId }, 'Unmatched payment not refunded yet; the payments job retries');
      }
    }
    if (!refused) return;
    const after = await this.prisma.payment.update({ where: { id: payment.id }, data: { unmatchedRefundAttempts: { increment: 1 } } });
    if (after.unmatchedRefundAttempts === maxUnmatchedRefundAttempts) {
      await this.inbox.admins('admin.payment.unmatched_refund_stuck', {
        subject: payment.id,
        title: 'A refund of an uncredited payment needs attention',
        body: `Refunding ${formatMoney(payment.unmatchedAmountMinor, payment.unmatchedCurrency)} through ${payment.provider} failed ${maxUnmatchedRefundAttempts} times. Refund the payer by hand.`,
        link: '/orders',
        mode: payment.mode,
      });
    }
  }

  async monnifyDeposit(transactionReference: string) {
    const monnify = this.providers.monnify;
    if (!monnify) return { handled: false };
    return { handled: true, ...(await this.recordDeposit('monnify', await monnify.verifyTransaction(transactionReference))) };
  }
}
