import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Event, LedgerMode, WebhookAttempt, WebhookDelivery, WebhookDeliveryStatus, WebhookEndpoint } from '../generated/prisma/client.js';
import { WebhookDeliveryService } from './delivery.service.js';
import { checkDestination } from './destinations.js';
import { eventPayload, eventTypes, pingEvent } from './events.js';
import { newWebhookSecret } from './signing.js';

/** Endpoints per reseller in each mode. */
export const maxEndpoints = 16;
const maxOverlapHours = 168;

const notFound = (what = 'webhook endpoint') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

export function presentEndpoint(endpoint: WebhookEndpoint) {
  return {
    object: 'webhook_endpoint' as const,
    id: endpoint.id,
    mode: endpoint.mode,
    url: endpoint.url,
    description: endpoint.description,
    /** `*` means every event type, including types added later. */
    events: endpoint.events.length ? endpoint.events : ['*'],
    status: endpoint.status,
    disabled_reason: endpoint.disabledReason,
    disabled_at: endpoint.disabledAt?.toISOString() ?? null,
    previous_secret_expires_at: endpoint.previousSecretEncrypted && endpoint.previousSecretExpiresAt && endpoint.previousSecretExpiresAt > new Date() ? endpoint.previousSecretExpiresAt.toISOString() : null,
    created_at: endpoint.createdAt.toISOString(),
  };
}

const presentAttempt = (attempt: WebhookAttempt) => ({
  success: attempt.success,
  manual: attempt.manual,
  response_status: attempt.responseStatus,
  response_body: attempt.responseBody,
  error: attempt.error,
  duration_ms: attempt.durationMs,
  created_at: attempt.createdAt.toISOString(),
});

export function presentDelivery(delivery: WebhookDelivery & { event: Event; log?: WebhookAttempt[] }) {
  return {
    object: 'webhook_delivery' as const,
    id: delivery.id,
    endpoint_id: delivery.endpointId,
    event: { id: delivery.event.id, type: delivery.event.type, created_at: delivery.event.createdAt.toISOString() },
    status: delivery.status,
    attempts: delivery.attempts,
    next_attempt_at: delivery.nextAttemptAt?.toISOString() ?? null,
    last_attempt_at: delivery.lastAttemptAt?.toISOString() ?? null,
    last_response_status: delivery.lastResponseStatus,
    last_error: delivery.lastError,
    created_at: delivery.createdAt.toISOString(),
    ...(delivery.log ? { log: delivery.log.map(presentAttempt) } : {}),
  };
}

type EndpointInput = { url?: string; description?: string | null; events?: string[]; status?: 'enabled' | 'disabled' };

/** Reseller webhook endpoints, their secrets, test events and the delivery log. */
@Injectable()
export class WebhookEndpointsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  private async find(resellerId: string, mode: LedgerMode, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, resellerId, mode } });
    if (!endpoint) throw notFound();
    return endpoint;
  }

  private async checkUrl(url: string) {
    const problem = await checkDestination(url, this.config.WEBHOOK_ALLOW_PRIVATE_URLS);
    if (problem) throw invalid('url_invalid', problem, 'url');
  }

  /** Stored empty for "every type". */
  private eventList(events: string[]) {
    if (events.includes('*')) return [];
    const unknown = events.filter(type => !(eventTypes as readonly string[]).includes(type));
    if (unknown.length) throw invalid('event_type_invalid', `Unknown event type: ${unknown.join(', ')}.`, 'events');
    return [...new Set(events)];
  }

  /** The signing secret is returned here and on rotation only. */
  async create(resellerId: string, mode: LedgerMode, input: { url: string; description?: string; events?: string[] }) {
    const events = this.eventList(input.events ?? ['*']);
    await this.checkUrl(input.url);
    const existing = await this.prisma.webhookEndpoint.findMany({ where: { resellerId, mode }, select: { url: true } });
    if (existing.some(endpoint => endpoint.url === input.url)) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'endpoint_exists', 'An endpoint with this URL already exists.', 'url');
    }
    if (existing.length >= maxEndpoints) throw invalid('endpoint_limit', `You can have up to ${maxEndpoints} webhook endpoints in each mode.`, 'url');
    const secret = newWebhookSecret();
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { resellerId, mode, url: input.url, description: input.description ?? null, events, secretEncrypted: this.encryption().encrypt(secret) },
    });
    return { ...presentEndpoint(endpoint), secret };
  }

  async list(resellerId: string, mode: LedgerMode) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { resellerId, mode }, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: endpoints.map(presentEndpoint) };
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    return presentEndpoint(await this.find(resellerId, mode, id));
  }

  /** Enabling again clears the failure history; deliveries resume for events from now on and any still pending. */
  async update(resellerId: string, mode: LedgerMode, id: string, input: EndpointInput) {
    const endpoint = await this.find(resellerId, mode, id);
    if (input.url !== undefined && input.url !== endpoint.url) {
      await this.checkUrl(input.url);
      if (await this.prisma.webhookEndpoint.findFirst({ where: { resellerId, mode, url: input.url, id: { not: id } } })) {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'endpoint_exists', 'An endpoint with this URL already exists.', 'url');
      }
    }
    const status =
      input.status === 'enabled' && endpoint.status === 'disabled'
        ? { status: 'enabled' as const, disabledReason: null, disabledAt: null, failingSince: null }
        : input.status === 'disabled' && endpoint.status === 'enabled'
          ? { status: 'disabled' as const, disabledReason: 'by_reseller', disabledAt: new Date() }
          : {};
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        url: input.url,
        description: input.description,
        events: input.events ? this.eventList(input.events) : undefined,
        ...status,
      },
    });
    if (updated.status === 'enabled') this.delivery.wake(id);
    return presentEndpoint(updated);
  }

  /** Deletes the endpoint and its delivery log. Events stay available from GET /v1/events. */
  async remove(resellerId: string, mode: LedgerMode, id: string) {
    await this.find(resellerId, mode, id);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return { object: 'webhook_endpoint' as const, id, deleted: true };
  }

  /** A new secret; the old one keeps signing alongside it for the overlap (default 24 hours), then stops. */
  async rotateSecret(resellerId: string, mode: LedgerMode, id: string, overlapHours = 24) {
    const endpoint = await this.find(resellerId, mode, id);
    if (overlapHours < 0 || overlapHours > maxOverlapHours) throw invalid('parameter_invalid', `The overlap can be 0 to ${maxOverlapHours} hours.`, 'expire_previous_in_hours');
    const secret = newWebhookSecret();
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        secretEncrypted: this.encryption().encrypt(secret),
        previousSecretEncrypted: overlapHours > 0 ? endpoint.secretEncrypted : null,
        previousSecretExpiresAt: overlapHours > 0 ? new Date(Date.now() + overlapHours * 3600 * 1000) : null,
      },
    });
    return { ...presentEndpoint(updated), secret };
  }

  /** Sends a `ping` event to this endpoint now and returns the delivery with its result. */
  async sendTest(resellerId: string, mode: LedgerMode, id: string) {
    const endpoint = await this.find(resellerId, mode, id);
    const eventId = randomUUID();
    const createdAt = new Date();
    const delivery = await this.prisma.$transaction(async tx => {
      await tx.event.create({
        data: {
          id: eventId,
          resellerId,
          mode,
          type: pingEvent,
          endpointId: endpoint.id,
          createdAt,
          dispatchedAt: createdAt,
          payload: eventPayload({ id: eventId, type: pingEvent, mode, createdAt }, { object: 'ping', endpoint_id: endpoint.id, message: 'Test event from BitoCard.' }),
        },
      });
      return tx.webhookDelivery.create({ data: { eventId, endpointId: endpoint.id, status: 'pending' }, include: { event: true } });
    });
    const result = await this.delivery.attempt(endpoint, delivery, true);
    // Test events are sent once, never retried.
    if (!result.success) await this.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'failed' } });
    return this.getDelivery(resellerId, mode, id, delivery.id);
  }

  async listDeliveries(resellerId: string, mode: LedgerMode, id: string, filter: { status?: WebhookDeliveryStatus; limit?: number; starting_after?: string }) {
    await this.find(resellerId, mode, id);
    const limit = filter.limit ?? 25;
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { endpointId: id, status: filter.status },
      include: { event: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: deliveries.slice(0, limit).map(delivery => presentDelivery(delivery)), has_more: deliveries.length > limit };
  }

  async getDelivery(resellerId: string, mode: LedgerMode, id: string, deliveryId: string) {
    await this.find(resellerId, mode, id);
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, endpointId: id },
      include: { event: true, log: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!delivery) throw notFound('delivery');
    return presentDelivery(delivery);
  }

  /** Sends the same event again now, whatever its status; the result is added to the log. */
  async resend(resellerId: string, mode: LedgerMode, id: string, deliveryId: string) {
    const endpoint = await this.find(resellerId, mode, id);
    const delivery = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, endpointId: id }, include: { event: true } });
    if (!delivery) throw notFound('delivery');
    await this.delivery.attempt(endpoint, delivery, true);
    return this.getDelivery(resellerId, mode, id, deliveryId);
  }
}
