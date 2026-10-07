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
  payment_intent?: string | { id: string; latest_charge?: string | { balance_transaction?: string | { fee?: number } | null } | null } | null;
};
type Refund = { id: string; status?: string; failure_reason?: string | null };

/** Currencies Stripe counts in whole units (no cents); BitoCard keeps two decimal places for every currency. */
const zeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
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
 * Stripe: card payments on Stripe Checkout, and refunds. The Checkout Session's ID is the payment's provider ID (kept
 * when the page is opened), so checks and notifications find it; the session's `client_reference_id` is our reference.
 * Stripe's fee is read from the charge's balance transaction.
 */
export class StripeProvider implements CheckoutProvider {
  readonly name = 'stripe';

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly webhookSecret?: string,
  ) {}

  private call<T>(path: string, init: { method?: string; form?: Record<string, string> } = {}) {
    return providerRequest<T>(this.name, `${this.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers: { authorization: `Bearer ${this.secretKey}` } });
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

  async createCheckout(input: CheckoutInput) {
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
        'metadata[reference]': input.reference,
        'payment_intent_data[metadata][reference]': input.reference,
      },
    });
    if (!session.url) throw new ProviderError(this.name, 'no checkout link returned', false);
    return { checkoutUrl: session.url, providerTransactionId: session.id };
  }

  private session(id: string) {
    return this.call<Session>(`/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge.balance_transaction`);
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
      return { status: 'succeeded', ...base, fee: balance?.fee ? fromStripe(balance.fee, currency) : 0n };
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
