import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ShopEmails } from './shop-emails.service.js';

const dayMs = 86_400_000;
/** Strikes count over this many days. */
export const strikeWindowDays = 90;
/** A card or mobile money top-up this recent can still be reversed by the payer's bank. */
export const reversibleTopUpMs = 60 * dayMs;

/** "Chinedu  OKAFOR Emeka" and "emeka chinedu okafor" are the same name. */
const nameKey = (name: string | null) => (name ? name.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ') : null);

/**
 * Safe pay's protections against abuse: a buyer and seller who are the same verified person (the same ID document, the
 * same verified name and date of birth, or the same payout bank account) cannot trade with each other; a seller with
 * too many strikes in 90 days (cancelling after accepting, not handing over, disputes lost) cannot take orders until an
 * admin lifts it; and a seller paid by a buyer who topped up by card or mobile money in the last 60 days waits for
 * finance before paying that money out.
 */
@Injectable()
export class SafePayGuardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
  ) {}

  // ---- The same person ----

  /** Refuses Safe pay between two accounts of the same verified person, and tells admins once per pair. */
  async requireDifferentPeople(buyerId: string, sellerId: string) {
    const reason = await this.samePerson(buyerId, sellerId);
    if (!reason) return;
    const [first, second] = [buyerId, sellerId].sort();
    await this.inbox.admins('admin.classifieds.same_person', {
      subject: `${first}:${second}`,
      title: 'Safe pay refused: one person on both sides',
      body: `A buyer and seller on Udozo matched by ${reason.replace(/_/g, ' ')}. Their order was refused; check both accounts.`,
      link: `/storefront/customers/${buyerId}`,
    });
    throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'same_person', 'Safe pay is for trades between two different people, so it cannot be used here.');
  }

  /** Why two accounts are the same person (`id_document`, `name_and_birth_date`, `bank_account`), or null. */
  async samePerson(a: string, b: string) {
    const cases = await this.prisma.kycCase.findMany({
      where: { subject: 'customer', customerReference: { in: [a, b] }, status: { notIn: ['declined'] } },
      select: { customerReference: true, idFingerprint: true, fullName: true, dateOfBirth: true },
    });
    const of = (id: string) => cases.filter(row => row.customerReference === id);
    const prints = new Set(of(a).map(row => row.idFingerprint).filter(Boolean));
    if (of(b).some(row => row.idFingerprint && prints.has(row.idFingerprint))) return 'id_document';
    const people = new Set(of(a).filter(row => row.fullName && row.dateOfBirth).map(row => `${nameKey(row.fullName)}|${row.dateOfBirth}`));
    if (of(b).some(row => row.fullName && row.dateOfBirth && people.has(`${nameKey(row.fullName)}|${row.dateOfBirth}`))) return 'name_and_birth_date';

    const accounts = await this.prisma.customerBankAccount.findMany({ where: { customerId: { in: [a, b] } }, select: { customerId: true, bankCode: true, accountNumberEncrypted: true, accountNumberLast4: true } });
    const left = accounts.filter(row => row.customerId === a);
    const right = accounts.filter(row => row.customerId === b);
    const open = (sealed: string) => {
      try {
        return this.encryption().decrypt(sealed);
      } catch {
        return null;
      }
    };
    for (const one of left) {
      for (const other of right) {
        if (one.bankCode !== other.bankCode || one.accountNumberLast4 !== other.accountNumberLast4) continue;
        const number = open(one.accountNumberEncrypted);
        if (number && number === open(other.accountNumberEncrypted)) return 'bank_account';
      }
    }
    return null;
  }

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(key);
  }

  // ---- Strikes ----

  /** A seller's strikes in the last 90 days (since an admin last lifted their limit) against the country's limit. */
  async standing(sellerId: string, country: string) {
    const [settings, seller] = await Promise.all([
      this.prisma.classifiedSafePaySettings.findUnique({ where: { country }, select: { strikeLimit: true } }),
      this.prisma.classifiedSeller.findUnique({ where: { customerId: sellerId }, select: { safePayClearedAt: true } }),
    ]);
    const window = new Date(Date.now() - strikeWindowDays * dayMs);
    const since = seller?.safePayClearedAt && seller.safePayClearedAt > window ? seller.safePayClearedAt : window;
    const [cancelled, notHandedOver, lost, notAccepted] = await Promise.all([
      this.prisma.classifiedOrder.count({ where: { sellerId, endedBy: 'seller', acceptedAt: { not: null }, status: { in: ['cancelled', 'refunded'] }, OR: [{ closedAt: { gt: since } }, { refundedAt: { gt: since } }] } }),
      this.prisma.classifiedOrder.count({ where: { sellerId, endReason: 'not_handed_over', refundedAt: { gt: since } } }),
      // Lost disputes that were the seller's fault (before stage 5 of reselling every upheld one was).
      this.prisma.classifiedDispute.count({ where: { order: { sellerId }, decision: { in: ['refund', 'partial'] }, OR: [{ fault: null }, { fault: 'supplier' }], decidedAt: { gt: since } } }),
      // Resale orders left to lapse: the buyer's money was locked for nothing.
      this.prisma.classifiedOrder.count({ where: { sellerId, kind: 'resale', status: 'lapsed', endReason: 'not_accepted_in_time', closedAt: { gt: since } } }),
    ]);
    const limit = settings?.strikeLimit ?? 3;
    const strikes = cancelled + notHandedOver + lost + notAccepted;
    return { strikes, strike_limit: limit, limited: strikes >= limit, cancelled_after_accepting: cancelled, not_handed_over: notHandedOver, disputes_lost: lost, resale_not_accepted: notAccepted, cleared_at: seller?.safePayClearedAt?.toISOString() ?? null };
  }

  /** After a strike: a seller who has just reached the limit is told, and so are admins (once until it is lifted). */
  async afterStrike(seller: { id: string; storeId: string }, country: string) {
    const standing = await this.standing(seller.id, country);
    if (!standing.limited) return;
    const subject = `${seller.id}:${standing.cleared_at ?? 'never'}`;
    await this.inbox.customer({ customerId: seller.id, storeId: seller.storeId }, 'customer.classifieds.safe_pay_limited', {
      subject,
      title: 'You cannot take Safe pay orders for now',
      body: `You cancelled, did not accept or hand over, or lost ${standing.strikes} Safe pay orders in ${strikeWindowDays} days. Buyers can still chat with you and pay you directly. Contact Udozo to have it reviewed.`,
      link: '/account/orders',
    });
    this.emails.customer(seller.id, { title: 'You cannot take Safe pay orders for now', body: `You cancelled, did not accept or hand over, or lost ${standing.strikes} Safe pay orders in ${strikeWindowDays} days. Buyers can still chat with you. Contact Udozo to have it reviewed.`, path: '/account/orders' });
    await this.inbox.admins('admin.classifieds.seller_limited', { subject, title: 'A Udozo seller reached the Safe pay strike limit', body: `${standing.strikes} strikes in ${strikeWindowDays} days. Review the seller and lift the limit if it is fair.`, link: `/storefront/customers/${seller.id}` });
  }

  /** `safe_pay_limited` once a seller has reached the strike limit. */
  async requireNotLimited(sellerId: string, country: string, asSeller: boolean) {
    if (!(await this.standing(sellerId, country)).limited) return;
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      'permission_error',
      'safe_pay_limited',
      asSeller ? `You cannot take Safe pay orders for now: too many were cancelled, not handed over or lost in the last ${strikeWindowDays} days. Contact Udozo to have it reviewed.` : 'This seller cannot take Safe pay orders at the moment. You can still chat with them.',
    );
  }

  // ---- Payout review ----

  /** Whether money a buyer pays in may still be reversed: a card or mobile money top-up in the last 60 days (live only). */
  async reversibleFunds(buyerId: string, mode: LedgerMode) {
    if (mode !== 'live') return false;
    const recent = await this.prisma.payment.count({
      where: { customerId: buyerId, purpose: 'customer_top_up', mode, status: 'succeeded', reservedAccountId: null, completedAt: { gt: new Date(Date.now() - reversibleTopUpMs) } },
    });
    return recent > 0;
  }
}
