import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import type { CatalogueItem, FulfilmentRequest, FulfilmentResult, SupplierAdapter } from './adapter.js';
import { minorOf, slug } from './adapter.js';

const Decimal = Prisma.Decimal;

/** pawaPay uses ISO 3166-1 alpha-3 country codes; BitoCard alpha-2. Every African country (pawaPay works in Africa). */
const alpha2: Record<string, string> = {
  DZA: 'DZ', AGO: 'AO', BEN: 'BJ', BWA: 'BW', BFA: 'BF', BDI: 'BI', CPV: 'CV', CMR: 'CM', CAF: 'CF', TCD: 'TD', COM: 'KM', COD: 'CD', COG: 'CG',
  CIV: 'CI', DJI: 'DJ', EGY: 'EG', GNQ: 'GQ', ERI: 'ER', SWZ: 'SZ', ETH: 'ET', GAB: 'GA', GMB: 'GM', GHA: 'GH', GIN: 'GN', GNB: 'GW', KEN: 'KE',
  LSO: 'LS', LBR: 'LR', LBY: 'LY', MDG: 'MG', MWI: 'MW', MLI: 'ML', MRT: 'MR', MUS: 'MU', MAR: 'MA', MOZ: 'MZ', NAM: 'NA', NER: 'NE', NGA: 'NG',
  RWA: 'RW', STP: 'ST', SEN: 'SN', SYC: 'SC', SLE: 'SL', SOM: 'SO', ZAF: 'ZA', SSD: 'SS', SDN: 'SD', TZA: 'TZ', TGO: 'TG', TUN: 'TN', UGA: 'UG',
  ZMB: 'ZM', ZWE: 'ZW',
};

/** pawaPay's alpha-3 code for one of BitoCard's alpha-2 countries, or null where pawaPay does not work. */
export function pawapayCountry(code: string) {
  return Object.entries(alpha2).find(([, two]) => two === code.toUpperCase())?.[0] ?? null;
}

type PayoutConfig = { operationType: string; status?: string; decimalsInAmount?: 'NONE' | 'TWO_PLACES' | string; minAmount?: string; maxAmount?: string; minTransactionLimit?: string; maxTransactionLimit?: string };
type ActiveConf = {
  countries: Array<{
    country: string;
    displayName?: Record<string, string>;
    providers: Array<{ provider: string; displayName?: string; logo?: string; currencies: Array<{ currency: string; operationTypes: PayoutConfig[] | Record<string, Omit<PayoutConfig, 'operationType'>> }> }>;
  }>;
};
type PayoutStatus = 'ACCEPTED' | 'PROCESSING' | 'IN_RECONCILIATION' | 'ENQUEUED' | 'COMPLETED' | 'FAILED';
type Payout = { payoutId: string; status: PayoutStatus; providerTransactionId?: string; failureReason?: { failureCode?: string; failureMessage?: string } };

/**
 * pawaPay's payout ID for one of our references: a UUIDv4 (which pawaPay requires) made from the reference itself, so
 * a check always finds the same payout and a retried request is ignored as a duplicate rather than paid twice.
 */
export function payoutId(reference: string) {
  const hex = createHash('sha256').update(`bitocard-payout:${reference}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** pawaPay payout statuses to BitoCard outcomes: only COMPLETED and FAILED are final. */
export function pawapayOutcome(status: string | undefined): FulfilmentResult['status'] {
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'pending';
}

/** The payout settings of one provider currency, from either shape pawaPay uses (a list, or keyed by operation). */
function payoutConfig(operationTypes: PayoutConfig[] | Record<string, Omit<PayoutConfig, 'operationType'>>): PayoutConfig | null {
  if (Array.isArray(operationTypes)) return operationTypes.find(item => item.operationType === 'PAYOUT') ?? null;
  return operationTypes.PAYOUT ? { operationType: 'PAYOUT', ...operationTypes.PAYOUT } : null;
}

/**
 * pawaPay: mobile money top-ups (payouts) to customers' wallets, for every country and provider configured for payouts
 * on BitoCard's pawaPay account (its active configuration, so newly enabled providers appear on the next sync). A
 * product is a country, provider and currency, sold as any amount within the provider's limits; whole amounts only
 * where the provider takes no decimals (`whole_units`). BitoCard pays the amount from its prefunded pawaPay wallet in
 * that currency plus pawaPay's fee (the agreed percentage, an integration setting), which is the cost.
 *
 * Payouts take our reference as `clientReferenceId` and a UUID made from it as `payoutId`.
 */
export class PawapayAdapter implements SupplierAdapter {
  readonly code = 'pawapay';
  readonly syncs: ProductCategory[] = ['mobile_money'];
  private report: string[] = [];
  /** One sync asks once per switched-on market; the answer is the same, so it is reused for a minute. */
  private fetched: { at: number; items: CatalogueItem[] } | null = null;

  constructor(private readonly config: { apiToken?: string; baseUrl: string; feePercent?: string }) {}

  configured() {
    return Boolean(this.config.apiToken);
  }

  syncReport() {
    return this.report.length ? this.report.join(' ') : null;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    if (!this.configured()) throw new ProviderError(this.code, 'not configured', true);
    const base = this.config.baseUrl.replace(/\/+$/, '');
    // Tokens are often pasted with "Bearer " or spaces from the dashboard.
    const token = (this.config.apiToken ?? '').trim().replace(/^bearer\s+/i, '');
    try {
      return await providerRequest<T>(this.code, `${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } });
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
        // Refused before anything happened, so a clear failure; say what to check (never the token itself).
        const sandbox = /sandbox/i.test(base);
        throw new ProviderError(
          this.code,
          `pawaPay refused the API token (HTTP ${error.status}) at ${base}. Sandbox and production tokens differ: ${sandbox ? 'this is the sandbox address, so use a sandbox token' : 'this is the production address, so use a production token, or set the API address to https://api.sandbox.pawapay.io for a sandbox token'} (Settings > Integrations > pawaPay).`,
          true,
          error.status,
        );
      }
      throw error;
    }
  }

  /** Every country pawaPay pays out to on this account, whichever market asked: money can be sent across borders. */
  async catalogue(): Promise<CatalogueItem[]> {
    if (this.fetched && Date.now() - this.fetched.at < 60_000) return this.fetched.items;
    this.report = [];
    const fee = this.config.feePercent?.trim();
    if (!fee || !/^\d{1,2}(\.\d{1,4})?$/.test(fee)) {
      throw new ProviderError(this.code, 'set the payout fee percentage agreed with pawaPay (Settings > Integrations > pawaPay) before syncing', true);
    }
    const ratio = new Decimal(1).plus(new Decimal(fee).div(100)).toString();
    const conf = await this.request<ActiveConf>('/v2/active-conf?operationType=PAYOUT');
    const items: CatalogueItem[] = [];
    const skipped: string[] = [];
    for (const country of conf.countries ?? []) {
      const code = alpha2[country.country];
      if (!code) {
        skipped.push(country.country);
        continue;
      }
      for (const provider of country.providers ?? []) {
        for (const currency of provider.currencies ?? []) {
          const payout = payoutConfig(currency.operationTypes ?? []);
          if (!payout || payout.status === 'CLOSED') continue;
          const min = payout.minAmount ?? payout.minTransactionLimit;
          const max = payout.maxAmount ?? payout.maxTransactionLimit;
          if (!min || !max) {
            skipped.push(provider.provider);
            continue;
          }
          const name = provider.displayName || provider.provider;
          const brand = slug(name, [country.displayName?.en ?? '']);
          items.push({
            sku: `${provider.provider}:${currency.currency}`,
            productKey: `mobile_money:${code}:${brand}:${currency.currency.toLowerCase()}`,
            category: 'mobile_money',
            country: code,
            brand,
            name: `${name} mobile money`,
            faceCurrency: currency.currency,
            denominationType: 'range',
            fixedValues: [],
            minValue: minorOf(min),
            maxValue: minorOf(max),
            recipientType: 'phone',
            description: `Money sent to a ${name} mobile money wallet in ${country.displayName?.en ?? code}. The recipient gets an SMS receipt.`,
            logoUrl: provider.logo,
            costCurrency: currency.currency,
            costRatio: ratio,
            costFee: 0n,
            meta: { provider: provider.provider, currency: currency.currency, whole_units: payout.decimalsInAmount === 'NONE' },
          });
        }
      }
    }
    if (skipped.length) this.report.push(`Left out (unknown country or no limits): ${skipped.join(', ')}.`);
    if (!items.length) this.report.push('pawaPay returned no providers configured for payouts on this account.');
    this.fetched = { at: Date.now(), items };
    return items;
  }

  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const whole = request.meta.whole_units === true;
    if (whole && request.faceValue % 100n !== 0n) throw new ProviderError(this.code, 'this provider takes whole amounts only', true);
    const amount = new Decimal(request.faceValue.toString()).div(100);
    const res = await this.request<{ payoutId: string; status: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE_IGNORED'; failureReason?: { failureCode?: string; failureMessage?: string } }>('/v2/payouts', {
      method: 'POST',
      body: {
        payoutId: payoutId(request.reference),
        amount: whole ? amount.toFixed(0) : amount.toFixed(2).replace(/\.?0+$/, ''),
        currency: request.meta.currency ?? request.faceCurrency,
        recipient: { type: 'MMO', accountDetails: { phoneNumber: (request.recipient.phone ?? '').replace(/^\+/, ''), provider: request.meta.provider } },
        clientReferenceId: request.reference,
      },
    });
    if (res.status === 'REJECTED') {
      // Refused before anything was sent: a clear failure, so the money held for it is released.
      throw new ProviderError(this.code, `${res.failureReason?.failureCode ?? 'REJECTED'}: ${res.failureReason?.failureMessage ?? 'payout rejected'}`, true);
    }
    // Accepted (or a duplicate of one already accepted): read its status; a failed read leaves it pending.
    return this.orderStatus(request).catch((error: Error) => ({ status: 'pending' as const, supplierTransactionId: payoutId(request.reference), detail: `Accepted; status not read yet: ${error.message}` }));
  }

  async orderStatus(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const id = payoutId(request.reference);
    const res = await this.request<{ status: 'FOUND' | 'NOT_FOUND'; data?: Payout }>(`/v2/payouts/${id}`);
    // Not found is not a failure: the request may still arrive. It waits for later checks (and then an admin).
    if (res.status !== 'FOUND' || !res.data) return { status: 'pending', supplierTransactionId: id, detail: 'pawaPay has no payout with this ID yet' };
    const outcome = pawapayOutcome(res.data.status);
    const failure = res.data.failureReason ? ` ${res.data.failureReason.failureCode ?? ''}: ${res.data.failureReason.failureMessage ?? ''}` : '';
    return {
      status: outcome,
      supplierTransactionId: id,
      detail: `${res.data.status}${failure}`,
      ...(outcome === 'completed' ? { deliveries: [{ kind: 'confirmation' as const, details: res.data.providerTransactionId ? { transaction_id: res.data.providerTransactionId } : {} }] } : {}),
    };
  }
}

/**
 * pawaPay callbacks are authenticated by a secret token in the callback address set in the pawaPay dashboard
 * (`/v1/webhooks/pawapay?token=<PAWAPAY_CALLBACK_TOKEN>`). The body is never trusted: it only names the payout to re-check.
 */
export function pawapayCallbackValid(secret: string | undefined, token: string | undefined) {
  if (!secret || !token) return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The order a callback names: our reference (`clientReferenceId`) and the payout ID. */
export function pawapayNotice(payload: unknown) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return { eventType: text(body.status) ? `payout:${text(body.status)}` : null, reference: text(body.clientReferenceId), supplierTransactionId: text(body.payoutId) };
}
