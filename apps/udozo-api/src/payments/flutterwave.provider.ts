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
type FlwVirtualAccount = { account_number?: string; bank_name?: string; order_ref?: string; flw_ref?: string; note?: string; account_status?: string };
type FlwListedCharge = { id: number; tx_ref?: string; status?: string; payment_type?: string; currency?: string };
type FlwPage<T> = FlwResponse<T> & { meta?: { page_info?: { total?: number; current_page?: number; total_pages?: number } } };

/** Our references for reserved accounts: resellers' (`bc_ra_`) and store customers' (`bc_rc_`). */
export const reservedReference = /^bc_r[ac]_/;

/**
 * The narration Flutterwave shows as the account's name: letters, digits, spaces and a little punctuation, at most 35
 * characters (its limit), never empty.
 */
export function accountNarration(name: string) {
  const clean = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 .&'-]/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || 'Udozo wallet').slice(0, 35).trim();
}

/**
 * The name the payer's bank shows for the account, from Flutterwave's note ("Please make a bank transfer to Ada
 * Digital FLW"), else the narration sent. Payers check it before they send, so it must be what the bank shows.
 */
export function shownAccountName(note: string | undefined, narration: string) {
  const match = /transfer to (.+?)\.?\s*$/i.exec(note ?? '');
  return match?.[1]?.trim() || narration;
}

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
        customizations: { title: 'Udozo', description: input.description },
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

  /**
   * A static (permanent) account number (`POST /v3/virtual-account-numbers`, `is_permanent: true`). Every transfer into
   * it carries `tx_ref`, our reference, which is how deposits find their wallet. Nigeria (NGN) needs the BVN. Ghana
   * (GHS) takes no BVN but needs the holder's first and last name and phone number, and is enabled only for Ghanaian
   * merchants unless Flutterwave switches it on (hi@flutterwavego.com). The narration is the account's name (at most 35
   * characters). A reply without an account number is unclear, never a refusal: the account may exist.
   */
  async createReservedAccount(input: { reference: string; email: string; name: string; currency: string; bvn?: string; firstName?: string; lastName?: string; phone?: string }): Promise<ReservedAccountDetails[]> {
    const narration = accountNarration(input.name);
    const holder = {
      ...(input.firstName ? { firstname: input.firstName } : {}),
      ...(input.lastName ? { lastname: input.lastName } : {}),
      ...(input.phone ? { phonenumber: input.phone } : {}),
    };
    const body =
      input.currency === 'GHS'
        ? { currency: 'GHS', is_permanent: true, email: input.email, tx_ref: input.reference, narration, ...holder }
        : { currency: input.currency, is_permanent: true, email: input.email, bvn: input.bvn, tx_ref: input.reference, narration, ...holder };
    const res = await this.call<FlwVirtualAccount>('/virtual-account-numbers', { method: 'POST', body });
    const account = res.data;
    if (res.status !== 'success' || !account?.account_number || !account.bank_name) {
      throw new ProviderError(this.name, `virtual account reply without an account number (${res.message ?? res.status})`, false);
    }
    return [{ bankName: account.bank_name, accountNumber: account.account_number, accountName: shownAccountName(account.note, narration), providerAccountId: account.order_ref }];
  }

  /**
   * Successful bank transfers into our reserved accounts between two days (inclusive), one page at a time
   * (`GET /v3/transactions`): the IDs to re-read, so a deposit whose notification never came is still credited.
   */
  async reservedDeposits(input: { from: string; to: string; page: number }) {
    const query = new URLSearchParams({ from: input.from, to: input.to, page: String(input.page), status: 'successful' });
    const res = (await this.call<FlwListedCharge[]>(`/transactions?${query.toString()}`)) as FlwPage<FlwListedCharge[]>;
    const rows = Array.isArray(res.data) ? res.data : [];
    return {
      ids: rows.filter(row => reservedReference.test(row.tx_ref ?? '') && String(row.status).toLowerCase() === 'successful').map(row => String(row.id)),
      lastPage: (res.meta?.page_info?.total_pages ?? 1) <= input.page || rows.length === 0,
    };
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
