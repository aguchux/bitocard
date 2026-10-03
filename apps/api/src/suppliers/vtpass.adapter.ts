import type { ProductCategory } from '../generated/prisma/client.js';
import { providerRequest } from '../payments/provider-error.js';
import { toMajor } from '../payments/providers.js';
import { type CatalogueItem, type CatalogueScope, type Delivery, type FulfilmentRequest, type FulfilmentResult, minorOf, type RecipientCheck, slug, type SupplierAdapter } from './adapter.js';

type Variation = { variation_code: string; name: string; variation_amount: string | number; fixedPrice?: string };
type VariationsResponse = { response_description?: string; content?: { ServiceName?: string; serviceID?: string; variations?: Variation[]; varations?: Variation[] } };
type PayResponse = {
  code?: string;
  response_description?: string;
  content?: { transactions?: { status?: string; transactionId?: string | number } };
  purchased_code?: string;
  token?: string;
  mainToken?: string;
  units?: string | number;
};
type VerifyResponse = { code?: string; content?: Record<string, string | number | undefined> & { error?: string } };

/** Nigerian pay-TV services synced from VTpass. */
export const vtpassTvServices = ['dstv', 'gotv', 'startimes', 'showmax'];
/** Nigerian electricity distribution companies on VTpass. */
export const vtpassElectricityServices = [
  'ikeja-electric',
  'eko-electric',
  'abuja-electric',
  'kano-electric',
  'portharcourt-electric',
  'jos-electric',
  'kaduna-electric',
  'enugu-electric',
  'ibadan-electric',
  'benin-electric',
  'aba-electric',
  'yola-electric',
];
/** VTpass response codes meaning the request was refused and nothing was processed. */
const refusedCodes = new Set(['011', '012', '013', '014', '015', '017', '018', '019', '021', '022', '024', '025', '026', '027', '028', '030', '031', '032', '034', '035', '083', '085', '087', '089', '091']);

/** Electricity purchase limits (₦1,000 to ₦500,000), to confirm with VTpass. */
const electricityMin = 100_000n;
const electricityMax = 50_000_000n;

/** VTpass: Nigerian pay-TV subscriptions and electricity. GET calls use the public key; POST calls the secret key. */
export class VtpassAdapter implements SupplierAdapter {
  readonly code = 'vtpass';
  readonly syncs: ProductCategory[] = ['pay_tv', 'bills'];

  constructor(
    private readonly keys: { apiKey?: string; publicKey?: string; secretKey?: string },
    private readonly baseUrl: string,
    private readonly contactPhone = '08011111111',
  ) {}

  configured() {
    return Boolean(this.keys.apiKey && this.keys.publicKey && this.keys.secretKey);
  }

  private variations(serviceID: string) {
    return providerRequest<VariationsResponse>(this.code, `${this.baseUrl}/service-variations?serviceID=${encodeURIComponent(serviceID)}`, {
      headers: { 'api-key': this.keys.apiKey ?? '', 'public-key': this.keys.publicKey ?? '' },
    });
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    if (scope.country !== 'NG') return [];
    if (scope.category === 'pay_tv') return this.services(vtpassTvServices, 'pay_tv');
    if (scope.category === 'bills') return this.services(vtpassElectricityServices, 'bills');
    return [];
  }

  private async services(serviceIDs: string[], category: 'pay_tv' | 'bills') {
    const items: CatalogueItem[] = [];
    for (const serviceID of serviceIDs) {
      const res = await this.variations(serviceID);
      const variations = res.content?.variations ?? res.content?.varations ?? [];
      const service = res.content?.ServiceName ?? serviceID;
      for (const variation of variations) {
        const base = {
          sku: `${serviceID}:${variation.variation_code}`,
          productKey: `${category}:NG:${serviceID}:${slug(variation.variation_code)}`,
          category,
          country: 'NG',
          brand: serviceID,
          faceCurrency: 'NGN',
          costCurrency: 'NGN',
          // VTpass charges face value and pays commission separately; the agreed commission is set by admins as a discount.
          costRatio: '1',
          costFee: 0n,
          meta: { serviceID, variationCode: variation.variation_code },
        };
        if (category === 'pay_tv') {
          items.push({ ...base, name: variation.name, denominationType: 'fixed', fixedValues: [minorOf(variation.variation_amount)], recipientType: 'smartcard' });
        } else {
          items.push({
            ...base,
            name: `${service.replace(/ - .*$/, '')} ${variation.name}`.trim(),
            denominationType: 'range',
            fixedValues: [],
            minValue: electricityMin,
            maxValue: electricityMax,
            recipientType: 'meter',
          });
        }
      }
    }
    return items;
  }

  /** Smartcard, IUC or meter check. Returns the account name and, for TV, the current package. */
  async validateRecipient(meta: Record<string, unknown>, accountNumber: string): Promise<RecipientCheck> {
    const serviceID = String(meta.serviceID);
    const body: Record<string, string> = { billersCode: accountNumber, serviceID };
    if (vtpassElectricityServices.includes(serviceID)) body.type = String(meta.variationCode);
    const res = await providerRequest<VerifyResponse>(this.code, `${this.baseUrl}/merchant-verify`, {
      method: 'POST',
      headers: { 'api-key': this.keys.apiKey ?? '', 'secret-key': this.keys.secretKey ?? '' },
      body,
    });
    const content = res.content ?? {};
    const name = content.Customer_Name;
    if (content.error || !name) return { valid: false, reason: 'The number was not recognised.' };
    const details: Record<string, string> = {};
    if (content.Current_Bouquet) details.current_package = String(content.Current_Bouquet);
    if (content.Due_Date) details.due_date = String(content.Due_Date);
    if (content.Renewal_Amount !== undefined) details.renewal_amount = String(content.Renewal_Amount);
    if (content.Address) details.address = String(content.Address);
    return { valid: true, accountName: String(name).trim(), details };
  }

  private post<T>(path: string, body: unknown) {
    return providerRequest<T>(this.code, `${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'api-key': this.keys.apiKey ?? '', 'secret-key': this.keys.secretKey ?? '' },
      body,
    });
  }

  /** Our reference is the VTpass request_id, which must start with the Lagos date and time (YYYYMMDDHHmm). */
  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const serviceID = String(request.meta.serviceID);
    const tv = vtpassTvServices.includes(serviceID);
    const res = await this.post<PayResponse>('/pay', {
      request_id: request.reference,
      serviceID,
      billersCode: request.recipient.account_number,
      variation_code: String(request.meta.variationCode),
      amount: toMajor(request.faceValue),
      phone: request.recipient.phone?.replace(/^\+234/, '0') ?? this.contactPhone,
      ...(tv ? { subscription_type: request.recipient.transaction_type === 'renew' ? 'renew' : 'change' } : {}),
    });
    return this.result(res, true);
  }

  /** A requery that does not recognise the request ID is not proof of failure: the order keeps waiting. */
  async orderStatus(request: FulfilmentRequest): Promise<FulfilmentResult> {
    return this.result(await this.post<PayResponse>('/requery', { request_id: request.reference }), false);
  }

  private result(res: PayResponse, placing: boolean): FulfilmentResult {
    const code = res.code ?? '';
    const status = (res.content?.transactions?.status ?? '').toLowerCase();
    const supplierTransactionId = res.content?.transactions?.transactionId === undefined ? undefined : String(res.content.transactions.transactionId);
    const detail = `${code} ${res.response_description ?? ''} ${status}`.trim();
    if (code === '000' && status === 'delivered') return { status: 'completed', supplierTransactionId, deliveries: [delivery(res)], detail };
    if (code === '016' || status === 'failed' || (placing && refusedCodes.has(code))) return { status: 'failed', supplierTransactionId, detail };
    return { status: 'pending', supplierTransactionId, detail };
  }
}

/** Electricity returns a token to hand to the customer; TV subscriptions return only a confirmation. */
function delivery(res: PayResponse): Delivery {
  const raw = res.mainToken ?? res.token ?? res.purchased_code;
  if (!raw) return { kind: 'confirmation' };
  const code = raw.replace(/^.*?token\s*:?\s*/i, '').trim();
  return { kind: 'token', code, details: res.units === undefined ? {} : { units: String(res.units) } };
}
