import { timingSafeEqual } from 'node:crypto';
import { pawapayCountry } from '../suppliers/pawapay.adapter.js';
import { ProviderError, providerRequest } from './provider-error.js';
import { type ChargeResult, type CheckoutInput, type CheckoutProvider, fromMajor, type PaymentRef, type RefundResult, toMajor, uuidFor } from './providers.js';

type Found<T> = { status?: 'FOUND' | 'NOT_FOUND' | string; data?: T };
type Deposit = {
  depositId: string;
  status?: string;
  amount?: string;
  currency?: string;
  providerTransactionId?: string;
  clientReferenceId?: string;
  failureReason?: { failureCode?: string; failureMessage?: string };
};
type Refund = { refundId: string; status?: string; failureReason?: { failureCode?: string; failureMessage?: string } };

/** pawaPay's amount: whole when there are no cents (some currencies take no decimals), otherwise two places. */
const amountOf = (amount: bigint) => (amount % 100n === 0n ? String(amount / 100n) : toMajor(amount));

/**
 * pawaPay deposits: mobile money payments through pawaPay's payment page (the payer picks their provider and approves
 * on their phone), and refunds. The deposit ID is a UUID made from our reference, kept as the payment's provider ID,
 * so callbacks (which carry only the deposit ID) and checks find it.
 */
export class PawapayPaymentsProvider implements CheckoutProvider {
  readonly name = 'pawapay';

  constructor(
    private readonly apiToken: string,
    private readonly baseUrl: string,
    private readonly callbackToken?: string,
  ) {}

  private call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const token = this.apiToken.trim().replace(/^bearer\s+/i, '');
    return providerRequest<T>(this.name, `${this.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } });
  }

  /** Deposit callbacks carry the token set in the callback address (`?token=`). */
  callbackTrusted(token: string | undefined) {
    if (!this.callbackToken || !token) return false;
    const expected = Buffer.from(this.callbackToken);
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  supportsCheckout(country: string) {
    return pawapayCountry(country) !== null;
  }

  async createCheckout(input: CheckoutInput) {
    const country = pawapayCountry(input.country);
    if (!country) throw new ProviderError(this.name, `no mobile money in ${input.country}`, true);
    const depositId = uuidFor('deposit', input.reference);
    const res = await this.call<{ redirectUrl?: string }>('/v2/paymentpage', {
      method: 'POST',
      body: {
        depositId,
        returnUrl: input.returnUrl,
        // Shown on the payer's statement: 4 to 22 letters, numbers or spaces.
        customerMessage: 'BitoCard payment',
        amountDetails: { amount: amountOf(input.amount), currency: input.currency },
        country,
        reason: input.description.slice(0, 50),
        metadata: [{ reference: input.reference }],
      },
    });
    if (!res.redirectUrl) throw new ProviderError(this.name, 'no payment page returned', false);
    return { checkoutUrl: res.redirectUrl, providerTransactionId: depositId };
  }

  async verify(payment: PaymentRef): Promise<ChargeResult | null> {
    const depositId = payment.providerTransactionId ?? uuidFor('deposit', payment.reference);
    const res = await this.call<Found<Deposit>>(`/v2/deposits/${encodeURIComponent(depositId)}`);
    const deposit = res.status === 'FOUND' ? res.data : undefined;
    if (!deposit) return null;
    const status = String(deposit.status ?? '').toUpperCase();
    return {
      status: status === 'COMPLETED' ? 'succeeded' : status === 'FAILED' ? 'failed' : 'pending',
      providerTransactionId: depositId,
      // The deposit ID is made from our reference, so a match on it is a match on the reference.
      reference: payment.reference,
      amount: fromMajor(deposit.amount ?? 0),
      currency: deposit.currency ?? payment.currency,
      fee: 0n,
      failureReason: status === 'FAILED' ? (deposit.failureReason?.failureMessage ?? deposit.failureReason?.failureCode ?? 'Payment failed') : undefined,
    };
  }

  async refund(payment: PaymentRef & { refundReference: string }): Promise<RefundResult> {
    const refundId = uuidFor('refund', payment.refundReference);
    const res = await this.call<{ refundId?: string; status?: string; failureReason?: { failureMessage?: string } }>('/v2/refunds', {
      method: 'POST',
      body: { refundId, depositId: payment.providerTransactionId ?? uuidFor('deposit', payment.reference), amount: amountOf(payment.amount), currency: payment.currency },
    });
    const status = String(res.status ?? '').toUpperCase();
    // ACCEPTED (or a repeat, DUPLICATE_IGNORED) is on its way; REJECTED was refused.
    if (status === 'REJECTED') return { status: 'failed', providerRefundId: refundId, failureReason: res.failureReason?.failureMessage ?? 'Refund refused' };
    return { status: 'pending', providerRefundId: refundId };
  }

  async refundStatus(payment: { providerRefundId: string }): Promise<RefundResult> {
    const res = await this.call<Found<Refund>>(`/v2/refunds/${encodeURIComponent(payment.providerRefundId)}`);
    const status = String(res.data?.status ?? '').toUpperCase();
    return {
      status: status === 'COMPLETED' ? 'refunded' : status === 'FAILED' ? 'failed' : 'pending',
      providerRefundId: payment.providerRefundId,
      failureReason: status === 'FAILED' ? (res.data?.failureReason?.failureMessage ?? 'Refund failed') : undefined,
    };
  }
}
