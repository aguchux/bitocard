import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, providerRequest } from './provider-error.js';
import { type ChargeResult, fromMajor, type ReservedAccountDetails, type ReservedAccountProvider } from './providers.js';

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

/** Monnify: reserved accounts in Nigeria, the second source after Flutterwave. */
export class MonnifyProvider implements ReservedAccountProvider {
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
