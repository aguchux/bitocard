import { Injectable, Logger } from '@nestjs/common';
import { namePattern, tidyName } from '../../auth/names.js';
import { CustomersService } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SignupJourneysService } from '../../signups/journeys.service.js';
import { e164 } from '../contacts.service.js';
import { words } from '../messages.js';
import { WhatsappSignIns } from '../sign-in.service.js';
import { type BotContext, type FlowState, problemText, typed } from './context.js';

type Step = 'terms' | 'first' | 'last' | 'email' | 'code';
type SignupState = FlowState & { step: Step; signInId?: string | null; firstName?: string; lastName?: string; email?: string };

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const isWord = (text: string, ...options: string[]) => options.includes(text.trim().toUpperCase().replace(/[.!]+$/, ''));

/** A first or last name as accounts take it (letters, with spaces, hyphens and apostrophes inside; 1 to 60), or null. */
export function nameFrom(text: string) {
  const name = tidyName(text);
  return name.length >= 1 && name.length <= 60 && namePattern.test(name) ? name : null;
}

/**
 * Making a Udozo account on WhatsApp, step by step: Udozo's terms, the first and last name, the email, then the code
 * Udozo emails to it, typed here. The number it all came from becomes the account's confirmed mobile, and its country
 * the account's (open for sign-up). The account has no password: it signs in with WhatsApp (or sets one with Forgot
 * password). A sign-in udozo.com asked for (`signInId`) is approved once the account is made, so that browser is in.
 */
@Injectable()
export class SignupFlow {
  private readonly logger = new Logger('WhatsappSignup');

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly signIns: WhatsappSignIns,
    private readonly journeys: SignupJourneysService,
  ) {}

  private go(ctx: BotContext, state: SignupState) {
    return ctx.setFlow('signup', state);
  }

  private store() {
    return this.prisma.store.findUniqueOrThrow({ where: { id: this.signIns.storeId } });
  }

  /** JOIN, the menu's Create an account, or a sign-in code from a number with no account yet. */
  async start(ctx: BotContext, signInId: string | null = null) {
    if (ctx.customer) {
      await ctx.setFlow(null);
      return ctx.say({ type: 'text', body: words.alreadyHaveAccount(ctx.customer.firstName ?? ctx.customer.name.split(' ')[0] ?? 'there') });
    }
    const country = ctx.contact.country ? await this.prisma.country.findUnique({ where: { code: ctx.contact.country }, select: { resellerSignup: true } }) : null;
    if (!country?.resellerSignup) return ctx.say({ type: 'text', body: words.signupNotOpen(ctx.site) });
    // An account (perhaps their own, made on udozo.com) already has the number: it signs in its own way, then connects.
    if (await this.prisma.customer.findFirst({ where: { storeId: this.signIns.storeId, phone: e164(ctx.contact.waId) }, select: { id: true } })) {
      return ctx.say({ type: 'text', body: words.numberOnAccount(`${ctx.site}/signin`) });
    }
    await this.go(ctx, { step: 'terms', signInId });
    return ctx.say({ type: 'buttons', body: words.signupIntro(`${ctx.site}/legal/terms`, `${ctx.site}/legal/privacy`), buttons: words.signupStartButtons });
  }

  async step(ctx: BotContext) {
    const state = ctx.state as SignupState;
    const text = typed(ctx);
    const choice = ctx.input.choice ?? '';
    if (choice === 'join:cancel') {
      await ctx.setFlow(null);
      return ctx.say({ type: 'text', body: words.signupCancelled });
    }
    if (ctx.customer) return this.start(ctx);
    if (ctx.input.kind !== 'text' && ctx.input.kind !== 'choice') return ctx.say({ type: 'text', body: words.signupTypeIt });
    switch (state.step) {
      case 'terms':
        if (choice !== 'join:accept' && !isWord(text, 'YES', 'OK', 'I ACCEPT', 'ACCEPT')) {
          return ctx.say({ type: 'buttons', body: words.signupIntro(`${ctx.site}/legal/terms`, `${ctx.site}/legal/privacy`), buttons: words.signupStartButtons });
        }
        await this.go(ctx, { ...state, step: 'first' });
        return ctx.say({ type: 'text', body: words.askFirstName });
      case 'first': {
        const name = nameFrom(text);
        if (!name) return ctx.say({ type: 'text', body: words.nameInvalid('first') });
        await this.go(ctx, { ...state, step: 'last', firstName: name });
        return ctx.say({ type: 'text', body: words.askLastName(name) });
      }
      case 'last': {
        const name = nameFrom(text);
        if (!name) return ctx.say({ type: 'text', body: words.nameInvalid('last') });
        await this.go(ctx, { ...state, step: 'email', lastName: name });
        return ctx.say({ type: 'text', body: words.askEmail });
      }
      case 'email':
        return this.email(ctx, state, text);
      case 'code':
        return this.code(ctx, state, text);
      default:
        return this.start(ctx, state.signInId ?? null);
    }
  }

  /** The email: free at Udozo, then Udozo emails it a code (the sign-up's own, as udozo.com's). */
  private async email(ctx: BotContext, state: SignupState, text: string) {
    const email = text.trim().toLowerCase();
    if (email.length > 254 || !emailPattern.test(email)) return ctx.say({ type: 'text', body: words.emailInvalid });
    try {
      await this.customers.startSignupEmail(await this.store(), email);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'email_taken') return ctx.say({ type: 'text', body: words.emailTaken(`${ctx.site}/signin`) });
      return ctx.say({ type: 'text', body: problemText(error) });
    }
    await this.go(ctx, { ...state, step: 'code', email });
    return ctx.say({ type: 'text', body: words.askEmailCode(email) });
  }

  /** The emailed code: the account is made, tied to this number, and a waiting sign-in approved. */
  private async code(ctx: BotContext, state: SignupState, text: string) {
    if (isWord(text, 'CHANGE', 'CHANGE EMAIL')) {
      await this.go(ctx, { ...state, step: 'email', email: undefined });
      return ctx.say({ type: 'text', body: words.askEmail });
    }
    if (isWord(text, 'RESEND', 'SEND AGAIN')) return this.email(ctx, { ...state, step: 'email' }, state.email ?? '');
    const code = text.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) return ctx.say({ type: 'text', body: words.emailCodeInvalid });
    const store = await this.store();
    const email = state.email ?? '';
    let customer;
    try {
      const verified = await this.customers.verifySignupEmail(store, { email, code });
      const signIn = await this.signIns.waiting(ctx.contact, state.signInId);
      customer = await this.customers.signupWithWhatsapp(store, {
        email,
        first_name: state.firstName ?? '',
        last_name: state.lastName ?? '',
        phone: e164(ctx.contact.waId),
        country: ctx.contact.country ?? '',
        signup_token: verified.signup_token,
        ref: signIn?.ref ?? null,
      });
    } catch (error) {
      await this.journeys.record({ surface: 'udozo', step: 'whatsapp', email, error, country: ctx.contact.country });
      return ctx.say({ type: 'text', body: problemText(error) });
    }
    const now = new Date();
    ctx.contact = await this.prisma.whatsappContact.update({ where: { id: ctx.contact.id }, data: { customerId: customer.id, linkedAt: now, optedInAt: now, optedOutAt: null, country: customer.country ?? ctx.contact.country } });
    await ctx.setFlow(null);
    await this.journeys.record({ surface: 'udozo', step: 'whatsapp', email, country: customer.country, accountId: customer.id });
    const signIn = await this.signIns.waiting(ctx.contact, state.signInId);
    const signedIn = signIn ? await this.signIns.approve(signIn, ctx.contact, customer.id, true, now) : false;
    this.logger.log(`An account was made on WhatsApp${signedIn ? ' and signed in on udozo.com' : ''}`);
    return ctx.say({ type: 'text', body: words.signupDone(customer.firstName ?? 'there', signedIn) });
  }
}
