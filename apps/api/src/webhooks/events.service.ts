import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Event, LedgerMode } from '../generated/prisma/client.js';
import type { Tx } from '../ledger/ledger.service.js';
import { WebhookDeliveryService } from './delivery.service.js';
import { eventPayload, type EventType } from './events.js';

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const presentEvent = (event: Event) => JSON.parse(event.payload) as Record<string, unknown>;

/**
 * Events about a reseller's objects. `record` writes one in the caller's transaction (the outbox), so an event exists
 * exactly when its change committed; call `committed()` after the transaction to deliver it promptly.
 */
@Injectable()
export class EventsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  /** `object` is the public representation of the changed object, as the API returns it (never secrets). */
  async record(tx: Tx, input: { resellerId: string; mode: LedgerMode; type: EventType; object: object }) {
    const id = randomUUID();
    const createdAt = new Date();
    await tx.event.create({
      data: { id, resellerId: input.resellerId, mode: input.mode, type: input.type, createdAt, payload: eventPayload({ id, type: input.type, mode: input.mode, createdAt }, input.object) },
    });
    return id;
  }

  /** Starts delivering recorded events now rather than at the next scheduled run. */
  committed() {
    this.delivery.kick();
  }

  /** Oldest first, for catching up: pass the last event ID you handled (or a time) as `since`. */
  async list(resellerId: string, mode: LedgerMode, filter: { since?: string; type?: string; limit?: number }) {
    const limit = filter.limit ?? 100;
    let after: { seq?: { gt: bigint }; createdAt?: { gt: Date } } = {};
    if (filter.since) {
      if (isUuid(filter.since)) {
        const from = await this.prisma.event.findFirst({ where: { id: filter.since, resellerId, mode, endpointId: null } });
        if (!from) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'resource_missing', 'No such event. It may be older than 30 days; pass a time instead.', 'since');
        after = { seq: { gt: from.seq } };
      } else {
        const time = new Date(filter.since);
        if (Number.isNaN(time.getTime())) {
          throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'since must be an event ID or an ISO 8601 time.', 'since');
        }
        after = { createdAt: { gt: time } };
      }
    }
    // Recent events appear after a few seconds, so an event committed late can never be skipped by a reader.
    const settled = new Date(Date.now() - this.config.EVENTS_SETTLE_SECONDS * 1000);
    const events = await this.prisma.event.findMany({
      where: { resellerId, mode, endpointId: null, type: filter.type, ...after, AND: [{ createdAt: { lte: settled } }] },
      orderBy: { seq: 'asc' },
      take: limit + 1,
    });
    return { object: 'list' as const, data: events.slice(0, limit).map(presentEvent), has_more: events.length > limit };
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    const event = await this.prisma.event.findFirst({ where: { id, resellerId, mode, endpointId: null } });
    if (!event) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such event.');
    return presentEvent(event);
  }
}
