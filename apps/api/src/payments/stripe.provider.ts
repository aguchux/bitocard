import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, providerRequest } from './provider-error.js';
import type { ChargeResult, CheckoutInput, CheckoutProvider, PaymentRef, RefundResult } from './providers.js';

type Session = {
  id: string;
  url?: string | null;
  status?: 'open' | 'complete' | 'expired' | null;
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id: string; latest_charge?: string | { balance_transaction?: string | BalanceTransaction | null } | null } | null;
};
/** In the Stripe account's settlement currency, which can differ from the charge's; `exchange_rate` converts charge to settlement. */
type BalanceTransaction = { fee?: number; currency?: string; exchange_rate?: number | null };
type Refund = { id: string; status?: string; failure_reason?: string | null };

/** Currencies Stripe counts in whole units (no cents); BitoCard keeps two decimal places for every currency. */
const zeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
/** Currencies a Stripe account refused (by a hash of its key), so later payments go straight to US dollars. */
const refusedCurrencies = new Map<string, Set<string>>();

/**
 * Stripe accounts (by a hash of the key) that refused the `managed_payments` parameter as unknown, so later sessions
 * leave it out instead of being refused once each.
 */
const noManagedPaymentsParam = new Set<string>();

/** Forgets the currencies Stripe refused and the accounts that do not know `managed_payments` (tests, or after the account changes). */
export function forgetStripeCurrencies() {
  refusedCurrencies.clear();
  noManagedPaymentsParam.clear();
}

/**
 * When Stripe's page expires, in Unix seconds: BitoCard's timeout, kept within what Stripe takes (30 minutes to 24
 * hours from now, with a minute's margin each way).
 */
export function stripeExpiry(at: Date, now = Date.now()) {
  const minute = 60_000;
  const clamped = Math.min(Math.max(at.getTime(), now + 31 * minute), now + 24 * 60 * minute - minute);
  return Math.floor(clamped / 1000);
}

/** How far a webhook's signed time may be from ours. */
const toleranceSeconds = 300;

/** BitoCard's minor units (cents) to Stripe's amount in the currency's smallest unit. */
export function stripeAmount(amount: bigint, currency: string) {
  if (!zeroDecimal.has(currency.toUpperCase())) return amount;
  if (amount % 100n !== 0n) throw new ProviderError('stripe', `${currency} takes whole amounts only`, true);
  return amount / 100n;
}

const fromStripe = (amount: number, currency: string) => (zeroDecimal.has(currency.toUpperCase()) ? BigInt(amount) * 100n : BigInt(amount));

/**
 * Stripe's fee in the charge's currency. The balance transaction is in the account's settlement currency: when that
 * differs, the fee is converted back with the transaction's own exchange rate (none given: the fee is not booked).
 */
export function stripeFee(balance: BalanceTransaction, chargeCurrency: string) {
  if (!balance.fee) return 0n;
  const settlement = (balance.currency ?? chargeCurrency).toUpperCase();
  const fee = fromStripe(balance.fee, settlement);
  if (settlement === chargeCurrency.toUpperCase()) return fee;
  if (!balance.exchange_rate || balance.exchange_rate <= 0) return 0n;
  return BigInt(Math.round(Number(fee) / balance.exchange_rate));
}

/**
 * Stripe: card payments on Stripe Checkout, and refunds. The Checkout Session's ID is the payment's provider ID (kept
 * when the page is opened), so checks and notifications find it; the session's `client_reference_id` is our reference.
 * Stripe's fee is read from the charge's balance transaction.
 */
/**
 * Stripe product tax codes by what is paid for (Managed Payments requires one, and accepts only digital products):
 * software is downloadable software for personal use. Other categories get the account's default code, if set.
 */
export const stripeTaxCodes: Record<string, string> = { software: 'txcd_10202000', vpn: 'txcd_10202000' };

export class StripeProvider implements CheckoutProvider {
  readonly name = 'stripe';
  /** Cards are charged in US dollars where the account cannot take the local currency. */
  readonly fallbackCurrency = 'USD';

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly webhookSecret?: string,
    /** The code for payments with none of their own (`STRIPE_TAX_CODE`). */
    private readonly defaultTaxCode?: string,
  ) {}

  /** The product tax code to send for a payment, or null to send none. */
  taxCodeFor(category: string | null | undefined) {
    return (category ? stripeTaxCodes[category] : undefined) ?? this.defaultTaxCode ?? null;
  }

  private call<T>(path: string, init: { method?: string; form?: Record<string, string>; idempotencyKey?: string } = {}) {
    const { idempotencyKey, ...rest } = init;
    const headers: Record<string, string> = { authorization: `Bearer ${this.secretKey}` };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    return providerRequest<T>(this.name, `${this.baseUrl.replace(/\/+$/, '')}${path}`, { ...rest, headers });
  }

  /**
   * Stripe-Signature: `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` with the endpoint's signing secret, within five
   * minutes of now.
   */
  webhookTrusted(rawBody: Buffer | undefined, header: string | undefined, now = Date.now()) {
    if (!this.webhookSecret || !rawBody || !header) return false;
    const parts = header.split(',').map(part => part.split('=') as [string, string]);
    const signedAt = parts.find(([key]) => key === 't')?.[1] ?? '';
    if (!/^\d+$/.test(signedAt) || Math.abs(now / 1000 - Number(signedAt)) > toleranceSeconds) return false;
    const expected = Buffer.from(createHmac('sha256', this.webhookSecret).update(`${signedAt}.`).update(rawBody).digest('hex'));
    return parts
      .filter(([key]) => key === 'v1')
      .some(([, value]) => {
        const given = Buffer.from(value ?? '');
        return given.length === expected.length && timingSafeEqual(given, expected);
      });
  }

  /** Stripe takes cards from anywhere; which markets offer it is an admin's choice. */
  supportsCheckout(_country: string, currency: string) {
    return /^[A-Z]{3}$/.test(currency);
  }

  private get accountKey() {
    return createHmac('sha256', 'stripe-account').update(this.secretKey).digest('hex').slice(0, 16);
  }

  takesCurrency(currency: string) {
    return !refusedCurrencies.get(this.accountKey)?.has(currency.toUpperCase());
  }

  async createCheckout(input: CheckoutInput) {
    try {
      return await this.openSession(input);
    } catch (error) {
      // "Invalid currency: ghs ... Your account currently supports these currencies: usd, ...": remembered, so the
      // payment (and later ones) can be charged in US dollars instead.
      if (error instanceof ProviderError && error.status === 400 && /invalid currency/i.test(error.message)) {
        const refused = refusedCurrencies.get(this.accountKey) ?? new Set<string>();
        refused.add(input.currency.toUpperCase());
        refusedCurrencies.set(this.accountKey, refused);
        throw new ProviderError(this.name, `the Stripe account cannot take ${input.currency.toUpperCase()}`, true, 400, 'currency_unsupported');
      }
      // Managed Payments applied although every session opts out (or the account does not know the opt-out) and this
      // payment has no eligible tax code: a clear refusal, explained.
      if (error instanceof ProviderError && error.status === 400 && /tax[ _]code/i.test(error.message)) {
        throw new ProviderError(
          this.name,
          `${error.message.replace(/^stripe: /, '')} Stripe applied Managed Payments to this payment although BitoCard opts out of it on every payment, and it only takes digital products with an eligible tax code. Turn it off in the Stripe dashboard (Settings > Managed Payments) or ask Stripe Support to disable it for the account; wallet top-ups, gift cards, airtime and other products cannot be paid through it.`,
          true,
          400,
        );
      }
      throw error;
    }
  }

  /**
   * BitoCard is the seller of record, so every session opts out of Stripe Managed Payments (where Stripe would be the
   * seller, and which takes only digital products): accounts that have it on by default, with no account-wide switch,
   * still take top-ups, gift cards and airtime. An account whose API version does not know the parameter is asked
   * again without it, once, and remembered.
   */
  private async openSession(input: CheckoutInput) {
    const optOut = !noManagedPaymentsParam.has(this.accountKey);
    try {
      return await this.sessionFor(input, optOut);
    } catch (error) {
      if (!optOut || !(error instanceof ProviderError) || error.status !== 400 || !/unknown parameter[^.]*managed_payments/i.test(error.message)) throw error;
      noManagedPaymentsParam.add(this.accountKey);
      return this.sessionFor(input, false);
    }
  }

  private async sessionFor(input: CheckoutInput, optOut: boolean) {
    const taxCode = this.taxCodeFor(input.category);
    const session = await this.call<Session>('/v1/checkout/sessions', {
      method: 'POST',
      form: {
        mode: 'payment',
        client_reference_id: input.reference,
        customer_email: input.email,
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': input.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(stripeAmount(input.amount, input.currency)),
        'line_items[0][price_data][product_data][name]': input.description,
        ...(taxCode ? { 'line_items[0][price_data][product_data][tax_code]': taxCode } : {}),
        'metadata[reference]': input.reference,
        'payment_intent_data[metadata][reference]': input.reference,
        ...(optOut ? { 'managed_payments[enabled]': 'false' } : {}),
        ...(input.expiresAt ? { expires_at: String(stripeExpiry(input.expiresAt)) } : {}),
      },
    });
    if (!session.url) throw new ProviderError(this.name, 'no checkout link returned', false);
    return { checkoutUrl: session.url, providerTransactionId: session.id };
  }

  /**
   * A dispute as Stripe has it now, with the Checkout session it belongs to (our payment's provider transaction ID).
   * `outcome` is set once decided: won (or an inquiry closed without a chargeback) or lost.
   */
  async dispute(id: string) {
    const dispute = await this.call<{ id: string; amount: number; currency: string; status: string; reason?: string | null; payment_intent?: string | null }>(
      `/v1/disputes/${encodeURIComponent(id)}`,
    );
    const currency = dispute.currency.toUpperCase();
    const sessions = dispute.payment_intent
      ? await this.call<{ data: Session[] }>(`/v1/checkout/sessions?payment_intent=${encodeURIComponent(dispute.payment_intent)}&limit=1`)
      : { data: [] };
    const outcome = dispute.status === 'lost' ? ('lost' as const) : dispute.status === 'won' || dispute.status === 'warning_closed' ? ('won' as const) : null;
    return { id: dispute.id, amount: fromStripe(dispute.amount, currency), currency, status: dispute.status, reason: dispute.reason ?? null, sessionId: sessions.data[0]?.id ?? null, outcome };
  }

  private session(id: string) {
    return this.call<Session>(`/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge.balance_transaction`);
  }

  /** Expires the Checkout Session so it can no longer be paid. Stripe refuses (400) once it is complete or already expired. */
  async closePage(payment: PaymentRef) {
    if (!payment.providerTransactionId) return;
    await this.call(`/v1/checkout/sessions/${encodeURIComponent(payment.providerTransactionId)}/expire`, { method: 'POST', form: {} });
  }

  async verify(payment: PaymentRef): Promise<ChargeResult | null> {
    if (!payment.providerTransactionId) return null;
    const session = await this.session(payment.providerTransactionId);
    const currency = (session.currency ?? payment.currency).toUpperCase();
    const base = { providerTransactionId: session.id, reference: session.client_reference_id ?? '', amount: fromStripe(session.amount_total ?? 0, currency), currency };
    if (session.payment_status === 'paid') {
      const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
      const charge = intent && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      const balance = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
      return { status: 'succeeded', ...base, fee: balance ? stripeFee(balance, currency) : 0n };
    }
    if (session.status === 'expired') return { status: 'failed', ...base, fee: 0n, failureReason: 'The payment page expired before it was paid.' };
    // Paid by a method that settles later (bank debits): still waiting. An open page has not been paid yet.
    if (session.status === 'complete') return { status: 'pending', ...base, fee: 0n };
    return null;
  }

  async refund(payment: PaymentRef & { refundReference: string }): Promise<RefundResult> {
    if (!payment.providerTransactionId) throw new ProviderError(this.name, 'no payment to refund', true);
    const session = await this.call<Session>(`/v1/checkout/sessions/${encodeURIComponent(payment.providerTransactionId)}`);
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intent) throw new ProviderError(this.name, 'the payment has no charge to refund', true);
    const refund = await this.call<Refund>('/v1/refunds', {
      method: 'POST',
      form: { payment_intent: intent, amount: String(stripeAmount(payment.amount, payment.currency)), 'metadata[reference]': payment.refundReference },
      // A retry after a timeout returns the refund already made instead of making a second one.
      idempotencyKey: payment.refundReference,
    });
    return this.refundResult(refund);
  }

  async refundStatus(payment: { providerRefundId: string }): Promise<RefundResult> {
    return this.refundResult(await this.call<Refund>(`/v1/refunds/${encodeURIComponent(payment.providerRefundId)}`));
  }

  private refundResult(refund: Refund): RefundResult {
    const status = refund.status ?? '';
    return {
      status: status === 'succeeded' ? 'refunded' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending',
      providerRefundId: refund.id,
      failureReason: status === 'failed' || status === 'canceled' ? (refund.failure_reason ?? 'Refund failed') : undefined,
    };
  }

  /** A harmless check of the key (Test connection). */
  async balance() {
    return this.call<{ object: string }>('/v1/balance');
  }
}
