import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { houseStoreId } from '../checkout/house-ids.js';
import { ApiError } from '../common/errors/api-error.js';
import { CountriesService } from '../countries/countries.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { resellerTeamEmail } from '../notifications/templates.js';

const missingReseller = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');
const missingCustomer = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such customer.');
const trimmed = (url: string) => url.replace(/\/+$/, '');

/**
 * Moving a person between BitoCard's two kinds of account, from their page in the admin app. Many people sign up as
 * resellers when they only meant to buy, and the other way round.
 *
 * - **A reseller's owner becomes a bitocard.com customer:** a customer account with the same email, name, country and
 *   password (the same Argon2 hash, so the same password signs in), the email confirmed if it was. The reseller account
 *   can be suspended at the same time, but never while BitoCard holds money for it.
 * - **A bitocard.com customer becomes a reseller:** a Seller HQ person with the same email, name and password owning a
 *   new reseller account (pending, so the identity check comes next) in the customer's country. The customer account
 *   stays: they can still buy on bitocard.com.
 *
 * Nothing is deleted either way, and each move is audited and emailed to the person.
 */
@Injectable()
export class AccountSwitchService {
  private readonly logger = new Logger('AccountSwitch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly countries: CountriesService,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
    private readonly integrations: IntegrationsService,
  ) {}

  private async loadReseller(resellerId: string) {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, include: { members: { where: { role: 'owner' }, include: { user: true } } } });
    if (!reseller || reseller.house || reseller.platform !== 'bitocard') throw missingReseller();
    const owner = reseller.members[0]?.user ?? null;
    return { reseller, owner };
  }

  /** Whether BitoCard holds any of the reseller's money, live (wallets, earnings, holds, payouts on their way). */
  private async holdsMoney(resellerId: string) {
    const held = await this.prisma.ledgerAccount.count({ where: { ownerKey: `reseller:${resellerId}`, mode: 'live', balanceMinor: { not: 0n } } });
    return held > 0;
  }

  /** What making the reseller's owner a customer would do: who, whether they are a customer already, and whether the reseller can be suspended. */
  async customerPreview(resellerId: string) {
    const { reseller, owner } = await this.loadReseller(resellerId);
    const existing = owner ? await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: houseStoreId, email: owner.email.toLowerCase() } }, select: { id: true } }) : null;
    const [holdsMoney, publishedStores] = await Promise.all([this.holdsMoney(resellerId), this.prisma.store.count({ where: { resellerId, status: 'published' } })]);
    return {
      object: 'reseller_customer_preview' as const,
      owner: owner ? { name: owner.name, email: owner.email, email_confirmed: Boolean(owner.emailVerifiedAt), has_password: Boolean(owner.passwordHash) } : null,
      /** The bitocard.com customer with the owner's email, if there is one already: nothing new is made then. */
      existing_customer_id: existing?.id ?? null,
      reseller_status: reseller.status,
      /** BitoCard holds live money for the reseller: it cannot be suspended here (pay it out or move it first). */
      holds_money: holdsMoney,
      published_stores: publishedStores,
    };
  }

  /** Makes the reseller's owner a bitocard.com customer, and suspends the reseller account when asked. */
  async makeCustomer(actorId: string | null, resellerId: string, input: { reason: string; suspend_reseller?: boolean }) {
    const { reseller, owner } = await this.loadReseller(resellerId);
    if (!owner) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'owner_missing', 'This reseller has no owner to make a customer.');
    const suspend = input.suspend_reseller === true && reseller.status !== 'suspended';
    if (suspend && (await this.holdsMoney(resellerId))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'reseller_holds_money', 'BitoCard still holds money for this reseller. Pay it out or move it before suspending the account.', 'suspend_reseller');
    }
    const email = owner.email.toLowerCase();
    const country = reseller.country ? ((await this.prisma.country.findUnique({ where: { code: reseller.country }, select: { code: true } }))?.code ?? null) : null;

    let customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: houseStoreId, email } } });
    const created = !customer;
    if (!customer) {
      try {
        customer = await this.prisma.customer.create({
          data: { storeId: houseStoreId, email, name: owner.name, country, passwordHash: owner.passwordHash, emailVerifiedAt: owner.emailVerifiedAt },
        });
      } catch (error) {
        // Two admins at once: the other one made it.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        customer = await this.prisma.customer.findUniqueOrThrow({ where: { storeId_email: { storeId: houseStoreId, email } } });
      }
    }
    if (suspend) await this.prisma.reseller.updateMany({ where: { id: resellerId, status: { not: 'suspended' } }, data: { status: 'suspended' } });

    await this.audit.record({
      actorId,
      action: 'reseller.made_customer',
      targetType: 'reseller',
      targetId: resellerId,
      before: { status: reseller.status },
      after: { customer_id: customer.id, customer_created: created, suspended: suspend, reason: input.reason.trim() },
    });
    const storefront = trimmed(this.integrations.config.STOREFRONT_URL);
    await this.email
      .send(
        resellerTeamEmail(owner.email, {
          subject: 'Your BitoCard customer account is ready',
          heading: 'You can now shop on BitoCard',
          paragraphs: [
            `Hello ${owner.name},`,
            created
              ? 'We have set up a BitoCard customer account for you, so you can buy gift cards, top-ups, bills and more for yourself.'
              : 'You already have a BitoCard customer account with this email, so you can buy gift cards, top-ups, bills and more for yourself.',
            owner.passwordHash && created ? 'Sign in with the same email and password you used for Seller HQ.' : 'Sign in with your email. If you have no password for it yet, choose Forgot password to set one.',
            ...(suspend ? ['Your reseller account on Seller HQ is now closed. If you want to sell again, reply to this email.'] : []),
          ],
          link: { label: 'Sign in', url: `${storefront}/signin` },
        }),
      )
      .catch(error => this.logger.error({ err: error, resellerId }, 'Could not email the new customer'));
    return {
      object: 'account_switch' as const,
      customer: { id: customer.id, email: customer.email, created },
      reseller: { id: resellerId, status: suspend ? ('suspended' as const) : reseller.status },
    };
  }

  private async loadCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.storeId !== houseStoreId) throw missingCustomer();
    return customer;
  }

  /** The Seller HQ person with this email and the reseller account they own, if any. */
  private async resellerPerson(email: string, db: Prisma.TransactionClient = this.prisma) {
    const user =
      (await db.user.findUnique({ where: { realm_email: { realm: 'reseller', email } } })) ??
      (await db.userEmail.findUnique({ where: { realm_email: { realm: 'reseller', email } }, include: { user: true } }))?.user ??
      null;
    const owned = user ? await db.resellerMember.findFirst({ where: { userId: user.id, role: 'owner' }, select: { resellerId: true } }) : null;
    return { user, ownedResellerId: owned?.resellerId ?? null };
  }

  /** What making the customer a reseller would do: whether they are one already, and whether their country is open to resellers. */
  async resellerPreview(customerId: string) {
    const customer = await this.loadCustomer(customerId);
    const { user, ownedResellerId } = await this.resellerPerson(customer.email);
    const country = customer.country ? await this.prisma.country.findUnique({ where: { code: customer.country }, select: { code: true, name: true, resellerSignup: true } }) : null;
    return {
      object: 'customer_reseller_preview' as const,
      customer: { name: customer.name, email: customer.email, email_confirmed: Boolean(customer.emailVerifiedAt), country: customer.country },
      /** They already own a reseller account: nothing new is made. */
      existing_reseller_id: ownedResellerId,
      /** A Seller HQ person with this email exists (they will own the new account; their own password stays). */
      seller_hq_person: Boolean(user),
      /** Reseller sign-up is open in the customer's country. */
      country_open: Boolean(country?.resellerSignup),
      country_name: country?.name ?? null,
    };
  }

  /** Makes the bitocard.com customer the owner of a new, pending reseller account in their country. */
  async makeReseller(actorId: string | null, customerId: string, input: { business_name: string; reason: string }) {
    const customer = await this.loadCustomer(customerId);
    if (!customer.country) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_required', 'This customer has not chosen their country yet.', 'country');
    await this.countries.assertSignupOpen(customer.country);
    const email = customer.email.toLowerCase();
    const businessName = input.business_name.trim();

    const opened = await this.prisma.$transaction(async tx => {
      // Locks the customer's row, so two admins at once open one account.
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
      const { user: existing, ownedResellerId } = await this.resellerPerson(email, tx);
      if (ownedResellerId) {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_reseller', 'This person already owns a reseller account.', 'email');
      }
      const user =
        existing ??
        (await tx.user.create({ data: { realm: 'reseller', email, name: customer.name, passwordHash: customer.passwordHash, emailVerifiedAt: customer.emailVerifiedAt } }));
      const reseller = await tx.reseller.create({ data: { name: businessName, country: customer.country, signupPhone: customer.phone } });
      await tx.resellerMember.create({ data: { resellerId: reseller.id, userId: user.id, role: 'owner' } });
      return { reseller, user, newPerson: !existing };
    });

    await this.audit.record({
      actorId,
      action: 'customer.made_reseller',
      targetType: 'customer',
      targetId: customerId,
      before: null,
      after: { reseller_id: opened.reseller.id, user_id: opened.user.id, new_person: opened.newPerson, business_name: businessName, reason: input.reason.trim() },
    });
    await this.inbox.admins('admin.reseller.signed_up', {
      subject: opened.reseller.id,
      title: `New reseller: ${opened.reseller.name}`,
      body: `${opened.reseller.name} (${opened.reseller.country}) was opened from a bitocard.com customer account. It goes live after the identity check.`,
      link: `/resellers/${opened.reseller.id}`,
    });
    const dashboard = trimmed(this.integrations.config.DASHBOARD_URL);
    await this.email
      .send(
        resellerTeamEmail(customer.email, {
          subject: 'Your BitoCard reseller account is ready',
          heading: 'You can now sell on BitoCard',
          paragraphs: [
            `Hello ${customer.name},`,
            `We have opened a reseller account for ${businessName} on Seller HQ, where you set up your store, choose products and set your prices.`,
            opened.newPerson && customer.passwordHash
              ? 'Sign in with the same email and password you use on bitocard.com.'
              : 'Sign in with your email. If you have no password for Seller HQ yet, choose Forgot password to set one.',
            'Your account goes live after a quick identity check, which Seller HQ will ask for.',
            'Your bitocard.com customer account stays as it is.',
          ],
          link: { label: 'Open Seller HQ', url: `${dashboard}/signin` },
        }),
      )
      .catch(error => this.logger.error({ err: error, customerId }, 'Could not email the new reseller'));
    return {
      object: 'account_switch' as const,
      reseller: { id: opened.reseller.id, name: opened.reseller.name, status: opened.reseller.status },
      user: { id: opened.user.id, created: opened.newPerson },
    };
  }
}
