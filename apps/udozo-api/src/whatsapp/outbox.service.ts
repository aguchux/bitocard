import { Inject, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { KycStorage } from '../kyc/storage.js';
import { type OutgoingMessage, WhatsappCloud, WhatsappError } from './cloud-api.js';
import { type TemplateCall, templateLanguage, templateText } from './templates.js';

const minuteMs = 60_000;
/** Free-form messages may be sent this long after the person's last message to Udozo. */
export const windowMs = 24 * 60 * minuteMs;
/** Unclear sends are tried again after these waits, then given up. */
export const retryScheduleMs = [minuteMs, 5 * minuteMs, 30 * minuteMs];
/** At most one template per contact, template and chat in this time (a busy chat sends one, not one per message). */
export const templateEveryMs = 60 * minuteMs;
/** Messages are kept this long. */
export const keepMessagesMs = 90 * 24 * 60 * minuteMs;
/** A send in progress holds its row this long, so two runs never send it twice. */
const leaseMs = 2 * minuteMs;

/** A chat photo is read from the private bucket when it is sent, then uploaded to Meta (never a public link). */
export type QueuedPayload = { message: OutgoingMessage | { type: 'chat_photo'; objectKey: string; contentType: string; caption?: string }; fallback?: TemplateCall; replyTo?: string; /** The answer to STOP itself. */ always?: boolean };

export type QueueOptions = { fallback?: TemplateCall; conversationId?: string | null; classifiedMessageId?: string | null; replyTo?: string; always?: boolean };

export const windowOpen = (contact: { lastInboundAt: Date | null }, now = new Date()) => Boolean(contact.lastInboundAt && now.getTime() - contact.lastInboundAt.getTime() < windowMs);

/** What a queued message says, for the admin's log (never a chat photo's bytes). */
const kindOf = (payload: QueuedPayload) => (payload.message.type === 'chat_photo' ? 'image' : payload.message.type === 'buttons' || payload.message.type === 'list' ? 'interactive' : payload.message.type);

/**
 * Every message Udozo sends on WhatsApp: written to `whatsapp_messages` first (its payload encrypted), then sent after
 * the reply. Inside the person's 24-hour window it goes as written; outside it only its template (when it has one) may
 * go, at most once an hour per chat. Unclear failures are tried again by the `whatsapp` job; a clear refusal fails it,
 * and a number Meta says cannot get messages is not written to again until it writes to Udozo.
 */
@Injectable()
export class WhatsappOutbox {
  private readonly logger = new Logger('WhatsappOutbox');
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly storage: KycStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  cloud() {
    return new WhatsappCloud(this.integrations.config);
  }

  private seal() {
    return new Encryption(String(this.config.ENCRYPTION_KEY));
  }

  /** Queues a message to a contact and sends it after the reply. Its row's id. */
  async queue(contactId: string, message: QueuedPayload['message'], options: QueueOptions = {}) {
    const payload: QueuedPayload = { message, ...(options.fallback ? { fallback: options.fallback } : {}), ...(options.replyTo ? { replyTo: options.replyTo } : {}), ...(options.always ? { always: true } : {}) };
    const row = await this.prisma.whatsappMessage.create({
      data: {
        contactId,
        direction: 'out',
        kind: kindOf(payload),
        status: 'queued',
        conversationId: options.conversationId ?? null,
        classifiedMessageId: options.classifiedMessageId ?? null,
        nextAttemptAt: new Date(),
        payloadEncrypted: this.seal().encrypt(JSON.stringify(payload)),
      },
    });
    this.later(row.id);
    return row.id;
  }

  private later(id: string) {
    const task = this.send(id)
      .catch(error => this.logger.warn({ err: error, message: id }, 'Could not send a WhatsApp message'))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
    waitUntil(task);
  }

  /** Waits for sends still running (tests, and the job before it reads). */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  /** Sends one queued message (claimed first, so a retry and the job never both send it). */
  async send(id: string, now = new Date()) {
    const claimed = await this.prisma.whatsappMessage.updateMany({
      where: { id, status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { nextAttemptAt: new Date(now.getTime() + leaseMs), attempts: { increment: 1 } },
    });
    if (!claimed.count) return;
    const row = await this.prisma.whatsappMessage.findUniqueOrThrow({ where: { id }, include: { contact: true } });
    const fail = (error: string) => this.prisma.whatsappMessage.update({ where: { id }, data: { status: 'failed', error, nextAttemptAt: null, payloadEncrypted: null } });
    const contact = row.contact;
    const payload = JSON.parse(this.seal().decrypt(row.payloadEncrypted!)) as QueuedPayload;
    if (contact.optedOutAt && !payload.always) return fail('opted_out');
    if (contact.unreachableAt) return fail('unreachable');
    const cloud = this.cloud();
    if (!cloud.configured()) return fail('not_configured');

    let template: TemplateCall | null = null;
    if (!windowOpen(contact, now)) {
      if (!payload.fallback) return fail('window_closed');
      template = payload.fallback;
    }
    try {
      const wamid = template ? await this.sendTemplate(cloud, row, template, now) : await this.sendMessage(cloud, contact.waId, payload);
      if (!wamid) return;
      await this.prisma.whatsappMessage.update({
        where: { id },
        data: { status: 'sent', wamid, nextAttemptAt: null, payloadEncrypted: null, error: null, ...(template ? { kind: 'template', template: template.name } : {}) },
      });
    } catch (error) {
      const err = error instanceof WhatsappError ? error : new WhatsappError((error as Error).message, false);
      // The window closed between reading it and sending (Meta knows best): the template goes instead.
      if (err.code === 'window_closed' && !template && payload.fallback) {
        try {
          const wamid = await this.sendTemplate(cloud, row, payload.fallback, now);
          if (wamid) await this.prisma.whatsappMessage.update({ where: { id }, data: { status: 'sent', wamid, kind: 'template', template: payload.fallback.name, nextAttemptAt: null, payloadEncrypted: null, error: null } });
          return;
        } catch (second) {
          return this.failed(row.id, contact.id, second instanceof WhatsappError ? second : new WhatsappError((second as Error).message, false), row.attempts + 1, now);
        }
      }
      return this.failed(row.id, contact.id, err, row.attempts + 1, now);
    }
  }

  private async failed(id: string, contactId: string, error: WhatsappError, attempts: number, now: Date) {
    if (error.code === 'unreachable') await this.prisma.whatsappContact.update({ where: { id: contactId }, data: { unreachableAt: now } });
    if (error.definite || attempts > retryScheduleMs.length) {
      await this.prisma.whatsappMessage.update({ where: { id }, data: { status: 'failed', error: error.message.slice(0, 300), nextAttemptAt: null, payloadEncrypted: null } });
      return;
    }
    await this.prisma.whatsappMessage.update({ where: { id }, data: { error: error.message.slice(0, 300), nextAttemptAt: new Date(now.getTime() + retryScheduleMs[attempts - 1]!) } });
  }

  private async sendMessage(cloud: WhatsappCloud, to: string, payload: QueuedPayload) {
    const message = payload.message;
    if (message.type !== 'chat_photo') return cloud.send(to, message, payload.replyTo);
    const bytes = await this.storage.get(message.objectKey);
    if (!bytes) throw new WhatsappError('the photo is no longer kept', true);
    const mediaId = await cloud.upload(bytes, message.contentType);
    return cloud.send(to, { type: 'image', id: mediaId, caption: message.caption }, payload.replyTo);
  }

  /** A template, unless the same one went to this contact about the same chat within the hour (then nothing). */
  private async sendTemplate(cloud: WhatsappCloud, row: { id: string; contactId: string; conversationId: string | null; contact: { waId: string } }, call: TemplateCall, now: Date) {
    // Claimed under a lock per contact, chat and template, so two messages at once send one template between them.
    const claimed = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wa-template:${row.contactId}:${row.conversationId ?? ''}:${call.name}`}))`;
      const recent = await tx.whatsappMessage.count({
        where: {
          id: { not: row.id },
          contactId: row.contactId,
          conversationId: row.conversationId,
          template: call.name,
          createdAt: { gt: new Date(now.getTime() - templateEveryMs) },
          OR: [{ status: { in: ['sent', 'delivered', 'read'] } }, { status: 'queued', error: 'template_sending' }],
        },
      });
      if (recent) return false;
      await tx.whatsappMessage.update({ where: { id: row.id }, data: { template: call.name, error: 'template_sending' } });
      return true;
    });
    if (!claimed) {
      await this.prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'failed', error: 'template_recently_sent', kind: 'template', template: call.name, nextAttemptAt: null, payloadEncrypted: null } });
      return null;
    }
    return cloud.send(row.contact.waId, { type: 'template', name: call.name, language: templateLanguage, params: call.params, buttonParam: call.payload });
  }

  /** Meta's delivery reports: sent, delivered, read or failed (with why). Never moves a message backwards. */
  async status(wamid: string, status: string, error?: { code?: number; title?: string }) {
    const order = ['queued', 'sent', 'delivered', 'read'];
    const row = await this.prisma.whatsappMessage.findUnique({ where: { wamid }, select: { id: true, status: true, contactId: true } });
    if (!row) return;
    if (status === 'failed') {
      await this.prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'failed', error: `${error?.title ?? 'failed'}${error?.code ? ` (${error.code})` : ''}`.slice(0, 300) } });
      if (error?.code && new WhatsappError('', true, 400, error.code).code === 'unreachable') await this.prisma.whatsappContact.update({ where: { id: row.contactId }, data: { unreachableAt: new Date() } });
      return;
    }
    if (order.indexOf(status) > order.indexOf(row.status)) await this.prisma.whatsappMessage.update({ where: { id: row.id }, data: { status } });
  }

  /** The job: queued messages due a (re)try. */
  async runDue(now = new Date(), limit = 100) {
    const due = await this.prisma.whatsappMessage.findMany({ where: { status: 'queued', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, take: limit, select: { id: true } });
    for (const row of due) await this.send(row.id, now).catch(error => this.logger.warn({ err: error, message: row.id }, 'Could not send a WhatsApp message'));
    return { sent: due.length };
  }

  /** The job: messages older than 90 days. */
  async purge(now = new Date()) {
    const removed = await this.prisma.whatsappMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - keepMessagesMs) } } });
    return removed.count;
  }

  /** What an outgoing template reads like (the admin's log). */
  static describe(call: TemplateCall) {
    return templateText(call);
  }
}
