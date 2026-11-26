import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '../payments/provider-error.js';
import { brandRegistry } from '../storefront/brand-registry.js';

/**
 * Prestmit's partner API: the sell side (the gift cards it buys with their rates, creating a sell trade and reading it
 * back) and the buy side (the gift cards it sells, what one costs from BitoCard's Naira wallet, buying it and fetching
 * its codes; the `prestmit` supplier adapter). Documented at https://documentation.prestmit.io/ (read 15 November 2026). Every request carries the API
 * key and `API-Hash`, the hex HMAC-SHA256 of `<key>:<JSON of the body>` (for GET, of the query) with the API secret.
 * The documentation disagrees with itself in places (the multipart hash, the webhook signature's encoding): confirm
 * against Prestmit's sandbox before switching selling on live.
 */
export type PrestmitOptions = { apiKey?: string; apiSecret?: string; baseUrl: string; timeoutMs?: number; accountPin?: string };

export type PrestmitCard = {
  id: string;
  name: string;
  /** Naira per unit of the card's face value. */
  rate: string;
  minimum: number;
  form: 'physical' | 'ecode' | 'both';
  /** ISO 3166 alpha-2, or null when Prestmit's country is not one we know. */
  country: string | null;
  countryLabel: string;
  category: string;
  terms: string | null;
};

export type PrestmitTrade = {
  reference: string;
  /** PENDING, COMPLETED or REJECTED (any other is treated as pending). */
  status: string;
  /** What Prestmit paid, in naira (null until it says). */
  totalAmount: number | null;
  rejectionReason: string | null;
};

/** A gift card Prestmit sells (`fetch-buyable-giftcards`). Prices are in the card's own currency, major units. */
export type PrestmitBuyableCard = {
  sku: string;
  title: string;
  description: string | null;
  minPrice: number;
  maxPrice: number;
  /** ISO 4217 of the card's face value. */
  currency: string;
  /** ISO 3166 alpha-2 of its region, or null when Prestmit gives none we know. */
  country: string | null;
  category: string;
  imageUrl: string | null;
  preOrder: boolean;
};

/** A buy trade: Prestmit's reference, its status (COMPLETED, PENDING or FAILED), the naira paid and its cards once fulfilled. */
export type PrestmitBuyTrade = {
  reference: string;
  status: string;
  /** What BitoCard's Naira wallet was charged, in naira (major units), when Prestmit says. */
  paidNaira: number | null;
  uniqueIdentifier: string | null;
  cards: PrestmitCode[];
};

export type PrestmitCode = { cardNumber: string; pinCode: string | null; claimUrl: string | null; expireDate: string | null };

/** Prestmit's country names, as it writes them, to ISO codes. */
const countries: Record<string, string> = {
  USA: 'US', 'UNITED STATES': 'US', US: 'US', UK: 'GB', 'UNITED KINGDOM': 'GB', CANADA: 'CA', AUSTRALIA: 'AU', GERMANY: 'DE', FRANCE: 'FR',
  SPAIN: 'ES', ITALY: 'IT', NETHERLANDS: 'NL', 'NEW ZEALAND': 'NZ', SWITZERLAND: 'CH', IRELAND: 'IE', SINGAPORE: 'SG', MEXICO: 'MX', BELGIUM: 'BE',
  AUSTRIA: 'AT', SWEDEN: 'SE', POLAND: 'PL', JAPAN: 'JP', UAE: 'AE', 'UNITED ARAB EMIRATES': 'AE', 'SOUTH AFRICA': 'ZA', NIGERIA: 'NG', GHANA: 'GH',
  NORWAY: 'NO', DENMARK: 'DK', FINLAND: 'FI', PORTUGAL: 'PT', BRAZIL: 'BR', 'HONG KONG': 'HK', 'SOUTH KOREA': 'KR', TURKEY: 'TR', 'SAUDI ARABIA': 'SA',
};

export const prestmitCountry = (value: unknown) => {
  const text = String(value ?? '').trim().toUpperCase();
  // A region may come as its 2-letter code already.
  return countries[text] ?? (/^[A-Z]{2}$/.test(text) && text !== 'UK' ? text : null);
};

export function prestmitForm(value: unknown): PrestmitCard['form'] {
  const text = String(value ?? '').toLowerCase();
  const physical = text.includes('physical');
  const ecode = text.includes('code');
  return physical && ecode ? 'both' : ecode ? 'ecode' : 'physical';
}

/** Letters and digits only, lower case: how names are compared. */
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The registry entry a provider's card is sold under, from its category's or its own name. */
export function matchBrand(category: string, name: string): string | null {
  for (const text of [category, name]) {
    const wanted = key(text);
    if (!wanted) continue;
    const exact = brandRegistry.find(entry => [entry.name, entry.slug, ...entry.slugs, ...entry.aliases].some(word => key(word) === wanted));
    if (exact) return exact.slug;
  }
  // "Amazon (USA) E-code": the longest registry name the card's name starts with.
  const named = key(name);
  const starts = brandRegistry.filter(entry => key(entry.name).length >= 3 && named.startsWith(key(entry.name))).sort((a, b) => key(b.name).length - key(a.name).length);
  return starts[0]?.slug ?? null;
}

/** `API-Hash`: hex HMAC-SHA256 of `<key>:<JSON of the body>`. */
export function prestmitHash(apiKey: string, apiSecret: string, body: Record<string, unknown>) {
  return createHmac('sha256', apiSecret).update(`${apiKey}:${JSON.stringify(body)}`).digest('hex');
}

/**
 * Webhooks (`x-prestmit-signature`): an HMAC-SHA256 with the webhook secret. The documentation's prose says of the
 * raw body and its sample of the re-serialised body, in base64; any of them is accepted, compared in constant time.
 * The body is never trusted anyway: it only names a trade, which is read back from Prestmit.
 */
export function prestmitSignatureValid(secret: string | undefined, rawBody: Buffer | undefined, signature: string | undefined) {
  if (!secret || !rawBody || !signature) return false;
  const bodies = [rawBody];
  try {
    bodies.push(Buffer.from(JSON.stringify(JSON.parse(rawBody.toString('utf8')))));
  } catch {
    // Not JSON: only the raw body can match.
  }
  const given = Buffer.from(signature.trim());
  return bodies.some(body => {
    const mac = createHmac('sha256', secret).update(body).digest();
    return [mac.toString('hex'), mac.toString('base64')].some(expected => {
      const wanted = Buffer.from(expected);
      return wanted.length === given.length && timingSafeEqual(wanted, given);
    });
  });
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Fields as `multipart/form-data`, as the buy endpoints take them (hashed as their JSON, like the sell side's). */
function formOf(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

/** Delivered cards: a code each (`cardNumber`), with its PIN, claim link and expiry where Prestmit gives them. */
function codesOf(value: unknown): PrestmitCode[] {
  return list(value).flatMap(item => {
    const card = record(item);
    const code = String(card.cardNumber ?? '').trim();
    const claim = typeof card.claimUrl === 'string' && card.claimUrl.startsWith('https://') ? card.claimUrl : null;
    if (!code && !claim) return [];
    const text = (field: unknown) => (typeof field === 'string' && field.trim() ? field.trim() : null);
    return [{ cardNumber: code, pinCode: text(card.pinCode), claimUrl: claim, expireDate: text(card.expireDate) }];
  });
}

export class Prestmit {
  constructor(private readonly options: PrestmitOptions) {}

  configured() {
    return Boolean(this.options.apiKey?.trim() && this.options.apiSecret?.trim());
  }

  /** The buy and sell capabilities reported by Prestmit's service availability endpoint. */
  async availability() {
    const body = record(await this.call('GET', '/general/service-availability'));
    const data = record(body.data ?? body);
    const buy = typeof data.buyGiftCard === 'boolean' ? data.buyGiftCard : null;
    const sell = typeof data.sellGiftCard === 'boolean' ? data.sellGiftCard : null;
    if (buy === null && sell === null) throw new ProviderError('prestmit', 'unexpected service availability response', false);
    return { buy, sell };
  }

  /** The gift cards Prestmit buys, with their rates (`sellableGiftcards` of the rate calculator's data). */
  async sellableCards(): Promise<PrestmitCard[]> {
    const body = record(await this.call('GET', '/giftcard-trade/sell/rate-calculator-data'));
    const data = record(body.data ?? body);
    return list(data.sellableGiftcards).flatMap(item => {
      const card = record(item);
      const id = card.id === undefined || card.id === null ? '' : String(card.id);
      const rate = Number(card.rate);
      if (!id || !Number.isFinite(rate) || rate <= 0) return [];
      const category = record(card.category);
      return [
        {
          id,
          name: String(card.name ?? '').trim() || `Card ${id}`,
          rate: rate.toFixed(4),
          minimum: Math.max(1, Math.ceil(Number(card.minimum) || 1)),
          form: prestmitForm(card.form),
          country: prestmitCountry(card.country),
          countryLabel: String(card.country ?? ''),
          category: String(category.name ?? card.name ?? '').trim(),
          terms: typeof card.terms === 'string' && card.terms.trim() ? card.terms.trim() : null,
        },
      ];
    });
  }

  /**
   * Creates a sell trade (`multipart/form-data`): photos of a physical card as `attachments[]` (JPEG or PNG), an e-code
   * in `comments`. `uniqueIdentifier` is BitoCard's own sale reference, so the trade can be found again by it.
   */
  async createTrade(input: { cardId: string; amount: number; uniqueIdentifier: string; code?: string; photos: Array<{ name: string; type: string; data: Buffer }> }): Promise<PrestmitTrade> {
    const fields: Record<string, string> = {
      giftcard_id: input.cardId,
      amount: String(input.amount),
      payoutMethod: 'NAIRA',
      uniqueIdentifier: input.uniqueIdentifier,
      ...(input.code ? { comments: input.code } : {}),
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const photo of input.photos) form.append('attachments[]', new Blob([new Uint8Array(photo.data)], { type: photo.type }), photo.name);
    // The hash leaves the attachments out, as the documentation says.
    const body = record(await this.call('POST', '/giftcard-trade/sell/create', fields, form));
    return this.trade(body.trade ?? record(body.data).trade ?? body.data ?? body);
  }

  /** The trade made with BitoCard's reference, or null when Prestmit has none. */
  async findTrade(uniqueIdentifier: string): Promise<PrestmitTrade | null> {
    const body = record(await this.call('GET', '/giftcard-trade/sell/history', { uniqueIdentifier }));
    const rows = Array.isArray(body.data) ? body.data : record(body.data).data;
    if (!Array.isArray(rows)) throw new ProviderError('prestmit', 'unexpected sell history response', false);
    const row = rows.map(record).find(item => !item.uniqueIdentifier || item.uniqueIdentifier === uniqueIdentifier);
    return row ? this.trade(row) : null;
  }

  // Buying.

  /** Every gift card Prestmit sells now (`fetch-buyable-giftcards`, 25 a page). */
  async buyableCards(maxPages = 40): Promise<PrestmitBuyableCard[]> {
    const cards: PrestmitBuyableCard[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const body = record(await this.call('GET', '/giftcard-trade/buy/fetch-buyable-giftcards', { page: String(page), perPage: '25' }));
      const rows = list(body.data);
      for (const row of rows) {
        const card = this.buyable(row);
        if (card) cards.push(card);
      }
      const meta = record(body.meta);
      const last = Number(meta.last_page);
      if (!rows.length || (Number.isFinite(last) && page >= last) || (!Number.isFinite(last) && rows.length < 25)) break;
    }
    return cards;
  }

  private buyable(value: unknown): PrestmitBuyableCard | null {
    const card = record(value);
    const sku = card.sku === undefined || card.sku === null ? '' : String(card.sku);
    const min = Number(card.minPrice);
    const max = Number(card.maxPrice);
    const currency = String(record(card.currency).code ?? '').toUpperCase();
    if (!sku || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min || !/^[A-Z]{3}$/.test(currency)) return null;
    const region = list(card.regions).map(record)[0];
    const description = record(card.description);
    return {
      sku,
      title: String(card.title ?? '').trim() || `Gift card ${sku}`,
      description: typeof description.content === 'string' && description.content.trim() ? description.content.trim() : null,
      minPrice: min,
      maxPrice: max,
      currency,
      country: prestmitCountry(region?.code) ?? prestmitCountry(region?.name),
      category: String(list(card.categories).map(record)[0]?.name ?? '').trim(),
      imageUrl: typeof card.imageUrl === 'string' && card.imageUrl.startsWith('https://') ? card.imageUrl : null,
      preOrder: card.preOrder === true,
    };
  }

  /** What `quantity` cards of `price` cost in naira from BitoCard's Naira wallet (`calculate-payment`), and whether they are in stock. */
  async buyCost(sku: string, price: number, quantity = 1) {
    const fields = { giftCardSKU: sku, price: String(price), quantity: String(quantity) };
    const body = record(await this.call('POST', '/giftcard-trade/buy/calculate-payment', fields, formOf(fields)));
    const naira = Number(body.NAIRA ?? record(body.data).NAIRA);
    const available = (body.isAvailable ?? record(body.data).isAvailable) !== false;
    return { naira: Number.isFinite(naira) && naira > 0 ? naira : null, available };
  }

  /**
   * Buys cards from BitoCard's Naira wallet (`buy/create`), with BitoCard's reference as `uniqueIdentifier` so the
   * trade can be found again. The account PIN goes with it when set; an account asking for a withdrawal 2FA code
   * cannot buy through the API (Prestmit refuses, and the order fails clearly).
   */
  async buy(input: { sku: string; price: number; quantity: number; uniqueIdentifier: string }): Promise<PrestmitBuyTrade> {
    const fields: Record<string, string> = {
      giftCardSKU: input.sku,
      price: String(input.price),
      quantity: String(input.quantity),
      paymentMethod: 'NAIRA',
      uniqueIdentifier: input.uniqueIdentifier,
      ...(this.options.accountPin?.trim() ? { currentAccountPIN: this.options.accountPin.trim() } : {}),
    };
    const body = record(await this.call('POST', '/giftcard-trade/buy/create', fields, formOf(fields)));
    return this.buyTrade(body.data ?? body);
  }

  /** The buy trade made with BitoCard's reference (or Prestmit's own), from the latest pages of the buy history. */
  async findBuy(match: { uniqueIdentifier?: string; reference?: string }, maxPages = 4): Promise<PrestmitBuyTrade | null> {
    for (let page = 1; page <= maxPages; page += 1) {
      const body = record(await this.call('GET', '/giftcard-trade/buy/history', { page: String(page) }));
      const rows = list(body.data).map(record);
      const row = rows.find(item => (match.reference && String(item.reference ?? '') === match.reference) || (match.uniqueIdentifier && String(item.uniqueIdentifier ?? '') === match.uniqueIdentifier));
      if (row) return this.buyTrade(row);
      const last = Number(record(body.meta).last_page);
      if (!rows.length || (Number.isFinite(last) && page >= last)) break;
    }
    return null;
  }

  /** The codes of a fulfilled buy trade (`fetch-codes/{reference}`). */
  async buyCodes(reference: string): Promise<PrestmitCode[]> {
    const body = await this.call('GET', `/giftcard-trade/buy/fetch-codes/${encodeURIComponent(reference)}`);
    return codesOf(Array.isArray(body) ? body : record(body).data);
  }

  private buyTrade(value: unknown): PrestmitBuyTrade {
    const trade = record(value);
    const paid = Number(trade.totalPaymentAmount);
    return {
      reference: String(trade.reference ?? ''),
      status: String(trade.status ?? 'PENDING').toUpperCase(),
      paidNaira: String(trade.paymentMethod ?? 'NAIRA').toUpperCase() === 'NAIRA' && Number.isFinite(paid) && paid > 0 ? paid : null,
      uniqueIdentifier: trade.uniqueIdentifier ? String(trade.uniqueIdentifier) : null,
      cards: codesOf(trade.cards),
    };
  }

  private trade(value: unknown): PrestmitTrade {
    const trade = record(value);
    const total = Number(trade.totalAmount ?? trade.total_amount);
    return {
      reference: String(trade.reference ?? trade.id ?? ''),
      status: String(trade.status ?? 'PENDING').toUpperCase(),
      totalAmount: Number.isFinite(total) && total > 0 ? total : null,
      rejectionReason: typeof trade.rejectionReason === 'string' && trade.rejectionReason.trim() ? trade.rejectionReason.trim() : null,
    };
  }

  private async call(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, form?: FormData) {
    const apiKey = this.options.apiKey?.trim();
    const apiSecret = this.options.apiSecret?.trim();
    if (!apiKey || !apiSecret) throw new ProviderError('prestmit', 'not set up', true);
    const url = new URL(`${this.options.baseUrl.replace(/\/+$/, '')}${path}`);
    if (method === 'GET') for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Accept: 'application/json', 'API-KEY': apiKey, 'API-Hash': prestmitHash(apiKey, apiSecret, params) };
    if (method === 'GET') headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: form, redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
    } catch (error) {
      throw new ProviderError('prestmit', error instanceof Error ? error.message : 'unreachable', false);
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = String(record(body).message ?? record(body).error ?? text.slice(0, 160) ?? response.status);
      // A refusal is definite; a timeout, rate limit or server error is unclear.
      const definite = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
      throw new ProviderError('prestmit', `${response.status} ${message}`.trim(), definite, response.status);
    }
    if (record(body).success === false) throw new ProviderError('prestmit', String(record(body).message ?? 'refused'), true);
    return body;
  }
}
