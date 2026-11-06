import { Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from './email.service.js';
import { noticeEmail } from './templates.js';

export type AccountNotice = { title: string; body: string; path?: string | null; action?: string };

/**
 * Emails about someone's account that sit beside an inbox notice: a store taken offline, an account activated, a role
 * changed, a suspension (when the person can no longer sign in to read the inbox). Sent after the reply and never
 * failing the change; never carrying codes, contact details or anyone's words.
 */
@Injectable()
export class AccountNotices {
  private readonly logger = new Logger(AccountNotices.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly integrations: IntegrationsService,
  ) {}

  private get signature() {
    return this.integrations.config.APP_PRODUCT === 'udozo' ? 'Udozo.' : 'BitoCard, a Golojan Ltd venture.';
  }

  private later(work: () => Promise<unknown>, who: string) {
    waitUntil(work().catch(error => this.logger.warn({ err: error, who }, 'Could not send an account email')));
  }

  private send(to: string, notice: AccountNotice, base: string) {
    return this.email.send(noticeEmail(to, { title: notice.title, body: notice.body, link: notice.path ? `${base.replace(/\/+$/, '')}${notice.path}` : null, action: notice.action, signature: this.signature }));
  }

  /** To a reseller account's owner, linking into Seller HQ. */
  owner(resellerId: string, notice: AccountNotice) {
    this.later(async () => {
      const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId, role: 'owner' }, select: { user: { select: { email: true } } } });
      if (owner) await this.send(owner.user.email, notice, this.integrations.config.DASHBOARD_URL);
    }, resellerId);
  }

  /** To one person: a Seller HQ member (links into Seller HQ) or an admin (links into the admin app). */
  person(userId: string, notice: AccountNotice) {
    this.later(async () => {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, realm: true } });
      if (!user) return;
      await this.send(user.email, notice, user.realm === 'reseller' ? this.integrations.config.DASHBOARD_URL : this.integrations.config.ADMIN_APP_URL);
    }, userId);
  }

  /** To a customer by email, whatever their account's state (a suspended one can no longer read their inbox). */
  customer(customerId: string, notice: AccountNotice) {
    this.later(async () => {
      const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } });
      if (customer) await this.send(customer.email, notice, this.integrations.config.STOREFRONT_URL);
    }, customerId);
  }
}
