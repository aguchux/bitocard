import { createHash } from 'node:crypto';
import { Controller, Get, HttpCode, HttpStatus, Injectable, Logger, Param, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { waitUntil } from '@vercel/functions';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, SessionOnly } from '../auth/caller.js';
import { AuditService } from '../audit/audit.service.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type SupplierWebhook, type SupplierWebhookStatus } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { connectable } from '../reseller-integrations/connectable.js';
import { ResellerIntegrationsService } from '../reseller-integrations/reseller-integrations.service.js';
import { didwwNotice, didwwSignatureValid } from '../suppliers/didww.webhooks.js';
import { reloadlyNotice, reloadlySignatureValid } from '../suppliers/reloadly.webhooks.js';
import { pawapayCallbackValid, pawapayNotice } from '../suppliers/pawapay.adapter.js';
import { zenditNotice, zenditWebhookHeader, zenditWebhookValid } from '../suppliers/zendit.adapter.js';
import { OrdersService } from './orders.service.js';

/** After the first try (straight after receipt): 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 1 day. */
export const supplierWebhookRetryMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000, 24 * 3600_000];
const maxAttempts = supplierWebhookRetryMs.length + 1;
/** How long a claimed notification is left alone while it is being processed. */
const leaseMs = 2 * 60_000;
/** Processed notifications are kept this long; unmatched and failed ones (for admins) for a year. */
const keepProcessedMs = 90 * 24 * 3600_000;
const keepOthersMs = 365 * 24 * 3600_000;

const untrusted = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'signature_invalid', 'Webhook signature is missing or wrong.');

/**
 * Supplier notifications (Reloadly, DIDWW, Zendit and pawaPay), to BitoCard's own accounts and to resellers' own connections (each live
 * connection has its own address, checked with that reseller's own secret, and can only name that reseller's own
 * orders through that connection). Nothing is lost: each one is verified and stored (encrypted) before it is
 * acknowledged; a supplier's retry of the same delivery is stored once. Processing happens after the reply (suppliers
 * allow a few seconds) and never trusts the body: the order it names is re-checked with the supplier, exactly like a
 * scheduled check. Failures are retried on `supplierWebhookRetryMs` by the `supplier-webhooks` job; notifications that
 * match no order, or keep failing, are kept for admins. The order's own scheduled checks continue regardless.
 */
@Injectable()
export class SupplierWebhooksService {
  private readonly logger = new Logger('SupplierWebhooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly connections: ResellerIntegrationsService,
    private readonly inbox: InboxService,
  ) {}

  async receiveReloadly(rawBody: Buffer | undefined, signature: string | undefined, timestamp: string | undefined) {
    if (!reloadlySignatureValid(this.integrations.config.RELOADLY_WEBHOOK_SECRET, rawBody, timestamp, signature)) throw untrusted();
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody!.toString('utf8'));
    } catch {
      // Stored all the same: an admin can look at it, and nothing is acted on without a reference.
    }
    return this.store('reloadly', rawBody!, reloadlyNotice(payload));
  }

  /** Zendit: authenticated by the header value set in the Zendit console; the body only names the order. */
  async receiveZendit(rawBody: Buffer | undefined, token: string | undefined) {
    if (!rawBody || !zenditWebhookValid(this.integrations.config.ZENDIT_WEBHOOK_SECRET, token)) throw untrusted();
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // Stored all the same, as for Reloadly.
    }
    return this.store('zendit', rawBody, zenditNotice(payload));
  }

  /** pawaPay payout callbacks: authenticated by the token in the callback address; the body only names the payout. */
  async receivePawapay(rawBody: Buffer | undefined, token: string | undefined) {
    if (!rawBody || !pawapayCallbackValid(this.integrations.config.PAWAPAY_CALLBACK_TOKEN, token)) throw untrusted();
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // Stored all the same.
    }
    return this.store('pawapay', rawBody, pawapayNotice(payload));
  }

  /** Reloadly, to a reseller's own connection: signed with the webhook secret they saved on it. */
  async receiveOwnReloadly(connectionId: string, rawBody: Buffer | undefined, signature: string | undefined, timestamp: string | undefined) {
    const connection = await this.connections.forNotification(connectionId, 'reloadly');
    if (!connection || !reloadlySignatureValid(connection.credentials.webhook_secret, rawBody, timestamp, signature)) throw untrusted();
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody!.toString('utf8'));
    } catch {
      // Stored all the same, as for BitoCard's own account.
    }
    return this.store('reloadly', rawBody!, reloadlyNotice(payload), connection.id);
  }

  /**
   * DIDWW order callbacks: form fields (`id`, `type`, `status`) signed with the API key over the address DIDWW called,
   * which is our callback base plus the path and query received (the query names our reference).
   */
  async receiveDidww(pathAndQuery: string, fields: unknown, rawBody: Buffer | undefined, signature: string | undefined, connectionId?: string) {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields && typeof fields === 'object' ? fields : {})) if (typeof value === 'string') params[key] = value;
    const url = `${this.integrations.config.DIDWW_CALLBACK_URL.replace(/\/+$/, '')}${pathAndQuery}`;
    // A reseller's own connection signs with their own API key.
    const connection = connectionId ? await this.connections.forNotification(connectionId, 'didww') : null;
    if (connectionId && !connection) throw untrusted();
    const apiKey = connection ? connection.credentials.api_key : this.integrations.config.DIDWW_API_KEY;
    if (!didwwSignatureValid(apiKey, url, params, signature)) throw untrusted();
    const reference = new URL(url).searchParams.get('reference') ?? undefined;
    // The query is part of what is stored (and of the body hash): it is what names the order.
    const stored = Buffer.concat([Buffer.from(`${pathAndQuery}\n`), rawBody ?? Buffer.from(new URLSearchParams(params).toString())]);
    return this.store('didww', stored, didwwNotice(params, reference), connection?.id);
  }

  /**
   * Stores the notification (once per distinct body and destination) and starts processing it after the reply. A
   * connection's notifications hash with its ID, so the same body sent to two accounts is two notifications.
   */
  private async store(supplierCode: string, rawBody: Buffer, notice: { eventType: string | null; reference: string | null; supplierTransactionId: string | null }, connectionId?: string) {
    const hash = createHash('sha256');
    if (connectionId) hash.update(`connection:${connectionId}\n`);
    const bodyHash = hash.update(rawBody).digest('hex');
    // Without the encryption key nothing can be stored safely: refuse, so the supplier retries once it is fixed.
    const bodyEncrypted = this.encryption().encrypt(rawBody.toString('utf8'));
    let row: SupplierWebhook;
    try {
      row = await this.prisma.supplierWebhook.create({
        data: { supplierCode, connectionId: connectionId ?? null, bodyHash, bodyEncrypted, eventType: notice.eventType?.slice(0, 100), reference: notice.reference?.slice(0, 200), supplierTransactionId: notice.supplierTransactionId?.slice(0, 100) },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { received: true, duplicate: true };
      throw error;
    }
    waitUntil(this.process(row.id).catch(error => this.logger.error({ err: error, id: row.id }, 'Supplier notification processing failed')));
    return { received: true };
  }

  /** Processes notifications that are due (the `supplier-webhooks` job), and drops old ones. Safe to run twice. */
  async processDue(now = new Date()) {
    const due = await this.prisma.supplierWebhook.findMany({
      where: { status: { in: ['received', 'unmatched'] }, attempts: { lt: maxAttempts }, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    const outcome = { processed: 0, unmatched: 0, retrying: 0, failed: 0 };
    for (const { id } of due) {
      const status = await this.process(id, now);
      if (status === 'processed') outcome.processed += 1;
      else if (status === 'unmatched') outcome.unmatched += 1;
      else if (status === 'failed') outcome.failed += 1;
      else if (status === 'received') outcome.retrying += 1;
    }
    const removed = await this.prisma.supplierWebhook.deleteMany({
      where: {
        OR: [
          { status: 'processed', receivedAt: { lt: new Date(now.getTime() - keepProcessedMs) } },
          { status: { in: ['unmatched', 'failed'] }, receivedAt: { lt: new Date(now.getTime() - keepOthersMs) } },
        ],
      },
    });
    return { ...outcome, removed: removed.count };
  }

  /** One try: claim it, find the order it names and re-check that order with the supplier. Returns the new status. */
  async process(id: string, now = new Date()): Promise<SupplierWebhookStatus | null> {
    const claimed = await this.prisma.supplierWebhook.updateMany({
      where: { id, status: { in: ['received', 'unmatched'] }, attempts: { lt: maxAttempts }, nextAttemptAt: { lte: now } },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + leaseMs) },
    });
    if (claimed.count === 0) return null;
    const row = await this.prisma.supplierWebhook.findUniqueOrThrow({ where: { id } });
    const retryAt = new Date(now.getTime() + (supplierWebhookRetryMs[row.attempts - 1] ?? supplierWebhookRetryMs.at(-1)!));
    const lastTry = row.attempts >= maxAttempts;
    try {
      const order = await this.orderFor(row);
      if (!order) {
        // The order may not be visible yet (the supplier answered before our write committed): try again later.
        await this.finish(row, { status: 'unmatched', nextAttemptAt: retryAt, lastError: row.reference ? 'No order has this reference' : 'The notification names no order reference' });
        if (lastTry) {
          this.logger.warn({ id, supplier: row.supplierCode }, 'Supplier notification matches no order; kept for admins');
          await this.gaveUp(row, 'matches none of your orders');
        }
        return 'unmatched';
      }
      const after = order.status === 'processing' && order.mode === 'live' ? await this.orders.attempt(order.id, 'check', { scheduled: false }) : order;
      if (after.status === 'processing' && !lastTry) {
        // The supplier has not settled it yet (its records can lag its notification): look again later.
        await this.finish(row, { status: 'received', orderId: order.id, nextAttemptAt: retryAt, lastError: 'Order still pending at the supplier' });
        return 'received';
      }
      // Settled, or out of tries: the order's own scheduled checks carry on from here.
      await this.finish(row, { status: 'processed', orderId: order.id, processedAt: new Date(), lastError: null });
      return 'processed';
    } catch (error) {
      const status: SupplierWebhookStatus = lastTry ? 'failed' : 'received';
      await this.finish(row, { status, nextAttemptAt: retryAt, lastError: (error as Error).message.slice(0, 500) });
      if (lastTry) {
        this.logger.error({ err: error, id }, 'Supplier notification kept failing; kept for admins');
        await this.gaveUp(row, 'could not be processed');
      }
      return status;
    }
  }

  /**
   * Records a try's result, only if no later try has claimed the notification since (a slow try must never overwrite
   * a newer result).
   */
  private finish(row: SupplierWebhook, data: Prisma.SupplierWebhookUpdateManyMutationInput) {
    return this.prisma.supplierWebhook.updateMany({ where: { id: row.id, attempts: row.attempts }, data });
  }

  /** Tells admins (and the reseller, for their own connection) that a notification was given up on. */
  private async gaveUp(row: SupplierWebhook, why: string) {
    const name = connectable(row.supplierCode)?.name ?? row.supplierCode;
    await this.inbox.admins('admin.supplier_notification.failed', {
      subject: row.id,
      title: `${name} notification not processed`,
      body: `A ${name} notification${row.connectionId ? ' to a reseller’s own account' : ''} ${why} after every try. The orders’ own checks continue.`,
      link: '/orders/notifications',
    });
    if (!row.connectionId) return;
    const connection = await this.prisma.resellerConnection.findUnique({ where: { id: row.connectionId }, select: { resellerId: true } });
    if (!connection) return;
    await this.inbox.reseller(connection.resellerId, 'supplier_notification.failed', {
      subject: row.id,
      title: `${name} notification not processed`,
      body: `A notification from your own ${name} account ${why}. Your orders are still checked with ${name} on schedule.`,
      link: '/integrations',
      mode: 'live',
    });
  }

  /**
   * Our order the notification names: by our reference (current or an earlier attempt's), else the supplier's ID. A
   * connection's notification only ever names that connection's own orders; BitoCard's only BitoCard's.
   */
  private async orderFor(row: SupplierWebhook) {
    const scope: Prisma.OrderWhereInput = row.connectionId ? { source: 'own', connectionId: row.connectionId } : { source: 'bitocard' };
    if (row.reference) {
      const current = await this.prisma.order.findFirst({ where: { supplierReference: row.reference, ...scope } });
      if (current) return current.supplierCode === row.supplierCode || (await this.attempted(current.id, row)) ? current : null;
      const earlier = await this.prisma.orderAttempt.findFirst({ where: { reference: row.reference, supplierCode: row.supplierCode }, select: { orderId: true } });
      if (earlier) return this.prisma.order.findFirst({ where: { id: earlier.orderId, ...scope } });
    }
    if (row.supplierTransactionId) return this.prisma.order.findFirst({ where: { supplierCode: row.supplierCode, supplierTransactionId: row.supplierTransactionId, ...scope } });
    return null;
  }

  private async attempted(orderId: string, row: SupplierWebhook) {
    return (await this.prisma.orderAttempt.count({ where: { orderId, supplierCode: row.supplierCode } })) > 0;
  }

  // -- Admin -----------------------------------------------------------------------------------------------------

  async list(filter: { status?: SupplierWebhookStatus; supplier?: string; order_id?: string; connection_id?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 50;
    const rows = await this.prisma.supplierWebhook.findMany({
      where: { status: filter.status, supplierCode: filter.supplier, orderId: filter.order_id, connectionId: filter.connection_id },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => this.present(row)), has_more: rows.length > limit };
  }

  /** A reseller's view: the notifications their own live connection to this supplier received. */
  async listForReseller(resellerId: string, integrationId: string, filter: { limit?: number; starting_after?: string }) {
    const connection = await this.prisma.resellerConnection.findUnique({ where: { resellerId_integrationId_mode: { resellerId, integrationId, mode: 'live' } } });
    if (!connection) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such connection.');
    const page = await this.list({ ...filter, connection_id: connection.id, limit: filter.limit ?? 20 });
    // The connection and supplier are implied; the rest is theirs to see.
    return {
      ...page,
      data: page.data.map(item => {
        const { connection_id, supplier, ...rest } = item;
        void connection_id;
        void supplier;
        return rest;
      }),
    };
  }

  /** Tries an unmatched or failed notification again now (for example after an order was fixed). Audited. */
  async retry(actorId: string | null, id: string) {
    const before = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.supplierWebhook.findUnique({ where: { id } }) : null;
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such supplier notification.');
    if (before.status === 'processed') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_processed', 'This notification has already been processed.');
    await this.prisma.supplierWebhook.update({ where: { id }, data: { status: 'received', attempts: 0, nextAttemptAt: new Date() } });
    await this.process(id);
    const after = await this.prisma.supplierWebhook.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ actorId, action: 'supplier_webhook.retried', targetType: 'supplier_webhook', targetId: id, before: this.present(before), after: this.present(after) });
    return this.present(after);
  }

  /** Never the body: it is encrypted and may carry customer details. */
  present(row: SupplierWebhook) {
    return {
      object: 'supplier_webhook' as const,
      id: row.id,
      supplier: row.supplierCode,
      /** A reseller's own connection it was sent to; null for BitoCard's own account. */
      connection_id: row.connectionId,
      event_type: row.eventType,
      reference: row.reference,
      supplier_transaction_id: row.supplierTransactionId,
      order_id: row.orderId,
      status: row.status,
      attempts: row.attempts,
      last_error: row.lastError,
      next_attempt_at: row.status === 'received' || (row.status === 'unmatched' && row.attempts < maxAttempts) ? row.nextAttemptAt.toISOString() : null,
      received_at: row.receivedAt.toISOString(),
      processed_at: row.processedAt?.toISOString() ?? null,
    };
  }

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Notifications cannot be stored yet.');
    return new Encryption(key);
  }
}

/** Notifications from suppliers. Public (each is signature-checked); the reply comes as soon as it is stored. */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks')
export class SupplierWebhooksController {
  constructor(private readonly webhooks: SupplierWebhooksService) {}

  @Post('reloadly')
  @HttpCode(HttpStatus.OK)
  reloadly(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receiveReloadly(req.rawBody, req.get('x-reloadly-signature'), req.get('x-reloadly-request-timestamp'));
  }

  @Post('zendit')
  @HttpCode(HttpStatus.OK)
  zendit(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receiveZendit(req.rawBody, req.get(zenditWebhookHeader));
  }

  @Post('pawapay')
  @HttpCode(HttpStatus.OK)
  pawapay(@Req() req: Request & { rawBody?: Buffer }, @Query('token') token?: string) {
    return this.webhooks.receivePawapay(req.rawBody, token);
  }

  @Post('didww')
  @HttpCode(HttpStatus.OK)
  didww(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receiveDidww(req.originalUrl, req.body, req.rawBody, req.get('x-didww-signature'));
  }

  /** A reseller's own Reloadly account (the address shown on their connection). */
  @Post('reloadly/:connection')
  @HttpCode(HttpStatus.OK)
  ownReloadly(@Req() req: Request & { rawBody?: Buffer }, @Param('connection') connection: string) {
    return this.webhooks.receiveOwnReloadly(connection, req.rawBody, req.get('x-reloadly-signature'), req.get('x-reloadly-request-timestamp'));
  }

  /** A reseller's own DIDWW account (set on each of their orders). */
  @Post('didww/:connection')
  @HttpCode(HttpStatus.OK)
  ownDidww(@Req() req: Request & { rawBody?: Buffer }, @Param('connection') connection: string) {
    return this.webhooks.receiveDidww(req.originalUrl, req.body, req.rawBody, req.get('x-didww-signature'), connection);
  }
}

class ResellerNotificationFilterDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() starting_after?: string;
}

/** Resellers: what their own supplier accounts notified, and what became of it. */
@ApiTags('Integrations')
@SessionOnly()
@Controller('integrations')
export class ResellerSupplierWebhooksController {
  constructor(private readonly webhooks: SupplierWebhooksService) {}

  @ApiOperation({
    summary: 'List your supplier’s notifications',
    description: 'Order updates your own live supplier account sent to its BitoCard address, newest first, and whether each was matched to one of your orders.',
  })
  @Get(':id/connection/notifications')
  list(@CurrentCaller() caller: Caller, @Param('id') id: string, @Query() filter: ResellerNotificationFilterDto) {
    return this.webhooks.listForReseller(resellerOf(caller), id.trim().toLowerCase(), filter);
  }
}

class SupplierWebhookFilterDto {
  @IsOptional() @IsIn(['received', 'processed', 'unmatched', 'failed']) status?: SupplierWebhookStatus;
  @IsOptional() @IsString() @Length(1, 40) supplier?: string;
  @IsOptional() @IsUUID() order_id?: string;
  @IsOptional() @IsUUID() connection_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() starting_after?: string;
}

/** Admin: every supplier notification and what became of it. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/supplier-webhooks')
export class AdminSupplierWebhooksController {
  constructor(private readonly webhooks: SupplierWebhooksService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list(@Query() filter: SupplierWebhookFilterDto) {
    return this.webhooks.list(filter);
  }

  @AdminRoles('operations')
  @Post(':id/retry')
  retry(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.webhooks.retry(caller.kind === 'session' ? caller.userId : null, id);
  }
}
