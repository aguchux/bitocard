import { createHash } from 'node:crypto';
import { Controller, Get, HttpCode, HttpStatus, Injectable, Logger, Param, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { waitUntil } from '@vercel/functions';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { AuditService } from '../audit/audit.service.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type SupplierWebhook, type SupplierWebhookStatus } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { didwwNotice, didwwSignatureValid } from '../suppliers/didww.webhooks.js';
import { reloadlyNotice, reloadlySignatureValid } from '../suppliers/reloadly.webhooks.js';
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
 * Supplier notifications (Reloadly and DIDWW). Nothing is lost: each one is verified and stored (encrypted) before it is
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

  /**
   * DIDWW order callbacks: form fields (`id`, `type`, `status`) signed with the API key over the address DIDWW called,
   * which is our callback base plus the path and query received (the query names our reference).
   */
  async receiveDidww(pathAndQuery: string, fields: unknown, rawBody: Buffer | undefined, signature: string | undefined) {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields && typeof fields === 'object' ? fields : {})) if (typeof value === 'string') params[key] = value;
    const url = `${this.integrations.config.DIDWW_CALLBACK_URL.replace(/\/+$/, '')}${pathAndQuery}`;
    if (!didwwSignatureValid(this.integrations.config.DIDWW_API_KEY, url, params, signature)) throw untrusted();
    const reference = new URL(url).searchParams.get('reference') ?? undefined;
    // The query is part of what is stored (and of the body hash): it is what names the order.
    const stored = Buffer.concat([Buffer.from(`${pathAndQuery}\n`), rawBody ?? Buffer.from(new URLSearchParams(params).toString())]);
    return this.store('didww', stored, didwwNotice(params, reference));
  }

  /** Stores the notification (once per distinct body) and starts processing it after the reply. */
  private async store(supplierCode: string, rawBody: Buffer, notice: { eventType: string | null; reference: string | null; supplierTransactionId: string | null }) {
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    // Without the encryption key nothing can be stored safely: refuse, so the supplier retries once it is fixed.
    const bodyEncrypted = this.encryption().encrypt(rawBody.toString('utf8'));
    let row: SupplierWebhook;
    try {
      row = await this.prisma.supplierWebhook.create({
        data: { supplierCode, bodyHash, bodyEncrypted, eventType: notice.eventType?.slice(0, 100), reference: notice.reference?.slice(0, 200), supplierTransactionId: notice.supplierTransactionId?.slice(0, 100) },
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
        if (lastTry) this.logger.warn({ id, supplier: row.supplierCode }, 'Supplier notification matches no order; kept for admins');
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
      if (lastTry) this.logger.error({ err: error, id }, 'Supplier notification kept failing; kept for admins');
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

  /** Our order the notification names: by our reference (current or an earlier attempt's), else the supplier's ID. */
  private async orderFor(row: SupplierWebhook) {
    if (row.reference) {
      const current = await this.prisma.order.findUnique({ where: { supplierReference: row.reference } });
      if (current) return current.supplierCode === row.supplierCode || (await this.attempted(current.id, row)) ? current : null;
      const earlier = await this.prisma.orderAttempt.findFirst({ where: { reference: row.reference, supplierCode: row.supplierCode }, select: { orderId: true } });
      if (earlier) return this.prisma.order.findUnique({ where: { id: earlier.orderId } });
    }
    if (row.supplierTransactionId) return this.prisma.order.findFirst({ where: { supplierCode: row.supplierCode, supplierTransactionId: row.supplierTransactionId } });
    return null;
  }

  private async attempted(orderId: string, row: SupplierWebhook) {
    return (await this.prisma.orderAttempt.count({ where: { orderId, supplierCode: row.supplierCode } })) > 0;
  }

  // -- Admin -----------------------------------------------------------------------------------------------------

  async list(filter: { status?: SupplierWebhookStatus; supplier?: string; order_id?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 50;
    const rows = await this.prisma.supplierWebhook.findMany({
      where: { status: filter.status, supplierCode: filter.supplier, orderId: filter.order_id },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => this.present(row)), has_more: rows.length > limit };
  }

  /** Tries an unmatched or failed notification again now (for example after an order was fixed). Audited. */
  async retry(actorId: string | null, id: string) {
    const before = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.supplierWebhook.findUnique({ where: { id } }) : null;
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'invalid_request_error', 'resource_missing', 'No such supplier notification.');
    if (before.status === 'processed') throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'already_processed', 'This notification has already been processed.');
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

  @Post('didww')
  @HttpCode(HttpStatus.OK)
  didww(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receiveDidww(req.originalUrl, req.body, req.rawBody, req.get('x-didww-signature'));
  }
}

class SupplierWebhookFilterDto {
  @IsOptional() @IsIn(['received', 'processed', 'unmatched', 'failed']) status?: SupplierWebhookStatus;
  @IsOptional() @IsString() @Length(1, 40) supplier?: string;
  @IsOptional() @IsUUID() order_id?: string;
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
