import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Notification, NotificationAudience, Prisma } from '../generated/prisma/client.js';
import { PushService } from './push.service.js';
import {
  type AdminNotificationType,
  type CustomerNotificationType,
  notificationTypes,
  type NotificationType,
  type PersonalNotificationType,
  type ResellerNotificationType,
} from './inbox.js';

export type NotificationContent = {
  /** What it is about (an order ID, a connection ID): the same type and subject reach a recipient once. */
  subject: string;
  title: string;
  body: string;
  /** A path in the recipient's app (SHQ, admin, or the customer's store). */
  link?: string | null;
  mode?: LedgerMode | null;
};

/**
 * Whose inbox: a user (admins and reseller staff, who also see the reseller account they are using) or a storefront
 * customer (their one store).
 */
export type Recipient = { userId: string; resellerId?: string | null } | { customerId: string };

/** A storefront customer: an account at one store, owned by that store's reseller. */
export type CustomerRecipient = { customerId: string; storeId: string };

/** Notifications are kept this long. */
const keepMs = 90 * 24 * 3600_000;

type Target = { audience: NotificationAudience; userId?: string; customerId?: string; resellerId: string | null; storeId?: string | null };

/**
 * The in-app notifications inbox for every audience: admins and reseller staff (SHQ and the admin app) by role, and
 * storefront customers (once customer accounts exist). Sending never fails the work that caused it (errors are
 * logged): notifications follow the change, they are not part of it. Each recipient gets their own copy, so reading
 * one is per recipient; each new copy is also pushed to that recipient's registered devices (`PushService`).
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger('Inbox');

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** To the reseller account's owner and the members whose role the type lists. */
  async reseller(resellerId: string, type: ResellerNotificationType, content: NotificationContent) {
    await this.safely(type, async () => {
      const roles = notificationTypes[type].roles as string[];
      const members = await this.prisma.resellerMember.findMany({
        where: { resellerId, user: { status: 'active' }, OR: [{ role: 'owner' }, { role: { in: roles as never } }] },
        select: { userId: true },
      });
      return this.create(
        members.map(member => ({ audience: 'reseller', userId: member.userId, resellerId })),
        type,
        content,
      );
    });
  }

  /** To super admins and the admin roles the type lists. */
  async admins(type: AdminNotificationType, content: NotificationContent) {
    await this.safely(type, async () => {
      const roles = ['super_admin', ...notificationTypes[type].roles];
      const admins = await this.prisma.user.findMany({ where: { realm: 'admin', status: 'active', adminRoles: { hasSome: roles } }, select: { id: true } });
      return this.create(
        admins.map(admin => ({ audience: 'admin', userId: admin.id, resellerId: null })),
        type,
        content,
      );
    });
  }

  /** To one person only (security notices), shown whichever reseller account they are using. */
  async person(userId: string, type: PersonalNotificationType, content: NotificationContent) {
    await this.safely(type, async () => {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { realm: true } });
      return user ? this.create([{ audience: user.realm, userId, resellerId: null }], type, content) : 0;
    });
  }

  /**
   * To one storefront customer, under their store's brand. The content must be written for the customer: the store
   * is the shop they know, so never name BitoCard's suppliers, costs or internal states.
   */
  async customer(recipient: CustomerRecipient, type: CustomerNotificationType, content: NotificationContent) {
    await this.safely(type, async () => {
      const store = await this.prisma.store.findUnique({ where: { id: recipient.storeId }, select: { id: true, resellerId: true } });
      if (!store) return 0;
      return this.create([{ audience: 'customer', customerId: recipient.customerId, storeId: store.id, resellerId: store.resellerId }], type, content);
    });
  }

  private async safely(type: NotificationType, send: () => Promise<number>) {
    try {
      await send();
    } catch (error) {
      this.logger.error({ err: error, type }, 'Could not create the notification');
    }
  }

  private async create(targets: Target[], type: NotificationType, content: NotificationContent) {
    if (targets.length === 0) return 0;
    const created = await this.prisma.notification.createManyAndReturn({
      data: targets.map(target => ({
        audience: target.audience,
        userId: target.userId ?? null,
        customerId: target.customerId ?? null,
        resellerId: target.resellerId,
        storeId: target.storeId ?? null,
        type,
        severity: notificationTypes[type].severity,
        title: content.title.slice(0, 200),
        body: content.body.slice(0, 1000),
        link: content.link ?? null,
        mode: content.mode ?? null,
        dedupeKey: `${type}:${content.subject}`.slice(0, 300),
      })),
      skipDuplicates: true,
    });
    // Only new ones are pushed (a repeat of the same subject is skipped above).
    await this.push.enqueue(created);
    return created.length;
  }

  // -- Reading ---------------------------------------------------------------------------------------------------

  /**
   * A recipient's notifications. Users: those for the reseller account they are using (if any) and their personal
   * ones. Customers: their own.
   */
  private scope(recipient: Recipient): Prisma.NotificationWhereInput {
    if ('customerId' in recipient) return { customerId: recipient.customerId };
    return { userId: recipient.userId, OR: [{ resellerId: null }, ...(recipient.resellerId ? [{ resellerId: recipient.resellerId }] : [])] };
  }

  async list(recipient: Recipient, filter: { unread?: boolean; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 20;
    const where: Prisma.NotificationWhereInput = { ...this.scope(recipient), ...(filter.unread ? { readAt: null } : {}) };
    const after = filter.starting_after ? await this.prisma.notification.findFirst({ where: { id: filter.starting_after, ...this.scope(recipient) } }) : null;
    const rows = await this.prisma.notification.findMany({
      where: after ? { AND: [where, { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }] } : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map(row => this.present(row)),
      has_more: rows.length > limit,
      unread_count: await this.unreadCount(recipient),
    };
  }

  unreadCount(recipient: Recipient) {
    return this.prisma.notification.count({ where: { ...this.scope(recipient), readAt: null } });
  }

  async markRead(recipient: Recipient, id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.notification.findFirst({ where: { id, ...this.scope(recipient) } }) : null;
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such notification.');
    if (row.readAt) return this.present(row);
    return this.present(await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } }));
  }

  async markAllRead(recipient: Recipient) {
    const updated = await this.prisma.notification.updateMany({ where: { ...this.scope(recipient), readAt: null }, data: { readAt: new Date() } });
    return { object: 'notifications_read' as const, updated: updated.count };
  }

  /** Daily: drops notifications older than 90 days. */
  async purge(now = new Date()) {
    const removed = await this.prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - keepMs) } } });
    return { removed: removed.count };
  }

  present(row: Notification) {
    return {
      object: 'notification' as const,
      id: row.id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      body: row.body,
      link: row.link,
      mode: row.mode,
      read: row.readAt !== null,
      read_at: row.readAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }
}
