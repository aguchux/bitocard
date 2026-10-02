import { Inject, Injectable, Logger } from '@nestjs/common';
import { QueueClient, type RetryHandler } from '@vercel/queue';
import { APP_CONFIG, type AppConfig } from '../config/config';

/** The Vercel Queues topic; its consumer trigger is configured in vercel.json. */
export const webhookTopic = 'webhook-deliveries';

/** A message says "this endpoint has deliveries due (now or after the delay)". */
export type EndpointMessage = { endpointId: string };

/** Thrown when another worker holds the endpoint: the queue redelivers the message shortly. */
export class EndpointBusyError extends Error {}

const maxDelaySeconds = 7 * 24 * 3600 - 3600;

/**
 * Vercel Queues as the webhook delivery transport. When enabled, each endpoint with due work gets a message (delayed
 * until its next retry), and Vercel pushes it back to the API, which delivers that endpoint's due deliveries. The
 * database stays the record: messages only say when to look, so a lost or repeated message is harmless, and the
 * cron run catches anything a message missed.
 */
@Injectable()
export class WebhookQueue {
  private readonly logger = new Logger('WebhookQueue');
  readonly enabled: boolean;
  private readonly client: QueueClient | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.enabled = config.webhookQueue === 'vercel';
    const testUrl = config.WEBHOOK_QUEUE_URL;
    this.client = this.enabled
      ? new QueueClient({
          // On Vercel, messages are pinned to the deployment that sent them; the test service has no deployments.
          ...(testUrl ? { region: 'iad1', resolveBaseUrl: () => new URL(testUrl), deploymentId: null } : {}),
          ...(config.WEBHOOK_QUEUE_TOKEN ? { token: config.WEBHOOK_QUEUE_TOKEN } : {}),
        })
      : null;
  }

  /** Asks for the endpoint's deliveries to be sent at `at`. Never throws: the cron run is the fallback. */
  async schedule(endpointId: string, at: Date = new Date()) {
    if (!this.client) return;
    const delaySeconds = Math.min(maxDelaySeconds, Math.max(0, Math.ceil((at.getTime() - Date.now()) / 1000)));
    try {
      await this.client.send<EndpointMessage>(webhookTopic, { endpointId }, {
        delaySeconds,
        retentionSeconds: Math.min(7 * 24 * 3600, delaySeconds + 24 * 3600),
        // Repeated requests for the same endpoint and second collapse into one message.
        idempotencyKey: `${endpointId}:${Math.ceil(at.getTime() / 1000)}`,
      });
    } catch (error) {
      this.logger.warn({ err: error, endpointId }, 'Could not queue webhook work; the scheduled run will pick it up');
    }
  }

  /**
   * The push consumer: a Connect-style handler for the Vercel Queues callback (`api/webhook-queue.mjs`, triggered by
   * the `webhook-deliveries` topic). A forged callback can only make the API deliver work that is already due, and the
   * queue service refuses to acknowledge it. A busy endpoint returns the message for a short wait.
   */
  nodeHandler(handle: (message: EndpointMessage) => Promise<void>) {
    if (!this.client) throw new Error('Vercel Queues is not enabled (WEBHOOK_QUEUE)');
    const retry: RetryHandler = error => ({ afterSeconds: error instanceof EndpointBusyError ? 10 : 30 });
    return this.client.handleNodeCallback<EndpointMessage>(message => handle(message), { visibilityTimeoutSeconds: 120, retry });
  }
}
