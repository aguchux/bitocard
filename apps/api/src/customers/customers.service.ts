import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PasswordsService } from '../auth/passwords.service.js';
import { normalisePhone } from '../auth/auth.service.js';
import { numericCode, randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Country, type Customer, type CustomerCodePurpose, Prisma, type Store } from '../generated/prisma/client.js';
import { EmailService } from '../notifications/email.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { customerCodeEmail } from '../notifications/templates.js';
import { houseSubdomain } from './store-key.js';

const minute = 60 * 1000;
/** Customers stay signed in for 30 days on the store's own cookie. */
export const customerSessionMs = 30 * 24 * 60 * minute;
const touchEveryMs = 5 * minute;
const codeLifetimeMs = 30 * minute;
const resendAfterMs = minute;
const maxCodeAttempts = 5;
const maxFailedSignIns = 5;
const lockMs = 15 * minute;

/** The header a store's server sends the customer's session token in. */
export const customerSessionHeader = 'bitocard-customer-session';

export type CustomerWithStore = Customer & { store: Store & { reseller: { house: boolean } }; market?: Country | null };

const countryLocked = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_locked', 'Your country is set for good: your wallet and payments are in its currency.', 'country');

/** `market` must be loaded when the customer has a country (`CustomersService.present` does it). */
export function presentCustomer(customer: Customer & { market?: Pick<Country, 'currency' | 'smsProvider'> | null }) {
  return {
    object: 'customer' as const,
    id: customer.id,
    email: customer.email,
    name: customer.name,
    email_verified: customer.emailVerifiedAt !== null,
    phone: customer.phone,
    phone_verified: customer.phoneVerifiedAt !== null,
    phone_verification_available: Boolean(customer.market?.smsProvider),
    /** Chosen at sign-up and then fixed: the wallet, checkouts and prices are in its currency. Null until chosen (older accounts). */
    country: customer.country,
    currency: customer.market?.currency ?? null,
    created_at: customer.createdAt.toISOString(),
  };
}

/**
 * The column names a P2002 unique-constraint violation names, from whichever shape Prisma's Postgres driver adapter
 * reports it in: `meta.target` (an array, or the constraint name as one string) or, with the driver adapter,
 * `meta.driverAdapterError.cause.constraint.fields`.
 */
function violatedFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = error.meta as { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } } } | undefined;
  // The driver names the columns (PGlite) or only the index (Postgres: `customers_store_id_phone_key`); either says which.
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  if (Array.isArray(constraint?.fields)) return constraint.fields.filter((field): field is string => typeof field === 'string');
  if (typeof constraint?.index === 'string') return [constraint.index];
  const target = meta?.target;
  if (Array.isArray(target)) return target.filter((field): field is string => typeof field === 'string');
  return typeof target === 'string' ? [target] : [];
}

const digest = (customerId: string, purpose: CustomerCodePurpose, code: string) => sha256(`customer:${purpose}:${customerId}:${code}`);
const signInFailed = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_credentials', 'The email or password is wrong.');
const codeInvalid = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');

/**
 * Storefront customers: accounts at one store only, owned by the store's reseller (BitoCard's own for bitocard.com).
 * Email and password, with the email confirmed by a 6-digit code before checkout. The store's server holds the session
 * token in its own cookie and sends it to the API in a header; only a hash of it is stored. Codes are emailed under
 * the store's name, single use, 30 minutes, 5 attempts, one resend a minute. Five wrong passwords lock the account for
 * 15 minutes.
 */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger('Customers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
  ) {}

  /** The customer signed in with this token, or null (ended, expired or suspended). */
  async resolve(token: string): Promise<{ customer: CustomerWithStore; sessionId: string; mfaVerifiedAt: Date | null; mfaReconfirmedAt: Date | null } | null> {
    const session = await this.prisma.customerSession.findUnique({ where: { tokenHash: sha256(token) }, include: { customer: { include: { store: { include: { reseller: { select: { house: true } } } }, market: true } } } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.customer.status !== 'active') return null;
    if (Date.now() - session.lastSeenAt.getTime() > touchEveryMs) await this.prisma.customerSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return { customer: session.customer, sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt, mfaReconfirmedAt: session.mfaReconfirmedAt };
  }

  /** Country stores by subdomain, briefly: asked on every signed-in request to one. */
  private readonly countryStores = new Map<string, { store: CustomerWithStore['store'] | null; until: number }>();

  /**
   * The published BitoCard country store at this subdomain (a house account's store other than bitocard.com itself),
   * whose customers are bitocard.com's own; null for anything else.
   */
  async countryStore(subdomain: string): Promise<CustomerWithStore['store'] | null> {
    const cached = this.countryStores.get(subdomain);
    if (cached && cached.until > Date.now()) return cached.store;
    const found = subdomain === houseSubdomain ? null : await this.prisma.store.findUnique({ where: { subdomain }, include: { reseller: { select: { house: true } } } });
    const store = found && found.status === 'published' && found.reseller.house ? found : null;
    this.countryStores.set(subdomain, { store, until: Date.now() + 60_000 });
    return store;
  }

  /** A new 30-day session (sign-in, sign-up, and the handoff from another of BitoCard's sites). */
  async startSession(customerId: string) {
    const token = `bcc_${randomToken()}`;
    const expiresAt = new Date(Date.now() + customerSessionMs);
    await this.prisma.customerSession.create({ data: { customerId, tokenHash: sha256(token), expiresAt } });
    return { token, expires_at: expiresAt.toISOString() };
  }

  /** The customer as the API shows them, with their country's currency. */
  async present(customer: Customer & { market?: Country | null }) {
    const market = customer.market ?? (customer.country ? await this.prisma.country.findUnique({ where: { code: customer.country } }) : null);
    return presentCustomer({ ...customer, market });
  }

  /**
   * The country a new customer is fixed to: on bitocard.com the one they chose (a BitoCard market), on a reseller's
   * store the reseller's (whatever was sent).
   */
  private async signupCountry(store: Store & { reseller: { house: boolean } }, asked: string | undefined) {
    // Afrippa's traders choose their country too: its markets are the same countries.
    if (!store.reseller.house && store.platform !== 'afrippa') {
      const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: store.resellerId }, select: { country: true } });
      return reseller.country;
    }
    if (!asked) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Choose your country.', 'country');
    return this.marketCode(asked);
  }

  /** A BitoCard market's code, or `market_unavailable`. */
  private async marketCode(asked: string) {
    const country = await this.prisma.country.findUnique({ where: { code: asked.toUpperCase() } });
    if (!country) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'market_unavailable', 'BitoCard does not sell in this country yet.', 'country');
    return country.code;
  }

  /**
   * `phone`, when sent, is validated and normalised exactly as `addPhone` does (a mobile number from the account's own
   * country, in E.164), but stored unverified: no code is sent at sign-up, so the customer confirms it later from
   * their account, as any other number they add.
   */
  async signup(store: Store & { reseller: { house: boolean } }, input: { email: string; name: string; password: string; country?: string; phone?: string }) {
    const email = input.email.trim().toLowerCase();
    const country = await this.signupCountry(store, input.country);
    await this.passwords.assertAcceptable(input.password);
    const phone = input.phone ? normalisePhone(input.phone, country) : null;
    let customer: Customer;
    try {
      customer = await this.prisma.customer.create({ data: { storeId: store.id, email, name: input.name.trim(), country, phone, passwordHash: await this.passwords.hash(input.password) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (violatedFields(error).some(field => field.includes('phone'))) {
          throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this number.', 'phone');
        }
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_taken', 'An account with this email already exists. Sign in instead.', 'email');
      }
      throw error;
    }
    await this.sendCode(customer, store, 'email_verification').catch(error => this.logger.warn({ err: error, customerId: customer.id }, 'Could not send the confirmation code'));
    return { customer: await this.present(customer), session: await this.startSession(customer.id) };
  }

  async signin(store: Store, input: { email: string; password: string }) {
    const customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email: input.email.trim().toLowerCase() } } });
    const ok = await this.passwords.verify(customer?.passwordHash ?? null, input.password);
    if (customer?.lockedUntil && customer.lockedUntil > new Date()) {
      // Only someone who knows the password learns the account is locked (as for resellers), so a lock never reveals
      // that an account exists.
      if (ok) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many wrong attempts. Try again in 15 minutes, or reset your password.');
      throw signInFailed();
    }
    if (!customer || !ok || customer.status !== 'active') {
      if (customer) await this.recordFailedSignIn(customer.id);
      throw signInFailed();
    }
    await this.prisma.customer.update({ where: { id: customer.id }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() } });
    return { customer: await this.present(customer), session: await this.startSession(customer.id) };
  }

  /** Counts a wrong password (or two-step code) atomically (parallel guesses each count) and locks the account at the limit. */
  async recordFailedSignIn(customerId: string) {
    const { failedSignIns } = await this.prisma.customer.update({ where: { id: customerId }, data: { failedSignIns: { increment: 1 } }, select: { failedSignIns: true } });
    if (failedSignIns < maxFailedSignIns) return;
    await this.prisma.customer.updateMany({
      where: { id: customerId, failedSignIns: { gte: maxFailedSignIns } },
      data: { failedSignIns: 0, lockedUntil: new Date(Date.now() + lockMs) },
    });
  }

  async signout(sessionId: string) {
    await this.prisma.customerSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { object: 'signed_out' as const };
  }

  /**
   * Changes the name, and sets the country once for an account from before it was asked (bitocard.com only: a
   * reseller's store is the reseller's country). A country already set never changes (`country_locked`): the wallet
   * and its money are in that country's currency.
   */
  async updateProfile(customer: CustomerWithStore, input: { name?: string; country?: string }) {
    if (input.country !== undefined) {
      const code = await this.marketCode(input.country);
      if (customer.country !== code) {
        if (customer.country || !customer.store.reseller.house) throw countryLocked();
        const set = await this.prisma.customer.updateMany({ where: { id: customer.id, country: null }, data: { country: code } });
        if (set.count === 0) throw countryLocked();
      }
    }
    const updated = await this.prisma.customer.update({ where: { id: customer.id }, data: { name: input.name?.trim() }, include: { market: true } });
    return presentCustomer(updated);
  }

  /** Needs the current password (wrong ones count towards the sign-in lockout); signs out the customer's other sessions. */
  async changePassword(customer: Customer, sessionId: string, input: { current_password: string; password: string }) {
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many wrong attempts. Try again in 15 minutes, or reset your password.');
    }
    if (!(await this.passwords.verify(customer.passwordHash, input.current_password))) {
      await this.recordFailedSignIn(customer.id);
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'password_incorrect', 'Your current password is wrong.', 'current_password');
    }
    await this.passwords.assertAcceptable(input.password);
    await this.prisma.$transaction([
      this.prisma.customer.update({ where: { id: customer.id }, data: { passwordHash: await this.passwords.hash(input.password) } }),
      this.prisma.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: new Date() } }),
    ]);
    return this.present(customer);
  }

  // -- Codes -----------------------------------------------------------------------------------------------------

  private async sendCode(customer: Customer, store: Store, purpose: 'email_verification' | 'password_reset') {
    const latest = await this.prisma.customerCode.findFirst({ where: { customerId: customer.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    const code = numericCode();
    await this.prisma.$transaction([
      this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.customerCode.create({ data: { customerId: customer.id, purpose, codeHash: digest(customer.id, purpose, code), expiresAt: new Date(Date.now() + codeLifetimeMs) } }),
    ]);
    try {
      const message = customerCodeEmail(customer.email, { store: store.name, code, purpose });
      // Afrippa's traders hear from Afrippa, through its own email account.
      if (store.platform === 'afrippa') await this.email.sendFor('afrippa', message);
      else await this.email.send(message, { resellerId: store.resellerId, name: store.name });
    } catch (error) {
      // Not sent: cancel it so another can be asked for at once.
      await this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
      throw error;
    }
  }

  /**
   * A new 6-digit code for a purpose (the latest replaces any earlier), sent by the caller. At most one a minute
   * (`code_recently_sent`) and ten a day (`code_daily_limit`).
   */
  async issueCode(customer: Customer, purpose: CustomerCodePurpose, target: string, lifetimeMs = codeLifetimeMs) {
    const latest = await this.prisma.customerCode.findFirst({ where: { customerId: customer.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    const sentToday = await this.prisma.customerCode.count({ where: { customerId: customer.id, purpose, createdAt: { gt: new Date(Date.now() - 24 * 60 * minute) } } });
    if (sentToday >= 10) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_daily_limit', 'Too many codes were sent today. Try again tomorrow.');
    const code = numericCode();
    await this.prisma.$transaction([
      this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.customerCode.create({ data: { customerId: customer.id, purpose, target, codeHash: digest(customer.id, purpose, code), expiresAt: new Date(Date.now() + lifetimeMs) } }),
    ]);
    return code;
  }

  /** Withdraws an unsent code (its delivery failed), so another can be asked for at once. */
  async cancelCode(customerId: string, purpose: CustomerCodePurpose) {
    await this.prisma.customerCode.updateMany({ where: { customerId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  }

  /** Uses a code (5 attempts, claimed before comparing); returns what it was sent to. */
  async consumeCode(customer: Customer, purpose: CustomerCodePurpose, code: string) {
    const record = await this.prisma.customerCode.findFirst({ where: { customerId: customer.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!record) throw codeInvalid();
    if (record.expiresAt <= new Date()) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_expired', 'That code has expired. Ask for a new one.', 'code');
    // Claim an attempt before comparing, in one statement, so parallel guesses can never get past the limit.
    const attempt = await this.prisma.customerCode.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: maxCodeAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count === 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
    if (!sameDigest(record.codeHash, digest(customer.id, purpose, code))) throw codeInvalid();
    const consumed = await this.prisma.customerCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw codeInvalid();
    return record.target;
  }

  /** A customer has one confirmed number. Changing it leaves the old number in place until the new one is confirmed. */
  async addPhone(customer: Customer & { store?: Pick<Store, 'platform'> }, raw: string) {
    // A number from the customer's own country only (normalisePhone refuses others, and asks for the country first).
    const phone = normalisePhone(raw, customer.country);
    const taken = await this.prisma.customer.findFirst({ where: { storeId: customer.storeId, phone, id: { not: customer.id } } });
    if (taken) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this number.', 'phone');
    const purpose: CustomerCodePurpose = 'phone_verification';
    const latest = await this.prisma.customerCode.findFirst({ where: { customerId: customer.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    const sentToday = await this.prisma.customerCode.count({ where: { customerId: customer.id, purpose, createdAt: { gt: new Date(Date.now() - 24 * 60 * minute) } } });
    if (sentToday >= 10) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_daily_limit', 'Too many codes were sent today. Try again tomorrow.');
    const code = numericCode();
    await this.prisma.$transaction([
      this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.customerCode.create({ data: { customerId: customer.id, purpose, target: phone, codeHash: digest(customer.id, purpose, code), expiresAt: new Date(Date.now() + codeLifetimeMs) } }),
    ]);
    try {
      // Afrippa's traders get Afrippa's text, through Afrippa's own SMS account.
      const afrippa = customer.store?.platform === 'afrippa';
      await this.sms.sendForCountry(customer.country, { to: phone, text: `Your ${afrippa ? 'Afrippa' : 'BitoCard'} code is ${code}. It expires in 30 minutes. Never share it.` }, afrippa ? 'afrippa' : 'bitocard');
    } catch (error) {
      await this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
      if (error instanceof ApiError) throw error;
      this.logger.error({ err: error }, 'Could not send the customer phone confirmation code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'sms_delivery_failed', 'We could not send the text message. Check the number and try again.');
    }
    return { object: 'notice' as const, message: `A code is on its way to ${phone}.`, phone };
  }

  async verifyPhone(customer: Customer, code: string) {
    const phone = await this.consumeCode(customer, 'phone_verification', code);
    if (!phone) throw codeInvalid();
    try {
      const updated = await this.prisma.customer.update({ where: { id: customer.id }, data: { phone, phoneVerifiedAt: new Date() }, include: { market: true } });
      return presentCustomer(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this number.', 'phone');
      throw error;
    }
  }

  async resendVerification(customer: CustomerWithStore) {
    if (customer.emailVerifiedAt) return this.present(customer);
    await this.sendCode(customer, customer.store, 'email_verification');
    return this.present(customer);
  }

  async verifyEmail(customer: Customer, code: string) {
    if (customer.emailVerifiedAt) return this.present(customer);
    await this.consumeCode(customer, 'email_verification', code);
    return presentCustomer(await this.prisma.customer.update({ where: { id: customer.id }, data: { emailVerifiedAt: new Date() }, include: { market: true } }));
  }

  /** Always answers the same, so it never reveals whether an account exists. */
  async forgotPassword(store: Store, emailAddress: string) {
    const customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email: emailAddress.trim().toLowerCase() } } });
    if (customer?.status === 'active') {
      await this.sendCode(customer, store, 'password_reset').catch(error => {
        if (!(error instanceof ApiError)) this.logger.warn({ err: error, customerId: customer.id }, 'Could not send the reset code');
      });
    }
    return { object: 'password_reset' as const, sent: true };
  }

  /** Sets a new password with the emailed code, confirms the email (the code proved it), and signs out everywhere else. */
  async resetPassword(store: Store, input: { email: string; code: string; password: string }) {
    const customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email: input.email.trim().toLowerCase() } } });
    if (!customer || customer.status !== 'active') throw codeInvalid();
    // Check the new password first, so a refused one does not use up the emailed code.
    await this.passwords.assertAcceptable(input.password);
    await this.consumeCode(customer, 'password_reset', input.code);
    const updated = await this.prisma.$transaction(async tx => {
      await tx.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.customer.update({
        where: { id: customer.id },
        data: { passwordHash: await this.passwords.hash(input.password), failedSignIns: 0, lockedUntil: null, emailVerifiedAt: customer.emailVerifiedAt ?? new Date() },
      });
    });
    return { customer: await this.present(updated), session: await this.startSession(customer.id) };
  }
}
