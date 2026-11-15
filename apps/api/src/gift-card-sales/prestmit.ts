import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '../payments/provider-error.js';

/**
 * Prestmit's partner API, the sell side: the gift cards it buys with their rates, creating a sell trade and reading
 * it back. Documented at https://documentation.prestmit.io/ (read 15 November 2026). Every request carries the API
 * key and `API-Hash`, the hex HMAC-SHA256 of `<key>:<JSON of the body>` (for GET, of the query) with the API secret.
 * The documentation disagrees with itself in places (the multipart hash, the webhook signature's encoding): confirm
 * against Prestmit's sandbox before switching selling on live.
 */
export type PrestmitOptions = { apiKey?: string; apiSecret?: string; baseUrl: string; timeoutMs?: number };

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

/** Prestmit's country names, as it writes them, to ISO codes. */
const countries: Record<string, string> = {
  USA: 'US', 'UNITED STATES': 'US', US: 'US', UK: 'GB', 'UNITED KINGDOM': 'GB', CANADA: 'CA', AUSTRALIA: 'AU', GERMANY: 'DE', FRANCE: 'FR',
  SPAIN: 'ES', ITALY: 'IT', NETHERLANDS: 'NL', 'NEW ZEALAND': 'NZ', SWITZERLAND: 'CH', IRELAND: 'IE', SINGAPORE: 'SG', MEXICO: 'MX', BELGIUM: 'BE',
  AUSTRIA: 'AT', SWEDEN: 'SE', POLAND: 'PL', JAPAN: 'JP', UAE: 'AE', 'UNITED ARAB EMIRATES': 'AE', 'SOUTH AFRICA': 'ZA', NIGERIA: 'NG', GHANA: 'GH',
  NORWAY: 'NO', DENMARK: 'DK', FINLAND: 'FI', PORTUGAL: 'PT', BRAZIL: 'BR', 'HONG KONG': 'HK', 'SOUTH KOREA': 'KR', TURKEY: 'TR', 'SAUDI ARABIA': 'SA',
};

export const prestmitCountry = (value: unknown) => countries[String(value ?? '').trim().toUpperCase()] ?? null;

export function prestmitForm(value: unknown): PrestmitCard['form'] {
  const text = String(value ?? '').toLowerCase();
  const physical = text.includes('physical');
  const ecode = text.includes('code');
  return physical && ecode ? 'both' : ecode ? 'ecode' : 'physical';
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

export class Prestmit {
  constructor(private readonly options: PrestmitOptions) {}

  configured() {
    return Boolean(this.options.apiKey?.trim() && this.options.apiSecret?.trim());
  }

  /** Whether Prestmit is taking gift card sales now (`/general/service-availability`). */
  async sellingOpen() {
    const body = record(await this.call('GET', '/general/service-availability'));
    const data = record(body.data ?? body);
    return data.sellGiftCard !== false;
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
    const rows = list(body.data ?? record(body.data).data);
    const row = rows.map(record).find(item => !item.uniqueIdentifier || item.uniqueIdentifier === uniqueIdentifier);
    return row ? this.trade(row) : null;
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
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: form, signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000) });
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
