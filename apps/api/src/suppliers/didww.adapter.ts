import type { ProductCategory } from '../generated/prisma/client.js';
import { providerRequest } from '../payments/provider-error.js';
import { type CatalogueItem, type CatalogueScope, type FulfilmentRequest, type FulfilmentResult, slug, type SupplierAdapter } from './adapter.js';

/** The DIDWW API version the request and response shapes below follow. */
export const didwwApiVersion = '2022-05-10';

type Resource<A> = { id: string; type: string; attributes: A; relationships?: Record<string, { data?: { id: string; type: string } | { id: string; type: string }[] | null }> };
type Document<A, I = unknown> = { data: Resource<A>[]; included?: Resource<I>[]; meta?: { total_records?: number } };
type One<A> = { data: Resource<A> };

type CountryAttributes = { name: string; iso: string; prefix: string };
type DidGroupAttributes = { prefix: string; features: string[]; is_metered: boolean; area_name: string; allow_additional_channels: boolean };
type DidGroupMeta = { needs_registration?: boolean; is_available?: boolean };
type SkuAttributes = { setup_price: string; monthly_price: string; channels_included_count: number };
type TypeAttributes = { name: string };
type OrderAttributes = { status: string; reference?: string; amount?: string; callback_url?: string | null; created_at?: string };
type DidAttributes = { number: string; expires_at?: string | null; channels_included_count?: number };

/** Number capabilities BitoCard shows, in DIDWW's names. Fax (t38) is not sold. */
const capabilities = ['voice', 'voice_out', 'sms', 'sms_out'] as const;
const capabilityLabels: Record<(typeof capabilities)[number], string> = { voice: 'incoming calls', voice_out: 'outgoing calls', sms: 'incoming SMS', sms_out: 'outgoing SMS' };
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
};

/**
 * DIDWW: virtual phone numbers (DIDs). A product is one country, number type, area and capability set at one price
 * (DIDWW's DID group and stock keeping unit). The customer pays the setup fee and the first month; numbers are ordered
 * for one billing cycle, so DIDWW never renews (and charges for) a number BitoCard has not been paid for. Renewals,
 * numbers needing the end user's documents and metered (per-minute) numbers are not sold yet.
 *
 * DIDWW orders carry no reference of ours, so each order's callback address names it (`?reference=`): DIDWW echoes the
 * address on the order, which lets an order whose reply was lost be found again instead of being placed twice.
 */
export class DidwwAdapter implements SupplierAdapter {
  readonly code = 'didww';
  readonly syncs: ProductCategory[] = ['virtual_numbers'];

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
  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    if (scope.category !== 'virtual_numbers') return [];
    const countries = scope.country ? [scope.country] : this.settings.countries;
    const items: CatalogueItem[] = [];
    for (const iso of countries) items.push(...(await this.country(iso.toUpperCase())));
    return items;
  }

  private async country(iso: string): Promise<CatalogueItem[]> {
    const found = await this.request<Document<CountryAttributes>>(`/countries?filter[iso]=${encodeURIComponent(iso)}`);
    const country = found.data[0];
    if (!country) return [];
    const items: CatalogueItem[] = [];
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
      for (const group of res.data) items.push(...this.groupItems(country.attributes, group as Resource<DidGroupAttributes> & { meta?: DidGroupMeta }, included));
      if (res.data.length < pageSize) break;
    }
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
    const features = capabilities.filter(feature => group.attributes.features.includes(feature));
    if (!features.includes('voice') && !features.includes('sms')) return [];
    const skus = related('stock_keeping_units') as Resource<SkuAttributes>[];
    const area = group.attributes.area_name?.trim() || typeName;
    const numberType = slug(typeName);
    return skus.map(sku => {
      const setup = centsUp(sku.attributes.setup_price);
      const monthly = centsUp(sku.attributes.monthly_price);
      const channels = sku.attributes.channels_included_count ?? 0;
      const variant = [slug(area), ...features.map(feature => feature.replace('_', '-')), ...(skus.length > 1 ? [`${channels}ch`] : [])].join('-');
      const what = features.map(feature => capabilityLabels[feature]).join(', ');
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

  /** The callback address for one order: it names our reference, which is how a lost order is found again. */
  callbackUrl(reference: string) {
    return `${this.settings.callbackBase.replace(/\/+$/, '')}/v1/webhooks/didww?reference=${encodeURIComponent(reference)}`;
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
            callback_method: 'POST',
            items: [{ type: 'did_order_items', attributes: { sku_id: String(request.meta.skuId), qty: 1, billing_cycles_count: 1 } }],
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
    return {
      status: 'completed',
      supplierTransactionId: order.id,
      detail,
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
}
