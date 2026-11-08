import { createHash, randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { houseStoreId } from '../checkout/house.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { WhatsappContact } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { waLink, whatsappConfigured, whatsappDigits } from './cloud-api.js';
import { windowOpen } from './outbox.service.js';

const minuteMs = 60_000;
/** A link code works this long, once. */
export const linkCodeMs = 10 * minuteMs;
/** Link codes a customer may ask for in an hour. */
const linkCodesPerHour = 5;
const codeLetters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** A WhatsApp id (digits) as E.164, the way accounts keep phone numbers. */
export const e164 = (waId: string) => `+${waId.replace(/\D/g, '')}`;

/** The country a number belongs to, from its dialling code. */
export const countryOfNumber = (waId: string) => parsePhoneNumberFromString(e164(waId))?.country ?? null;

export const customerInclude = { store: { include: { reseller: { select: { house: true } } } }, market: true } as const;

/** `LINK ABCD2345`, as the code is sent from udozo.com's link. */
export const linkCodeIn = (text: string) => /^\s*link\s+([a-z0-9]{8})\s*$/i.exec(text)?.[1]?.toUpperCase() ?? null;

/**
 * Who a WhatsApp number is: at most one Udozo account, linked by itself when the number is the account's confirmed
 * mobile, or by a one-time code the customer sends from the number (Profile > WhatsApp on udozo.com). A number makes
 * an account only through WhatsApp's own sign-up (`SignupFlow`). Udozo writes first only to numbers that opted in (connected, or wrote to Udozo); STOP opts out.
 */
@Injectable()
export class WhatsappContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly settings: SettingsService,
    private readonly sms: SmsService,
  ) {}

  /** The contact for a number that wrote to Udozo (made on its first message), linked when its number is an account's confirmed mobile. */
  async inbound(waId: string, profileName: string | null, now = new Date()) {
    const digits = waId.replace(/\D/g, '').slice(0, 20);
    let contact = await this.prisma.whatsappContact.upsert({
      where: { waId: digits },
      create: { waId: digits, profileName, country: countryOfNumber(digits), lastInboundAt: now, optedInAt: now },
      update: { lastInboundAt: now, unreachableAt: null, ...(profileName ? { profileName } : {}) },
    });
    if (!contact.customerId) contact = (await this.autoLink(contact, now)) ?? contact;
    return contact;
  }

  /** Links the number to the account whose confirmed mobile it is (an account already linked elsewhere is left alone). */
  private async autoLink(contact: WhatsappContact, now: Date) {
    const customer = await this.prisma.customer.findFirst({
      where: { storeId: houseStoreId, phone: e164(contact.waId), phoneVerifiedAt: { not: null }, status: 'active', whatsappContact: null },
      select: { id: true, country: true },
    });
    if (!customer) return null;
    try {
      return await this.prisma.whatsappContact.update({ where: { id: contact.id }, data: { customerId: customer.id, linkedAt: now, country: customer.country ?? contact.country } });
    } catch {
      return null;
    }
  }

  /** The customer a contact is linked to, as the classifieds services take them (null if none, or not active). */
  async customerOf(contact: Pick<WhatsappContact, 'customerId'>): Promise<CustomerWithStore | null> {
    if (!contact.customerId) return null;
    const customer = await this.prisma.customer.findUnique({ where: { id: contact.customerId }, include: customerInclude });
    return customer && customer.status === 'active' ? (customer as CustomerWithStore) : null;
  }

  /** Whether WhatsApp is open in a country: the switch on there and Udozo's number set up. */
  async openIn(country: string | null) {
    if (!country || !whatsappConfigured(this.integrations.config)) return false;
    return this.settings.isOnForCountry('whatsapp_channel', country);
  }

  /** For udozo.com's pages (public): whether WhatsApp and wanted requests are open in a country, and Udozo's number. */
  async channels(country: string) {
    const code = country.toUpperCase();
    const digits = whatsappDigits(this.integrations.config);
    const [whatsapp, wanted, codes] = await Promise.all([this.openIn(code), this.settings.isOnForCountry('classifieds_wanted', code), this.sms.codeChannelsFor(code)]);
    // `codes`: a code confirming a mobile can go on WhatsApp (open there, and Meta approved the verification template).
    return { object: 'classified_channels' as const, country: code, whatsapp: { available: whatsapp, number: whatsapp && digits ? `+${digits}` : null, codes: codes.whatsapp }, wanted };
  }

  /** STOP: Udozo writes nothing more until START. */
  optOut(contactId: string, now = new Date()) {
    return this.prisma.whatsappContact.update({ where: { id: contactId }, data: { optedOutAt: now, flow: null, flowState: undefined, flowUpdatedAt: null } });
  }

  optIn(contactId: string, now = new Date()) {
    return this.prisma.whatsappContact.update({ where: { id: contactId }, data: { optedOutAt: null, optedInAt: now } });
  }

  // ---- udozo.com: Profile > WhatsApp ----

  /** The customer's WhatsApp: whether it is open, Udozo's number, whether a number is connected and their choices. */
  async status(customer: CustomerWithStore) {
    const contact = await this.prisma.whatsappContact.findUnique({ where: { customerId: customer.id } });
    const config = this.integrations.config;
    return {
      object: 'whatsapp_connection' as const,
      available: await this.openIn(customer.country),
      number: whatsappDigits(config) ? `+${whatsappDigits(config)}` : null,
      chat_link: waLink(config, 'Hi'),
      connected: Boolean(contact),
      phone: contact ? e164(contact.waId) : null,
      connected_at: contact?.linkedAt?.toISOString() ?? null,
      opted_out: Boolean(contact?.optedOutAt),
      chats: contact?.chatsOn ?? true,
      alerts: contact?.alertsOn ?? true,
      // "Let buyers WhatsApp me directly": Contact seller gives buyers this number (off until they choose it).
      direct: Boolean(contact?.directAt),
      window_open: contact ? windowOpen(contact) : false,
    };
  }

  /** A one-time code to send from their number, and the wa.me link that sends it. */
  async startLink(customer: CustomerWithStore, now = new Date()) {
    if (!(await this.openIn(customer.country))) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'whatsapp_unavailable', 'Udozo is not on WhatsApp in your country yet.');
    const recent = await this.prisma.whatsappLinkCode.count({ where: { customerId: customer.id, createdAt: { gt: new Date(now.getTime() - 60 * minuteMs) } } });
    if (recent >= linkCodesPerHour) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'link_code_limit', 'You asked for several codes in the last hour. Use the last one, or try again later.');
    let code = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      code = Array.from({ length: 8 }, () => codeLetters[randomInt(codeLetters.length)]).join('');
      try {
        await this.prisma.whatsappLinkCode.create({ data: { customerId: customer.id, codeHash: sha256(code), expiresAt: new Date(now.getTime() + linkCodeMs) } });
        break;
      } catch {
        code = '';
      }
    }
    if (!code) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'try_again', 'Try again in a moment.');
    return { object: 'whatsapp_link' as const, code, link: waLink(this.integrations.config, `LINK ${code}`), expires_at: new Date(now.getTime() + linkCodeMs).toISOString() };
  }

  /**
   * `LINK <code>` from a number: the code's account is linked to it (another number it had is let go, as is another
   * account the number had). Their confirmed mobile becomes this number when they have none yet. Null when the code is
   * unknown, used or expired.
   */
  async redeem(contact: WhatsappContact, code: string, now = new Date()) {
    const used = await this.prisma.whatsappLinkCode.updateMany({ where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (!used.count) return null;
    const row = await this.prisma.whatsappLinkCode.findUniqueOrThrow({ where: { codeHash: sha256(code) }, include: { customer: true } });
    const customer = row.customer;
    if (customer.status !== 'active') return null;
    const linked = await this.prisma.$transaction(async tx => {
      await tx.whatsappContact.updateMany({ where: { customerId: customer.id, id: { not: contact.id } }, data: { customerId: null, linkedAt: null, flow: null, flowUpdatedAt: null, directAt: null } });
      // Sharing the number with buyers was another account's choice: a newly tied account chooses again.
      const keepDirect = contact.customerId === customer.id;
      return tx.whatsappContact.update({ where: { id: contact.id }, data: { customerId: customer.id, linkedAt: now, optedInAt: now, optedOutAt: null, country: customer.country ?? contact.country, flow: null, flowUpdatedAt: null, ...(keepDirect ? {} : { directAt: null }) } });
    });
    // Sending the code proved they hold the number: it becomes their confirmed mobile if they have none (never another's).
    if (!customer.phoneVerifiedAt) {
      const taken = await this.prisma.customer.count({ where: { storeId: customer.storeId, phone: e164(contact.waId), id: { not: customer.id } } });
      if (!taken) await this.prisma.customer.update({ where: { id: customer.id }, data: { phone: e164(contact.waId), phoneVerifiedAt: now, phoneDeferredAt: null } });
    }
    return { contact: linked, customer };
  }

  /** "Chats on WhatsApp", "Request alerts on WhatsApp" and "Let buyers WhatsApp me directly". */
  async setPreferences(customer: CustomerWithStore, input: { chats?: boolean; alerts?: boolean; direct?: boolean }, now = new Date()) {
    const contact = await this.prisma.whatsappContact.findUnique({ where: { customerId: customer.id } });
    if (!contact) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'whatsapp_not_connected', 'Connect your WhatsApp first.');
    await this.prisma.whatsappContact.update({
      where: { id: contact.id },
      data: {
        ...(input.chats !== undefined ? { chatsOn: input.chats } : {}),
        ...(input.alerts !== undefined ? { alertsOn: input.alerts } : {}),
        ...(input.direct !== undefined ? { directAt: input.direct ? (contact.directAt ?? now) : null } : {}),
      },
    });
    return this.status(customer);
  }

  /** Lets the number go: nothing more reaches it about the account. */
  async disconnect(customer: CustomerWithStore) {
    await this.prisma.whatsappContact.updateMany({ where: { customerId: customer.id }, data: { customerId: null, linkedAt: null, flow: null, flowUpdatedAt: null, activeConversationId: null, directAt: null } });
    return this.status(customer);
  }

  /** The job: link codes past their time. */
  async purgeCodes(now = new Date()) {
    const removed = await this.prisma.whatsappLinkCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * minuteMs) } } });
    return removed.count;
  }
}
