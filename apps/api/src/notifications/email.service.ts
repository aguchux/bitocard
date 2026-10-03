import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';

export type EmailMessage = { to: string; subject: string; text: string; html: string };

/** One email provider. Adapters translate BitoCard's message into the provider's API. */
export interface EmailProvider {
  readonly name: string;
  send(from: string, message: EmailMessage): Promise<void>;
}

const timeoutMs = 10_000;

async function postJson(url: string, apiKey: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  send(from: string, message: EmailMessage) {
    return postJson(`${this.baseUrl}/emails`, this.apiKey, { from, to: [message.to], subject: message.subject, text: message.text, html: message.html });
  }
}

export class MailerSendProvider implements EmailProvider {
  readonly name = 'mailersend';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  send(from: string, message: EmailMessage) {
    const match = /^(.*)<(.+)>$/.exec(from);
    const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { email: from };
    return postJson(`${this.baseUrl}/v1/email`, this.apiKey, {
      from: sender,
      to: [{ email: message.to }],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

/**
 * Sends email through Resend, falling back to MailerSend if Resend fails. With no provider keys configured
 * (local development and tests), messages are kept in `outbox` and logged instead of sent.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');
  private readonly configured: () => { from: string; providers: EmailProvider[] };
  /** Messages captured when no provider is configured. */
  readonly outbox: EmailMessage[] = [];

  constructor(integrations: IntegrationsService) {
    this.configured = integrations.derive(config => ({
      from: config.EMAIL_FROM,
      providers: ([
        config.RESEND_API_KEY ? new ResendProvider(config.RESEND_API_KEY, config.RESEND_API_URL) : null,
        config.MAILERSEND_API_KEY ? new MailerSendProvider(config.MAILERSEND_API_KEY, config.MAILERSEND_API_URL) : null,
      ] as Array<EmailProvider | null>).filter((provider): provider is EmailProvider => provider !== null),
    }));
  }

  private get providers() {
    return this.configured().providers;
  }

  private get from() {
    return this.configured().from;
  }

  /** Returns the provider that sent it ('outbox' when none is configured). Throws only if every provider fails. */
  async send(message: EmailMessage): Promise<string> {
    if (this.providers.length === 0) {
      this.outbox.push(message);
      this.logger.log({ to: message.to, subject: message.subject }, 'Email captured (no provider configured)');
      return 'outbox';
    }
    for (const provider of this.providers) {
      try {
        await provider.send(this.from, message);
        return provider.name;
      } catch (error) {
        this.logger.warn({ err: error, provider: provider.name }, 'Email provider failed; trying the next one');
      }
    }
    throw new Error('Every email provider failed');
  }
}
