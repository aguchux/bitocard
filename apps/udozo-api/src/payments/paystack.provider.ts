import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, providerRequest } from './provider-error.js';
import type { ChargeResult, CheckoutInput, CheckoutProvider, PaymentRef, RefundResult } from './providers.js';

type PaystackResponse<T> = { status: boolean; message?: string; data: T };
type PaystackTransaction = { id: number; reference: string; status: string; amount: number; currency: string; fees?: number | null; gateway_response?: string | null };
type PaystackRefund = { id: number; status: string; transaction?: number | { id?: number } };

/**
 * The country each Paystack market takes payments in, in its own currency. A Paystack account belongs to one country
 * and takes that country's currency (US dollars only where Paystack enables them for the account), so admins switch
 * Paystack on only in the market BitoCard's account (or the reseller's) is in.
 */
const checkoutCurrencies: Record<string, string> = { NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR' };

/**
 * Paystack's references take only letters, digits, `-`, `.` and `=`. Ours are `bc_<kind>_<hex>` and never contain a dot,
 * so underscores are sent as dots and turned back on the way in: the same payment always has the same Paystack reference.
 */
export const toPaystackReference = (reference: string) => reference.replaceAll('_', '.');
export const fromPaystackReference = (reference: string) => reference.replaceAll('.', '_');

/**
 * Paystack's transaction statuses that will not turn into a payment. `abandoned` is not one of them: it is how Paystack
 * shows a payment page opened but not paid yet, which the payer can still pay; the payment's own lifetime closes it.
 */
const notPaid = new Set(['failed', 'reversed']);

/**
 * Paystack (Nigeria, Ghana, Kenya, South Africa): payment pages (card, bank transfer, USSD, mobile money where local)
 * and refunds. Amounts are in the currency's subunit (kobo, pesewas, cents), which are BitoCard's minor units. Test keys
 * (sk_test_…) use the same address as live ones.
 */
export class PaystackProvider implements CheckoutProvider {
  readonly name = 'paystack';

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
  ) {}

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await providerRequest<PaystackResponse<T>>(this.name, `${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${this.secretKey}` } });
    if (!res?.status) throw new ProviderError(this.name, res?.message ?? 'request refused', true);
    return res.data;
  }

  /** Webhooks are signed: HMAC-SHA512 of the raw body with the secret key, in the x-paystack-signature header. */
  webhookTrusted(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature) return false;
    const expected = Buffer.from(createHmac('sha512', this.secretKey).update(rawBody).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  supportsCheckout(country: string, currency: string) {
    return checkoutCurrencies[country] === currency;
  }

  async createCheckout(input: CheckoutInput) {
    const data = await this.call<{ authorization_url?: string; reference?: string }>('/transaction/initialize', {
      method: 'POST',
      body: {
        reference: toPaystackReference(input.reference),
        amount: input.amount.toString(),
        currency: input.currency,
        email: input.email,
        callback_url: input.returnUrl,
        metadata: { custom_fields: [{ display_name: 'For', variable_name: 'description', value: input.description }], cancel_action: input.returnUrl },
      },
    });
    if (!data?.authorization_url) throw new ProviderError(this.name, 'no payment link returned', false);
    return { checkoutUrl: data.authorization_url };
  }

  async verify(payment: PaymentRef): Promise<ChargeResult | null> {
    let tx: PaystackTransaction;
    try {
      tx = await this.call<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(toPaystackReference(payment.reference))}`);
    } catch (error) {
      // Paystack answers 400 or 404 while it has no transaction for the reference (the page was never opened). A
      // refused key (401, 403) is not "no transaction": it is reported.
      if (error instanceof ProviderError && error.definite && (error.status === 400 || error.status === 404)) return null;
      throw error;
    }
    return this.charge(tx);
  }

  private charge(tx: PaystackTransaction): ChargeResult {
    const status = String(tx.status ?? '').toLowerCase();
    const failed = notPaid.has(status);
    return {
      status: status === 'success' ? 'succeeded' : failed ? 'failed' : 'pending',
      providerTransactionId: String(tx.id),
      reference: fromPaystackReference(tx.reference),
      amount: BigInt(Math.round(Number(tx.amount ?? 0))),
      currency: tx.currency,
      fee: BigInt(Math.round(Number(tx.fees ?? 0))),
      failureReason: failed ? (tx.gateway_response ?? `Payment ${status}`) : undefined,
    };
  }

  /** Refunds go against Paystack's transaction ID, which the payment holds once it has settled. */
  async refund(payment: PaymentRef & { refundReference: string }): Promise<RefundResult> {
    if (!payment.providerTransactionId) throw new ProviderError(this.name, 'no transaction to refund', true);
    // Paystack's refunds take no reference of ours, so a retry after a timeout could refund twice: look for a refund of
    // this transaction first (a failed one does not count). If the lookup fails, the error is not definite and the
    // refund is retried later rather than risk sending a second one.
    const existing = await this.existingRefund(payment.providerTransactionId);
    if (existing) return this.refundResult(existing);
    const data = await this.call<PaystackRefund>('/refund', {
      method: 'POST',
      body: {
        transaction: payment.providerTransactionId,
        amount: payment.amount.toString(),
        currency: payment.currency,
        customer_note: 'Refund for an order that could not be fulfilled',
        merchant_note: payment.refundReference,
      },
    });
    return this.refundResult(data);
  }

  /** The transaction's refund that has not failed, if any (`GET /refund?transaction=<id>`). */
  private async existingRefund(transactionId: string) {
    const refunds = await this.call<PaystackRefund[]>(`/refund?transaction=${encodeURIComponent(transactionId)}&perPage=100`);
    const ofTransaction = (refund: PaystackRefund) => String(typeof refund.transaction === 'object' ? refund.transaction?.id : refund.transaction) === transactionId;
    return (Array.isArray(refunds) ? refunds : []).find(refund => ofTransaction(refund) && String(refund.status ?? '').toLowerCase() !== 'failed') ?? null;
  }

  async refundStatus(payment: { providerRefundId: string }): Promise<RefundResult> {
    return this.refundResult(await this.call<PaystackRefund>(`/refund/${encodeURIComponent(payment.providerRefundId)}`));
  }

  /** `processed` has reached the payer; `pending`, `processing` and `needs-attention` (Paystack asks for the payer's bank details) wait. */
  private refundResult(data: PaystackRefund): RefundResult {
    const status = String(data.status ?? '').toLowerCase();
    return {
      status: status === 'processed' ? 'refunded' : status === 'failed' ? 'failed' : 'pending',
      providerRefundId: String(data.id),
      failureReason: status === 'failed' ? 'Refund failed' : undefined,
    };
  }
}
