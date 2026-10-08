import { timingSafeEqual } from 'node:crypto';
import type { BvnProvider, CheckResult } from '../identity/providers.js';
import { ProviderError, providerRequest } from './provider-error.js';
import {
  type ChargeResult,
  type CheckoutInput,
  type CheckoutProvider,
  type PaymentRef,
  type RefundResult,
  fromMajor,
  type ReservedAccountDetails,
  type ReservedAccountProvider,
  toMajor,
  type TransferProvider,
  type TransferResult,
} from './providers.js';

type FlwResponse<T> = { status: string; message?: string; data: T };
type FlwCharge = { id: number; tx_ref: string; status: string; amount: number; currency: string; app_fee?: number; processor_response?: string };
type FlwRefund = { id: number; status: string; comments?: string; tx_id?: number | string };
type FlwTransfer = { id: number; status: string; fee?: number; complete_message?: string; reference?: string };

/** Countries Flutterwave's payment page takes payments from (cards everywhere; bank and mobile money where local). */
const checkoutCountries = new Set(['NG', 'GH', 'KE', 'UG', 'TZ', 'RW', 'ZA', 'ZM', 'MW', 'CM', 'CI', 'SN', 'SL', 'EG', 'US', 'GB']);
/** Bank payouts. */
const transferCountries = new Set(['NG', 'GH', 'KE']);
const reservedAccountCountries = new Set(['NG', 'GH']);

/** Flutterwave v3: payment pages, refunds, reserved (virtual) accounts, bank payouts and offered exchange rates. */
export class FlutterwaveProvider implements CheckoutProvider, ReservedAccountProvider, TransferProvider, BvnProvider {
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

  // -- BVN (Nigeria) ---------------------------------------------------------------------------------------------

  /** Starts BVN consent: the holder approves on the NIBSS page, then the record is released to us. */
  async startBvnConsent(input: { bvn: string; firstName: string; lastName: string; redirectUrl: string }) {
    const res = await this.call<{ url?: string; reference?: string }>('/bvn/verifications', {
      method: 'POST',
      body: { bvn: input.bvn, firstname: input.firstName, lastname: input.lastName, redirect_url: input.redirectUrl },
    });
    if (!res.data?.url || !res.data.reference) throw new ProviderError(this.name, 'no consent link returned', false);
    return { providerReference: res.data.reference, url: res.data.url };
  }

  /** COMPLETED releases the name on the BVN record; anything else is still waiting for consent. The BVN data is not kept. */
  async bvnResult(reference: string): Promise<CheckResult> {
    const res = await this.call<{ status?: string; first_name?: string; last_name?: string }>(`/bvn/verifications/${encodeURIComponent(reference)}`);
    const status = String(res.data?.status ?? '').toUpperCase();
    if (status === 'COMPLETED') return { status: 'approved', firstName: res.data.first_name, lastName: res.data.last_name };
    if (status === 'FAILED' || status === 'DECLINED') return { status: 'declined', reason: 'bvn_consent_declined' };
    return { status: 'in_progress' };
  }

  supportsCheckout(country: string) {
    return checkoutCountries.has(country);
  }

  async createCheckout(input: CheckoutInput) {
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

  verify(payment: PaymentRef) {
    return this.verifyByReference(payment.reference);
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

  /** Refunds go against Flutterwave's transaction ID, which the payment holds once it has settled. */
  async refund(payment: PaymentRef & { refundReference: string }): Promise<RefundResult> {
    if (!payment.providerTransactionId) throw new ProviderError(this.name, 'no transaction to refund', true);
    // Flutterwave's refund takes no reference of ours, so a retry after a timeout could refund twice: look for a refund
    // of this transaction first (a failed one does not count). If the lookup itself fails, the error is not definite and
    // the refund is retried later rather than risk sending a second one.
    const existing = await this.existingRefund(payment.providerTransactionId);
    if (existing) return this.refundResult(existing);
    const res = await this.call<FlwRefund>(`/transactions/${encodeURIComponent(payment.providerTransactionId)}/refund`, { method: 'POST', body: { amount: Number(toMajor(payment.amount)) } });
    return this.refundResult(res.data);
  }

  /** The transaction's refund that has not failed, if any (`GET /refunds?id=<transaction id>`). */
  private async existingRefund(transactionId: string) {
    const to = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const res = await this.call<FlwRefund[]>(`/refunds?id=${encodeURIComponent(transactionId)}&from=2020-01-01&to=${to}`);
    const refunds = Array.isArray(res.data) ? res.data : [];
    return refunds.find(refund => String(refund.tx_id) === transactionId && String(refund.status ?? '').toLowerCase() !== 'failed') ?? null;
  }

  async refundStatus(payment: { providerRefundId: string }): Promise<RefundResult> {
    const res = await this.call<FlwRefund>(`/refunds/${encodeURIComponent(payment.providerRefundId)}`);
    return this.refundResult(res.data);
  }

  private refundResult(data: FlwRefund): RefundResult {
    const status = String(data.status ?? '').toLowerCase();
    return {
      status: status === 'completed' || status === 'successful' ? 'refunded' : status === 'failed' ? 'failed' : 'pending',
      providerRefundId: String(data.id),
      failureReason: status === 'failed' ? (data.comments ?? 'Refund failed') : undefined,
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
    return transferCountries.has(country);
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
