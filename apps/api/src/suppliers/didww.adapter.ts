import type { ProductCategory } from '../generated/prisma/client.js';
import { type FeatureRules, meetsFeatureRules, type ProductFeature, productFeatureKeys } from '../catalogue/features.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import { type CatalogueItem, type CatalogueScope, type FulfilmentRequest, type FulfilmentResult, type NumberSupplier, slug, type SupplierAdapter } from './adapter.js';

/** The DIDWW API version the request and response shapes below follow. */
export const didwwApiVersion = '2026-04-16';

type Resource<A> = { id: string; type: string; attributes: A; relationships?: Record<string, { data?: { id: string; type: string } | { id: string; type: string }[] | null }> };
type Document<A, I = unknown> = { data: Resource<A>[]; included?: Resource<I>[]; meta?: { total_records?: number } };
type One<A> = { data: Resource<A> };

type CountryAttributes = { name: string; iso: string; prefix: string };
type DidGroupAttributes = { prefix: string; features: string[]; is_metered: boolean; area_name: string; allow_additional_channels: boolean };
type DidGroupMeta = { needs_registration?: boolean; is_available?: boolean };
type SkuAttributes = { setup_price: string; monthly_price: string; channels_included_count: number };
type TypeAttributes = { name: string };
type OrderAttributes = { status: string; reference?: string; amount?: string; callback_url?: string | null; created_at?: string };
type DidAttributes = {
  number: string;
  expires_at?: string | null;
  channels_included_count?: number;
  /** Renewals left before it expires: null renews for ever, 0 none. */
  billing_cycles_count?: number | null;
  terminated?: boolean;
  blocked?: boolean;
};

/** Number capabilities in product keys, in DIDWW's names (fax shows in a key only on numbers with no calls or SMS). */
const capabilities = ['voice', 'voice_out', 'sms', 'sms_out'] as const;
/** DIDWW API 2026-04-16 names incoming calls and SMS `voice_in` and `sms_in`; older versions `voice` and `sms`. Read both. */
const featureAliases: Record<string, (typeof capabilities)[number]> = { voice: 'voice', voice_in: 'voice', voice_out: 'voice_out', sms: 'sms', sms_in: 'sms', sms_out: 'sms_out' };
/**
 * DIDWW features as BitoCard's product features (`src/catalogue/features.ts`): `a2p` numbers receive SMS sent by apps
 * and services (verification codes), `p2p` SMS from people, `cnam_out` shows the caller's name, `t38` receives fax.
 */
const publicFeatures: Record<string, ProductFeature> = {
  voice: 'calls_in',
  voice_in: 'calls_in',
  voice_out: 'calls_out',
  sms: 'sms_in',
  sms_in: 'sms_in',
  sms_out: 'sms_out',
  p2p: 'sms_people',
  a2p: 'app_codes',
  emergency: 'emergency',
  cnam_out: 'caller_name',
  t38: 'fax',
};
/** How each feature reads in a number's description. */
const describe: Record<ProductFeature, string> = {
  calls_in: 'incoming calls',
  calls_out: 'outgoing calls',
  sms_in: 'incoming SMS',
  sms_out: 'outgoing SMS',
  sms_people: 'SMS from people',
  app_codes: 'SMS codes from apps and services',
  emergency: 'emergency calls',
  caller_name: 'caller name display',
  fax: 'fax',
};
const pageSize = 100;

/** US dollars as a decimal string to cents, rounded up so BitoCard never records less than DIDWW charges. */
const centsUp = (value: string | number | null | undefined) => BigInt(Math.ceil(Math.round(Number(value ?? 0) * 1_000_000) / 10_000));

export type DidwwSettings = {
  apiKey?: string;
  baseUrl: string;
  /** ISO codes of the countries whose numbers are synced (numbers are sold to any market). */
  countries: string[];
  /** BitoCard's public API address, used for DIDWW's order callbacks (`/v1/webhooks/didww`). */
  callbackBase: string;
  /** Outgoing SMS: DIDWW's HTTP OUT SMS trunk (its own address and Basic credentials, not the API key). */
  sms?: { url: string; username?: string; password?: string };
  /**
   * A reseller's own DIDWW account: its callbacks go to that connection's own address
   * (`/v1/webhooks/didww/<connection>`), where they are checked with the reseller's own API key.
   */
  connectionId?: string;
};

/**
 * DIDWW: virtual phone numbers (DIDs). A product is one country, number type, area and capability set at one price
 * (DIDWW's DID group and stock keeping unit). The customer pays the setup fee and the first month; numbers are ordered
 * for one billing cycle, so DIDWW never renews (and charges for) a number BitoCard has not been paid for.
 *
 * Only numbers in stock, needing no end user documents and not billed per minute are synced, and only those keeping to
 * the admin's feature rules (Catalog > Suppliers > DIDWW > Features: each feature required, allowed or excluded). Until
 * an admin changes them, numbers must receive SMS and SMS codes from apps (`a2p`), whose SMS will be read in BitoCard or
 * forwarded by email.
 *
 * DIDWW orders carry no reference of ours, so each order's callback address names it (`?reference=`): DIDWW echoes the
 * address on the order, which lets an order whose reply was lost be found again instead of being placed twice.
 */
export class DidwwAdapter implements SupplierAdapter {
  readonly code = 'didww';
  readonly syncs: ProductCategory[] = ['virtual_numbers'];
  readonly gatedFeatures: readonly ProductFeature[] = productFeatureKeys;
  readonly defaultFeatureRules: FeatureRules = { sms_in: 'required', app_codes: 'required' };
  /** The rules of the sync in progress. */
  private rules: FeatureRules = this.defaultFeatureRules;

  constructor(private readonly settings: DidwwSettings) {}

  configured() {
    return Boolean(this.settings.apiKey);
  }

  private request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    return providerRequest<T>(this.code, `${this.settings.baseUrl}${path}`, {
      ...init,
      headers: {
        'api-key': this.settings.apiKey ?? '',
        accept: 'application/vnd.api+json',
        'x-didww-api-version': didwwApiVersion,
        ...(init.body !== undefined ? { 'content-type': 'application/vnd.api+json' } : {}),
      },
    });
  }

  /** Numbers are bought for use anywhere, so they are synced once for the configured countries, not per market. */
  /** What the last catalogue fetch found per country, so an empty sync says why. */
  private report: string[] = [];

  syncReport() {
    return this.report.length ? this.report.join(' ') : null;
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    if (scope.category !== 'virtual_numbers') return [];
    const countries = scope.country ? [scope.country] : this.settings.countries;
    this.report = countries.length ? [] : ['No number countries are set (Settings > Integrations > DIDWW).'];
    this.rules = scope.features ?? this.defaultFeatureRules;
    const items: CatalogueItem[] = [];
    for (const iso of countries) items.push(...(await this.country(iso.toUpperCase())));
    return items;
  }

  private async country(iso: string): Promise<CatalogueItem[]> {
    const found = await this.request<Document<CountryAttributes>>(`/countries?filter[iso]=${encodeURIComponent(iso)}`);
    const country = found.data[0];
    if (!country) {
      this.report.push(`${iso}: not a DIDWW country.`);
      return [];
    }
    const items: CatalogueItem[] = [];
    let groups = 0;
    const skipped = { documents: 0, metered: 0, unavailable: 0, rules: 0, prices: 0 };
    const seen = new Set<string>();
    for (let page = 1; ; page += 1) {
      const query = [
        `filter[country.id]=${country.id}`,
        'filter[is_available]=true',
        'filter[needs_registration]=false',
        'filter[is_metered]=false',
        'include=did_group_type,stock_keeping_units',
        `page[size]=${pageSize}`,
        `page[number]=${page}`,
      ].join('&');
      const res = await this.request<Document<DidGroupAttributes, SkuAttributes & TypeAttributes>>(`/did_groups?${query}`);
      const included = new Map((res.included ?? []).map(item => [`${item.type}:${item.id}`, item]));
      for (const group of res.data as Array<Resource<DidGroupAttributes> & { meta?: DidGroupMeta }>) {
        groups += 1;
        if (group.meta?.needs_registration) skipped.documents += 1;
        else if (group.attributes.is_metered) skipped.metered += 1;
        else if (group.meta?.is_available === false) skipped.unavailable += 1;
        const found = this.groupItems(country.attributes, group, included);
        if (!group.meta?.needs_registration && !group.attributes.is_metered && group.meta?.is_available !== false && found.length === 0) {
          if (!this.sellable(group)) {
            skipped.rules += 1;
            for (const feature of group.attributes.features ?? []) seen.add(feature);
          } else skipped.prices += 1;
        }
        items.push(...found);
      }
      if (res.data.length < pageSize) break;
    }
    const reasons = [
      skipped.documents && `${skipped.documents} need the end user's documents`,
      skipped.metered && `${skipped.metered} are billed per minute`,
      skipped.unavailable && `${skipped.unavailable} are out of stock`,
      skipped.rules && `${skipped.rules} do not match the feature settings (features: ${[...seen].join(', ') || 'none'})`,
      skipped.prices && `${skipped.prices} have no prices`,
    ].filter(Boolean);
    // DIDWW is asked only for numbers in stock that need no documents and are not billed per minute.
    this.report.push(`${iso}: ${groups} number groups in stock without documents or per-minute billing, ${items.length} products${reasons.length ? `; ${reasons.join(', ')}` : ''}.`);
    return items;
  }

  private groupItems(country: CountryAttributes, group: Resource<DidGroupAttributes> & { meta?: DidGroupMeta }, included: Map<string, Resource<unknown>>): CatalogueItem[] {
    // Filtered by the API as well; checked again so a regulated or metered number is never sold by mistake.
    if (group.meta?.needs_registration || group.meta?.is_available === false || group.attributes.is_metered) return [];
    const related = (name: string) => {
      const data = group.relationships?.[name]?.data;
      return (Array.isArray(data) ? data : data ? [data] : []).map(ref => included.get(`${ref.type}:${ref.id}`)).filter(Boolean) as Resource<unknown>[];
    };
    const typeName = (related('did_group_type')[0]?.attributes as TypeAttributes | undefined)?.name ?? 'Local';
    if (!this.sellable(group)) return [];
    const features = this.features(group);
    // Everything the number can do, for the stores' icons and filters (calls and SMS, app codes, emergency, caller name, fax).
    const productFeatureList = this.productFeatures(group);
    const skus = related('stock_keeping_units') as Resource<SkuAttributes>[];
    const area = group.attributes.area_name?.trim() || typeName;
    const numberType = slug(typeName);
    return skus.map(sku => {
      const setup = centsUp(sku.attributes.setup_price);
      const monthly = centsUp(sku.attributes.monthly_price);
      const channels = sku.attributes.channels_included_count ?? 0;
      // Keys name calls and SMS only, so they stay stable when fax is added; a fax-only number is named by its fax.
      const named = features.length ? features.map(feature => feature.replace('_', '-')) : ['fax'];
      const variant = [slug(area), ...named, ...(skus.length > 1 ? [`${channels}ch`] : [])].join('-');
      const what = productFeatureList.map(feature => describe[feature]).join(', ');
      return {
        sku: `${group.id}:${sku.id}`,
        productKey: `virtual_numbers:${country.iso}:${numberType}:${variant}`,
        category: 'virtual_numbers',
        country: country.iso,
        brand: numberType,
        name: `${country.name} ${typeName.toLowerCase()} number, ${area}`,
        faceCurrency: 'USD',
        denominationType: 'fixed',
        // Setup plus the first month: what DIDWW charges for the order.
        fixedValues: [setup + monthly],
        recipientType: 'none',
        features: productFeatureList,
        description: `A ${country.name} number (+${country.prefix} ${group.attributes.prefix}) with ${what}${channels ? `, ${channels} call channels` : ''}. Includes the first month.`,
        costCurrency: 'USD',
        costRatio: '1',
        costFee: 0n,
        meta: {
          didGroupId: group.id,
          skuId: sku.id,
          numberType,
          areaName: area,
          capabilities: features,
          channels,
          setupMinor: Number(setup),
          monthlyMinor: Number(monthly),
        },
      } satisfies CatalogueItem;
    });
  }

  /** The group's capabilities in BitoCard's names (calls and SMS in and out). */
  private features(group: Resource<DidGroupAttributes>) {
    const names = new Set((group.attributes.features ?? []).map(feature => featureAliases[feature]).filter(Boolean));
    return capabilities.filter(feature => names.has(feature));
  }

  /** Everything the group's numbers can do, in BitoCard's names. */
  private productFeatures(group: Resource<DidGroupAttributes>) {
    const named = new Set((group.attributes.features ?? []).map(feature => publicFeatures[feature]).filter(Boolean));
    return productFeatureKeys.filter(feature => named.has(feature));
  }

  /** Sold only when the numbers receive calls, SMS or fax, and keep to the admin's feature rules. */
  private sellable(group: Resource<DidGroupAttributes>) {
    const features = this.productFeatures(group);
    const usable = features.some(feature => feature === 'calls_in' || feature === 'sms_in' || feature === 'fax');
    return usable && meetsFeatureRules(features, this.rules);
  }

  /** The callback address for one order: it names our reference, which is how a lost order is found again. */
  callbackUrl(reference: string) {
    const path = this.settings.connectionId ? `/v1/webhooks/didww/${this.settings.connectionId}` : '/v1/webhooks/didww';
    return `${this.settings.callbackBase.replace(/\/+$/, '')}${path}?reference=${encodeURIComponent(reference)}`;
  }

  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const res = await this.request<One<OrderAttributes>>('/orders', {
      method: 'POST',
      body: {
        data: {
          type: 'orders',
          attributes: {
            allow_back_ordering: false,
            callback_url: this.callbackUrl(request.reference),
            callback_method: 'post',
            // No automatic renewals: DIDWW counts renewals left after the first period, so 0 means only the month paid
            // for. Each renewal is paid from the reseller's wallet first, then added (`renewNumber`).
            items: [{ type: 'did_order_items', attributes: { sku_id: String(request.meta.skuId), qty: 1, billing_cycles_count: 0 } }],
          },
        },
      },
    });
    return this.result(res.data, request);
  }

  /** By DIDWW's order ID when known; otherwise the order whose callback address names our reference. */
  async orderStatus(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult> {
    if (supplierTransactionId) return this.result((await this.request<One<OrderAttributes>>(`/orders/${encodeURIComponent(supplierTransactionId)}`)).data, request);
    const recent = await this.request<Document<OrderAttributes>>(`/orders?sort=-created_at&page[size]=${pageSize}`);
    const callback = this.callbackUrl(request.reference);
    const order = recent.data.find(item => item.attributes.callback_url === callback);
    // Not found is not proof that it failed (DIDWW may not list it yet): the order keeps waiting and is checked again.
    return order ? this.result(order, request) : { status: 'pending', detail: 'No DIDWW order with this reference yet' };
  }

  private async result(order: Resource<OrderAttributes>, request: FulfilmentRequest): Promise<FulfilmentResult> {
    const status = order.attributes.status?.toLowerCase();
    const detail = `${order.attributes.reference ?? order.id} ${order.attributes.status}`;
    if (status === 'canceled' || status === 'cancelled') return { status: 'failed', supplierTransactionId: order.id, detail };
    if (status !== 'completed') return { status: 'pending', supplierTransactionId: order.id, detail };
    const dids = await this.request<Document<DidAttributes>>(`/dids?filter[order.id]=${encodeURIComponent(order.id)}`);
    const did = dids.data[0];
    // Completed but the number is not listed yet: look again rather than deliver nothing.
    if (!did) return { status: 'pending', supplierTransactionId: order.id, detail: `${detail}, number not listed yet` };
    const meta = request.meta;
    const number = `+${did.attributes.number.replace(/^\+/, '')}`;
    return {
      status: 'completed',
      supplierTransactionId: order.id,
      detail,
      numbers: [
        {
          supplierNumberId: did.id,
          number,
          expiresAt: did.attributes.expires_at ? new Date(did.attributes.expires_at) : null,
          monthlyCostMinor: BigInt(Number(meta.monthlyMinor ?? 0)),
          costCurrency: 'USD',
        },
      ],
      deliveries: [
        {
          kind: 'virtual_number',
          serial: `+${did.attributes.number.replace(/^\+/, '')}`,
          details: {
            number: `+${did.attributes.number.replace(/^\+/, '')}`,
            number_type: String(meta.numberType ?? ''),
            capabilities: Array.isArray(meta.capabilities) ? meta.capabilities.join(',') : '',
            ...(did.attributes.expires_at ? { expires_at: did.attributes.expires_at } : {}),
          },
        },
      ],
    };
  }

  // -- Numbers already bought ------------------------------------------------------------------------------------------

  readonly numbers: NumberSupplier = {
    /**
     * One more paid month: DIDWW renews at `expires_at` once per renewal left (`billing_cycles_count`), charged to the
     * DIDWW balance then. A paused (expired or cancelled) number is restored with `terminated: false`.
     */
    renewNumber: async (didId: string) => {
      const did = (await this.request<One<DidAttributes>>(`/dids/${encodeURIComponent(didId)}`)).data;
      const left = did.attributes.billing_cycles_count ?? 0;
      const updated = await this.request<One<DidAttributes>>(`/dids/${encodeURIComponent(didId)}`, {
        method: 'PATCH',
        body: { data: { id: didId, type: 'dids', attributes: { billing_cycles_count: left + 1, ...(did.attributes.terminated || did.attributes.blocked ? { terminated: false } : {}) } } },
      });
      const expires = updated.data.attributes.expires_at ?? did.attributes.expires_at;
      return { expiresAt: expires ? new Date(expires) : null };
    },
    /** Cancelled for good: no renewals left, removed from service. */
    releaseNumber: async (didId: string) => {
      await this.request(`/dids/${encodeURIComponent(didId)}`, {
        method: 'PATCH',
        body: { data: { id: didId, type: 'dids', attributes: { billing_cycles_count: 0, terminated: true } } },
      });
    },
    smsConfigured: () => Boolean(this.settings.sms?.username && this.settings.sms.password),
    /** DIDWW's outbound SMS API (`POST /outbound_messages`, Basic auth with the HTTP OUT trunk's credentials). */
    sendSms: async (input: { from: string; to: string; text: string }) => {
      const sms = this.settings.sms;
      if (!sms?.username || !sms.password) throw new ProviderError(this.code, 'outgoing SMS is not set up', true);
      const res = await providerRequest<{ data?: { id?: string } }>(this.code, `${sms.url.replace(/\/+$/, '')}/outbound_messages`, {
        method: 'POST',
        body: { data: { type: 'outbound_messages', attributes: { source: input.from.replace(/^\+/, ''), destination: input.to.replace(/^\+/, ''), content: input.text } } },
        headers: {
          authorization: `Basic ${Buffer.from(`${sms.username}:${sms.password}`).toString('base64')}`,
          accept: 'application/vnd.api+json',
          'content-type': 'application/vnd.api+json',
        },
      });
      if (!res.data?.id) throw new ProviderError(this.code, 'no message ID returned', false);
      return { supplierMessageId: res.data.id };
    },
  };
}
