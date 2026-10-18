import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ApiError } from '../common/errors/api-error.js';

export type SmsMessage = { to: string; text: string };

/**
 * Sends profile verification SMS through the country's admin-selected provider. Resold SMS products have separate suppliers.
 * In local development and tests, a selected provider without credentials captures messages in `outbox`.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('Sms');
  readonly outbox: SmsMessage[] = [];

  /** Admin integration settings over the environment, read fresh on every use. */
  private get config() {
    return this.integrations.config;
  }

  constructor(private readonly integrations: IntegrationsService, private readonly prisma: PrismaService) {}

  /** A country is disabled until an admin assigns a provider and configures its credentials. */
  async sendForCountry(countryCode: string | null, message: SmsMessage) {
    const country = countryCode ? await this.prisma.country.findUnique({ where: { code: countryCode } }) : null;
    if (!countryCode) return this.send(message);
    if (!country?.smsProvider) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_verification_unavailable', 'Phone verification is not available in your country yet.');
    const config = this.config;
    if (country.smsProvider === 'termii') {
      if (!config.TERMII_API_KEY && process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'sms_provider_unavailable', 'Phone verification is temporarily unavailable.');
      return this.send(message);
    }
    if (country.smsProvider !== 'africas_talking') throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'sms_provider_unavailable', 'Phone verification is temporarily unavailable.');
    if (!config.AFRICASTALKING_USERNAME || !config.AFRICASTALKING_API_KEY) {
      if (process.env.NODE_ENV !== 'production') { this.outbox.push(message); return 'outbox'; }
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'sms_provider_unavailable', 'Phone verification is temporarily unavailable.');
    }
    const body = new URLSearchParams({ username: config.AFRICASTALKING_USERNAME, to: message.to, message: message.text });
    if (config.AFRICASTALKING_SENDER_ID) body.set('from', config.AFRICASTALKING_SENDER_ID);
    // The sandbox account (username `sandbox`) has its own address; an address set in Settings wins (tests use a fake).
    const base = config.AFRICASTALKING_API_URL ?? (config.AFRICASTALKING_USERNAME === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com');
    const url = `${base.replace(/\/+$/, '')}/version1/messaging`;
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', apiKey: config.AFRICASTALKING_API_KEY }, body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Africa's Talking HTTP ${response.status}`);
    const result = await response.json() as { SMSMessageData?: { Recipients?: Array<{ statusCode?: number }> } };
    if (!result.SMSMessageData?.Recipients?.some(recipient => recipient.statusCode === 100 || recipient.statusCode === 101)) throw new Error('Africa\'s Talking rejected the SMS');
    return 'africas_talking';
  }

  /** `to` is E.164 (+2348012345678). Throws if Termii rejects the message or cannot be reached. */
  async send(message: SmsMessage): Promise<string> {
    const { TERMII_API_KEY: apiKey, TERMII_API_URL: baseUrl, TERMII_SENDER_ID: from } = this.config;
    if (!apiKey) {
      this.outbox.push(message);
      this.logger.log({ to: message.to }, 'SMS captured (no provider configured)');
      return 'outbox';
    }
    const res = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, to: message.to.replace(/^\+/, ''), from, sms: message.text, type: 'plain', channel: 'generic' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Termii HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return 'termii';
  }
}
