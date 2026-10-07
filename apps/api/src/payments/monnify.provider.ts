import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, providerRequest } from './provider-error.js';
import {
  type ChargeResult,
  type CheckoutInput,
  type CheckoutProvider,
  fromMajor,
  type PaymentRef,
  type RefundResult,
  type ReservedAccountDetails,
  type ReservedAccountProvider,
  toMajor,
} from './providers.js';

type MonnifyResponse<T> = { requestSuccessful: boolean; responseMessage?: string; responseBody: T };
type MonnifyTransaction = {
  transactionReference: string;
  paymentStatus: string;
  amountPaid: number | string;
  settlementAmount?: number | string;
  currencyCode?: string;
  currency?: string;
  product?: { type: string; reference: string };
};
type MonnifyCheckoutTransaction = {
  transactionReference: string;
  paymentReference: string;
  paymentStatus: string;
  amountPaid?: number | string;
  totalPayable?: number | string;
  settlementAmount?: number | string;
  currency?: string;
  currencyCode?: string;
};
type MonnifyRefund = { refundReference: string; refundStatus: string; comment?: string };

/** Monnify's payment statuses that will not turn into a payment. */
const notPaid = new Set(['FAILED', 'EXPIRED', 'ABANDONED', 'CANCELLED', 'REVERSED']);

/** Monnify (Nigeria): payment pages (card and bank transfer), refunds, and reserved accounts after Flutterwave. */
export class MonnifyProvider implements ReservedAccountProvider, CheckoutProvider {
  readonly name = 'monnify';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly contractCode: string,
    private readonly baseUrl: string,
  ) {}

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');
    const res = await providerRequest<MonnifyResponse<{ accessToken: string; expiresIn: number }>>(this.name, `${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}` },
      body: {},
    });
    this.token = { value: res.responseBody.accessToken, expiresAt: Date.now() + res.responseBody.expiresIn * 1000 };
    return this.token.value;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const token = await this.accessToken();
    const res = await providerRequest<MonnifyResponse<T>>(this.name, `${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } });
    if (!res.requestSuccessful) throw new ProviderError(this.name, res.responseMessage ?? 'request refused', true);
    return res.responseBody;
  }

  /** Webhooks are signed: HMAC-SHA512 of the raw body with the secret key, in the monnify-signature header. */
  webhookTrusted(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature) return false;
    const expected = Buffer.from(createHmac('sha512', this.secretKey).update(rawBody).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  supportsCheckout(country: string, currency: string) {
    return country === 'NG' && currency === 'NGN';
  }

  /** Monnify's own transaction reference comes back at once and is kept, so a check or a notification finds the payment. */
  async createCheckout(input: CheckoutInput) {
    const body = await this.call<{ transactionReference: string; checkoutUrl: string }>('/api/v1/merchant/transactions/init-transaction', {
      method: 'POST',
      body: {
        amount: Number(toMajor(input.amount)),
        customerName: input.name,
        customerEmail: input.email,
        paymentReference: input.reference,
        paymentDescription: input.description,
        currencyCode: input.currency,
        contractCode: this.contractCode,
        redirectUrl: input.returnUrl,
        paymentMethods: ['CARD', 'ACCOUNT_TRANSFER', 'USSD'],
      },
    });
    if (!body?.checkoutUrl) throw new ProviderError(this.name, 'no checkout link returned', false);
    return { checkoutUrl: body.checkoutUrl, providerTransactionId: body.transactionReference };
  }

  async verify(payment: PaymentRef): Promise<ChargeResult | null> {
    let tx: MonnifyCheckoutTransaction;
    try {
      tx = await this.call<MonnifyCheckoutTransaction>(`/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(payment.reference)}`);
    } catch (error) {
      // Monnify answers 4xx while it has no transaction for the reference.
      if (error instanceof ProviderError && error.definite) return null;
      throw error;
    }
    const status = String(tx.paymentStatus ?? '').toUpperCase();
    const amount = fromMajor(tx.amountPaid ?? 0);
    const settled = tx.settlementAmount === undefined ? amount : fromMajor(tx.settlementAmount);
    return {
      // OVERPAID still paid at least the amount; the amount check refuses anything else.
      status: status === 'PAID' || status === 'OVERPAID' ? 'succeeded' : notPaid.has(status) ? 'failed' : 'pending',
      providerTransactionId: tx.transactionReference,
      reference: tx.paymentReference,
      amount: status === 'OVERPAID' ? payment.amount : amount,
      currency: tx.currencyCode ?? tx.currency ?? 'NGN',
      fee: amount > settled ? amount - settled : 0n,
      failureReason: notPaid.has(status) ? `Payment ${status.toLowerCase()}` : undefined,
    };
  }

  async refund(payment: PaymentRef & { refundReference: string }): Promise<RefundResult> {
    if (!payment.providerTransactionId) throw new ProviderError(this.name, 'no transaction to refund', true);
    const body = await this.call<MonnifyRefund>('/api/v1/refunds/initiate-refund', {
      method: 'POST',
      body: {
        transactionReference: payment.providerTransactionId,
        refundReference: payment.refundReference,
        refundAmount: Number(toMajor(payment.amount)),
        refundReason: 'Order could not be fulfilled',
        customerNote: 'Refund for an order that could not be fulfilled',
      },
    });
    return this.refundResult(body);
  }

  async refundStatus(payment: { refundReference: string }): Promise<RefundResult> {
    return this.refundResult(await this.call<MonnifyRefund>(`/api/v1/refunds/${encodeURIComponent(payment.refundReference)}`));
  }

  private refundResult(body: MonnifyRefund): RefundResult {
    const status = String(body.refundStatus ?? '').toUpperCase();
    return {
      status: status === 'COMPLETED' ? 'refunded' : status === 'FAILED' ? 'failed' : 'pending',
      providerRefundId: body.refundReference,
      failureReason: status === 'FAILED' ? (body.comment ?? 'Refund failed') : undefined,
    };
  }

  supportsReservedAccounts(country: string, currency: string) {
    return country === 'NG' && currency === 'NGN';
  }

  async createReservedAccount(input: { reference: string; email: string; name: string; currency: string; bvn?: string }): Promise<ReservedAccountDetails[]> {
    const body = await this.call<{ accounts: Array<{ bankName: string; accountNumber: string; accountName: string }> }>('/api/v2/bank-transfer/reserved-accounts', {
      method: 'POST',
      body: {
        accountReference: input.reference,
        accountName: input.name,
        currencyCode: input.currency,
        contractCode: this.contractCode,
        customerEmail: input.email,
        customerName: input.name,
        bvn: input.bvn,
        getAllAvailableBanks: true,
      },
    });
    return body.accounts.map(account => ({ bankName: account.bankName, accountNumber: account.accountNumber, accountName: account.accountName }));
  }

  /** Looks a transaction up at Monnify, never trusting the webhook body alone. */
  async verifyTransaction(transactionReference: string): Promise<ChargeResult> {
    const tx = await this.call<MonnifyTransaction>(`/api/v2/transactions/${encodeURIComponent(transactionReference)}`);
    const amount = fromMajor(tx.amountPaid);
    const settled = tx.settlementAmount === undefined ? amount : fromMajor(tx.settlementAmount);
    return {
      status: tx.paymentStatus === 'PAID' ? 'succeeded' : tx.paymentStatus === 'FAILED' ? 'failed' : 'pending',
      providerTransactionId: tx.transactionReference,
      reference: tx.product?.reference ?? '',
      amount,
      currency: tx.currencyCode ?? tx.currency ?? 'NGN',
      fee: amount > settled ? amount - settled : 0n,
    };
  }
}
