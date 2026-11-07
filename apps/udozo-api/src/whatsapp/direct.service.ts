import { HttpStatus, Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { ContactRequestsService } from '../classifieds/contact.service.js';
import { addLead } from '../classifieds/leads.service.js';
import { publicName } from '../classifieds/search.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { e164 } from './contacts.service.js';

/** A buyer gets at most this many sellers' WhatsApp numbers (different listings) a day. */
export const directPerDay = 20;
/** Who got a seller's number is kept this long. */
const keepMs = 365 * 86_400_000;

/** The message a buyer's WhatsApp opens with, written for them to send (or change) to the seller. */
export const directGreeting = (title: string, url: string) => `Hi, I saw your listing "${title}" on Udozo: ${url}`;

/** A number as people write it (+234 803 123 4567). */
export const phoneText = (e164: string) => parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;

/** A wa.me link to a number, with the message filled in. */
export const directLink = (waId: string, text: string) => `https://wa.me/${waId.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

export type DirectSeller = { name: string; phone: string; waId: string; firstTime: boolean };

/**
 * **Contact seller** on Udozo's WhatsApp for sellers who chose "Let buyers WhatsApp me directly" (Profile > WhatsApp on
 * udozo.com, off by default): a signed-in buyer is given the seller's public name and their connected WhatsApp number,
 * so they chat on the seller's own number. Only a number the seller connected (proved it is theirs and on WhatsApp),
 * never one opted out of Udozo's messages, never to a buyer the seller blocked, about a live listing in the buyer's
 * market (`ContactRequestsService.contactable`). Each buyer and listing is recorded once: it is a phone lead, counts
 * towards the buyer's `directPerDay`, and tells the seller who has their number (once per buyer). Sellers who did not
 * choose it are asked through the usual contact request.
 */
@Injectable()
export class WhatsappDirect {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactRequests: ContactRequestsService,
    private readonly inbox: InboxService,
  ) {}

  /** The seller's WhatsApp for this buyer and listing, or null when the seller does not share it. */
  async reveal(buyer: CustomerWithStore, listingId: string, now = new Date()): Promise<DirectSeller | null> {
    const listing = await this.contactRequests.contactable(buyer, listingId);
    const seller = await this.prisma.customer.findUnique({
      where: { id: listing.customerId },
      select: { id: true, name: true, status: true, storeId: true, whatsappContact: { select: { waId: true, directAt: true, optedOutAt: true } }, classifiedSeller: { select: { suspendedAt: true } } },
    });
    const contact = seller?.whatsappContact;
    if (!seller || seller.status !== 'active' || seller.classifiedSeller?.suspendedAt || !contact?.directAt || contact.optedOutAt) return null;

    let firstTime = false;
    const known = await this.prisma.whatsappDirectContact.findUnique({ where: { buyerId_listingId: { buyerId: buyer.id, listingId } }, select: { id: true } });
    if (!known) {
      const today = await this.prisma.whatsappDirectContact.count({ where: { buyerId: buyer.id, createdAt: { gt: new Date(now.getTime() - 86_400_000) } } });
      if (today >= directPerDay) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'direct_contact_limit', `You can get ${directPerDay} sellers' numbers a day. Chat with this seller through Udozo instead, or try again tomorrow.`);
      }
      const before = await this.prisma.whatsappDirectContact.count({ where: { sellerId: seller.id, buyerId: buyer.id } });
      try {
        await this.prisma.$transaction(async tx => {
          await tx.whatsappDirectContact.create({ data: { sellerId: seller.id, buyerId: buyer.id, listingId } });
          await addLead(tx, listingId, buyer.id, 'phone');
        });
        firstTime = before === 0;
      } catch (error) {
        // Asked twice at once: the first one recorded it.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    if (firstTime) {
      const name = publicName(buyer.name);
      await this.inbox.customer({ customerId: seller.id, storeId: seller.storeId }, 'customer.classifieds.whatsapp_shared', {
        subject: `${seller.id}:${buyer.id}`,
        title: `${name} has your WhatsApp number`,
        body: `${name} tapped Contact seller about “${listing.title ?? 'your listing'}” and may message you on WhatsApp. You chose to let buyers WhatsApp you directly: turn it off in Profile > WhatsApp.`,
        link: '/account/profile/whatsapp',
      });
    }
    return { name: publicName(seller.name), phone: e164(contact.waId), waId: contact.waId, firstTime };
  }

  /** The job: who got a seller's number, after 12 months. */
  async purge(now = new Date()) {
    const removed = await this.prisma.whatsappDirectContact.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - keepMs) } } });
    return removed.count;
  }
}
