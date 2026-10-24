import { Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import { toMajor } from '../payments/providers.js';
import { type CatalogueItem, type CatalogueScope, type Delivery, type FulfilmentRequest, type FulfilmentResult, minorOf, type RecipientCheck, slug, type SupplierAdapter } from './adapter.js';

type Variation = { variation_code: string; name: string; variation_amount: string | number; fixedPrice?: string };
type VariationsResponse = { response_description?: string; content?: { ServiceName?: string; serviceID?: string; variations?: Variation[]; varations?: Variation[] } };
type PayResponse = {
  code?: string;
  response_description?: string;
  content?: { transactions?: { status?: string; transactionId?: string | number; total_amount?: string | number; commission?: string | number } };
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
/** Nigerian airtime on VTpass: its service ID and the brand BitoCard's products use (shared with other suppliers). */
export const vtpassAirtimeServices: Record<string, { brand: string; label: string }> = {
  mtn: { brand: 'mtn', label: 'MTN' },
  airtel: { brand: 'airtel', label: 'Airtel' },
  glo: { brand: 'glo', label: 'Glo' },
  etisalat: { brand: '9mobile', label: '9mobile' },
};
/** Nigerian data on VTpass, by service ID: the network's brand and how its plans are named. */
export const vtpassDataServices: Record<string, { brand: string; label: string }> = {
  'mtn-data': { brand: 'mtn', label: 'MTN' },
  'airtel-data': { brand: 'airtel', label: 'Airtel' },
  'glo-data': { brand: 'glo', label: 'Glo' },
  'glo-sme-data': { brand: 'glo', label: 'Glo SME' },
  'etisalat-data': { brand: '9mobile', label: '9mobile' },
};
/** Airtime amounts VTpass is asked for (₦50 to ₦50,000), to confirm with VTpass. */
const airtimeMin = 5_000n;
const airtimeMax = 5_000_000n;

/**
 * The commission agreed with VTpass per service, from its setting: `mtn 3; airtel 3.4; mtn-data 3`, one per line or
 * separated by semicolons or commas, each a service ID and a percent below 20. Services without one are not synced:
 * BitoCard's cost is the amount less it, so a missing or guessed commission would misprice every sale.
 */
export function parseVtpassCommissions(raw: string | undefined) {
  const commissions = new Map<string, Prisma.Decimal>();
  const problems: string[] = [];
  for (const entry of (raw ?? '').split(/[\n;,]+/).map(item => item.trim()).filter(Boolean)) {
    const match = /^([a-z0-9-]+)\s*[:=\s]\s*(\d{1,2}(?:\.\d{1,4})?)\s*%?$/i.exec(entry);
    const percent = match ? new Prisma.Decimal(match[2]) : null;
    if (!match || !percent || percent.gte(20)) problems.push(entry);
    else commissions.set(match[1].toLowerCase(), percent);
  }
  return { commissions, problems };
}

/** VTpass response codes meaning the request was refused and nothing was processed. */
const refusedCodes = new Set(['011', '012', '013', '014', '015', '017', '018', '019', '021', '022', '024', '025', '026', '027', '028', '030', '031', '032', '034', '035', '083', '085', '087', '089', '091']);

/** Electricity purchase limits (₦1,000 to ₦500,000), to confirm with VTpass. */
const electricityMin = 100_000n;
const electricityMax = 50_000_000n;

/**
 * VTpass: Nigerian pay-TV subscriptions, electricity, airtime and data, paid from BitoCard's VTpass wallet in naira.
 * GET calls use the public key; POST calls the secret key. Pay-TV and electricity are charged at face value with the
 * commission set by admins per offer; airtime and data at face value less the commission agreed per service
 * (`VTPASS_COMMISSIONS`), the amount each sale reports (`total_amount`) kept for reconciliation.
 */
export class VtpassAdapter implements SupplierAdapter {
  readonly code = 'vtpass';
  readonly syncs: ProductCategory[] = ['pay_tv', 'bills', 'airtime', 'data'];
  private report: string[] = [];

  constructor(
    private readonly keys: { apiKey?: string; publicKey?: string; secretKey?: string },
    private readonly baseUrl: string,
    private readonly contactPhone = '08011111111',
    private readonly commissions?: string,
  ) {}

  configured() {
    return Boolean(this.keys.apiKey && this.keys.publicKey && this.keys.secretKey);
  }

  syncReport() {
    return this.report.length ? this.report.join(' ') : null;
  }

  private variations(serviceID: string) {
    return providerRequest<VariationsResponse>(this.code, `${this.baseUrl}/service-variations?serviceID=${encodeURIComponent(serviceID)}`, {
      headers: { 'api-key': this.keys.apiKey ?? '', 'public-key': this.keys.publicKey ?? '' },
    });
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    this.report = [];
    if (scope.country !== 'NG') return [];
    if (scope.category === 'pay_tv') return this.services(vtpassTvServices, 'pay_tv');
    if (scope.category === 'bills') return this.services(vtpassElectricityServices, 'bills');
    if (scope.category === 'airtime') return this.airtime();
    if (scope.category === 'data') return this.data();
    return [];
  }

  /** The cost ratio (1 less the commission) of each service with an agreed commission; the rest are reported, not synced. */
  private agreed(serviceIDs: string[]) {
    const { commissions, problems } = parseVtpassCommissions(this.commissions);
    if (problems.length) this.report.push(`Commissions not understood: ${problems.join(', ')}.`);
    if (!serviceIDs.some(id => commissions.has(id))) {
      throw new ProviderError(this.code, 'set the commissions agreed with VTpass (Settings > Integrations > VTpass) before syncing airtime and data', true);
    }
    const missing = serviceIDs.filter(id => !commissions.has(id));
    if (missing.length) this.report.push(`No commission set for ${missing.join(', ')}: not synced.`);
    return serviceIDs.flatMap(id => {
      const percent = commissions.get(id);
      return percent ? [[id, new Prisma.Decimal(1).minus(percent.div(100)).toString()] as const] : [];
    });
  }

  /** Any amount on each network, as the product other suppliers sell it as (`airtime:NG:mtn:topup`). */
  private airtime(): CatalogueItem[] {
    return this.agreed(Object.keys(vtpassAirtimeServices)).map(([serviceID, costRatio]) => {
      const { brand, label } = vtpassAirtimeServices[serviceID];
      return {
        sku: `airtime:${serviceID}`,
        productKey: `airtime:NG:${brand}:topup`,
        name: `${label} Nigeria`,
        category: 'airtime' as const,
        country: 'NG',
        brand,
        faceCurrency: 'NGN',
        costCurrency: 'NGN',
        costRatio,
        costFee: 0n,
        denominationType: 'range' as const,
        fixedValues: [],
        minValue: airtimeMin,
        maxValue: airtimeMax,
        recipientType: 'phone' as const,
        // Its own limits: another supplier's sync may set the shared product's range wider.
        meta: { serviceID, min_value: airtimeMin.toString(), max_value: airtimeMax.toString() },
      };
    });
  }

  /** Each network's fixed-price plans, at the price VTpass lists them for (face value) less the commission. */
  private async data(): Promise<CatalogueItem[]> {
    const items: CatalogueItem[] = [];
    for (const [serviceID, costRatio] of this.agreed(Object.keys(vtpassDataServices))) {
      const { brand, label } = vtpassDataServices[serviceID];
      const res = await this.variations(serviceID);
      let open = 0;
      for (const variation of res.content?.variations ?? res.content?.varations ?? []) {
        const face = minorOf(variation.variation_amount);
        // A plan without a fixed price is priced by VTpass at sale time: never listed at a guessed price.
        if (String(variation.fixedPrice ?? 'Yes').toLowerCase() !== 'yes' || face <= 0n) {
          open += 1;
          continue;
        }
        items.push({
          sku: `${serviceID}:${variation.variation_code}`,
          productKey: `data:NG:${brand}:${slug(variation.variation_code)}`,
          name: `${label} ${variation.name}`.trim(),
          category: 'data',
          country: 'NG',
          brand,
          faceCurrency: 'NGN',
          costCurrency: 'NGN',
          costRatio,
          costFee: 0n,
          denominationType: 'fixed',
          fixedValues: [face],
          recipientType: 'phone',
          meta: { serviceID, variationCode: variation.variation_code },
        });
      }
      if (open) this.report.push(`${label}: ${open} plan${open === 1 ? '' : 's'} without a fixed price left out.`);
    }
    return items;
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
    // Airtime and data go to the customer's mobile number, in Nigeria's national format (0801…).
    if (serviceID in vtpassAirtimeServices) {
      const phone = nationalPhone(request.recipient.phone);
      return this.result(await this.post<PayResponse>('/pay', { request_id: request.reference, serviceID, amount: toMajor(request.faceValue), phone }), true);
    }
    if (serviceID in vtpassDataServices) {
      const phone = nationalPhone(request.recipient.phone);
      const body = { request_id: request.reference, serviceID, billersCode: phone, variation_code: String(request.meta.variationCode), amount: toMajor(request.faceValue), phone };
      return this.result(await this.post<PayResponse>('/pay', body), true);
    }
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
    if (code === '000' && status === 'delivered') return { status: 'completed', supplierTransactionId, deliveries: [delivery(res)], detail, reportedCost: reportedCost(res) };
    if (code === '016' || status === 'failed' || (placing && refusedCodes.has(code))) return { status: 'failed', supplierTransactionId, detail };
    return { status: 'pending', supplierTransactionId, detail };
  }
}

/** A Nigerian mobile number as VTpass takes it (`08012345678`), from E.164 or national form. */
function nationalPhone(phone: string | undefined) {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  return digits.startsWith('234') ? `0${digits.slice(3)}` : digits;
}

/** What VTpass charged after its commission (`total_amount`, naira), when its reply says. */
function reportedCost(res: PayResponse): FulfilmentResult['reportedCost'] {
  const total = Number(res.content?.transactions?.total_amount);
  if (res.content?.transactions?.total_amount === undefined || !Number.isFinite(total)) return undefined;
  return { amountMinor: BigInt(Math.round(total * 100)), currency: 'NGN' };
}

/** Electricity returns a token to hand to the customer; TV subscriptions return only a confirmation. */
function delivery(res: PayResponse): Delivery {
  const raw = res.mainToken ?? res.token ?? res.purchased_code;
  if (!raw) return { kind: 'confirmation' };
  const code = raw.replace(/^.*?token\s*:?\s*/i, '').trim();
  return { kind: 'token', code, details: res.units === undefined ? {} : { units: String(res.units) } };
}
