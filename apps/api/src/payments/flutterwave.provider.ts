import { timingSafeEqual } from 'node:crypto';
import { ProviderError, providerRequest } from './provider-error';
import {
  type ChargeResult,
  type CheckoutProvider,
  fromMajor,
  type ReservedAccountDetails,
  type ReservedAccountProvider,
  toMajor,
  type TransferProvider,
  type TransferResult,
} from './providers';

type FlwResponse<T> = { status: string; message?: string; data: T };
type FlwCharge = { id: number; tx_ref: string; status: string; amount: number; currency: string; app_fee?: number; processor_response?: string };
type FlwTransfer = { id: number; status: string; fee?: number; complete_message?: string; reference?: string };

const checkoutCountries = new Set(['NG', 'GH', 'KE']);
const reservedAccountCountries = new Set(['NG', 'GH']);

/** Flutterwave v3: checkout, reserved (virtual) accounts, bank payouts and offered exchange rates. */
export class FlutterwaveProvider implements CheckoutProvider, ReservedAccountProvider, TransferProvider {
  readonly name = 'flutterwave';

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly webhookHash?: string,
  ) {}

  private call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    return providerRequest<FlwResponse<T>>(this.name, `${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${this.secretKey}` } });
  }

  /** Webhooks carry the secret hash configured in the Flutterwave dashboard. */
  webhookTrusted(header: string | undefined) {
    if (!this.webhookHash || !header) return false;
    const expected = Buffer.from(this.webhookHash);
    const given = Buffer.from(header);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  supportsCheckout(country: string) {
    return checkoutCountries.has(country);
  }

  async createCheckout(input: { reference: string; amount: bigint; currency: string; email: string; name: string; returnUrl: string; description: string }) {
    const res = await this.call<{ link: string }>('/payments', {
      method: 'POST',
      body: {
        tx_ref: input.reference,
        amount: toMajor(input.amount),
        currency: input.currency,
        redirect_url: input.returnUrl,
        customer: { email: input.email, name: input.name },
        customizations: { title: 'BitoCard', description: input.description },
      },
    });
    if (!res.data?.link) throw new ProviderError(this.name, 'no payment link returned', false);
    return { checkoutUrl: res.data.link };
  }

  async verifyByReference(reference: string) {
    try {
      const res = await this.call<FlwCharge>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
      return this.charge(res.data);
    } catch (error) {
      // Flutterwave answers 4xx when it has no transaction for the reference yet (the payer has not paid).
      if (error instanceof ProviderError && error.definite) return null;
      throw error;
    }
  }

  async verifyById(id: string) {
    const res = await this.call<FlwCharge>(`/transactions/${encodeURIComponent(id)}/verify`);
    return this.charge(res.data);
  }

  private charge(data: FlwCharge): ChargeResult {
    const status = data.status === 'successful' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending';
    return {
      status,
      providerTransactionId: String(data.id),
      reference: data.tx_ref,
      amount: fromMajor(data.amount),
      currency: data.currency,
      fee: fromMajor(data.app_fee),
      failureReason: status === 'failed' ? (data.processor_response ?? 'Payment failed') : undefined,
    };
  }

  supportsReservedAccounts(country: string) {
    return reservedAccountCountries.has(country);
  }

  async createReservedAccount(input: { reference: string; email: string; name: string; currency: string; bvn?: string }): Promise<ReservedAccountDetails[]> {
    const res = await this.call<{ account_number: string; bank_name: string }>('/virtual-account-numbers', {
      method: 'POST',
      body: { email: input.email, is_permanent: true, bvn: input.bvn, tx_ref: input.reference, narration: input.name, currency: input.currency },
    });
    return [{ bankName: res.data.bank_name, accountNumber: res.data.account_number, accountName: input.name }];
  }

  supportsTransfers(country: string) {
    return checkoutCountries.has(country);
  }

  async listBanks(country: string) {
    const res = await this.call<Array<{ code: string; name: string }>>(`/banks/${encodeURIComponent(country)}`);
    return res.data.map(bank => ({ code: bank.code, name: bank.name }));
  }

  async resolveAccount(input: { bankCode: string; accountNumber: string }) {
    const res = await this.call<{ account_name: string }>('/accounts/resolve', {
      method: 'POST',
      body: { account_number: input.accountNumber, account_bank: input.bankCode },
    });
    return { accountName: res.data.account_name };
  }

  async transfer(input: { reference: string; bankCode: string; accountNumber: string; amount: bigint; currency: string; narration: string }) {
    const res = await this.call<FlwTransfer>('/transfers', {
      method: 'POST',
      body: {
        account_bank: input.bankCode,
        account_number: input.accountNumber,
        amount: Number(toMajor(input.amount)),
        currency: input.currency,
        debit_currency: input.currency,
        reference: input.reference,
        narration: input.narration,
      },
    });
    return this.transferResult(res.data);
  }

  async transferStatus(providerTransferId: string) {
    const res = await this.call<FlwTransfer>(`/transfers/${encodeURIComponent(providerTransferId)}`);
    return this.transferResult(res.data);
  }

  private transferResult(data: FlwTransfer): TransferResult {
    const status = data.status === 'SUCCESSFUL' ? 'paid' : data.status === 'FAILED' ? 'failed' : 'pending';
    return {
      status,
      providerTransferId: String(data.id),
      reference: data.reference,
      fee: fromMajor(data.fee),
      failureReason: status === 'failed' ? (data.complete_message ?? 'Transfer failed') : undefined,
    };
  }

  /** Units of `currency` Flutterwave charges for one US dollar. */
  async unitsPerUsd(currency: string) {
    const res = await this.call<{ source: { amount: number }; destination: { amount: number } }>(
      `/transfers/rates?amount=1&destination_currency=USD&source_currency=${encodeURIComponent(currency)}`,
    );
    return res.data.source.amount / res.data.destination.amount;
  }
}
