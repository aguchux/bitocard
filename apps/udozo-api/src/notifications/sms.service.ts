import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { Platform } from '../generated/prisma/client.js';
import { inProductWords } from '../products/product.js';
import type { AppConfig } from '../config/config.js';

export type SmsMessage = { to: string; text: string };

/** The SMS providers a message can be sent through by name (Udozo's Marketing chooses one per message). */
export const smsProviders = ['africas_talking', 'termii'] as const;
export type SmsProvider = (typeof smsProviders)[number];
/** Termii's routes: `generic` (promotional, not delivered to numbers on Nigeria's do-not-disturb list) or `dnd` (transactional). */
export const termiiChannels = ['generic', 'dnd'] as const;
export type TermiiChannel = (typeof termiiChannels)[number];
export type SmsOptions = { from?: string | null; channel?: TermiiChannel };
/** `held`: no provider credentials outside production, so the message went to `outbox`. `reference`: the provider's message ID. */
export type SmsResult = { provider: SmsProvider; held: boolean; reference: string | null };

const providerNames: Record<SmsProvider, string> = { africas_talking: 'Africa’s Talking', termii: 'Termii' };

/**
 * Sends profile verification SMS through the country's admin-selected provider, and admins' own messages through the
 * provider they choose (`sendWith`). Resold SMS products have separate suppliers. In local development and tests, a
 * provider without credentials captures messages in `outbox`.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('Sms');
  readonly outbox: SmsMessage[] = [];

  /** A product's admin integration settings, read fresh on every use: Afrippa's texts go through Afrippa's own account. */
  private config(platform: Platform) {
    return this.integrations.configFor(platform);
  }

  constructor(private readonly integrations: IntegrationsService, private readonly prisma: PrismaService) {}

  private words(original: SmsMessage, platform: Platform) {
    return platform === 'bitocard' ? { ...original, text: inProductWords(original.text, this.integrations.config.APP_PRODUCT) } : original;
  }

  /** Each provider: whether its credentials are set, the sender ID it uses unless told otherwise, and whether it is a test account. */
  providers(platform: Platform = 'bitocard') {
    const config = this.config(platform);
    return [
      { provider: 'africas_talking' as const, name: providerNames.africas_talking, configured: Boolean(config.AFRICASTALKING_USERNAME && config.AFRICASTALKING_API_KEY), sender_id: config.AFRICASTALKING_SENDER_ID ?? null, sandbox: config.AFRICASTALKING_USERNAME === 'sandbox' },
      { provider: 'termii' as const, name: providerNames.termii, configured: Boolean(config.TERMII_API_KEY), sender_id: config.TERMII_SENDER_ID ?? null, sandbox: false },
    ];
  }

  /** A country is disabled until an admin assigns a provider and configures its credentials. */
  async sendForCountry(countryCode: string | null, original: SmsMessage, platform: Platform = 'bitocard') {
    const message = this.words(original, platform);
    const country = countryCode ? await this.prisma.country.findUnique({ where: { code: countryCode } }) : null;
    if (!countryCode) return this.send(message, platform);
    if (!country?.smsProvider) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_verification_unavailable', 'Phone verification is not available in your country yet.');
    const config = this.config(platform);
    if (country.smsProvider === 'termii') {
      if (!config.TERMII_API_KEY && process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'sms_provider_unavailable', 'Phone verification is temporarily unavailable.');
      return this.send(message, platform);
    }
    if (country.smsProvider !== 'africas_talking') throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'sms_provider_unavailable', 'Phone verification is temporarily unavailable.');
    if (!config.AFRICASTALKING_USERNAME || !config.AFRICASTALKING_API_KEY) {
      if (process.env.NODE_ENV !== 'production') { this.outbox.push(message); return 'outbox'; }
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'sms_provider_unavailable', 'Phone verification is temporarily unavailable.');
    }
    await this.africasTalking(message, config, config.AFRICASTALKING_SENDER_ID);
    return 'africas_talking';
  }

  /** `to` is E.164 (+2348012345678). Throws if Termii rejects the message or cannot be reached. */
  async send(original: SmsMessage, platform: Platform = 'bitocard'): Promise<string> {
    const message = this.words(original, platform);
    const config = this.config(platform);
    if (!config.TERMII_API_KEY) {
      this.outbox.push(message);
      this.logger.log({ to: message.to }, 'SMS captured (no provider configured)');
      return 'outbox';
    }
    await this.termii(message, config, { from: config.TERMII_SENDER_ID, channel: 'generic' });
    return 'termii';
  }

  /**
   * One message through the provider named, with an optional sender ID (else the provider's setting) and, for Termii,
   * its route. Without the provider's credentials it is refused in production and held in `outbox` elsewhere. A provider's
   * refusal throws an Error carrying its reason.
   */
  async sendWith(provider: SmsProvider, original: SmsMessage, options: SmsOptions = {}, platform: Platform = 'bitocard'): Promise<SmsResult> {
    const message = this.words(original, platform);
    const config = this.config(platform);
    const configured = this.providers(platform).find(item => item.provider === provider)?.configured ?? false;
    if (!configured) {
      if (process.env.NODE_ENV === 'production') {
        throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'sms_provider_unavailable', `${providerNames[provider]} is not set up yet. Add its keys in Settings > Integrations.`, 'provider');
      }
      this.outbox.push(message);
      this.logger.log({ to: message.to, provider }, 'SMS captured (no provider configured)');
      return { provider, held: true, reference: null };
    }
    const reference =
      provider === 'africas_talking'
        ? await this.africasTalking(message, config, options.from ?? config.AFRICASTALKING_SENDER_ID)
        : await this.termii(message, config, { from: options.from ?? config.TERMII_SENDER_ID, channel: options.channel ?? 'generic' });
    return { provider, held: false, reference };
  }

  /** Africa's Talking's messaging API; the message ID of the first accepted recipient. */
  private async africasTalking(message: SmsMessage, config: AppConfig, from: string | null | undefined) {
    const body = new URLSearchParams({ username: config.AFRICASTALKING_USERNAME!, to: message.to, message: message.text });
    if (from) body.set('from', from);
    // The sandbox account (username `sandbox`) has its own address; an address set in Settings wins (tests use a fake).
    const base = config.AFRICASTALKING_API_URL ?? (config.AFRICASTALKING_USERNAME === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com');
    const url = `${base.replace(/\/+$/, '')}/version1/messaging`;
    // Africa's Talking answers in XML unless JSON is asked for.
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', apiKey: config.AFRICASTALKING_API_KEY! }, body, signal: AbortSignal.timeout(10_000) });
    const reply = await response.text();
    if (!response.ok) throw new Error(`Africa's Talking HTTP ${response.status}: ${reply.slice(0, 200)}`);
    let result: { SMSMessageData?: { Message?: string; Recipients?: Array<{ statusCode?: number; status?: string; messageId?: string }> } };
    try {
      result = JSON.parse(reply) as typeof result;
    } catch {
      throw new Error(`Africa's Talking sent an unreadable reply: ${reply.slice(0, 200)}`);
    }
    const recipients = result.SMSMessageData?.Recipients ?? [];
    const accepted = recipients.find(recipient => recipient.statusCode === 100 || recipient.statusCode === 101);
    if (!accepted) {
      throw new Error(`Africa's Talking rejected the SMS: ${recipients.map(recipient => recipient.status).join(', ') || result.SMSMessageData?.Message || 'no recipients'}`);
    }
    return accepted.messageId ?? null;
  }

  /** Termii's send API; its message ID when it gives one. */
  private async termii(message: SmsMessage, config: AppConfig, options: { from: string | null | undefined; channel: TermiiChannel }) {
    const res = await fetch(`${config.TERMII_API_URL}/api/sms/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: config.TERMII_API_KEY, to: message.to.replace(/^\+/, ''), from: options.from, sms: message.text, type: 'plain', channel: options.channel }),
      signal: AbortSignal.timeout(10_000),
    });
    const reply = await res.text();
    if (!res.ok) throw new Error(`Termii HTTP ${res.status}: ${reply.slice(0, 300)}`);
    try {
      const parsed = JSON.parse(reply) as { message_id?: string | number };
      return parsed.message_id !== undefined ? String(parsed.message_id) : null;
    } catch {
      return null;
    }
  }
}
