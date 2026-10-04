import { Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import { toMajor } from '../payments/providers.js';
import { type CatalogueItem, type CatalogueScope, type Delivery, type FulfilmentRequest, type FulfilmentResult, minorOf, slug, type SupplierAdapter } from './adapter.js';

const Decimal = Prisma.Decimal;

type GiftCardProduct = {
  productId: number;
  productName: string;
  denominationType: 'FIXED' | 'RANGE';
  discountPercentage?: number;
  senderFee?: number;
  senderCurrencyCode: string;
  recipientCurrencyCode: string;
  fixedRecipientDenominations?: number[];
  fixedSenderDenominations?: number[];
  minRecipientDenomination?: number | null;
  maxRecipientDenomination?: number | null;
  minSenderDenomination?: number | null;
  maxSenderDenomination?: number | null;
  brand?: { brandName: string };
  country?: { isoName: string };
  logoUrls?: string[];
  redeemInstruction?: { concise?: string };
};

type Operator = {
  operatorId: number;
  name: string;
  bundle: boolean;
  data: boolean;
  denominationType: 'FIXED' | 'RANGE';
  senderCurrencyCode: string;
  destinationCurrencyCode: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  localMinAmount?: number | null;
  localMaxAmount?: number | null;
  fixedAmounts?: number[];
  localFixedAmounts?: number[];
  fixedAmountsDescriptions?: Record<string, string>;
  fx?: { rate: number };
  internationalDiscount?: number;
  localDiscount?: number;
  country?: { isoName: string; name: string };
  logoUrls?: string[];
};

const maxPages = 25;
const giftCardsAccept = 'application/com.reloadly.giftcards-v1+json';
const topupsAccept = 'application/com.reloadly.topups-v1+json';

type ReloadlyTransaction = { transactionId: number; status: string; customIdentifier?: string };

/** Reloadly transaction statuses to BitoCard outcomes. Anything unknown is treated as not yet confirmed. */
function outcome(status: string | undefined): FulfilmentResult['status'] {
  const value = (status ?? '').toUpperCase();
  if (value === 'SUCCESSFUL' || value === 'COMPLETED') return 'completed';
  if (value === 'FAILED' || value === 'REFUNDED' || value === 'REJECTED') return 'failed';
  return 'pending';
}

/** Reloadly: gift cards (worldwide) and airtime and data top-ups by country. */
export class ReloadlyAdapter implements SupplierAdapter {
  readonly code = 'reloadly';
  readonly syncs: ProductCategory[] = ['gift_cards', 'airtime', 'data'];
  private readonly tokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly credentials: { clientId?: string; clientSecret?: string },
    private readonly urls: { auth: string; giftcards: string; topups: string },
  ) {}

  configured() {
    return Boolean(this.credentials.clientId && this.credentials.clientSecret);
  }

  /** OAuth client-credentials token per API (the audience is the API address). */
  private async token(audience: string) {
    const cached = this.tokens.get(audience);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    if (!this.configured()) throw new ProviderError(this.code, 'not configured', true);
    const res = await providerRequest<{ access_token: string; expires_in: number }>(this.code, `${this.urls.auth}/oauth/token`, {
      method: 'POST',
      body: { client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, grant_type: 'client_credentials', audience },
    }).catch((error: unknown) => {
      // Say which API refused the sign-in and why, for the supplier record (Reloadly only answers "Access Denied").
      if (!(error instanceof ProviderError)) throw error;
      const api = audience === this.urls.giftcards ? 'gift cards' : 'top-ups';
      const reason = error.message.replace(/^reloadly: /, '');
      const hint = error.status === 401 || error.status === 403 ? ' Check the client ID and secret, that the sandbox setting matches them (test or live keys), and that this API is enabled on the Reloadly account.' : '';
      throw new ProviderError(this.code, `sign-in to the ${api} API refused (HTTP ${error.status ?? 'no answer'}): ${reason}.${hint}`, error.definite, error.status);
    });
    this.tokens.set(audience, { value: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 });
    return res.access_token;
  }

  private async get<T>(base: string, path: string, accept: string) {
    const token = await this.token(base);
    return providerRequest<T>(this.code, `${base}${path}`, { headers: { authorization: `Bearer ${token}`, accept } });
  }

  private async post<T>(base: string, path: string, accept: string, body: unknown) {
    const token = await this.token(base);
    return providerRequest<T>(this.code, `${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, accept }, body });
  }

  async placeOrder(request: FulfilmentRequest): Promise<FulfilmentResult> {
    if (request.category === 'gift_cards') {
      const res = await this.post<ReloadlyTransaction>(this.urls.giftcards, '/orders', giftCardsAccept, {
        productId: request.meta.productId,
        quantity: request.quantity,
        unitPrice: Number(toMajor(request.faceValue)),
        customIdentifier: request.reference,
        senderName: 'BitoCard',
      });
      return this.giftCardResult(res);
    }
    const res = await this.post<ReloadlyTransaction>(this.urls.topups, '/topups', topupsAccept, {
      operatorId: request.meta.operatorId,
      amount: Number(toMajor(request.faceValue)),
      useLocalAmount: true,
      customIdentifier: request.reference,
      recipientPhone: { countryCode: request.country, number: request.recipient.phone },
    });
    return { status: outcome(res.status), supplierTransactionId: String(res.transactionId), deliveries: outcome(res.status) === 'completed' ? [topupConfirmation()] : [], detail: res.status };
  }

  async orderStatus(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult> {
    const gift = request.category === 'gift_cards';
    const base = gift ? this.urls.giftcards : this.urls.topups;
    const accept = gift ? giftCardsAccept : topupsAccept;
    let transaction: ReloadlyTransaction | undefined;
    if (supplierTransactionId) {
      transaction = gift
        ? await this.get<ReloadlyTransaction>(base, `/reports/transactions/${encodeURIComponent(supplierTransactionId)}`, accept)
        : await this.get<{ status: string; transaction?: ReloadlyTransaction }>(base, `/topups/${encodeURIComponent(supplierTransactionId)}/status`, accept).then(res => ({
            ...(res.transaction ?? { transactionId: Number(supplierTransactionId) }),
            status: res.status,
          }));
    } else {
      const path = gift ? '/reports/transactions' : '/topups/reports/transactions';
      const res = await this.get<{ content: ReloadlyTransaction[] }>(base, `${path}?customIdentifier=${encodeURIComponent(request.reference)}`, accept);
      transaction = res.content.find(t => t.customIdentifier === request.reference) ?? res.content[0];
    }
    // No record of our reference: not confirmed either way, so it keeps waiting for a later check or an admin.
    if (!transaction) return { status: 'pending', detail: 'No transaction found for the reference yet' };
    if (gift) return this.giftCardResult(transaction);
    return { status: outcome(transaction.status), supplierTransactionId: String(transaction.transactionId), deliveries: outcome(transaction.status) === 'completed' ? [topupConfirmation()] : [], detail: transaction.status };
  }

  /** A successful gift card order still needs its codes; failing to fetch them leaves the order pending. */
  private async giftCardResult(transaction: ReloadlyTransaction): Promise<FulfilmentResult> {
    const status = outcome(transaction.status);
    const supplierTransactionId = String(transaction.transactionId);
    if (status !== 'completed') return { status, supplierTransactionId, detail: transaction.status };
    try {
      const cards = await this.get<Array<{ cardNumber?: string; pinCode?: string; serialNumber?: string }>>(
        this.urls.giftcards,
        `/orders/transactions/${encodeURIComponent(supplierTransactionId)}/cards`,
        giftCardsAccept,
      );
      const deliveries: Delivery[] = cards.map(card => ({ kind: 'gift_card', code: card.cardNumber, pin: card.pinCode, serial: card.serialNumber }));
      return { status: 'completed', supplierTransactionId, deliveries };
    } catch {
      return { status: 'pending', supplierTransactionId, detail: 'Paid; card codes not retrieved yet' };
    }
  }

  async catalogue(scope: CatalogueScope): Promise<CatalogueItem[]> {
    if (scope.category === 'gift_cards') return this.giftCards();
    if ((scope.category === 'airtime' || scope.category === 'data') && scope.country) {
      return (await this.operators(scope.country)).filter(item => item.category === scope.category);
    }
    return [];
  }

  private async giftCards() {
    const items: CatalogueItem[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await this.get<{ content: GiftCardProduct[]; totalPages: number }>(
        this.urls.giftcards,
        `/products?size=200&page=${page}`,
        'application/com.reloadly.giftcards-v1+json',
      );
      for (const product of res.content) {
        const item = giftCardItem(product);
        if (item) items.push(item);
      }
      if (page >= res.totalPages) break;
    }
    return items;
  }

  private async operators(country: string) {
    const operators = await this.get<Operator[]>(
      this.urls.topups,
      `/operators/countries/${encodeURIComponent(country)}?includeBundles=true&includeData=true&suggestedAmounts=false`,
      'application/com.reloadly.topups-v1+json',
    );
    return operators.flatMap(operator => operatorItems(operator, country));
  }
}

/** Top-ups deliver nothing to hand over; the confirmation carries no supplier details. */
function topupConfirmation(): Delivery {
  return { kind: 'confirmation' };
}

/** Sender (cost) currency per unit of recipient (face) value, less Reloadly's discount. */
function ratio(sender: number, recipient: number, discountPercent = 0) {
  return new Decimal(sender).div(recipient).mul(new Decimal(1).minus(new Decimal(discountPercent).div(100))).toDecimalPlaces(10).toString();
}

export function giftCardItem(product: GiftCardProduct): CatalogueItem | null {
  const country = product.country?.isoName;
  if (!country) return null;
  const fixed = product.denominationType === 'FIXED';
  const recipientValues = product.fixedRecipientDenominations ?? [];
  const senderValues = product.fixedSenderDenominations ?? [];
  const costRatio = fixed
    ? recipientValues.length && senderValues.length
      ? ratio(senderValues[0], recipientValues[0], product.discountPercentage)
      : null
    : product.maxSenderDenomination && product.maxRecipientDenomination
      ? ratio(product.maxSenderDenomination, product.maxRecipientDenomination, product.discountPercentage)
      : null;
  if (!costRatio) return null;
  return {
    sku: `gc:${product.productId}`,
    productKey: `gift_cards:${country}:${slug(product.productName)}`,
    category: 'gift_cards',
    country,
    brand: slug(product.brand?.brandName ?? product.productName),
    name: product.productName,
    faceCurrency: product.recipientCurrencyCode,
    denominationType: fixed ? 'fixed' : 'range',
    fixedValues: fixed ? recipientValues.map(minorOf) : [],
    minValue: fixed ? undefined : minorOf(product.minRecipientDenomination),
    maxValue: fixed ? undefined : minorOf(product.maxRecipientDenomination),
    recipientType: 'none',
    redeemInstructions: product.redeemInstruction?.concise,
    logoUrl: product.logoUrls?.[0],
    costCurrency: product.senderCurrencyCode,
    costRatio,
    costFee: minorOf(product.senderFee),
    meta: { productId: product.productId },
  };
}

export function operatorItems(operator: Operator, country: string): CatalogueItem[] {
  const fx = operator.fx?.rate || 1;
  const domestic = operator.senderCurrencyCode === operator.destinationCurrencyCode;
  const costRatio = ratio(1, domestic ? 1 : fx, domestic ? operator.localDiscount : operator.internationalDiscount);
  const brand = slug(operator.name, [operator.country?.name ?? '', 'data', 'bundles', 'bundle']);
  const base = {
    country,
    brand,
    faceCurrency: operator.destinationCurrencyCode,
    recipientType: 'phone' as const,
    logoUrl: operator.logoUrls?.[0],
    costCurrency: operator.senderCurrencyCode,
    costRatio,
    costFee: 0n,
  };
  const local = (sender: number, index: number) => operator.localFixedAmounts?.[index] ?? (domestic ? sender : sender * fx);

  if (operator.bundle && operator.fixedAmounts?.length) {
    return operator.fixedAmounts.map((amount, index) => {
      const description = operator.fixedAmountsDescriptions?.[amount.toFixed(2)] ?? operator.fixedAmountsDescriptions?.[String(amount)] ?? `${amount}`;
      return {
        ...base,
        sku: `op:${operator.operatorId}:${amount}`,
        productKey: `${operator.data ? 'data' : 'airtime'}:${country}:${brand}:${slug(description)}`,
        category: operator.data ? ('data' as const) : ('airtime' as const),
        name: `${operator.name} ${description}`,
        denominationType: 'fixed' as const,
        fixedValues: [minorOf(local(amount, index))],
        meta: { operatorId: operator.operatorId, senderAmount: amount },
      };
    });
  }
  const category = operator.data ? ('data' as const) : ('airtime' as const);
  const fixed = operator.denominationType === 'FIXED';
  return [
    {
      ...base,
      sku: `op:${operator.operatorId}`,
      productKey: `${category}:${country}:${brand}:topup`,
      category,
      name: operator.name,
      denominationType: fixed ? 'fixed' : 'range',
      fixedValues: fixed ? (operator.fixedAmounts ?? []).map((amount, index) => minorOf(local(amount, index))) : [],
      minValue: fixed ? undefined : minorOf(operator.localMinAmount ?? (operator.minAmount ?? 0) * (domestic ? 1 : fx)),
      maxValue: fixed ? undefined : minorOf(operator.localMaxAmount ?? (operator.maxAmount ?? 0) * (domestic ? 1 : fx)),
      meta: { operatorId: operator.operatorId },
    },
  ];
}
