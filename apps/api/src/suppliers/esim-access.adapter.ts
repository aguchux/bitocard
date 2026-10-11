import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import { worldwideCountry } from '../catalogue/pricing.service.js';
import type { CatalogueItem, Delivery, EsimState, EsimSupplier, EsimTopUpKind, EsimTopUpOption, FulfilmentRequest, FulfilmentResult, SupplierAdapter } from './adapter.js';
import { slug } from './adapter.js';

const Decimal = Prisma.Decimal;
const regionNames = new Intl.DisplayNames(['en-GB'], { type: 'region' });

/** eSIM Access prices are US dollars times 10,000 (10000 = $1.00); BitoCard's minor units are cents. */
const unitsPerCent = 100;

/**
 * eSIM Access error codes that mean the request was refused before anything was ordered: bad requests, refused
 * credentials or signature, a price that changed, too little balance, a package that no longer exists or has no
 * profiles left. Anything else (a server error, "busy") is unclear and the order is checked again.
 */
const refusedCodes = new Set([
  '000101', '000102', '000103', '000104', '000105', '000106', '000107',
  '101001', '101002', '101003',
  '200002', '200005', '200006', '200007', '200008', '200011',
  '310201', '310211', '310221', '310231', '310241', '310243', '310251', '310272', '310403',
]);
/** Profiles still being allocated for the order (the query answers this until they are ready). */
const stillAllocating = '200010';

/**
 * Day passes (`dataType` 2 to 4: an allowance a day) are priced per day; each is sold as one product per number of days
 * here, so the customer chooses the days by choosing the product. Top-ups that extend a day pass offer the same days.
 */
export const dayPassDays = [1, 3, 5, 7, 10, 15, 30] as const;
const topUpDays = [1, 3, 7, 15, 30] as const;

/** BitoCard's name for an eSIM's state, from eSIM Access's lifecycle (`esimStatus`) and SM-DP+ (`smdpStatus`) states. */
export function esimStateName(esimStatus: string | null | undefined, smdpStatus: string | null | undefined) {
  switch ((esimStatus ?? '').toUpperCase()) {
    case 'CANCEL':
      return 'cancelled';
    case 'REVOKED':
      return 'revoked';
    case 'SUSPENDED':
      return 'suspended';
    case 'USED_UP':
      return 'used_up';
    case 'USED_EXPIRED':
    case 'UNUSED_EXPIRED':
      return 'expired';
    case 'IN_USE':
      return 'active';
    default:
      // Allocated (GOT_RESOURCE): not on a phone until the SM-DP+ says it was downloaded.
      return !smdpStatus || smdpStatus.toUpperCase() === 'RELEASED' ? 'ready' : 'installed';
  }
}

/** eSIM Access times come as `2027-04-09T18:34:17+0000` or ISO 8601. */
const time = (value: unknown) => {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const bytes = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? BigInt(Math.round(value)) : null);
const topUpKind = (support: unknown): EsimTopUpKind => (support === 3 ? 'days' : support === 2 ? 'data' : 'none');

type Reply<T> = { success: boolean | string; errorCode?: string | null; errorMsg?: string | null; errorMessage?: string | null; obj?: T | null };
type Package = {
  packageCode: string;
  slug?: string;
  name: string;
  price: number;
  currencyCode: string;
  volume: number;
  unusedValidTime?: number;
  duration: number;
  durationUnit: string;
  location: string;
  description?: string;
  activeType?: number;
  dataType?: number;
  smsStatus?: number;
  speed?: string;
  supportTopUpType?: number;
  locationNetworkList?: Array<{ locationName?: string; locationCode?: string; operatorList?: Array<{ operatorName?: string; networkType?: string }> }>;
};
type Profile = {
  esimTranNo?: string;
  orderNo?: string;
  iccid?: string;
  ac?: string;
  smdpStatus?: string;
  esimStatus?: string;
  apn?: string;
  expiredTime?: string;
  totalVolume?: number;
  totalDuration?: number;
  durationUnit?: string;
  orderUsage?: number;
};

/** The documented signature: lower-case hex HMAC-SHA256 of timestamp + request ID + access code + body, keyed with the secret key. */
export function esimAccessSignature(input: { timestamp: string; requestId: string; accessCode: string; body: string; secretKey: string }) {
  return createHmac('sha256', input.secretKey).update(`${input.timestamp}${input.requestId}${input.accessCode}${input.body}`).digest('hex').toLowerCase();
}

/** "1GB", "500MB", "Unlimited" style data allowance from bytes. */
export function dataAmount(bytes: number) {
  if (!bytes || bytes <= 0) return 'Unlimited';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : Number(gb.toFixed(1))}GB`;
  return `${Math.round(bytes / 1024 ** 2)}MB`;
}

const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/**
 * eSIM Access: eSIM data packages for travellers, ordered on demand from BitoCard's prepaid eSIM Access balance. Every
 * request is signed (`RT-AccessCode`, `RT-RequestID`, `RT-Timestamp`, `RT-Signature`). There is no sandbox: BitoCard's
 * own sandbox orders are simulated and never reach eSIM Access.
 *
 * A product is one eSIM Access package (`esim:<country or WW>:<coverage>:<slug>`): a country's own packages under that
 * country, regional and global packages under `WW`. Its single face value is eSIM Access's price in US cents (rounded
 * up), so it is a markup product: BitoCard's margin and the reseller's markup are added to the cost.
 *
 * Orders are placed with our reference as the `transactionId` (eSIM Access treats a repeat as the same order) and
 * profiles are allocated asynchronously: the order waits until the query returns them (or the `ORDER_STATUS` webhook
 * says so), then each profile is delivered as an `esim` with its LPA activation code (a secret), ICCID and APN. The QR
 * image address eSIM Access hosts is never kept: the activation code is the same thing and the store draws the QR.
 */
export class EsimAccessAdapter implements SupplierAdapter {
  readonly code = 'esim_access';
  readonly syncs: ProductCategory[] = ['esim'];
  readonly esims: EsimSupplier = {
    status: id => this.esimStatus(id),
    topUpOptions: esim => this.topUpOptions(esim.iccid),
    topUp: input => this.topUp(input),
    cancel: id => this.cancel(id),
  };
  private report: string[] = [];
  /** One sync asks once per switched-on market; the package list is the same, so it is reused for a minute. */
  private fetched: { at: number; items: CatalogueItem[] } | null = null;

  constructor(private readonly config: { accessCode?: string; secretKey?: string; baseUrl: string }) {}

  configured() {
    return Boolean(this.config.accessCode && this.config.secretKey);
  }

  syncReport() {
    return this.report.length ? this.report.join(' ') : null;
  }

  /** A signed POST to `/api/v1/open/<path>`, returning `obj`; eSIM Access answers HTTP 200 with `success: false` on errors. */
  async request<T>(path: string, body: Record<string, unknown> = {}): Promise<{ obj: T | null; errorCode: string | null; message: string | null }> {
    if (!this.configured()) throw new ProviderError(this.code, 'not configured', true);
    const text = JSON.stringify(body);
    const timestamp = String(Date.now());
    const requestId = randomUUID().replaceAll('-', '');
    const accessCode = this.config.accessCode!.trim();
    const reply = await providerRequest<Reply<T>>(this.code, `${this.config.baseUrl.replace(/\/+$/, '')}/api/v1/open/${path}`, {
      method: 'POST',
      body,
      headers: {
        'RT-AccessCode': accessCode,
        'RT-RequestID': requestId,
        'RT-Timestamp': timestamp,
        'RT-Signature': esimAccessSignature({ timestamp, requestId, accessCode, body: text, secretKey: this.config.secretKey!.trim() }),
      },
    });
    const ok = reply?.success === true || reply?.success === 'true';
    const errorCode = reply?.errorCode && reply.errorCode !== '0' ? String(reply.errorCode) : null;
    return { obj: reply?.obj ?? null, errorCode: ok ? null : (errorCode ?? 'unknown'), message: reply?.errorMsg ?? reply?.errorMessage ?? null };
  }

  /** Throws for an error reply: definite for the codes that mean nothing was done, otherwise unclear. */
  private failed(errorCode: string, message: string | null): never {
    const text = `${errorCode}: ${message ?? 'request refused'}`;
    if (errorCode === '101003') throw new ProviderError(this.code, `${text}. Check the access code and secret key (Settings > Integrations > eSIM Access).`, true);
    throw new ProviderError(this.code, text, refusedCodes.has(errorCode));
  }

  /**
   * Every eSIM package, whichever market asked (eSIMs are bought for use abroad): fixed plans as one product each, and
   * day passes as one product per number of days (`dayPassDays`).
   */
  async catalogue(): Promise<CatalogueItem[]> {
    if (this.fetched && Date.now() - this.fetched.at < 60_000) return this.fetched.items;
    this.report = [];
    const items: CatalogueItem[] = [];
    const skipped: string[] = [];
    for (const dataType of ['1', '2']) {
      const reply = await this.request<{ packageList?: Package[] }>('package/list', { locationCode: '', type: 'BASE', packageCode: '', slug: '', iccid: '', dataType });
      if (reply.errorCode) this.failed(reply.errorCode, reply.message);
      for (const pkg of reply.obj?.packageList ?? []) {
        const alias = pkg.slug || pkg.packageCode;
        if (!alias || !(pkg.price > 0) || (pkg.currencyCode ?? 'USD').toUpperCase() !== 'USD') {
          skipped.push(alias || 'unnamed');
          continue;
        }
        if (dataType === '1' && (pkg.dataType ?? 1) === 1) items.push(this.item(pkg, alias));
        else if (dataType === '2' && (pkg.dataType ?? 2) !== 1) items.push(...dayPassDays.map(days => this.item(pkg, alias, days)));
      }
    }
    if (skipped.length) this.report.push(`Left out (no price, or not priced in US dollars): ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? '…' : ''}.`);
    if (!items.length) this.report.push('eSIM Access returned no data packages for this account.');
    this.fetched = { at: Date.now(), items };
    return items;
  }

  /** One product: a fixed plan, or a day pass for `passDays` days (priced per day, so its face value is days x the day price). */
  private item(pkg: Package, alias: string, passDays?: number): CatalogueItem {
    const codes = (pkg.location ?? '')
      .split(',')
      .map(code => code.trim().toUpperCase())
      .filter(code => /^[A-Z]{2}$/.test(code));
    const single = codes.length === 1;
    const country = single ? codes[0] : worldwideCountry;
    const coverage = single ? countryName(codes[0]) : codes.length >= 50 ? 'Global' : 'Regional';
    const brand = slug(coverage);
    const units = pkg.price * (passDays ?? 1);
    const face = BigInt(Math.ceil(units / unitsPerCent));
    const days = passDays
      ? `${passDays} day${passDays === 1 ? '' : 's'}`
      : pkg.durationUnit?.toUpperCase() === 'DAY'
        ? `${pkg.duration} day${pkg.duration === 1 ? '' : 's'}`
        : `${pkg.duration} ${pkg.durationUnit?.toLowerCase() ?? ''}`.trim();
    const daily = dataAmount(pkg.volume);
    // Day passes: the allowance each day, then slower (2), cut off until the next day (3), or unlimited (4).
    const data = !passDays ? daily : pkg.dataType === 4 ? 'Unlimited data' : `${daily} a day${pkg.dataType === 3 ? '' : ', then slower'}`;
    const where = single ? countryName(codes[0]) : `${codes.length} countries (${codes.map(countryName).slice(0, 12).join(', ')}${codes.length > 12 ? '…' : ''})`;
    const starts = pkg.activeType === 2 ? 'Validity starts when it first connects to a network.' : 'Validity starts when it is installed.';
    const networks = (pkg.locationNetworkList ?? []).flatMap(item => (item.operatorList ?? []).map(op => op.operatorName).filter((name): name is string => Boolean(name)));
    return {
      sku: passDays ? `${alias}#${passDays}` : alias,
      productKey: `esim:${country}:${brand}:${slug(alias)}${passDays ? `-${passDays}d` : ''}`,
      category: 'esim',
      country,
      brand,
      name: passDays ? `${coverage} day pass: ${data}, ${days}` : pkg.name || `${coverage} ${data} ${days}`,
      faceCurrency: 'USD',
      denominationType: 'fixed',
      fixedValues: [face],
      recipientType: 'none',
      description: `${passDays ? `${data} for ${days}` : `${data} of data for ${days}`} in ${where}. ${starts}${pkg.speed ? ` Speed: ${pkg.speed}.` : ''} Needs an eSIM-capable, carrier-unlocked phone.`,
      redeemInstructions:
        'Install it before you travel: scan the QR code (Settings > Mobile data > Add eSIM), or enter the SM-DP+ address and activation code by hand. An eSIM can be installed only once, so keep the code private. Turn on data roaming for this eSIM when you arrive.',
      costCurrency: 'USD',
      // The exact cost per cent of face value (eSIM Access prices can have fractions of a cent).
      // Rounded up at the stored precision (10 places), so the cost is never under-counted.
      costRatio: new Decimal(units).div(unitsPerCent).div(face.toString()).toDecimalPlaces(10, Decimal.ROUND_UP).toString(),
      costFee: 0n,
      meta: {
        slug: alias,
        package_code: pkg.packageCode,
        // A day pass's price is per day; `period_num` is the days this product buys.
        price: pkg.price,
        ...(passDays ? { period_num: passDays } : {}),
        volume: pkg.volume,
        duration: pkg.duration,
        duration_unit: pkg.durationUnit,
        countries: codes,
        active_type: pkg.activeType ?? null,
        data_type: pkg.dataType ?? null,
        sms: pkg.smsStatus ?? 0,
        top_up: pkg.supportTopUpType ?? null,
        speed: pkg.speed ?? null,
        networks: networks.slice(0, 50),
      },
    };
  }

  /** Orders the profiles; they are allocated asynchronously, so the order usually waits for the query or the webhook. */
  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const orderNo = await this.order(request);
    return this.query(request, orderNo).catch((error: Error) => ({ status: 'pending' as const, supplierTransactionId: orderNo, detail: `Ordered; profiles not read yet: ${error.message}` }));
  }

  async orderStatus(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult> {
    // Without the order number (its reply was lost), the same transaction ID returns the same order, never a second one.
    const orderNo = supplierTransactionId ?? (await this.order(request));
    return this.query(request, orderNo);
  }

  /** Places (or, with the same transaction ID, finds) the order and returns eSIM Access's order number. */
  private async order(request: FulfilmentRequest) {
    const alias = String(request.meta.slug ?? request.sku);
    const price = Number(request.meta.price);
    const period = Number(request.meta.period_num ?? 0);
    const reply = await this.request<{ orderNo?: string }>('esim/order', {
      transactionId: request.reference,
      // With the price and total, eSIM Access refuses the order if its price changed, rather than charging more.
      ...(price > 0 ? { amount: price * request.quantity * (period || 1) } : {}),
      packageInfoList: [{ packageCode: alias, count: request.quantity, ...(price > 0 ? { price } : {}), ...(period ? { periodNum: period } : {}) }],
    });
    if (reply.errorCode) this.failed(reply.errorCode, reply.message);
    if (!reply.obj?.orderNo) throw new ProviderError(this.code, 'order accepted without an order number', false);
    return reply.obj.orderNo;
  }

  /** The order's profiles: complete once every one has its activation code. */
  private async query(request: FulfilmentRequest, orderNo: string): Promise<FulfilmentResult> {
    const reply = await this.request<{ esimList?: Profile[] }>('esim/query', { orderNo, iccid: '', pager: { pageNum: 1, pageSize: 50 } });
    if (reply.errorCode === stillAllocating) return { status: 'pending', supplierTransactionId: orderNo, detail: 'eSIM Access is still allocating the profiles' };
    if (reply.errorCode) {
      // A query that fails never fails the order: it was placed, so it is checked again (and then an admin looks).
      return { status: 'pending', supplierTransactionId: orderNo, detail: `${reply.errorCode}: ${reply.message ?? 'query failed'}` };
    }
    const profiles = reply.obj?.esimList ?? [];
    const ready = profiles.filter(profile => profile.ac && profile.iccid);
    // Every profile cancelled or revoked before it was delivered (in eSIM Access's console): nothing can be delivered.
    if (profiles.length && profiles.every(profile => profile.esimStatus === 'CANCEL' || profile.esimStatus === 'REVOKED')) {
      return { status: 'failed', supplierTransactionId: orderNo, detail: `Profiles ${profiles[0].esimStatus?.toLowerCase()} at eSIM Access` };
    }
    if (ready.length < request.quantity) return { status: 'pending', supplierTransactionId: orderNo, detail: `${ready.length} of ${request.quantity} profiles ready` };
    const deliveries: Delivery[] = ready.slice(0, request.quantity).map(profile => ({
      kind: 'esim',
      code: profile.ac!,
      serial: profile.iccid!,
      details: {
        iccid: profile.iccid!,
        ...(profile.apn ? { apn: profile.apn } : {}),
        ...(profile.totalVolume ? { data: dataAmount(profile.totalVolume) } : {}),
        ...(profile.totalDuration ? { validity: `${profile.totalDuration} ${(profile.durationUnit ?? 'DAY').toLowerCase()}${profile.totalDuration === 1 ? '' : 's'}` } : {}),
        ...(profile.expiredTime ? { install_by: profile.expiredTime } : {}),
      },
    }));
    const price = Number(request.meta.price) * (Number(request.meta.period_num ?? 0) || 1);
    return {
      status: 'completed',
      supplierTransactionId: orderNo,
      deliveries,
      esims: ready.slice(0, request.quantity).map(profile => ({
        supplierEsimId: profile.esimTranNo || profile.iccid!,
        iccid: profile.iccid!,
        expiresAt: time(profile.expiredTime),
        totalBytes: bytes(profile.totalVolume),
        topUps: topUpKind(request.meta.top_up),
      })),
      detail: `${ready.length} profile${ready.length === 1 ? '' : 's'} ready`,
      ...(price > 0 ? { reportedCost: { amountMinor: BigInt(Math.ceil((price * request.quantity) / unitsPerCent)), currency: 'USD' } } : {}),
    };
  }

  /** One eSIM by eSIM Access's transaction number: its states, data use and expiry. */
  private async esimStatus(esimTranNo: string): Promise<EsimState> {
    const reply = await this.request<{ esimList?: Profile[] }>('esim/query', { esimTranNo, orderNo: '', iccid: '', pager: { pageNum: 1, pageSize: 5 } });
    if (reply.errorCode) this.failed(reply.errorCode, reply.message);
    const profile = (reply.obj?.esimList ?? []).find(item => item.esimTranNo === esimTranNo) ?? reply.obj?.esimList?.[0];
    if (!profile) throw new ProviderError(this.code, 'eSIM not found', false);
    return {
      status: esimStateName(profile.esimStatus, profile.smdpStatus),
      supplierStatus: profile.esimStatus ?? null,
      profileStatus: profile.smdpStatus ?? null,
      totalBytes: bytes(profile.totalVolume),
      usedBytes: bytes(profile.orderUsage),
      expiresAt: time(profile.expiredTime),
    };
  }

  /**
   * The top-ups an eSIM takes now (`package/list` with `type: TOPUP` and its ICCID). A top-up that extends a day pass is
   * offered for several numbers of days. The package (internal) carries its exact price, so the top-up is price-checked.
   */
  private async topUpOptions(iccid: string): Promise<EsimTopUpOption[]> {
    const reply = await this.request<{ packageList?: Package[] }>('package/list', { locationCode: '', type: 'TOPUP', packageCode: '', slug: '', iccid });
    if (reply.errorCode) this.failed(reply.errorCode, reply.message);
    const options: EsimTopUpOption[] = [];
    for (const pkg of reply.obj?.packageList ?? []) {
      const alias = pkg.slug || pkg.packageCode;
      if (!alias || !(pkg.price > 0) || (pkg.currencyCode ?? 'USD').toUpperCase() !== 'USD') continue;
      const perDay = pkg.supportTopUpType === 3 || (pkg.dataType ?? 1) !== 1;
      for (const days of perDay ? topUpDays : [pkg.duration]) {
        options.push({
          supplierPackage: `${alias}|${pkg.price}|${perDay ? days : 0}`,
          name: perDay ? `${dataAmount(pkg.volume)} a day for ${days} more day${days === 1 ? '' : 's'}` : pkg.name || `${dataAmount(pkg.volume)}, ${pkg.duration} days`,
          data: perDay ? `${dataAmount(pkg.volume)} a day` : dataAmount(pkg.volume),
          days,
          perDay,
          costMinor: BigInt(Math.ceil((pkg.price * (perDay ? days : 1)) / unitsPerCent)),
          costCurrency: 'USD',
        });
      }
    }
    return options;
  }

  /** Adds a top-up (`esim/topup`) with our reference as its transaction ID and the exact price to check against. */
  private async topUp(input: { supplierEsimId: string; supplierPackage: string; reference: string }): Promise<EsimState> {
    const [alias, price, period] = input.supplierPackage.split('|');
    const days = Number(period) || 0;
    const reply = await this.request<{ expiredTime?: string; totalVolume?: number; orderUsage?: number }>('esim/topup', {
      esimTranNo: input.supplierEsimId,
      iccid: '',
      packageCode: alias,
      transactionId: input.reference,
      ...(Number(price) > 0 ? { amount: String(Number(price) * (days || 1)) } : {}),
      ...(days ? { periodNum: String(days) } : {}),
    });
    if (reply.errorCode) this.failed(reply.errorCode, reply.message);
    const state = await this.esimStatus(input.supplierEsimId).catch(() => null);
    return {
      status: state?.status ?? 'active',
      supplierStatus: state?.supplierStatus ?? null,
      profileStatus: state?.profileStatus ?? null,
      totalBytes: bytes(reply.obj?.totalVolume) ?? state?.totalBytes ?? null,
      usedBytes: bytes(reply.obj?.orderUsage) ?? state?.usedBytes ?? null,
      expiresAt: time(reply.obj?.expiredTime) ?? state?.expiresAt ?? null,
    };
  }

  /** Cancels an eSIM never installed (`esim/cancel`); eSIM Access refunds its price to BitoCard's balance. */
  private async cancel(esimTranNo: string) {
    const reply = await this.request<Record<string, never>>('esim/cancel', { esimTranNo });
    // Any refusal here (installed, used, unknown) is definite: nothing was cancelled.
    if (reply.errorCode) throw new ProviderError(this.code, `${reply.errorCode}: ${reply.message ?? 'cancel refused'}`, true);
  }

  /** The account balance in US cents (Test connection). */
  async balance() {
    const reply = await this.request<{ balance?: number }>('balance/query');
    if (reply.errorCode) this.failed(reply.errorCode, reply.message);
    return Math.floor(Number(reply.obj?.balance ?? 0) / unitsPerCent);
  }
}

/**
 * eSIM Access signs nothing it sends, so its webhook address carries a secret token
 * (`/v1/webhooks/esim-access?token=<ESIM_ACCESS_WEBHOOK_TOKEN>`), compared in constant time.
 */
export function esimAccessWebhookValid(secret: string | undefined, token: string | undefined) {
  if (!secret || !token) return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What an eSIM notification says about one eSIM (status, usage, expiry), by eSIM Access's transaction number. */
export type EsimNotice = {
  kind: 'status' | 'usage' | 'validity';
  supplierEsimId: string;
  state: Partial<EsimState>;
  /** DATA_USAGE: the share of data left that triggered it (0.1 = 10%). VALIDITY_USAGE: days left. */
  remaining: number | null;
};

/**
 * What a notification is about. `ORDER_STATUS` (profiles allocated) names an order to re-check: our reference is its
 * `transactionId`. `ESIM_STATUS` and `SMDP_EVENT` (installed, in use, used up, expired, cancelled), `DATA_USAGE` (a
 * share of the data used) and `VALIDITY_USAGE` (about to expire) are about one eSIM (`esim`). `CHECK_HEALTH` is the
 * setup check: nothing to do.
 */
export function esimAccessNotice(payload: unknown) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const content = body.content && typeof body.content === 'object' ? (body.content as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const type = text(body.notifyType);
  const supplierEsimId = text(content.esimTranNo);
  let esim: EsimNotice | null = null;
  if (supplierEsimId && (type === 'ESIM_STATUS' || type === 'SMDP_EVENT')) {
    const esimStatus = text(content.esimStatus);
    const smdpStatus = text(content.smdpStatus);
    esim = {
      kind: 'status',
      supplierEsimId,
      state: {
        status: esimStateName(esimStatus, smdpStatus),
        supplierStatus: esimStatus,
        profileStatus: smdpStatus,
        ...(bytes(content.totalVolume) !== null ? { totalBytes: bytes(content.totalVolume) } : {}),
        ...(bytes(content.orderUsage) !== null ? { usedBytes: bytes(content.orderUsage) } : {}),
      },
      remaining: null,
    };
  } else if (supplierEsimId && type === 'DATA_USAGE') {
    esim = { kind: 'usage', supplierEsimId, state: { totalBytes: bytes(content.totalVolume), usedBytes: bytes(content.orderUsage) }, remaining: number(content.remainThreshold) };
  } else if (supplierEsimId && type === 'VALIDITY_USAGE') {
    esim = { kind: 'validity', supplierEsimId, state: { expiresAt: time(content.expiredTime) }, remaining: number(content.remain) };
  }
  return {
    orderUpdate: type === 'ORDER_STATUS',
    eventType: type ? `${type}${text(content.orderStatus) ? `:${text(content.orderStatus)}` : ''}` : null,
    reference: text(content.transactionId),
    supplierTransactionId: text(content.orderNo),
    esim,
  };
}
