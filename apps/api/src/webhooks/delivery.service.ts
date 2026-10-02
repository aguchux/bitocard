import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { Encryption } from '../common/encryption';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import type { Event, WebhookDelivery, WebhookEndpoint } from '../generated/prisma/client';
import { EmailService } from '../notifications/email.service';
import { webhookEndpointDisabledEmail } from '../notifications/templates';
import { BlockedDestinationError, isBlockedAddress, safeLookup } from './destinations';
import { signatureHeader, signatureValue } from './signing';

/** Seconds to wait after each failed attempt: 1 min, 5 min, 30 min, 2 h, 6 h, then every 12 h. */
export const retryScheduleSeconds = [60, 300, 1800, 7200, 21_600];
const laterRetrySeconds = 43_200;
/** Deliveries stop after this, and an endpoint failing for this long is disabled. */
export const giveUpAfterMs = 3 * 24 * 3600 * 1000;
/** At most this many requests in flight to one endpoint, so one slow reseller never holds up others. */
export const concurrencyPerEndpoint = 5;
const timeoutMs = 10_000;
const leaseMs = 90_000;
const endpointsInParallel = 20;
/** Events are kept this long for GET /v1/events and the delivery log. */
export const eventRetentionMs = 30 * 24 * 3600 * 1000;

export type SendResult = { success: boolean; status: number | null; body: string | null; error: string | null; durationMs: number };

/** ±10% jitter, so retries from many failures do not arrive together. */
const jitter = (seconds: number) => Math.round(seconds * 1000 * (0.9 + Math.random() * 0.2));

/**
 * Delivers events to reseller endpoints. Postgres is the queue: the outbox (events not yet dispatched) is fanned out
 * into one delivery per endpoint, and due deliveries are sent by one worker per endpoint at a time (a lease), with a
 * few requests in flight. A run starts right after a change commits (`kick`) and every minute from cron, so a lost
 * run only delays delivery. `attempt` sends one delivery and is the unit a queue consumer would call.
 */
@Injectable()
export class WebhookDeliveryService implements OnModuleDestroy {
  private readonly logger = new Logger('Webhooks');
  private current: Promise<void> | null = null;
  private again = false;
  private closing = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  // -- Running ---------------------------------------------------------------------------------------------------

  /** Starts a delivery run in the background (after a change commits); a run already going picks the new work up. */
  kick() {
    if (this.closing) return;
    if (this.current) {
      this.again = true;
      return;
    }
    const run = (async () => {
      do {
        this.again = false;
        await this.run(15_000);
      } while (this.again && !this.closing);
    })()
      .catch(error => this.logger.error({ err: error }, 'Webhook run failed'))
      .finally(() => {
        this.current = null;
      });
    this.current = run;
    waitUntil(run);
  }

  /** Resolves when no background run is going (tests, shutdown). */
  async idle() {
    while (this.current) await this.current;
  }

  async onModuleDestroy() {
    this.closing = true;
    await this.idle();
  }

  /** Fans out the outbox, then sends what is due until the time budget runs out. Safe to run concurrently. */
  async run(budgetMs = 40_000) {
    const deadline = Date.now() + budgetMs;
    const dispatched = await this.dispatchOutbox();
    const delivered = await this.deliverDue(deadline);
    return { dispatched, ...delivered };
  }

  /** Turns undispatched events into deliveries for every enabled endpoint that wants them. */
  async dispatchOutbox() {
    let total = 0;
    for (;;) {
      const count = await this.prisma.$transaction(async tx => {
        const events = await tx.$queryRaw<Array<{ id: string; reseller_id: string; mode: string; type: string }>>`
          SELECT id, reseller_id, mode::text AS mode, type FROM events
          WHERE dispatched_at IS NULL ORDER BY seq LIMIT 100 FOR UPDATE SKIP LOCKED`;
        if (!events.length) return 0;
        const endpoints = await tx.webhookEndpoint.findMany({
          where: { status: 'enabled', resellerId: { in: [...new Set(events.map(event => event.reseller_id))] } },
          select: { id: true, resellerId: true, mode: true, events: true },
        });
        const now = new Date();
        const deliveries = events.flatMap(event =>
          endpoints
            .filter(endpoint => endpoint.resellerId === event.reseller_id && endpoint.mode === event.mode && (!endpoint.events.length || endpoint.events.includes(event.type)))
            .map(endpoint => ({ eventId: event.id, endpointId: endpoint.id, nextAttemptAt: now })),
        );
        if (deliveries.length) await tx.webhookDelivery.createMany({ data: deliveries, skipDuplicates: true });
        await tx.event.updateMany({ where: { id: { in: events.map(event => event.id) } }, data: { dispatchedAt: now } });
        return events.length;
      });
      total += count;
      if (count < 100) return total;
    }
  }

  /** Sends due deliveries, one leased worker per endpoint, many endpoints in parallel. */
  async deliverDue(deadline: number) {
    const stats = { endpoints: 0, sent: 0, succeeded: 0, failed: 0 };
    const now = new Date();
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now }, endpoint: { status: 'enabled', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] } },
      distinct: ['endpointId'],
      select: { endpointId: true },
      take: 200,
    });
    const queue = due.map(row => row.endpointId);
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        if (Date.now() >= deadline) return;
        const done = await this.workEndpoint(id, deadline);
        if (done === null) continue;
        stats.endpoints += 1;
        stats.sent += done.sent;
        stats.succeeded += done.succeeded;
        stats.failed += done.sent - done.succeeded;
      }
    };
    await Promise.all(Array.from({ length: Math.min(endpointsInParallel, queue.length) }, worker));
    return stats;
  }

  private async workEndpoint(endpointId: string, deadline: number) {
    const leaseUntil = new Date(Date.now() + leaseMs);
    const claimed = await this.prisma.webhookEndpoint.updateMany({
      where: { id: endpointId, status: 'enabled', OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
      data: { leaseUntil },
    });
    if (claimed.count === 0) return null;
    const done = { sent: 0, succeeded: 0 };
    try {
      while (Date.now() < deadline) {
        const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
        if (!endpoint || endpoint.status !== 'enabled') break;
        const batch = await this.prisma.webhookDelivery.findMany({
          where: { endpointId, status: 'pending', nextAttemptAt: { lte: new Date() } },
          orderBy: { nextAttemptAt: 'asc' },
          take: concurrencyPerEndpoint,
          include: { event: true },
        });
        if (!batch.length) break;
        const results = await Promise.all(batch.map(delivery => this.attempt(endpoint, delivery, false)));
        done.sent += results.length;
        done.succeeded += results.filter(result => result.success).length;
      }
    } finally {
      await this.prisma.webhookEndpoint.updateMany({ where: { id: endpointId, leaseUntil }, data: { leaseUntil: null } });
    }
    return done;
  }

  // -- One attempt -----------------------------------------------------------------------------------------------

  /**
   * Sends one delivery and records the attempt. A scheduled failure sets the next retry (or gives up after 3 days)
   * and may disable a long-failing endpoint; a manual attempt (resend, test) only records itself, and marks the
   * delivery succeeded if it worked.
   */
  async attempt(endpoint: WebhookEndpoint, delivery: WebhookDelivery & { event: Event }, manual: boolean): Promise<SendResult> {
    const attemptNumber = delivery.attempts + 1;
    const result = await this.send(endpoint, delivery.event, attemptNumber);
    const now = new Date();
    await this.prisma.webhookAttempt.create({
      data: { deliveryId: delivery.id, manual, success: result.success, responseStatus: result.status, responseBody: result.body, error: result.error, durationMs: result.durationMs },
    });
    const last = { attempts: { increment: 1 }, lastAttemptAt: now, lastResponseStatus: result.status, lastError: result.error };
    if (result.success) {
      await this.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { ...last, status: 'succeeded', nextAttemptAt: null } });
      await this.prisma.webhookEndpoint.updateMany({ where: { id: endpoint.id, failingSince: { not: null } }, data: { failingSince: null } });
      return result;
    }
    if (manual) {
      await this.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: last });
      return result;
    }
    const next = new Date(now.getTime() + jitter(retryScheduleSeconds[attemptNumber - 1] ?? laterRetrySeconds));
    const givingUp = next.getTime() > delivery.event.createdAt.getTime() + giveUpAfterMs;
    await this.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: last });
    // Only while still pending: the endpoint may have been disabled (stopping its deliveries) during this attempt.
    await this.prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: 'pending' },
      data: { status: givingUp ? 'failed' : 'pending', nextAttemptAt: givingUp ? null : next },
    });
    await this.prisma.webhookEndpoint.updateMany({ where: { id: endpoint.id, failingSince: null }, data: { failingSince: now } });
    const failingSince = (await this.prisma.webhookEndpoint.findUnique({ where: { id: endpoint.id }, select: { failingSince: true } }))?.failingSince;
    if (failingSince && now.getTime() - failingSince.getTime() >= giveUpAfterMs) await this.disableFailing(endpoint);
    return result;
  }

  /** After 3 days of failures: disable the endpoint, stop its pending deliveries, and tell the reseller. */
  private async disableFailing(endpoint: WebhookEndpoint) {
    const disabled = await this.prisma.webhookEndpoint.updateMany({
      where: { id: endpoint.id, status: 'enabled' },
      data: { status: 'disabled', disabledReason: 'failing', disabledAt: new Date() },
    });
    if (disabled.count === 0) return;
    await this.prisma.webhookDelivery.updateMany({
      where: { endpointId: endpoint.id, status: 'pending' },
      data: { status: 'failed', nextAttemptAt: null, lastError: 'endpoint_disabled' },
    });
    this.logger.warn({ endpointId: endpoint.id, resellerId: endpoint.resellerId }, 'Webhook endpoint disabled after 3 days of failures');
    const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId: endpoint.resellerId, role: 'owner' }, include: { user: true } });
    if (owner) {
      await this.email
        .send(webhookEndpointDisabledEmail(owner.user.email, endpoint.url, endpoint.mode, `${this.config.DASHBOARD_URL}/developers/webhooks/${endpoint.id}`))
        .catch(error => this.logger.warn({ err: error, endpointId: endpoint.id }, 'Could not send the email'));
    }
  }

  /** The signing secrets: the current one, plus the previous one during a rotation's overlap. */
  private secrets(endpoint: WebhookEndpoint) {
    const encryption = this.encryption();
    const secrets = [encryption.decrypt(endpoint.secretEncrypted)];
    if (endpoint.previousSecretEncrypted && endpoint.previousSecretExpiresAt && endpoint.previousSecretExpiresAt > new Date()) {
      secrets.push(encryption.decrypt(endpoint.previousSecretEncrypted));
    }
    return secrets;
  }

  /** POSTs the event. Any 2xx is success; redirects are not followed; 10-second limit; internal addresses refused. */
  async send(endpoint: WebhookEndpoint, event: Event, attemptNumber: number): Promise<SendResult> {
    const started = Date.now();
    const finish = (partial: Omit<SendResult, 'durationMs'>): SendResult => ({ ...partial, durationMs: Date.now() - started });
    const allowPrivate = this.config.WEBHOOK_ALLOW_PRIVATE_URLS;
    let url: URL;
    try {
      url = new URL(endpoint.url);
    } catch {
      return finish({ success: false, status: null, body: null, error: 'invalid_url' });
    }
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) return finish({ success: false, status: null, body: null, error: 'insecure_url' });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && isIP(host) && isBlockedAddress(host)) return finish({ success: false, status: null, body: null, error: 'blocked_destination' });

    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'BitoCard-Webhooks/1.0 (+https://docs.bitocard.com/webhooks)',
      [signatureHeader.toLowerCase()]: signatureValue(this.secrets(endpoint), timestamp, event.payload),
      'bitocard-event-id': event.id,
      'bitocard-event-type': event.type,
      'bitocard-delivery-attempt': String(attemptNumber),
      'content-length': String(Buffer.byteLength(event.payload)),
    };
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<SendResult>(resolve => {
      let settled = false;
      const done = (result: Omit<SendResult, 'durationMs'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(finish(result));
      };
      const req = send(url, { method: 'POST', headers, lookup: safeLookup(allowPrivate) }, res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (size < 2048) chunks.push(chunk);
          size += chunk.length;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 500) || null;
          done({ success: status >= 200 && status < 300, status, body, error: status >= 200 && status < 300 ? null : `http_${status}` });
        });
        res.on('error', () => done({ success: false, status: res.statusCode ?? null, body: null, error: 'connection_error' }));
      });
      const timer = setTimeout(() => {
        req.destroy();
        done({ success: false, status: null, body: null, error: 'timeout' });
      }, timeoutMs);
      req.on('error', error => {
        const code = error instanceof BlockedDestinationError || (error as { cause?: unknown }).cause instanceof BlockedDestinationError ? 'blocked_destination' : 'connection_error';
        done({ success: false, status: null, body: null, error: code });
      });
      req.end(event.payload);
    });
  }

  // -- Housekeeping ----------------------------------------------------------------------------------------------

  /** Deletes events (with their deliveries and attempts) past the retention period, and expired rotated secrets. Daily. */
  async purge(now = new Date()) {
    const events = await this.prisma.event.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - eventRetentionMs) } } });
    const secrets = await this.prisma.webhookEndpoint.updateMany({
      where: { previousSecretExpiresAt: { lte: now } },
      data: { previousSecretEncrypted: null, previousSecretExpiresAt: null },
    });
    return { events: events.count, expired_secrets: secrets.count };
  }
}
