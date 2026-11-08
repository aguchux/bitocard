import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { houseStoreId } from '../checkout/house.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { CustomersService } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { WhatsappContact, WhatsappSignIn } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { SignupJourneysService } from '../signups/journeys.service.js';
import { waLink } from './cloud-api.js';
import { WhatsappContactsService } from './contacts.service.js';

const minuteMs = 60_000;
/** A sign-in waits this long for WhatsApp: long enough to make an account there (names, email and its code). */
export const signInLifetimeMs = 20 * minuteMs;
const codeLetters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type SignInIntent = 'signin' | 'signup';

/** `LOGIN ABCD2345` or `JOIN ABCD2345`, as udozo.com's link fills them in (also SIGNIN and SIGNUP). */
export const signInCodeIn = (text: string) => /^\s*(?:login|log\s*in|signin|sign\s*in|join|signup|sign\s*up)\s+([a-z0-9]{8})\s*$/i.exec(text)?.[1]?.toUpperCase() ?? null;

const refused = (code: string, message: string, status = HttpStatus.BAD_REQUEST) => new ApiError(status, status === HttpStatus.CONFLICT ? 'conflict_error' : 'invalid_request_error', code, message);

/**
 * Signing up and in with WhatsApp. udozo.com asks for a sign-in (`start`): a one-time code the person sends from their
 * WhatsApp to Udozo's number (a wa.me link fills it in), and a token only that browser holds, which it brings back
 * (`finish`) until the sign-in is approved. On WhatsApp the bot binds the code to the number that sent it: a number
 * already tied to an account is asked "Sign in as Kemi on Chrome on Windows?" (`approve`), and one without an account
 * makes one there step by step (`SignupFlow`), which then approves it. The browser that asked is then signed in once.
 */
@Injectable()
export class WhatsappSignIns {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly contacts: WhatsappContactsService,
    private readonly customers: CustomersService,
    private readonly journeys: SignupJourneysService,
  ) {}

  /** udozo.com asks to sign in (or up) with WhatsApp, in the market it shows; `whatsapp_unavailable` where it is not open. */
  async start(input: { intent: SignInIntent; country: string; ref?: string | null; device?: string | null }, now = new Date()) {
    if (!(await this.contacts.openIn(input.country.toUpperCase()))) throw refused('whatsapp_unavailable', 'Udozo is not on WhatsApp in your country yet. Use your email instead.', HttpStatus.CONFLICT);
    const token = `bws_${randomToken()}`;
    const expiresAt = new Date(now.getTime() + signInLifetimeMs);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = Array.from({ length: 8 }, () => codeLetters[randomInt(codeLetters.length)]).join('');
      try {
        await this.prisma.whatsappSignIn.create({ data: { codeHash: sha256(code), tokenHash: sha256(token), intent: input.intent, device: input.device?.slice(0, 60) ?? null, ref: input.ref ?? null, expiresAt } });
        const text = `${input.intent === 'signup' ? 'JOIN' : 'LOGIN'} ${code}`;
        return { object: 'whatsapp_sign_in' as const, intent: input.intent, code, text, link: waLink(this.integrations.config, text), token, expires_at: expiresAt.toISOString() };
      } catch {
        // A code already in use (rare): another.
      }
    }
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'try_again', 'Try again in a moment.');
  }

  /**
   * The browser checks on its sign-in: `waiting` (nothing yet, or the account is still being made on WhatsApp),
   * `declined` or `expired`; once approved, the customer and a new session, once (`used` afterwards, as unknown).
   */
  async finish(token: string, now = new Date()) {
    const row = /^bws_[\w-]{20,}$/.test(token) ? await this.prisma.whatsappSignIn.findUnique({ where: { tokenHash: sha256(token) } }) : null;
    if (!row || row.status === 'used') throw refused('whatsapp_sign_in_unknown', 'That sign-in is over. Start again.');
    if (row.status === 'declined') return { object: 'whatsapp_sign_in_status' as const, status: 'declined' as const };
    if (row.status !== 'approved') return { object: 'whatsapp_sign_in_status' as const, status: row.expiresAt <= now ? ('expired' as const) : ('waiting' as const) };
    // Used once: whoever claims it is signed in.
    const claimed = await this.prisma.whatsappSignIn.updateMany({ where: { id: row.id, status: 'approved' }, data: { status: 'used', usedAt: now } });
    if (!claimed.count || !row.customerId) throw refused('whatsapp_sign_in_unknown', 'That sign-in is over. Start again.');
    const customer = await this.prisma.customer.findUnique({ where: { id: row.customerId } });
    if (!customer || customer.status !== 'active') throw refused('account_disabled', 'This account cannot sign in. Contact Udozo.', HttpStatus.FORBIDDEN);
    await this.prisma.customer.update({ where: { id: customer.id }, data: { lastSignInAt: now } });
    if (!row.signedUp) await this.journeys.record({ surface: 'udozo', step: 'signin', email: customer.email, accountId: customer.id });
    return { object: 'whatsapp_sign_in_status' as const, status: 'approved' as const, customer: await this.customers.present(customer), session: await this.customers.startSession(customer.id), signed_up: row.signedUp };
  }

  /** The bot: a sign-in's code from a number, bound to that number (never to two). Null when unknown, over or another number's. */
  async claim(contact: WhatsappContact, code: string, now = new Date()) {
    const bound = await this.prisma.whatsappSignIn.updateMany({
      where: { codeHash: sha256(code), status: 'waiting', expiresAt: { gt: now }, OR: [{ contactId: null }, { contactId: contact.id }] },
      data: { contactId: contact.id },
    });
    if (!bound.count) return null;
    return this.prisma.whatsappSignIn.findUnique({ where: { codeHash: sha256(code) } });
  }

  /** A waiting sign-in this number holds, by id (its buttons, or the sign-up that finishes it). */
  waiting(contact: WhatsappContact, id: unknown, now = new Date()) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
    return this.prisma.whatsappSignIn.findFirst({ where: { id, contactId: contact.id, status: 'waiting', expiresAt: { gt: now } } });
  }

  /** Signs the browser in as the number's account (once it says yes, or made the account here). */
  async approve(signIn: Pick<WhatsappSignIn, 'id'>, contact: WhatsappContact, customerId: string, signedUp = false, now = new Date()) {
    const approved = await this.prisma.whatsappSignIn.updateMany({
      where: { id: signIn.id, contactId: contact.id, status: 'waiting', expiresAt: { gt: now } },
      data: { status: 'approved', customerId, signedUp, approvedAt: now },
    });
    return approved.count > 0;
  }

  async decline(signIn: Pick<WhatsappSignIn, 'id'>, contact: WhatsappContact) {
    const declined = await this.prisma.whatsappSignIn.updateMany({ where: { id: signIn.id, contactId: contact.id, status: 'waiting' }, data: { status: 'declined' } });
    return declined.count > 0;
  }

  /** The job: sign-ins a day past their time. */
  async purge(now = new Date()) {
    const removed = await this.prisma.whatsappSignIn.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * minuteMs) } } });
    return removed.count;
  }

  /** The store whose accounts WhatsApp makes and signs in: udozo.com's (shared by every store). */
  get storeId() {
    return houseStoreId;
  }
}
