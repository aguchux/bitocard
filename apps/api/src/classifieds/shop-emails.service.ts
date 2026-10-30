import { Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { PrismaService } from '../database/prisma.service.js';
import type { ClassifiedOrder } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { resaleOrderEmail } from '../notifications/templates.js';

export type OrderEmailAudience = 'buyer' | 'supplier' | 'reseller';
type EmailOrder = Pick<ClassifiedOrder, 'id' | 'kind' | 'mode' | 'storeId' | 'resellerId' | 'buyerId' | 'sellerId'>;

/** New messages are emailed at most this often per conversation and person. */
export const messageEmailEveryMs = 10 * 60 * 1000;

/** A column claimed so a burst of messages sends one email. */
export type EmailThrottle = { model: 'classifiedOrder' | 'resaleRelationship'; id: string; field: string };

const orderField = { buyer: 'buyerEmailedAt', supplier: 'supplierEmailedAt', reseller: 'resellerEmailedAt' } as const;

/** `storeId`: the store the email comes from, when not the customer's own (a resale order's store, as Udozo's one account buys on every store). */
type Notice = { title: string; body: string; path: string; action?: string; sandbox?: boolean; throttle?: EmailThrottle; held?: boolean; storeId?: string };

/**
 * Emails for BitoCard Shop and B2B reselling, beside the inbox and push: every Safe pay order's steps (direct and
 * resale), the supplier and reseller's work together, resellers' resale notices and Shop sellers' listing outcomes.
 * A customer of a reseller's store hears from that store (its name, its own sending domain once verified, links on
 * its main address); bitocard.com's customers from BitoCard Shop; a reseller's owner from BitoCard, linking to SHQ.
 * Messages are emailed without their text, at most every 10 minutes per conversation and person. Emails never carry
 * codes, anyone's contact details or what they wrote. Sent after the reply; a failure is logged, never thrown.
 */
@Injectable()
export class ShopEmails {
  private readonly logger = new Logger(ShopEmails.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** A Safe pay order's step to one side (`message: true` for a new message, without its text). */
  order(order: EmailOrder, to: OrderEmailAudience, input: { title: string; body: string; message?: boolean }) {
    if (to === 'reseller' && !order.resellerId) return;
    const resale = order.kind === 'resale';
    const notice: Notice = {
      title: input.title,
      body: input.message ? 'Open the order to read it and reply.' : input.body,
      sandbox: order.mode === 'test',
      throttle: input.message ? { model: 'classifiedOrder', id: order.id, field: orderField[to] } : undefined,
      path: to === 'reseller' ? `/resale/orders/${order.id}` : to === 'buyer' && resale ? `/account/purchases/${order.id}` : `/account/orders/${order.id}`,
      action: to === 'buyer' ? 'View your order' : 'Open the order',
      held: to === 'buyer',
      ...(to === 'buyer' && resale && order.storeId ? { storeId: order.storeId } : {}),
    };
    if (to === 'reseller') this.reseller(order.resellerId!, notice);
    else this.customer(to === 'buyer' ? order.buyerId : order.sellerId, notice);
  }

  /** A notice to a store customer (a BitoCard Shop seller or buyer, or a Resale shop's buyer), at `path` on their store. */
  customer(customerId: string, notice: Notice) {
    this.later(this.sendCustomer(customerId, notice), customerId);
  }

  /** A notice to a reseller's owner, at `path` in SHQ. */
  reseller(resellerId: string, notice: Notice) {
    this.later(this.sendReseller(resellerId, notice), resellerId);
  }

  private later(work: Promise<unknown>, who: string) {
    waitUntil(work.catch(error => this.logger.warn({ err: error, who }, 'Could not send a Udozo email')));
  }

  private async claim(throttle?: EmailThrottle) {
    if (!throttle) return true;
    const now = new Date();
    const where = { id: throttle.id, OR: [{ [throttle.field]: null }, { [throttle.field]: { lt: new Date(now.getTime() - messageEmailEveryMs) } }] };
    const data = { [throttle.field]: now };
    const claimed = throttle.model === 'classifiedOrder' ? await this.prisma.classifiedOrder.updateMany({ where, data }) : await this.prisma.resaleRelationship.updateMany({ where, data });
    return claimed.count > 0;
  }

  private async sendReseller(resellerId: string, notice: Notice) {
    if (!(await this.claim(notice.throttle))) return;
    const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId, role: 'owner' }, select: { user: { select: { email: true } } } });
    if (!owner) return;
    const link = `${this.integrations.config.DASHBOARD_URL.replace(/\/+$/, '')}${notice.path}`;
    await this.email.send(resaleOrderEmail(owner.user.email, { title: notice.title, body: notice.body, link, action: notice.action ?? 'Open in Seller HQ', signature: 'Udozo.', sandbox: notice.sandbox ?? false }));
  }

  private async sendCustomer(customerId: string, notice: Notice) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { email: true, emailVerifiedAt: true, status: true, storeId: true } });
    if (!customer?.emailVerifiedAt || customer.status !== 'active') return;
    if (!(await this.claim(notice.throttle))) return;
    const store = await this.storeOf(notice.storeId ?? customer.storeId);
    const signature = store.own ? `Sent for ${store.name}.${notice.held ? ' Your payment is held by Udozo until you have the item.' : ''}` : 'Udozo.';
    const message = resaleOrderEmail(customer.email, { title: notice.title, body: notice.body, link: `${store.origin}${notice.path}`, action: notice.action ?? 'Open it', signature, sandbox: notice.sandbox ?? false });
    await this.email.send(message, store.own ? { resellerId: store.resellerId, name: store.name } : undefined);
  }

  /** Where a customer's account lives: a reseller's store (its main address, its name) or BitoCard's own. */
  private async storeOf(storeId: string) {
    const base = new URL(this.integrations.config.STOREFRONT_URL);
    const bitocard = { own: false as const, origin: `${base.protocol}//${base.host}`, name: 'Udozo', resellerId: '' };
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true, subdomain: true, resellerId: true, reseller: { select: { house: true } } } });
    if (!store || store.subdomain === 'bitocard' || store.reseller.house) return bitocard;
    const domain = await this.prisma.storeDomain.findFirst({ where: { storeId, primary: true, status: 'active' }, select: { name: true } });
    return { own: true as const, origin: domain ? `https://${domain.name}` : `${base.protocol}//${store.subdomain}.${base.host}`, name: store.name, resellerId: store.resellerId };
  }
}
