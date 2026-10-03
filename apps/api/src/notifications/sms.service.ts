import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';

export type SmsMessage = { to: string; text: string };

/**
 * Sends SMS through Termii (used for BitoCard's own sign-in codes; resold SMS products use their own suppliers).
 * With no API key configured (local development and tests), messages are kept in `outbox` instead of sent.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('Sms');
  readonly outbox: SmsMessage[] = [];

  /** Admin integration settings over the environment, read fresh on every use. */
  private get config() {
    return this.integrations.config;
  }

  constructor(private readonly integrations: IntegrationsService) {}

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
