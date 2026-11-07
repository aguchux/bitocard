import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '../payments/provider-error.js';

const timeoutMs = 15_000;

export type WhatsappSettings = {
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  WHATSAPP_NUMBER?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_API_URL?: string;
};

/** Whether Udozo can send on WhatsApp: its number and the system user's token are set. */
export const whatsappConfigured = (config: WhatsappSettings) => Boolean(config.WHATSAPP_PHONE_NUMBER_ID?.trim() && config.WHATSAPP_ACCESS_TOKEN?.trim());

/** Udozo's number as digits only (for wa.me links), or null until it is set. */
export const whatsappDigits = (config: WhatsappSettings) => {
  const digits = (config.WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
};

/** A wa.me link to Udozo's number with the message filled in. */
export const waLink = (config: WhatsappSettings, text?: string) => {
  const digits = whatsappDigits(config);
  return digits ? `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null;
};

/** Meta's `X-Hub-Signature-256`: `sha256=<hex HMAC-SHA256 of the raw body keyed with the app secret>`. */
export function signatureValid(rawBody: Buffer | undefined, header: string | undefined, appSecret: string | undefined) {
  if (!rawBody || !header || !appSecret?.trim()) return false;
  const expected = `sha256=${createHmac('sha256', appSecret.trim()).update(rawBody).digest('hex')}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/** Constant-time comparison of two short secrets (the webhook's verify token). */
export function sameSecret(given: string | undefined, expected: string | undefined) {
  if (!given || !expected?.trim()) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A button (at most 3 a message; titles up to 20 characters). */
export type Button = { id: string; title: string };
/** A list row (at most 10 a message; titles up to 24 characters, descriptions up to 72). */
export type Row = { id: string; title: string; description?: string };

/** What Udozo sends: free-form inside the 24-hour window, templates outside it. */
export type OutgoingMessage =
  | { type: 'text'; body: string; previewUrl?: boolean }
  | { type: 'image'; link?: string; id?: string; caption?: string }
  | { type: 'buttons'; body: string; buttons: Button[]; header?: string; footer?: string }
  | { type: 'list'; body: string; button: string; rows: Row[]; header?: string; footer?: string }
  | { type: 'template'; name: string; language: string; params: string[]; buttonParam?: string; /** A verification template's code (its copy button). */ otp?: string };

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The Graph API body for one message to `to` (digits only). */
export function messageBody(to: string, message: OutgoingMessage, replyTo?: string) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...(replyTo ? { context: { message_id: replyTo } } : {}) };
  switch (message.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: cut(message.body, 4096), preview_url: message.previewUrl ?? false } };
    case 'image':
      return { ...base, type: 'image', image: { ...(message.id ? { id: message.id } : { link: message.link }), ...(message.caption ? { caption: cut(message.caption, 1024) } : {}) } };
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(message.header ? { header: { type: 'text', text: cut(message.header, 60) } } : {}),
          body: { text: cut(message.body, 1024) },
          ...(message.footer ? { footer: { text: cut(message.footer, 60) } } : {}),
          action: { buttons: message.buttons.slice(0, 3).map(button => ({ type: 'reply', reply: { id: button.id.slice(0, 256), title: cut(button.title, 20) } })) },
        },
      };
    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(message.header ? { header: { type: 'text', text: cut(message.header, 60) } } : {}),
          body: { text: cut(message.body, 4096) },
          ...(message.footer ? { footer: { text: cut(message.footer, 60) } } : {}),
          action: {
            button: cut(message.button, 20),
            sections: [{ rows: message.rows.slice(0, 10).map(row => ({ id: row.id.slice(0, 200), title: cut(row.title, 24), ...(row.description ? { description: cut(row.description, 72) } : {}) })) }],
          },
        },
      };
    case 'template':
      return {
        ...base,
        type: 'template',
        template: {
          name: message.name,
          language: { code: message.language },
          components: [
            ...(message.params.length ? [{ type: 'body', parameters: message.params.map(text => ({ type: 'text', text: cut(text.replace(/\s+/g, ' ').trim() || '-', 900) })) }] : []),
            ...(message.buttonParam ? [{ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: message.buttonParam }] }] : []),
            ...(message.otp ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: message.otp }] }] : []),
          ],
        },
      };
  }
}

/**
 * Meta's error codes that mean the number cannot get messages (not on WhatsApp, blocked Udozo, or not allowed): stop
 * sending until they write again. 131047 is the 24-hour window closing, which a template answers.
 */
const unreachableCodes = new Set([131026, 131030, 131021, 131050]);
export const windowClosedCode = 131047;

export class WhatsappError extends ProviderError {
  constructor(
    message: string,
    definite: boolean,
    status?: number,
    readonly metaCode?: number,
  ) {
    super('whatsapp', message, definite, status, metaCode === windowClosedCode ? 'window_closed' : metaCode !== undefined && unreachableCodes.has(metaCode) ? 'unreachable' : undefined);
  }
}

type MetaError = { error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };

/** Meta's WhatsApp Cloud API, with plain `fetch`: messages, media, templates and the number's own details. */
export class WhatsappCloud {
  constructor(private readonly config: WhatsappSettings) {}

  configured() {
    return whatsappConfigured(this.config);
  }

  private get base() {
    return (this.config.WHATSAPP_API_URL ?? 'https://graph.facebook.com/v23.0').replace(/\/+$/, '');
  }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path.startsWith('http') ? path : `${this.base}/${path.replace(/^\/+/, '')}`, {
        method,
        headers: { authorization: `Bearer ${this.config.WHATSAPP_ACCESS_TOKEN?.trim() ?? ''}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new WhatsappError(`request failed: ${(error as Error).message}`, false);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const meta = (json as MetaError | null)?.error;
      const code = meta?.code;
      // Rate limits (4, 80007, 130429, 131048, 131056) and Meta's own trouble (1, 2, 131000) may pass: unclear.
      const passing = res.status === 429 || res.status === 408 || res.status >= 500 || [1, 2, 4, 80007, 130429, 131000, 131048, 131056].includes(code ?? -1);
      const words = [meta?.message, meta?.error_data?.details].filter(Boolean).join(': ') || `HTTP ${res.status}`;
      throw new WhatsappError(`${words.slice(0, 300)}${code ? ` (${code})` : ''}`, !passing, res.status, code);
    }
    return json as T;
  }

  /** Sends one message; Meta's message id. */
  async send(to: string, message: OutgoingMessage, replyTo?: string) {
    const reply = await this.call<{ messages?: Array<{ id?: string }> }>('POST', `${this.config.WHATSAPP_PHONE_NUMBER_ID?.trim()}/messages`, messageBody(to, message, replyTo));
    const id = reply?.messages?.[0]?.id;
    if (!id) throw new WhatsappError('no message id in the reply', false);
    return id;
  }

  /** Uploads a photo to Meta (a chat photo from the private bucket, never a public link); its media id. */
  async upload(bytes: Buffer, contentType: string) {
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', contentType);
    form.set('file', new Blob([new Uint8Array(bytes)], { type: contentType }), contentType === 'image/png' ? 'photo.png' : 'photo.jpg');
    let res: Response;
    try {
      res = await fetch(`${this.base}/${encodeURIComponent(this.config.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '')}/media`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.WHATSAPP_ACCESS_TOKEN?.trim() ?? ''}` },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new WhatsappError(`upload failed: ${(error as Error).message}`, false);
    }
    const reply = (await res.json().catch(() => null)) as { id?: string } & MetaError | null;
    if (!res.ok || !reply?.id) throw new WhatsappError(reply?.error?.message ?? `upload HTTP ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 429, res.status, reply?.error?.code);
    return reply.id;
  }

  /** Marks a message they sent as read (the blue ticks). */
  async markRead(wamid: string) {
    await this.call('POST', `${this.config.WHATSAPP_PHONE_NUMBER_ID?.trim()}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: wamid });
  }

  /** Marks a message read and shows "typing…" to them while an answer is written (Meta clears it on the reply, or after 25 seconds). */
  async typing(wamid: string) {
    await this.call('POST', `${this.config.WHATSAPP_PHONE_NUMBER_ID?.trim()}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: wamid, typing_indicator: { type: 'text' } });
  }

  /** A photo they sent: its address (valid a few minutes) is read first, then its bytes, at most `maxBytes`. */
  async media(mediaId: string, maxBytes = 5 * 1024 * 1024) {
    const info = await this.call<{ url?: string; mime_type?: string; file_size?: number }>('GET', encodeURIComponent(mediaId));
    if (!info?.url || !/^https:\/\//.test(info.url) && !/^http:\/\/127\.0\.0\.1/.test(info.url)) throw new WhatsappError('no media address', true);
    if (info.file_size && info.file_size > maxBytes) throw new WhatsappError('file too large', true);
    let res: Response;
    try {
      res = await fetch(info.url, { headers: { authorization: `Bearer ${this.config.WHATSAPP_ACCESS_TOKEN?.trim() ?? ''}` }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new WhatsappError(`media download failed: ${(error as Error).message}`, false);
    }
    if (!res.ok) throw new WhatsappError(`media HTTP ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 429, res.status);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw new WhatsappError('file too large', true);
    return { bytes, contentType: (info.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim() };
  }

  /** The number's verified name, display number and quality rating (Test connection). */
  async phoneNumber() {
    return this.call<{ verified_name?: string; display_phone_number?: string; quality_rating?: string; id?: string }>(
      'GET',
      `${encodeURIComponent(this.config.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '')}?fields=verified_name,display_phone_number,quality_rating`,
    );
  }

  /** The account's message templates and their approval status. */
  async templates() {
    const reply = await this.call<{ data?: Array<{ name: string; status: string; language: string; category: string; rejected_reason?: string }> }>(
      'GET',
      `${encodeURIComponent(this.config.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? '')}/message_templates?fields=name,status,language,category,rejected_reason&limit=200`,
    );
    return reply?.data ?? [];
  }

  /** Submits a template to Meta for approval. */
  async createTemplate(template: { name: string; language: string; category: string; components: unknown[] }) {
    return this.call<{ id?: string; status?: string }>('POST', `${encodeURIComponent(this.config.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? '')}/message_templates`, template);
  }
}
