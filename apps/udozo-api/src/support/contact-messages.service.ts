import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ContactMessage, ContactMessageEntry, Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { contactReceivedEmail, contactReplyEmail } from '../notifications/templates.js';

/** What a Contact us message is about. */
export const contactKinds = ['order', 'safe_pay', 'account', 'selling', 'reselling', 'report', 'partnership', 'other'] as const;
export type ContactKind = (typeof contactKinds)[number];
export const contactStatuses = ['new', 'open', 'waiting', 'resolved', 'spam'] as const;
export type ContactStatus = (typeof contactStatuses)[number];

/** Messages one email address (or one account) may send an hour, so the form cannot be used to flood anyone's inbox. */
export const contactPerHour = 5;
const keepMs = 2 * 365 * 24 * 3600_000;
const keepSpamMs = 30 * 24 * 3600_000;

export const contactReference = (number: number) => `C-${String(number).padStart(6, '0')}`;

type Sender = { kind: ContactKind; name: string; email: string; phone?: string | null; body: string; country?: string | null };
type Author = { id: string | null; name: string };
type Row = ContactMessage & { entries?: ContactMessageEntry[] };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such message.');

/**
 * udozo.com's Contact us form: anyone (signed in or not) writes to Udozo's support team, who work each message in the
 * admin app: its status (new, open, waiting on the sender, resolved, spam), who has it, replies emailed to the sender
 * and notes for the team. The sender is emailed a receipt with the reference; nothing they wrote is ever sent back.
 */
@Injectable()
export class ContactMessagesService {
  private readonly logger = new Logger(ContactMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  present(row: Row, view: 'sender' | 'admin' = 'admin') {
    const reference = contactReference(row.number);
    if (view === 'sender') return { object: 'contact_message' as const, reference, kind: row.kind, created_at: row.createdAt.toISOString() };
    return {
      object: 'contact_message' as const,
      id: row.id,
      reference,
      kind: row.kind,
      status: row.status,
      name: row.name,
      email: row.email,
      phone: row.phone,
      body: row.body,
      country: row.country,
      customer_id: row.customerId,
      assignee_id: row.assigneeId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      replied_at: row.repliedAt?.toISOString() ?? null,
      resolved_at: row.resolvedAt?.toISOString() ?? null,
      entries: row.entries?.map(entry => ({ id: entry.id, kind: entry.kind, author_name: entry.authorName, body: entry.body, created_at: entry.createdAt.toISOString() })),
    };
  }

  /** A message from the form: kept, the team told, and the sender emailed its reference. */
  async submit(input: Sender, customerId: string | null) {
    const email = input.email.trim().toLowerCase();
    const since = new Date(Date.now() - 3600_000);
    const recent = await this.prisma.contactMessage.count({ where: { createdAt: { gte: since }, OR: [{ email }, ...(customerId ? [{ customerId }] : [])] } });
    if (recent >= contactPerHour) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'contact_limit', 'You have sent us several messages in the last hour. We will reply to those first.');
    }
    const row = await this.prisma.contactMessage.create({
      data: { kind: input.kind, name: input.name.trim(), email, phone: input.phone?.trim() || null, body: input.body.trim(), country: input.country ?? null, customerId },
    });
    const reference = contactReference(row.number);
    await this.inbox.admins('admin.support.contact_message', {
      subject: row.id,
      title: `New message: ${kindLabels[row.kind as ContactKind]} (${reference})`,
      body: `${row.name} wrote through Contact us.`,
      link: `/support/contact/${row.id}`,
    });
    await this.send(contactReceivedEmail(email, { name: row.name, reference }), 'receipt');
    return this.present(row, 'sender');
  }

  async list(filter: { status?: ContactStatus | 'active'; kind?: ContactKind; assignee?: string; q?: string; limit?: number; offset?: number }) {
    const where: Prisma.ContactMessageWhereInput = {};
    if (filter.status === 'active') where.status = { in: ['new', 'open', 'waiting'] };
    else if (filter.status) where.status = filter.status;
    if (filter.kind) where.kind = filter.kind;
    if (filter.assignee === 'none') where.assigneeId = null;
    else if (filter.assignee) where.assigneeId = filter.assignee;
    const q = filter.q?.trim();
    if (q) {
      const number = Number(q.replace(/^C-?/i, ''));
      where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }, ...(Number.isInteger(number) && number > 0 ? [{ number }] : [])];
    }
    const take = filter.limit ?? 50;
    const [rows, total, counts] = await Promise.all([
      this.prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip: filter.offset ?? 0 }),
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(contactStatuses.map(status => [status, counts.find(row => row.status === status)?._count._all ?? 0]));
    return { object: 'list' as const, data: rows.map(row => this.present(row)), total, counts: byStatus };
  }

  async get(id: string) {
    const row = await this.prisma.contactMessage.findUnique({ where: { id }, include: { entries: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw notFound();
    return this.present(row);
  }

  /** The team replies: emailed to the sender, kept on the message, which then waits for them. */
  async reply(id: string, author: Author, body: string) {
    const row = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (row.status === 'spam') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'contact_spam', 'This message is marked as spam: mark it open before replying.');
    const reference = contactReference(row.number);
    const sent = await this.send(contactReplyEmail(row.email, { name: row.name, reference, reply: body }), 'reply');
    if (!sent) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'email_unavailable', 'The reply could not be emailed. Try again in a moment.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.contactMessageEntry.create({ data: { messageId: id, kind: 'reply', authorId: author.id, authorName: author.name, body: body.trim() } }),
      this.prisma.contactMessage.update({ where: { id }, data: { status: 'waiting', repliedAt: now, resolvedAt: null, assigneeId: row.assigneeId ?? author.id } }),
    ]);
    await this.audit.record({ actorId: author.id, action: 'contact_message.replied', targetType: 'contact_message', targetId: id, before: { status: row.status }, after: { status: 'waiting' } });
    return this.get(id);
  }

  /** A note for the team only; a new message becomes open. */
  async note(id: string, author: Author, body: string) {
    const row = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!row) throw notFound();
    await this.prisma.$transaction([
      this.prisma.contactMessageEntry.create({ data: { messageId: id, kind: 'note', authorId: author.id, authorName: author.name, body: body.trim() } }),
      ...(row.status === 'new' ? [this.prisma.contactMessage.update({ where: { id }, data: { status: 'open' } })] : [this.prisma.contactMessage.update({ where: { id }, data: { updatedAt: new Date() } })]),
    ]);
    return this.get(id);
  }

  /** Status and assignee: `assignee_id` null takes it off whoever had it. */
  async update(id: string, author: Author, input: { status?: ContactStatus; assignee_id?: string | null }) {
    const row = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!row) throw notFound();
    const data: Prisma.ContactMessageUpdateInput = {};
    if (input.status && input.status !== row.status) {
      data.status = input.status;
      data.resolvedAt = input.status === 'resolved' ? new Date() : null;
    }
    if (input.assignee_id !== undefined && input.assignee_id !== row.assigneeId) {
      if (input.assignee_id) {
        const admin = await this.prisma.user.findFirst({ where: { id: input.assignee_id, realm: 'admin', status: 'active' }, select: { id: true } });
        if (!admin) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose an active admin.', 'assignee_id');
      }
      data.assigneeId = input.assignee_id;
      // Taking a new message starts work on it.
      if (input.assignee_id && row.status === 'new' && !input.status) data.status = 'open';
    }
    if (!Object.keys(data).length) return this.get(id);
    await this.prisma.contactMessage.update({ where: { id }, data });
    await this.audit.record({ actorId: author.id, action: 'contact_message.updated', targetType: 'contact_message', targetId: id, before: { status: row.status, assignee_id: row.assigneeId }, after: { status: data.status ?? row.status, assignee_id: data.assigneeId ?? row.assigneeId } });
    return this.get(id);
  }

  /** The daily `support` job: messages quiet for two years, and spam after 30 days. */
  async purgeOld(now = new Date()) {
    const old = await this.prisma.contactMessage.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - keepMs) } } });
    const spam = await this.prisma.contactMessage.deleteMany({ where: { status: 'spam', updatedAt: { lt: new Date(now.getTime() - keepSpamMs) } } });
    return old.count + spam.count;
  }

  private async send(message: Parameters<EmailService['send']>[0], what: string) {
    try {
      await this.email.send(message);
      return true;
    } catch (error) {
      this.logger.warn(`Contact message ${what} email failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return false;
    }
  }
}

/** The form's words for each kind, in Udozo's admin notices too. */
export const kindLabels: Record<ContactKind, string> = {
  order: 'An order',
  safe_pay: 'UdozoPay',
  account: 'My account',
  selling: 'Selling',
  reselling: 'Reselling on Seller HQ',
  report: 'Reporting a person or listing',
  partnership: 'Partnerships and press',
  other: 'Something else',
};
