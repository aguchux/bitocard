import type { ProductCategory } from '../generated/prisma/client.js';
import { ProviderError } from '../payments/provider-error.js';
import { toMajor } from '../payments/providers.js';
import { type CatalogueItem, type CatalogueScope, type Delivery, type FulfilmentRequest, type FulfilmentResult, minorOf, type RecipientCheck, slug, type SupplierAdapter } from './adapter.js';

/**
 * Remita Vending Bills (SystemSpecs' RemitaConnect gateway, https://api.remita.net, "Vending Bills"): electricity, cable
 * TV, airtime and data, and internet subscriptions. Every call carries the account's secret key in a `secretKey` header.
 * Replies are `{ status, message, data }`, where `status` is Remita's own code ("00" approved, "03" pending, "71" requery):
 * the code decides, whatever the HTTP status. Production calls come only from IP addresses Remita has whitelisted
 * ("06"); the demo gateway needs none.
 */

type Reply<T> = { status?: string; message?: string; data?: T };
type Page<T> = { totalPage?: number; totalContent?: number; items?: T[] };
type RemitaCategory = { id: number; name?: string; code: string };
type RemitaProvider = { code: string; name?: string; description?: string; logoUrl?: string };
export type RemitaProduct = {
  name: string;
  description?: string | null;
  code: string;
  country?: string | null;
  countryCode?: string | null;
  currencyCode?: string | null;
  productType?: string | null;
  feeType?: string | null;
  amount?: number | string | null;
  provider: string;
  categoryCode: string;
};
type RemitaValidation = {
  name?: string | null;
  accountNumber?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  outstandingBalance?: number | string | null;
  address?: string | null;
  district?: string | null;
  accountType?: string | null;
  tariff?: string | null;
  tariffRate?: string | number | null;
  accountStatus?: string | null;
};
type RemitaTransaction = {
  amount?: number | string;
  productCode?: string;
  categoryCode?: string;
  token?: string | null;
  extraTokens?: unknown;
  unit?: string | number | null;
  clientReference?: string;
  paymentIdentifier?: string | number | null;
  retrialTimeInSec?: number;
};

/** Remita category codes synced into each BitoCard category. Education and transport have no BitoCard category yet. */
const remitaCategories: Partial<Record<ProductCategory, string[]>> = {
  bills: ['electricity', 'internet_data_subscription'],
  pay_tv: ['cable_tv'],
  airtime: ['airtime'],
  data: ['internet_data_subscription'],
};

/**
 * Electricity distribution companies under the brand names VTpass's offers use, so the same meter product has one
 * BitoCard key and is routed between both by net margin.
 */
export const remitaElectricityBrands: Record<string, string> = {
  ekedc: 'eko-electric',
  ikedc: 'ikeja-electric',
  aedc: 'abuja-electric',
  kedco: 'kano-electric',
  phed: 'portharcourt-electric',
  jedc: 'jos-electric',
  jed: 'jos-electric',
  kaedc: 'kaduna-electric',
  eedc: 'enugu-electric',
  ibedc: 'ibadan-electric',
  bedc: 'benin-electric',
  aba: 'aba-electric',
  apl: 'aba-electric',
  yedc: 'yola-electric',
};

/** Mobile networks: their airtime and data go to a phone number; any other internet provider is an account to pay. */
const mobileNetworks: Record<string, string> = { mtn: 'mtn', airtel: 'airtel', glo: 'glo', globacom: 'glo', '9mobile': '9mobile', etisalat: '9mobile', t2: '9mobile', ntel: 'ntel', vodafone: 'vodafone', telecel: 'telecel', airteltigo: 'airteltigo', safaricom: 'safaricom' };

/** The countries BitoCard sells in that Remita lists (ISO alpha-2 to alpha-3) and their currencies. */
const countries: Record<string, { alpha3: string; currency: string }> = {
  NG: { alpha3: 'NGA', currency: 'NGN' },
  GH: { alpha3: 'GHA', currency: 'GHS' },
  KE: { alpha3: 'KEN', currency: 'KES' },
  GB: { alpha3: 'GBR', currency: 'GBP' },
  US: { alpha3: 'USA', currency: 'USD' },
  ZA: { alpha3: 'ZAF', currency: 'ZAR' },
  UG: { alpha3: 'UGA', currency: 'UGX' },
  TZ: { alpha3: 'TZA', currency: 'TZS' },
  RW: { alpha3: 'RWA', currency: 'RWF' },
  CM: { alpha3: 'CMR', currency: 'XAF' },
};

/**
 * Any-amount limits in minor units, until an account check gives its own (Remita's products carry none): naira
 * airtime and data ₦50 to ₦50,000, bills and TV ₦500 to ₦500,000; other currencies 1 to 100,000 whole units.
 */
function limits(category: ProductCategory, currency: string): { min: bigint; max: bigint } {
  if (currency === 'NGN') return category === 'airtime' || category === 'data' ? { min: 5_000n, max: 5_000_000n } : { min: 50_000n, max: 50_000_000n };
  return { min: 100n, max: 10_000_000n };
}

/** Codes meaning Remita refused before anything was vended: the order fails (and may move to another supplier). */
const refusedCodes = new Set(['01', '02', '04', '06', '08', '10', '11', '17', '24', '25', '31', '38', '51', '62']);
/** Codes meaning a transaction with this reference may exist: the same reference is asked again, never resent. */
const unclearCodes = new Set(['03', '12', '21', '22', '23', '26', '71', '94', '96']);

const describe = (reply: Reply<unknown>) => `${reply.status ?? '?'} ${reply.message ?? ''}`.trim();

/** A friendlier reason for the refusals an admin can act on (Test connection, syncs). */
function refusalText(reply: Reply<unknown>) {
  if (reply.status === '06') return `${describe(reply)}: ask Remita to whitelist BitoCard's server IP addresses for production`;
  if (reply.status === '04') return `${describe(reply)}: check the secret key and that Vending is subscribed and approved on RemitaConnect`;
  return describe(reply);
}

export type RemitaOptions = { secretKey?: string; baseUrl: string; contactPhone?: string };

/** Remita Vending Bills behind BitoCard's supplier interface. */
export class RemitaAdapter implements SupplierAdapter {
  readonly code = 'remita';
  readonly syncs: ProductCategory[] = ['bills', 'pay_tv', 'airtime', 'data'];
  private lastReport: string | null = null;

  constructor(private readonly options: RemitaOptions) {}

  configured() {
    return Boolean(this.options.secretKey);
  }

  private url(path: string) {
    return `${this.options.baseUrl.replace(/\/+$/, '')}/api/v1/vending${path}`;
  }

  /**
   * One call. Remita's own `status` decides; a reply without one is judged by its HTTP status (a 4xx other than 408 and
   * 429 is a refusal); a network failure or an unreadable reply is unclear.
   */
  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<Reply<T>> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method: init.method ?? 'GET',
        headers: { accept: 'application/json', secretKey: (this.options.secretKey ?? '').trim(), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new ProviderError(this.code, `request failed: ${(error as Error).message}`, false);
    }
    const text = await res.text();
    let reply: Reply<T> | null = null;
    try {
      reply = text ? (JSON.parse(text) as Reply<T>) : null;
    } catch {
      throw new ProviderError(this.code, `unreadable response (HTTP ${res.status})`, false, res.status);
    }
    if (reply && typeof reply.status === 'string') return reply;
    throw new ProviderError(this.code, `HTTP ${res.status} without a status`, res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429, res.status);
  }

  /** A read that must be approved: anything else is a refusal named for the admin. */
  private async read<T>(path: string): Promise<T> {
    const reply = await this.call<T>(path);
    if (reply.status !== '00' || reply.data === undefined) throw new ProviderError(this.code, refusalText(reply), refusedCodes.has(reply.status ?? '') || reply.status === '04' || reply.status === '06');
    return reply.data;
  }

  /** Test connection: the category list, which needs a valid key (and, live, a whitelisted address). */
  async check() {
    const page = await this.read<Page<RemitaCategory>>('/categories?page=0&size=50');
    return page.items?.length ?? 0;
  }

  syncReport() {
    return this.lastReport;
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    const country = scope.country ? countries[scope.country] : undefined;
    const codes = remitaCategories[scope.category];
    if (!scope.country || !country || !codes) {
      this.lastReport = scope.country && !country ? `Remita lists no products for ${scope.country} that BitoCard can sell.` : null;
      return [];
    }
    const items: CatalogueItem[] = [];
    const skipped: string[] = [];
    const categories = await this.categories();
    for (const code of codes) {
      const category = categories.find(item => item.code === code);
      const providers = category ? await this.providers(category.id) : [];
      for (const product of await this.products(country.alpha3, code, providers)) {
        const item = this.item(scope.category, scope.country, country.currency, product, providers);
        if (item) items.push(item);
        else skipped.push(product.code);
      }
    }
    this.lastReport = items.length ? null : `Remita returned no ${scope.category} products for ${scope.country}${skipped.length ? ` (${skipped.length} left out: another category or no price)` : ''}.`;
    return items;
  }

  private async categories() {
    const page = await this.read<Page<RemitaCategory>>('/categories?page=0&size=50');
    return page.items ?? [];
  }

  private async providers(categoryId: number) {
    const reply = await this.call<RemitaProvider[]>(`/providers/category/${categoryId}`);
    return reply.status === '00' && Array.isArray(reply.data) ? reply.data : [];
  }

  /**
   * Every product of a category in a country, page by page. Asked for the whole category first; a gateway that wants
   * a provider named is then asked provider by provider.
   */
  private async products(alpha3: string, categoryCode: string, providers: RemitaProvider[]) {
    const all = await this.pages(new URLSearchParams({ countryCode: alpha3, categoryCode }));
    if (all.length || !providers.length) return all;
    const found: RemitaProduct[] = [];
    for (const provider of providers) found.push(...(await this.pages(new URLSearchParams({ countryCode: alpha3, categoryCode, provider: provider.code }))));
    return found;
  }

  private async pages(filter: URLSearchParams) {
    const found: RemitaProduct[] = [];
    for (let page = 0; page < 50; page += 1) {
      const query = new URLSearchParams(filter);
      query.set('page', String(page));
      query.set('pageSize', '100');
      const reply = await this.call<Page<RemitaProduct>>(`/products?${query}`);
      if (reply.status !== '00') {
        if (reply.status === '04' || reply.status === '06') throw new ProviderError(this.code, refusalText(reply), true);
        break;
      }
      found.push(...(reply.data?.items ?? []));
      if (page + 1 >= (reply.data?.totalPage ?? 1)) break;
    }
    return found;
  }

  /** One Remita product in BitoCard terms, or null when it belongs to another BitoCard category or cannot be priced. */
  private item(category: ProductCategory, country: string, defaultCurrency: string, product: RemitaProduct, providers: RemitaProvider[]): CatalogueItem | null {
    const providerCode = product.provider.toLowerCase();
    const base = providerCode.replace(/_(ng|nga|gh|gha|ke|ken|uk|gb|usa|us|za)$/, '');
    const network = mobileNetworks[base];
    const internet = product.categoryCode === 'internet_data_subscription';
    // Internet subscriptions: a mobile network's are data bundles to a phone; other providers' are bills to an account.
    if (internet && category === 'data' && !network) return null;
    if (internet && category === 'bills' && network) return null;
    const currency = (product.currencyCode ?? '').trim().toUpperCase() || defaultCurrency;
    if (currency !== defaultCurrency) return null;
    const amount = Number(product.amount ?? 0);
    const fixed = Number.isFinite(amount) && amount > 0 && (product.feeType ?? '').toUpperCase() !== 'DYNAMIC';
    const provider = providers.find(item => item.code.toLowerCase() === providerCode);
    const providerName = provider?.name ?? product.provider;

    let brand: string;
    let variant: string;
    let recipientType: CatalogueItem['recipientType'];
    if (product.categoryCode === 'electricity') {
      brand = remitaElectricityBrands[providerCode] ?? slug(providerCode);
      const words = product.name.toLowerCase();
      variant = /\bpre-?paid\b/.test(words) ? 'prepaid' : /\bpost-?paid\b/.test(words) ? 'postpaid' : slug(product.name, [providerName, 'electricity']);
      recipientType = 'meter';
    } else if (product.categoryCode === 'cable_tv') {
      brand = slug(base);
      variant = fixed ? slug(product.name) : `${slug(product.name, [providerName])}-any-amount`;
      recipientType = 'smartcard';
    } else if (category === 'airtime') {
      brand = network ?? slug(base);
      // Any-amount airtime shares the key other suppliers use, so offers compete on net margin.
      variant = fixed ? slug(product.name, [providerName]) : 'topup';
      recipientType = 'phone';
    } else if (category === 'data') {
      brand = network ?? slug(base);
      variant = slug(product.name, [providerName]);
      recipientType = 'phone';
    } else {
      brand = slug(base);
      variant = slug(product.name, [providerName]);
      recipientType = 'account';
    }
    const range = limits(category, currency);
    return {
      sku: product.code,
      productKey: `${category}:${country}:${brand}:${variant}`,
      category,
      country,
      brand,
      name: product.name.trim(),
      description: product.description && product.description !== product.name ? product.description : undefined,
      faceCurrency: currency,
      denominationType: fixed ? 'fixed' : 'range',
      fixedValues: fixed ? [minorOf(amount)] : [],
      ...(fixed ? {} : { minValue: range.min, maxValue: range.max }),
      recipientType,
      logoUrl: provider?.logoUrl || undefined,
      costCurrency: currency,
      // Remita charges face value; its commission is agreed with BitoCard and set by admins as the offer's discount.
      costRatio: '1',
      costFee: 0n,
      meta: { productCode: product.code, provider: product.provider, categoryCode: product.categoryCode },
    };
  }

  /** Meter, smartcard or account check: the name on it, and what Remita says about it (address, minimum, balance). */
  async validateRecipient(meta: Record<string, unknown>, accountNumber: string): Promise<RecipientCheck> {
    const reply = await this.call<RemitaValidation>('/validate', { method: 'POST', body: { productCode: String(meta.productCode), accountNumber } });
    if (reply.status !== '00') {
      if (reply.status === '02' || reply.status === '01') return { valid: false, reason: 'The number was not recognised.' };
      throw new ProviderError(this.code, refusalText(reply), refusedCodes.has(reply.status ?? ''));
    }
    const data = reply.data ?? {};
    if (!data.name?.trim()) return { valid: false, reason: 'The number was not recognised.' };
    const details: Record<string, string> = {};
    if (data.address) details.address = String(data.address).trim();
    if (data.district) details.district = String(data.district);
    if (data.accountType) details.account_type = String(data.accountType);
    if (data.tariff) details.tariff = String(data.tariff);
    if (data.minAmount !== null && data.minAmount !== undefined) details.min_amount = String(data.minAmount);
    if (data.maxAmount !== null && data.maxAmount !== undefined) details.max_amount = String(data.maxAmount);
    if (data.outstandingBalance !== null && data.outstandingBalance !== undefined) details.outstanding_balance = String(data.outstandingBalance);
    return { valid: true, accountName: data.name.trim(), details };
  }

  /** Remita's phone format: Nigerian numbers nationally (0803…), others as digits with their country code. */
  private phone(raw: string | undefined) {
    const value = (raw ?? this.options.contactPhone ?? '').replace(/[^\d+]/g, '');
    if (value.startsWith('+234')) return `0${value.slice(4)}`;
    return value.replace(/^\+/, '');
  }

  /**
   * Vends once, under our reference as `clientReference`: a repeat with it is Remita's duplicate ("23", "26", "94"),
   * which is asked about, never sent again. Airtime and data go to the phone (also sent as the account number).
   */
  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const toPhone = request.category === 'airtime' || request.category === 'data';
    const phone = this.phone(request.recipient.phone);
    const reply = await this.call<RemitaTransaction>('/transactions', {
      method: 'POST',
      body: {
        productCode: String(request.meta.productCode),
        clientReference: request.reference,
        // A number of whole units with up to two decimals, as Remita's docs show (not a string).
        amount: Number(toMajor(request.faceValue)),
        data: { accountNumber: toPhone ? phone : request.recipient.account_number, phoneNumber: phone },
      },
    });
    return this.outcome(reply, true);
  }

  /** The vend's state by our reference. Not finding it is not proof it failed: the order keeps waiting. */
  async orderStatus(request: FulfilmentRequest): Promise<FulfilmentResult> {
    return this.outcome(await this.call<RemitaTransaction>(`/query-transaction/${encodeURIComponent(request.reference)}`), false);
  }

  private outcome(reply: Reply<RemitaTransaction>, placing: boolean): FulfilmentResult {
    const status = reply.status ?? '';
    const data = reply.data ?? undefined;
    const supplierTransactionId = data?.paymentIdentifier === undefined || data?.paymentIdentifier === null ? undefined : String(data.paymentIdentifier);
    const detail = describe(reply);
    if (status === '00' && data) return { status: 'completed', supplierTransactionId, deliveries: [delivery(data)], detail };
    if (unclearCodes.has(status)) return { status: 'pending', supplierTransactionId, detail };
    // "01" is a failed transaction on a requery too; other refusals only mean anything when placing.
    if (status === '01' || (placing && refusedCodes.has(status))) return { status: 'failed', supplierTransactionId, detail };
    return { status: 'pending', supplierTransactionId, detail };
  }
}

/** Electricity returns a token (and sometimes more, after a meter change); everything else is confirmed by reference. */
function delivery(data: RemitaTransaction): Delivery {
  const details: Record<string, string> = {};
  if (data.unit !== null && data.unit !== undefined && String(data.unit) !== '') details.units = String(data.unit);
  const extra = Array.isArray(data.extraTokens) ? data.extraTokens.map(String).filter(Boolean) : typeof data.extraTokens === 'string' && data.extraTokens ? [data.extraTokens] : [];
  if (extra.length) details.extra_tokens = extra.join(', ');
  if (data.paymentIdentifier) details.reference = String(data.paymentIdentifier);
  const token = data.token?.trim();
  return token ? { kind: 'token', code: token, details } : { kind: 'confirmation', details };
}
