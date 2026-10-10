import { timingSafeEqual } from 'node:crypto';
import { createHash } from 'node:crypto';
import { pawapayAlpha2, pawapayCountry } from '../suppliers/pawapay.adapter.js';
import { errorText, ProviderError, providerRequest } from './provider-error.js';
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

type PaymentPageReply = { redirectUrl?: string; status?: string; failureReason?: { failureCode?: string; failureMessage?: string } };

type OperationConfig = { operationType?: string; status?: string };
type ActiveConf = {
  countries?: Array<{
    country: string;
    providers?: Array<{ provider?: string; displayName?: string; currencies?: Array<{ currency: string; operationTypes?: OperationConfig[] | Record<string, OperationConfig> }> }>;
  }>;
};

/** Each country's (alpha-2) currencies and, per currency, the mobile money networks taking deposits, from pawaPay's active configuration. */
export function depositCountries(conf: ActiveConf) {
  const countries = new Map<string, Map<string, string[]>>();
  for (const country of conf.countries ?? []) {
    const code = pawapayAlpha2(country.country);
    if (!code) continue;
    for (const provider of country.providers ?? []) {
      for (const currency of provider.currencies ?? []) {
        const types = currency.operationTypes ?? [];
        const deposit = Array.isArray(types) ? types.find(item => item.operationType === 'DEPOSIT') : types.DEPOSIT;
        if (!deposit || deposit.status === 'CLOSED') continue;
        const currencies = countries.get(code) ?? new Map<string, string[]>();
        const name = provider.displayName || provider.provider;
        const networks = currencies.get(currency.currency.toUpperCase()) ?? [];
        if (name && !networks.includes(name)) networks.push(name);
        currencies.set(currency.currency.toUpperCase(), networks);
        countries.set(code, currencies);
      }
    }
  }
  return countries;
}

/** Deposit configurations by account (address and a hash of the token), kept 10 minutes; a failed read 1 minute. */
const depositConfigs = new Map<string, { until: number; countries: Map<string, Map<string, string[]>> }>();
const configMs = 10 * 60_000;
const failedConfigMs = 60_000;

/** Forgets every cached deposit configuration (tests, or after an admin changes pawaPay's settings). */
export function forgetDepositConfigs() {
  depositConfigs.clear();
}

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

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const token = this.apiToken.trim().replace(/^bearer\s+/i, '');
    const base = this.baseUrl.replace(/\/+$/, '');
    try {
      return await providerRequest<T>(this.name, `${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } });
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
        // Refused before anything happened: say what to check, never the token.
        throw new ProviderError(
          this.name,
          `${error.message.replace(/^pawapay: /, '')}. pawaPay refused the request (HTTP ${error.status}) at ${base}: check that the API token is ${/sandbox/i.test(base) ? 'a sandbox' : 'a production'} token, that deposits and the Payment Page are enabled on the account for this country, and that any IP allowlist on the token allows BitoCard's servers (pawaPay dashboard; Settings > Integrations > pawaPay).`,
          true,
          error.status,
        );
      }
      throw error;
    }
  }

  /** Deposit callbacks carry the token set in the callback address (`?token=`). */
  callbackTrusted(token: string | undefined) {
    if (!this.callbackToken || !token) return false;
    const expected = Buffer.from(this.callbackToken);
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /**
   * Only countries and currencies the account takes deposits in (pawaPay's active configuration, enabled per country
   * in the pawaPay dashboard), so the method is never offered where the payment page would be refused. While pawaPay
   * cannot be reached the last answer is used; with none, the method is not offered.
   */
  async supportsCheckout(country: string, currency: string) {
    return (await this.depositCountries()).get(country.toUpperCase())?.has(currency.toUpperCase()) ?? false;
  }

  /** The mobile money networks payers in this country can pay from in this currency (MTN, Telecel…). */
  async networks(country: string, currency: string) {
    return (await this.depositCountries()).get(country.toUpperCase())?.get(currency.toUpperCase()) ?? [];
  }

  /** Every country (alpha-2) and currency this account takes deposits in. */
  async depositCountries() {
    const key = `${this.baseUrl}|${createHash('sha256').update(this.apiToken.trim()).digest('hex').slice(0, 16)}`;
    const cached = depositConfigs.get(key);
    if (cached && cached.until > Date.now()) return cached.countries;
    try {
      const countries = depositCountries(await this.call<ActiveConf>('/v2/active-conf?operationType=DEPOSIT'));
      depositConfigs.set(key, { until: Date.now() + configMs, countries });
      return countries;
    } catch {
      const countries = cached?.countries ?? new Map<string, Map<string, string[]>>();
      depositConfigs.set(key, { until: Date.now() + failedConfigMs, countries });
      return countries;
    }
  }

  async createCheckout(input: CheckoutInput) {
    const country = pawapayCountry(input.country);
    if (!country) throw new ProviderError(this.name, `no mobile money in ${input.country}`, true);
    const depositId = uuidFor('deposit', input.reference);
    const res = await this.call<PaymentPageReply>('/v2/paymentpage', {
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
    if (!res.redirectUrl) throw this.noPaymentPage(res, input);
    return { checkoutUrl: res.redirectUrl, providerTransactionId: depositId };
  }

  /**
   * pawaPay answered without a payment page. `REJECTED` (or a `failureReason`) is a clear refusal, with pawaPay's reason
   * and what to check, so the payment fails and admins are told; anything else is unclear, logged with what pawaPay sent.
   */
  private noPaymentPage(res: PaymentPageReply, input: CheckoutInput) {
    const status = String(res.status ?? '').toUpperCase();
    if (status === 'REJECTED' || res.failureReason) {
      const reason = res.failureReason ? errorText(res, '', 200) : 'no reason given';
      return new ProviderError(
        this.name,
        `${reason}. pawaPay rejected the payment page for ${input.country} in ${input.currency}: check that deposits and the Payment Page are enabled on the account for this country and currency, and that the amount is within its mobile money providers' limits (pawaPay dashboard).`,
        true,
      );
    }
    const excerpt = JSON.stringify(res ?? null).slice(0, 200);
    return new ProviderError(this.name, `no payment page returned${status ? ` (status ${status})` : ''}: ${excerpt}`, false);
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
