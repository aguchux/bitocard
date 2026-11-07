import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { WhatsappBot } from './bot.service.js';
import { sameSecret, signatureValid } from './cloud-api.js';
import { readBody } from './inbound.js';
import { WhatsappOutbox } from './outbox.service.js';

const minuteMs = 60_000;
/** A notice that could not be handled is tried again after these waits, then left failed. */
export const noticeRetryMs = [minuteMs, 5 * minuteMs, 30 * minuteMs, 2 * 60 * minuteMs];
/** Handled notices are kept this long. */
export const keepNoticesMs = 30 * 24 * 60 * minuteMs;

/**
 * Meta's webhook for Udozo's number: the verify challenge (the verify token compared in constant time), then every
 * body checked against `X-Hub-Signature-256` with the app secret, stored encrypted once (by its hash, so Meta's retry
 * is stored once) before Meta is answered, and handled after the reply. A body that fails is tried again by the job.
 */
@Injectable()
export class WhatsappNotices {
  private readonly logger = new Logger('WhatsappNotices');
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly bot: WhatsappBot,
    private readonly outbox: WhatsappOutbox,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** GET: Meta checks the address with the verify token and expects the challenge back as it was sent. */
  verify(query: Record<string, string | undefined>) {
    if (query['hub.mode'] === 'subscribe' && sameSecret(query['hub.verify_token'], this.integrations.config.WHATSAPP_VERIFY_TOKEN) && query['hub.challenge']) return query['hub.challenge'].slice(0, 200);
    throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'invalid_verify_token', 'This address could not be verified.');
  }

  async receive(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!signatureValid(rawBody, signature, this.integrations.config.WHATSAPP_APP_SECRET)) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_signature', 'This notification could not be verified.');
    }
    const body = rawBody!.toString('utf8');
    let notice;
    try {
      notice = await this.prisma.whatsappNotice.create({ data: { bodyHash: createHash('sha256').update(body).digest('hex'), bodyEncrypted: new Encryption(String(this.config.ENCRYPTION_KEY)).encrypt(body) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { received: true };
      throw error;
    }
    const task = this.process(notice.id)
      .catch(error => this.logger.warn({ err: error }, 'Could not handle a WhatsApp notice'))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
    waitUntil(task);
    return { received: true };
  }

  /** Waits for notices and the messages they sent (tests). */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    await this.outbox.idle();
  }

  /** Handles one stored body: delivery reports, then each message in order (each message once, by its id). */
  async process(id: string, now = new Date()) {
    const claimed = await this.prisma.whatsappNotice.updateMany({ where: { id, status: 'received', nextAttemptAt: { lte: new Date(now.getTime() + 1000) } }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 5 * minuteMs) } });
    if (!claimed.count) return;
    const notice = await this.prisma.whatsappNotice.findUniqueOrThrow({ where: { id } });
    try {
      const { messages, statuses } = readBody(JSON.parse(new Encryption(String(this.config.ENCRYPTION_KEY)).decrypt(notice.bodyEncrypted)));
      for (const status of statuses) await this.outbox.status(status.wamid, status.status, status.error);
      for (const message of messages.sort((a, b) => a.at.getTime() - b.at.getTime())) await this.bot.handle(message);
      await this.prisma.whatsappNotice.update({ where: { id }, data: { status: 'processed', processedAt: new Date(), lastError: null } });
    } catch (error) {
      const failed = notice.attempts > noticeRetryMs.length;
      await this.prisma.whatsappNotice.update({
        where: { id },
        data: { lastError: (error as Error).message.slice(0, 300), ...(failed ? { status: 'failed' } : { nextAttemptAt: new Date(now.getTime() + noticeRetryMs[notice.attempts - 1]!) }) },
      });
      throw error;
    }
  }

  /** The job: notices due a retry, then handled ones past 30 days. */
  async runDue(now = new Date()) {
    const due = await this.prisma.whatsappNotice.findMany({ where: { status: 'received', nextAttemptAt: { lte: now } }, orderBy: { receivedAt: 'asc' }, take: 50, select: { id: true } });
    for (const row of due) await this.process(row.id, now).catch(() => undefined);
    const removed = await this.prisma.whatsappNotice.deleteMany({ where: { status: { in: ['processed', 'failed'] }, receivedAt: { lt: new Date(now.getTime() - keepNoticesMs) } } });
    return { retried: due.length, removed: removed.count };
  }
}
