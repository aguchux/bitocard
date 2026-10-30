import { timingSafeEqual } from 'node:crypto';
import { Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import type { CatalogueItem, CatalogueScope, FulfilmentRequest, FulfilmentResult, SupplierAdapter } from './adapter.js';
import { slug } from './adapter.js';

const Decimal = Prisma.Decimal;

/** Where Africa's Talking sells airtime: its currency, the amounts it takes (major units) and the networks it reaches. */
export type AirtimeMarket = { country: string; currency: string; min: number; max: number; networks: string[] };

/**
 * Africa's Talking's airtime markets: the countries its help centre lists airtime as live in, with the per-number limits
 * it publishes (Kenya, Uganda, Tanzania and Nigeria; Ghana's and South Africa's are not published, so theirs are kept
 * narrow until confirmed on BitoCard's account). Settings > Integrations > Africa's Talking > Airtime countries
 * overrides them. Network slugs match the other suppliers' brands (Reloadly's "MTN Nigeria" is `mtn`), so Africa's
 * Talking's offers share their products and are routed by net margin.
 */
export const defaultAirtimeMarkets: AirtimeMarket[] = [
  { country: 'KE', currency: 'KES', min: 10, max: 10_000, networks: ['safaricom', 'airtel', 'telkom'] },
  { country: 'UG', currency: 'UGX', min: 50, max: 200_000, networks: ['mtn', 'airtel'] },
  { country: 'TZ', currency: 'TZS', min: 1_000, max: 200_000, networks: ['vodacom', 'airtel', 'tigo', 'halotel'] },
  { country: 'NG', currency: 'NGN', min: 50, max: 5_000, networks: ['mtn', 'airtel', 'glo', '9mobile'] },
  { country: 'GH', currency: 'GHS', min: 1, max: 1_000, networks: ['mtn', 'telecel', 'airteltigo'] },
  { country: 'ZA', currency: 'ZAR', min: 5, max: 1_000, networks: ['vodacom', 'mtn', 'cell-c', 'telkom'] },
];

const networkNames: Record<string, string> = {
  safaricom: 'Safaricom',
  airtel: 'Airtel',
  telkom: 'Telkom',
  mtn: 'MTN',
  vodacom: 'Vodacom',
  tigo: 'Tigo',
  halotel: 'Halotel',
  glo: 'Glo',
  '9mobile': '9mobile',
  telecel: 'Telecel',
  airteltigo: 'AirtelTigo',
  tnm: 'TNM',
  zamtel: 'Zamtel',
  'cell-c': 'Cell C',
};
const networkName = (network: string) => networkNames[network] ?? network.replace(/(^|-)([a-z])/g, (_, dash: string, letter: string) => `${dash ? ' ' : ''}${letter.toUpperCase()}`);

/** Africa's Talking's bundle validities and how the store names them. */
const validities = { Day: '1 day', Week: '7 days', BiWeek: '14 days', Month: '30 days', Quarterly: '90 days' } as const;
type Validity = keyof typeof validities;

/** A data bundle as set up by an admin: Africa's Talking publishes no plan or price list, so each plan is configured. */
export type DataPlan = { country: string; network: string; quantity: number; unit: 'MB' | 'GB'; validity: Validity; price: string; cost: string };

const lines = (value: string | undefined) =>
  (value ?? '')
    .split(/[;\n]/)
    .map(line => line.trim())
    .filter(Boolean);

/**
 * Airtime countries from the setting, one per line or separated by semicolons: `KE KES 10-10000 safaricom,airtel,telkom`
 * (country, currency, the smallest and largest amount, the networks). Empty: the published defaults.
 */
export function parseAirtimeMarkets(value: string | undefined): { markets: AirtimeMarket[]; problems: string[] } {
  if (!lines(value).length) return { markets: defaultAirtimeMarkets, problems: [] };
  const markets: AirtimeMarket[] = [];
  const problems: string[] = [];
  for (const line of lines(value)) {
    const match = /^([A-Za-z]{2})\s+([A-Za-z]{3})\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s+([a-z0-9][a-z0-9 ,-]*)$/i.exec(line);
    const networks = match?.[5].split(/[\s,]+/).map(item => networkSlug(item)).filter(Boolean) ?? [];
    if (!match || !networks.length || Number(match[3]) <= 0 || Number(match[3]) > Number(match[4])) {
      problems.push(`"${line}"`);
      continue;
    }
    markets.push({ country: match[1].toUpperCase(), currency: match[2].toUpperCase(), min: Number(match[3]), max: Number(match[4]), networks });
  }
  return { markets, problems };
}

/** Networks Africa's Talking (or a price list) names differently from the shared product brands. */
const networkAliases: Record<string, string> = { t2: '9mobile', etisalat: '9mobile', 'airtel-tigo': 'airteltigo', vodafone: 'telecel' };
const networkSlug = (value: string) => {
  const name = slug(value);
  return networkAliases[name] ?? name;
};

/**
 * The airtime discounts agreed with Africa's Talking, in percent, one per line or separated by semicolons or commas:
 * a bare number for every country and network (`3`), a country's (`NG 2`), or a network's in a country (`NG mtn 1.8`;
 * T2 is 9mobile's new name). The most specific wins; a network with none is not synced. Africa's Talking's schedule
 * raises the rates with monthly volume, so set the tier the account is on.
 */
export function parseAirtimeDiscounts(value: string | undefined) {
  const discounts = new Map<string, Prisma.Decimal>();
  const problems: string[] = [];
  for (const entry of (value ?? '').split(/[\n;,]+/).map(item => item.trim()).filter(Boolean)) {
    const match = /^(?:([A-Za-z]{2})\s+(?:([a-z0-9][a-z0-9-]*)\s+)?)?(\d{1,2}(?:\.\d{1,4})?)\s*%?$/i.exec(entry);
    const percent = match ? new Decimal(match[3]) : null;
    if (!match || !percent || percent.gte(20)) {
      problems.push(`"${entry}"`);
      continue;
    }
    discounts.set([match[1]?.toUpperCase() ?? '*', match[2] ? networkSlug(match[2]) : '*'].join(':'), percent);
  }
  const of = (country: string, network: string) => discounts.get(`${country}:${network}`) ?? discounts.get(`${country}:*`) ?? discounts.get('*:*') ?? null;
  return { discounts, problems, of };
}

/**
 * Data plans from the setting, one per line or separated by semicolons: `KE safaricom 1GB Month 299 250` (country,
 * network, size, validity: Day, Week, BiWeek, Month or Quarterly, the price customers know it by, BitoCard's cost with
 * Africa's Talking, both in the country's currency).
 */
export function parseDataPlans(value: string | undefined): { plans: DataPlan[]; problems: string[] } {
  const plans: DataPlan[] = [];
  const problems: string[] = [];
  for (const line of lines(value)) {
    const match = /^([A-Za-z]{2})\s+([a-z0-9-]+)\s+(\d+(?:\.\d+)?)\s*(MB|GB)\s+(Day|Week|BiWeek|Month|Quarterly)\s+(\d+(?:\.\d{1,2})?)\s+(\d+(?:\.\d{1,4})?)$/i.exec(line);
    const validity = match && (Object.keys(validities) as Validity[]).find(item => item.toLowerCase() === match[5].toLowerCase());
    if (!match || !validity || Number(match[3]) <= 0 || Number(match[6]) <= 0 || Number(match[7]) <= 0) {
      problems.push(`"${line}"`);
      continue;
    }
    plans.push({ country: match[1].toUpperCase(), network: slug(match[2]), quantity: Number(match[3]), unit: match[4].toUpperCase() as 'MB' | 'GB', validity, price: match[6], cost: match[7] });
  }
  return { plans, problems };
}

/** "KES 100.0000" to minor units of its currency; null when it cannot be read. */
export function atAmount(value: unknown): { currency: string; minor: bigint } | null {
  const match = typeof value === 'string' ? /^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/.exec(value.trim()) : null;
  if (!match) return null;
  return { currency: match[1], minor: BigInt(new Decimal(match[2]).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)) };
}

/** Africa's Talking statuses to BitoCard outcomes. Only Success and a clear failure are final. */
export function atOutcome(status: unknown): FulfilmentResult['status'] {
  const text = typeof status === 'string' ? status.toLowerCase() : '';
  if (text === 'success' || text === 'completed') return 'completed';
  if (text === 'failed' || text === 'failure' || text === 'rejected' || text === 'reversed') return 'failed';
  return 'pending';
}

type AirtimeReply = {
  errorMessage?: string;
  responses?: Array<{ phoneNumber?: string; amount?: string; discount?: string; status?: string; requestId?: string; errorMessage?: string }>;
};
type DataReply = { errorMessage?: string; entries?: Array<{ phoneNumber?: string; provider?: string; status?: string; transactionId?: string; value?: string; errorMessage?: string }> };
type FoundTransaction = { status?: string; errorMessage?: string; data?: { status?: string; transactionStatus?: string; description?: string; providerRefId?: string; value?: string } };

export type AfricasTalkingConfig = {
  username?: string;
  apiKey?: string;
  /** api.africastalking.com (airtime, transaction lookups) and bundles.africastalking.com (mobile data). */
  apiUrl: string;
  dataUrl: string;
  /** The airtime discounts agreed with Africa's Talking (`parseAirtimeDiscounts`): BitoCard's cost is the amount less them. */
  airtimeDiscountPercent?: string;
  airtimeCountries?: string;
  /** The Mobile Data product created in the Africa's Talking dashboard, and the plans sold through it. */
  dataProduct?: string;
  dataPlans?: string;
};

/**
 * Africa's Talking: mobile airtime and data bundles, paid from BitoCard's Africa's Talking wallet.
 *
 * - **Airtime** is any amount within the country's limits, to any of its networks: Africa's Talking finds the network
 *   from the number. One product per country and network (`airtime:KE:safaricom:topup`, the key Reloadly's offers use),
 *   costing the amount less the discount agreed for that country and network (`parseAirtimeDiscounts`, an
 *   integration setting; the actual discount each send reports is kept for reconciliation). Africa's Talking lists no products, so every airtime country it serves is stocked
 *   whichever market asks (as pawaPay's catalogue is), but each country's offers serve only that country's
 *   resellers and their customers, in their own currency, never another country's (`domesticOnly`).
 * - **Data** bundles are the plans an admin sets (Africa's Talking publishes no plan list), sent through the Mobile
 *   Data product made in its dashboard, each at the price customers know it by (face value) and BitoCard's cost.
 *
 * Sends carry our reference as the `Idempotency-Key`, and data sends also in their metadata (echoed by callbacks).
 * Africa's Talking replies `Sent`/`Queued` while the network works: the order waits for the status callback or the
 * next scheduled check (`/query/transaction/find`), never sent again.
 */
export class AfricasTalkingAdapter implements SupplierAdapter {
  readonly code = 'africas_talking';
  readonly syncs: ProductCategory[] = ['airtime', 'data'];
  /**
   * Africa's Talking sends airtime abroad only from an app whose base currency is US dollars, so each country's stock
   * serves only that country: its resellers and their customers buy in their own currency, never cross-border.
   */
  readonly domesticOnly = true;
  private report: string[] = [];

  constructor(private readonly config: AfricasTalkingConfig) {}

  configured() {
    return Boolean(this.config.username?.trim() && this.config.apiKey?.trim());
  }

  syncReport() {
    return this.report.length ? this.report.join(' ') : null;
  }

  private headers(reference?: string) {
    return { apikey: (this.config.apiKey ?? '').trim(), ...(reference ? { 'idempotency-key': reference } : {}) };
  }

  private request<T>(url: string, init: { method?: string; body?: unknown; form?: Record<string, string>; reference?: string } = {}) {
    if (!this.configured()) throw new ProviderError(this.code, 'not configured', true);
    return providerRequest<T>(this.code, url, { method: init.method, body: init.body, form: init.form, headers: this.headers(init.reference) });
  }

  private get username() {
    return (this.config.username ?? '').trim();
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    this.report = [];
    const country = scope.country?.toUpperCase() ?? null;
    if (scope.category === 'airtime') return this.airtime(country);
    if (scope.category === 'data') return this.data(country);
    return [];
  }

  private airtime(country: string | null): CatalogueItem[] {
    const discounts = parseAirtimeDiscounts(this.config.airtimeDiscountPercent);
    if (discounts.problems.length) this.report.push(`Airtime discounts not understood: ${discounts.problems.join(', ')}.`);
    if (!discounts.discounts.size) {
      throw new ProviderError(this.code, 'set the airtime discounts agreed with Africa’s Talking (Settings > Integrations > Africa’s Talking) before syncing', true);
    }
    const { markets, problems } = parseAirtimeMarkets(this.config.airtimeCountries);
    if (problems.length) this.report.push(`Airtime countries not understood: ${problems.join(', ')}.`);
    if (!markets.length) {
      this.report.push('No airtime countries are set up for Africa’s Talking.');
      return [];
    }
    if (country && !markets.some(item => item.country === country)) this.report.push(`Africa’s Talking sells no airtime in ${country} (as set up).`);
    const missing: string[] = [];
    const items = markets.flatMap(market =>
      market.networks.flatMap(network => {
        const discount = discounts.of(market.country, network);
        if (!discount) {
          missing.push(`${market.country} ${network}`);
          return [];
        }
        return [
          {
            sku: `airtime:${market.country}:${network}`,
            productKey: `airtime:${market.country}:${network}:topup`,
            category: 'airtime' as const,
            country: market.country,
            brand: network,
            name: `${networkName(network)} airtime`,
            faceCurrency: market.currency,
            denominationType: 'range' as const,
            fixedValues: [],
            minValue: BigInt(Math.round(market.min * 100)),
            maxValue: BigInt(Math.round(market.max * 100)),
            recipientType: 'phone' as const,
            description: `${networkName(network)} airtime, any amount from ${market.currency} ${market.min} to ${market.max}. Credited to the number straight away.`,
            costCurrency: market.currency,
            costRatio: new Decimal(1).minus(discount.div(100)).toString(),
            costFee: 0n,
            meta: { currency: market.currency, network },
          },
        ];
      }),
    );
    if (missing.length) this.report.push(`No airtime discount set for ${missing.join(', ')}: not synced.`);
    return items;
  }

  private data(country: string | null): CatalogueItem[] {
    const { plans, problems } = parseDataPlans(this.config.dataPlans);
    if (problems.length) this.report.push(`Data plans not understood: ${problems.join(', ')}.`);
    if (!this.config.dataProduct?.trim()) {
      if (plans.length) this.report.push('Set the Mobile Data product name before data plans can be synced.');
      return [];
    }
    const currencies = new Map(parseAirtimeMarkets(this.config.airtimeCountries).markets.map(item => [item.country, item.currency]));
    const items: CatalogueItem[] = [];
    for (const plan of plans.filter(item => item.country === country)) {
      const currency = currencies.get(plan.country);
      if (!currency) {
        this.report.push(`No currency known for ${plan.country}: add it to the airtime countries.`);
        continue;
      }
      if (new Decimal(plan.cost).gt(plan.price)) {
        this.report.push(`${plan.country} ${plan.network} ${plan.quantity}${plan.unit} costs more than its price; left out.`);
        continue;
      }
      const size = `${plan.quantity}${plan.unit}`;
      items.push({
        sku: `data:${plan.country}:${plan.network}:${size}:${plan.validity}`,
        productKey: `data:${plan.country}:${plan.network}:${slug(`${size} ${validities[plan.validity]}`)}`,
        category: 'data',
        country: plan.country,
        brand: plan.network,
        name: `${networkName(plan.network)} ${size} data, ${validities[plan.validity]}`,
        faceCurrency: currency,
        denominationType: 'fixed',
        fixedValues: [BigInt(new Decimal(plan.price).mul(100).toFixed(0))],
        recipientType: 'phone',
        description: `${size} of ${networkName(plan.network)} mobile data, valid for ${validities[plan.validity]}.`,
        costCurrency: currency,
        costRatio: new Decimal(plan.cost).div(plan.price).toDecimalPlaces(10, Decimal.ROUND_UP).toString(),
        costFee: 0n,
        meta: { network: plan.network, quantity: plan.quantity, unit: plan.unit, validity: plan.validity },
      });
    }
    if (!items.length && country) this.report.push(`No data plans are set up for ${country}.`);
    return items;
  }

  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const phone = `+${(request.recipient.phone ?? '').replace(/[^\d]/g, '')}`;
    if (phone.length < 8) throw new ProviderError(this.code, 'no recipient mobile number', true);
    return request.category === 'data' ? this.sendData(request, phone) : this.sendAirtime(request, phone);
  }

  private async sendAirtime(request: FulfilmentRequest, phone: string): Promise<FulfilmentResult> {
    const currency = String(request.meta.currency ?? request.faceCurrency);
    const amount = new Decimal(request.faceValue.toString()).div(100).toFixed(2).replace(/\.00$/, '');
    const reply = await this.request<AirtimeReply>(`${this.config.apiUrl.replace(/\/+$/, '')}/version1/airtime/send`, {
      method: 'POST',
      form: { username: this.username, recipients: JSON.stringify([{ phoneNumber: phone, amount: `${currency} ${amount}` }]) },
      reference: request.reference,
    });
    const entry = reply.responses?.[0];
    // Nothing accepted (no balance, a number it refuses, a duplicate): refused before anything was sent.
    if (!entry) throw new ProviderError(this.code, reply.errorMessage && reply.errorMessage !== 'None' ? reply.errorMessage : 'no airtime request accepted', true);
    if (atOutcome(entry.status) === 'failed') throw new ProviderError(this.code, entry.errorMessage && entry.errorMessage !== 'None' ? entry.errorMessage : `airtime ${entry.status}`, true);
    const charged = atAmount(entry.amount);
    const discount = atAmount(entry.discount);
    return {
      status: atOutcome(entry.status),
      supplierTransactionId: entry.requestId,
      detail: `airtime ${entry.status ?? 'unknown'}`,
      ...(charged && discount && charged.currency === discount.currency ? { reportedCost: { amountMinor: charged.minor - discount.minor, currency: charged.currency } } : {}),
      ...(atOutcome(entry.status) === 'completed' ? { deliveries: [{ kind: 'confirmation' as const, details: {} }] } : {}),
    };
  }

  private async sendData(request: FulfilmentRequest, phone: string): Promise<FulfilmentResult> {
    const product = this.config.dataProduct?.trim();
    if (!product) throw new ProviderError(this.code, 'the Mobile Data product name is not set', true);
    const reply = await this.request<DataReply>(`${this.config.dataUrl.replace(/\/+$/, '')}/mobile/data/request`, {
      method: 'POST',
      body: {
        username: this.username,
        productName: product,
        recipients: [{ phoneNumber: phone, quantity: Number(request.meta.quantity), unit: request.meta.unit, validity: request.meta.validity, metadata: { reference: request.reference } }],
      },
      reference: request.reference,
    });
    const entry = reply.entries?.[0];
    if (!entry) throw new ProviderError(this.code, reply.errorMessage && reply.errorMessage !== 'None' ? reply.errorMessage : 'no data request accepted', true);
    const status = entry.status ?? '';
    // Queued (or already done) is accepted; anything else (InvalidRequest, NotSupported, InsufficientCredit…) refused it.
    if (!/^(queued|success|sent|pending)$/i.test(status)) throw new ProviderError(this.code, `data ${status || 'refused'}${entry.errorMessage ? `: ${entry.errorMessage}` : ''}`, true);
    const outcome = atOutcome(status);
    const charged = atAmount(entry.value);
    return {
      status: outcome,
      supplierTransactionId: entry.transactionId,
      detail: `data ${status}`,
      ...(charged ? { reportedCost: { amountMinor: charged.minor, currency: charged.currency } } : {}),
      ...(outcome === 'completed' ? { deliveries: [{ kind: 'confirmation' as const, details: {} }] } : {}),
    };
  }

  async orderStatus(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult> {
    // Without its transaction ID (the reply was lost) Africa's Talking cannot be asked: the order waits for the status
    // callback (data callbacks carry our reference) or an admin, and is never sent again.
    if (!supplierTransactionId) return { status: 'pending', detail: 'No Africa’s Talking transaction ID yet: waiting for its status callback' };
    const base = request.category === 'data' ? this.config.dataUrl : this.config.apiUrl;
    const query = new URLSearchParams({ username: this.username, transactionId: supplierTransactionId });
    const found = await this.request<FoundTransaction>(`${base.replace(/\/+$/, '')}/query/transaction/find?${query}`);
    // Not found yet is not a failure: it waits for later checks.
    if (!found.data || (found.status && !/^success$/i.test(found.status))) {
      return { status: 'pending', supplierTransactionId, detail: `Not found yet${found.errorMessage ? `: ${found.errorMessage}` : ''}` };
    }
    const status = found.data.status ?? found.data.transactionStatus;
    const outcome = atOutcome(status);
    return {
      status: outcome,
      supplierTransactionId,
      detail: `${status ?? 'unknown'}${found.data.description ? `: ${found.data.description}` : ''}`,
      ...(outcome === 'completed' ? { deliveries: [{ kind: 'confirmation' as const, details: found.data.providerRefId ? { transaction_id: found.data.providerRefId } : {} }] } : {}),
    };
  }
}

/** Test connection: the account's balance (`/version1/user`), which needs the username and API key to match. */
export async function africasTalkingCheck(apiUrl: string, username: string | undefined, apiKey: string | undefined) {
  const query = new URLSearchParams({ username: (username ?? '').trim() });
  const reply = await providerRequest<{ UserData?: { balance?: string } }>('africas_talking', `${apiUrl.replace(/\/+$/, '')}/version1/user?${query}`, { headers: { apikey: (apiKey ?? '').trim() } });
  if (!reply?.UserData) throw new ProviderError('africas_talking', 'unexpected reply to the balance check', true);
  return reply.UserData.balance ?? null;
}

/**
 * Africa's Talking signs nothing: its status callbacks are authenticated by the secret token in the callback address
 * set in its dashboard (`/v1/webhooks/africas-talking?token=<AFRICAS_TALKING_CALLBACK_TOKEN>`).
 */
export function africasTalkingCallbackValid(secret: string | undefined, token: string | undefined) {
  if (!secret || !token) return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The order a status callback names (sent as JSON or as a form). Airtime callbacks name Africa's Talking's
 * `requestId`; data callbacks its `transactionId` and our reference in `requestMetadata`. Never trusted: only re-checked.
 */
export function africasTalkingNotice(raw: Buffer) {
  const text = raw.toString('utf8');
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = Object.fromEntries(new URLSearchParams(text));
  }
  const value = (item: unknown) => (typeof item === 'string' && item.trim() ? item.trim() : null);
  let metadata: unknown = body.requestMetadata ?? body.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  const reference = metadata && typeof metadata === 'object' ? value((metadata as Record<string, unknown>).reference) : null;
  const kind = value(body.category) ?? (body.requestId ? 'airtime' : 'data');
  const status = value(body.status);
  return { eventType: status ? `${kind}:${status}`.slice(0, 100) : null, reference, supplierTransactionId: value(body.requestId) ?? value(body.transactionId) };
}
