import { type CodeChannel, codeNotice } from '../notifications/sms.service.js';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PasswordsService } from '../auth/passwords.service.js';
import { normalisePhone } from '../auth/auth.service.js';
import { nameData, namesGiven, namesOf } from '../auth/names.js';
import { SignupVerificationService } from '../auth/signup-verification.service.js';
import { numericCode, randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Country, type Customer, type CustomerCodePurpose, Prisma, type Store } from '../generated/prisma/client.js';
import { EmailService } from '../notifications/email.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { customerCodeEmail, passwordChangedEmail } from '../notifications/templates.js';
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
    /** First and last name apart, as on their ID; `name_confirmed` false until an older account checks the split. */
    ...namesOf(customer),
    email_verified: customer.emailVerifiedAt !== null,
    phone: customer.phone,
    phone_verified: customer.phoneVerifiedAt !== null,
    phone_verification_available: Boolean(customer.market?.smsProvider),
    /** Udozo: the customer chose to confirm their mobile later, so nothing waits for it. */
    phone_deferred: customer.phoneDeferredAt !== null,
    /** Chosen at sign-up and then fixed: the wallet, checkouts and prices are in its currency. Null until chosen (older accounts). */
    country: customer.country,
    currency: customer.market?.currency ?? null,
    /** Udozo: where they live (an area of their country, apart from their listings'), their date of birth and sex; null until set. */
    area_id: customer.areaId ?? null,
    birth_date: customer.birthDate ? customer.birthDate.toISOString().slice(0, 10) : null,
    sex: (customer.sex ?? null) as CustomerSex | null,
    /** Udozo: Personalise what I see (docs/UDOZO_PERSONALISATION_PLAN.md); off, nothing is recorded about what they look at. */
    personalisation: !customer.personalisationOffAt,
    /** Udozo: their profile photo, or null for their initials. */
    avatar_url: customer.avatarUrl ?? null,
    banner_url: customer.bannerUrl ?? null,
    /** Udozo: their chosen username (their seller page's address), or null until they choose one. */
    username: customer.username ?? null,
    /** Udozo: the random handle of their seller page (its address until they choose a username), so their own page knows them. */
    seller_handle: customer.sellerHandle ?? null,
    created_at: customer.createdAt.toISOString(),
  };
}

/** How a customer describes their sex on their profile (`unspecified`: they would rather not say). */
export const customerSexes = ['female', 'male', 'unspecified'] as const;
export type CustomerSex = (typeof customerSexes)[number];

const youngestAge = 13;

/** A date of birth as `YYYY-MM-DD`: a real date, in the past, from someone at least 13 and at most 120 years old. */
export function birthDateOf(value: string, now = new Date()): Date {
  const date = new Date(`${value}T00:00:00Z`);
  const refuse = (message: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'birth_date_invalid', message, 'birth_date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw refuse('Enter your date of birth as a real date.');
  const years = (from: Date, by: number) => new Date(Date.UTC(from.getUTCFullYear() - by, from.getUTCMonth(), from.getUTCDate()));
  if (date > years(now, youngestAge)) throw refuse(`You must be at least ${youngestAge} years old.`);
  if (date < years(now, 120)) throw refuse('Enter your date of birth as a real date.');
  return date;
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
const emailTaken = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_taken', 'An account with this email already exists. Sign in instead.', 'email');
const phoneInUse = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this number.', 'phone');
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly signups: SignupVerificationService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * A change to the customer's own sign-in (password, mobile): told in their inbox (always pushed) and, for the
   * password, by email, so someone else making it is noticed. Udozo's customers only; never fails the change.
   */
  private async tellSecurity(customer: Pick<Customer, 'id' | 'email' | 'storeId'>, type: 'customer.security.password_changed' | 'customer.security.phone_changed', title: string, body: string) {
    if (this.config.APP_PRODUCT !== 'udozo') return;
    await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, type, { subject: `${type}:${Date.now()}`, title, body, link: '/account/profile' });
    if (type === 'customer.security.password_changed') {
      await this.email.send(passwordChangedEmail(customer.email, 'Udozo')).catch(error => this.logger.warn({ err: error, customerId: customer.id }, 'Could not send the password email'));
    }
  }

  /** Which product this instance serves (Udozo's customers confirm their mobile number at sign-up). */
  get product() {
    return this.config.APP_PRODUCT;
  }

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

  /**
   * The published store at this subdomain where accounts of the house store (bitocard.com, or Udozo's marketplace)
   * work too, or null. BitoCard: its country stores (`countryStore`). Udozo: every published store whose reseller is not
   * suspended, so one Udozo account works on udozo.com and every reseller's store (docs/UDOZO_SPINOFF_PLAN.md, step 3).
   */
  async sharedStore(subdomain: string): Promise<CustomerWithStore['store'] | null> {
    if (this.config.APP_PRODUCT !== 'udozo') return this.countryStore(subdomain);
    const cached = this.countryStores.get(subdomain);
    if (cached && cached.until > Date.now()) return cached.store;
    const found = subdomain === houseSubdomain ? null : await this.prisma.store.findUnique({ where: { subdomain }, include: { reseller: { select: { house: true, status: true } } } });
    const store = found && found.status === 'published' && found.reseller.status !== 'suspended' ? found : null;
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

  /**
   * A market's code, or `market_unavailable`. On Udozo the market must be open for sign-up (`reseller_signup`, the
   * markets udozo.com offers): one added closed cannot be chosen, even by a request the site never sent, until an
   * admin opens it.
   */
  private async marketCode(asked: string) {
    const country = await this.prisma.country.findUnique({ where: { code: asked.toUpperCase() } });
    if (!country || (this.product === 'udozo' && !country.resellerSignup)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'market_unavailable', 'BitoCard does not sell in this country yet.', 'country');
    return country.code;
  }

  /**
   * Whether an account uses this email at the store's accounts, for sign-in's first step (the email, then the password)
   * and sign-up's (`email_taken`). Sign-up says the same, so this tells nobody more than it already could.
   */
  async lookup(store: Store, rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email } }, select: { id: true, passwordHash: true } });
    // `password` false: a Google sign-up, which signs in with Google (or sets a password with Forgot password).
    return { object: 'account_lookup' as const, email, exists: Boolean(customer), password: Boolean(customer?.passwordHash) };
  }

  /** Step-by-step sign-up, step 1: emails a code to an address no account at the store uses yet. */
  async startSignupEmail(store: Store, rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    if ((await this.lookup(store, email)).exists) throw emailTaken();
    await this.signups.start(email, { storeId: store.id, storeName: store.name });
    return { object: 'notice' as const, message: 'A code is on its way.' };
  }

  /** Step 2: the emailed code, exchanged for a one-hour sign-up token for this store's accounts. */
  verifySignupEmail(store: Store, input: { email: string; code: string }) {
    return this.signups.verify(input.email.trim().toLowerCase(), input.code, store.id);
  }

  /**
   * Step 3, after the name and country: texts a code to the mobile number (of that country, used by no account at the
   * store) through the country's SMS provider. `phone_verification_unavailable` where it has none: the number is then
   * kept unconfirmed and nothing waits for it.
   */
  async startSignupPhone(store: Store & { reseller: { house: boolean } }, input: { email: string; signup_token: string; country?: string; phone: string; channel?: CodeChannel }) {
    const country = await this.signupCountry(store, input.country);
    if (!country) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Choose your country.', 'country');
    const phone = normalisePhone(input.phone, country);
    if (await this.prisma.customer.findFirst({ where: { storeId: store.id, phone }, select: { id: true } })) throw phoneInUse();
    const channel = await this.signups.startPhone(input.email.trim().toLowerCase(), input.signup_token, country, phone, store.id, input.channel);
    return { object: 'notice' as const, message: codeNotice(phone, channel), phone, channel };
  }

  verifySignupPhone(store: Store, input: { email: string; signup_token: string; code: string }) {
    return this.signups.verifyPhone(input.email.trim().toLowerCase(), input.signup_token, input.code, store.id);
  }

  /**
   * `phone`, when sent, is validated and normalised exactly as `addPhone` does (a mobile number from the account's own
   * country, in E.164), and stored unverified. On BitoCard no code is sent at sign-up: the customer confirms it later
   * from their account. On Udozo it is required, and texted a code at once through the country's SMS provider (where it
   * has one), which the customer enters after the emailed one before using the account (`phonePendingFor`).
   *
   * With `signup_token` (the step-by-step sign-up: `startSignupEmail` and on) the email is already confirmed, and the
   * number too when its texted code was confirmed for this sign-up, so no code is sent afterwards.
   *
   * `phone_later` (Udozo): the customer chose to confirm the number later (its code did not arrive, or they skipped the
   * step), so it is kept unconfirmed, no code is texted, and the account is usable at once.
   */
  async signup(store: Store & { reseller: { house: boolean } }, input: { email: string; first_name?: string; last_name?: string; name?: string; password: string; country?: string; phone?: string; phone_later?: boolean; signup_token?: string; ref?: string }) {
    const email = input.email.trim().toLowerCase();
    const country = await this.signupCountry(store, input.country);
    await this.passwords.assertAcceptable(input.password);
    const udozo = this.config.APP_PRODUCT === 'udozo' && store.platform !== 'afrippa';
    if (udozo && !input.phone) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Enter your mobile number.', 'phone');
    const phone = input.phone ? normalisePhone(input.phone, country) : null;
    const passwordHash = await this.passwords.hash(input.password);
    let customer: Customer;
    let phoneConfirmed = false;
    try {
      customer = await this.prisma.$transaction(async tx => {
        if (input.signup_token) ({ phoneConfirmed } = await this.signups.consume(tx, email, input.signup_token, phone, store.id));
        const confirmed = input.signup_token ? new Date() : null;
        return tx.customer.create({
          data: {
            storeId: store.id,
            email,
            ...nameData(input),
            country,
            phone,
            passwordHash,
            emailVerifiedAt: confirmed,
            phoneVerifiedAt: phoneConfirmed ? confirmed : null,
            phoneDeferredAt: udozo && !phoneConfirmed && input.phone_later ? new Date() : null,
            signupRef: input.ref ?? null,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (violatedFields(error).some(field => field.includes('phone'))) {
          throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this number.', 'phone');
        }
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_taken', 'An account with this email already exists. Sign in instead.', 'email');
      }
      throw error;
    }
    if (!customer.emailVerifiedAt) await this.sendCode(customer, store, 'email_verification').catch(error => this.logger.warn({ err: error, customerId: customer.id }, 'Could not send the confirmation code'));
    // A delivery problem (or a country that cannot text yet) must not lose the account: the code can be asked for again.
    if (udozo && phone && !phoneConfirmed && !customer.phoneDeferredAt) await this.addPhone({ ...customer, store }, phone).catch(error => this.logger.warn({ err: error, customerId: customer.id }, 'Could not text the sign-up code'));
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
   * Changes the first and last name (which confirms them), and sets the country once for an account from before it was asked (bitocard.com only: a
   * reseller's store is the reseller's country). A country already set never changes (`country_locked`): the wallet
   * and its money are in that country's currency.
   */
  async updateProfile(customer: CustomerWithStore, input: { first_name?: string; last_name?: string; name?: string; country?: string; area_id?: string | null; birth_date?: string | null; sex?: CustomerSex | null }) {
    if (input.country !== undefined) {
      // Their own country sent again is theirs, open for sign-up now or not.
      const code = customer.country && input.country.toUpperCase() === customer.country ? customer.country : await this.marketCode(input.country);
      if (customer.country !== code) {
        if (customer.country || !customer.store.reseller.house) throw countryLocked();
        const set = await this.prisma.customer.updateMany({ where: { id: customer.id, country: null }, data: { country: code } });
        if (set.count === 0) throw countryLocked();
      }
    }
    const about: Prisma.CustomerUncheckedUpdateInput = {};
    if (input.area_id !== undefined) about.areaId = input.area_id === null ? null : await this.homeArea(customer, input.area_id);
    if (input.birth_date !== undefined) about.birthDate = input.birth_date === null ? null : birthDateOf(input.birth_date);
    if (input.sex !== undefined) about.sex = input.sex;
    const updated = await this.prisma.customer.update({ where: { id: customer.id }, data: { ...(namesGiven(input) ? nameData(input) : {}), ...about }, include: { market: true } });
    return presentCustomer(updated);
  }

  /** Where the customer lives: an area (never a whole state) of their own country, switched on. */
  private async homeArea(customer: Customer, id: string) {
    if (!customer.country) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_required', 'Choose your country first.', 'country');
    const area = await this.prisma.classifiedArea.findFirst({ where: { id, country: customer.country, kind: 'area', enabled: true }, select: { id: true } });
    if (!area) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'area_unavailable', 'Choose an area of your country.', 'area_id');
    return area.id;
  }

  /** Needs the current password (wrong ones count towards the sign-in lockout); signs out the customer's other sessions. */
  async changePassword(customer: Customer, sessionId: string, input: { current_password: string; password: string }) {
    // Afrippa's Google-only traders have none until Forgot password sets one.
    if (!customer.passwordHash) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'password_not_set', 'Your account has no password yet. Set one with "Forgot password" first.');
    }
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
    await this.tellSecurity(customer, 'customer.security.password_changed', 'Your password was changed', 'Your other sessions were signed out. If you did not do this, reset your password now.');
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
  async addPhone(customer: Customer & { store?: Pick<Store, 'platform'> }, raw: string, via?: CodeChannel) {
    // A number from the customer's own country only (normalisePhone refuses others, and asks for the country first).
    const phone = normalisePhone(raw, customer.country);
    const taken = await this.prisma.customer.findFirst({ where: { storeId: customer.storeId, phone, id: { not: customer.id } } });
    if (taken) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this number.', 'phone');
    const purpose: CustomerCodePurpose = 'phone_verification';
    const latest = await this.prisma.customerCode.findFirst({ where: { customerId: customer.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    const sentToday = await this.prisma.customerCode.count({ where: { customerId: customer.id, purpose, createdAt: { gt: new Date(Date.now() - 24 * 60 * minute) } } });
    if (sentToday >= 10) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_daily_limit', 'Too many codes were sent today. Try again tomorrow.');
    // Texts already sent to this number today: a resend goes through the market's other provider first.
    const attempt = await this.prisma.customerCode.count({ where: { customerId: customer.id, purpose, target: phone, createdAt: { gt: new Date(Date.now() - 24 * 60 * minute) } } });
    const code = numericCode();
    await this.prisma.$transaction([
      this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.customerCode.create({ data: { customerId: customer.id, purpose, target: phone, codeHash: digest(customer.id, purpose, code), expiresAt: new Date(Date.now() + codeLifetimeMs) } }),
    ]);
    let channel: CodeChannel = 'sms';
    try {
      // Afrippa's traders get Afrippa's text, through Afrippa's own SMS account.
      const afrippa = customer.store?.platform === 'afrippa';
      channel = await this.sms.sendCode(customer.country, { to: phone, code, text: `Your ${afrippa ? 'Afrippa' : 'BitoCard'} code is ${code}. It expires in 30 minutes. Never share it.` }, afrippa ? 'afrippa' : 'bitocard', { attempt, via });
    } catch (error) {
      await this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
      if (error instanceof ApiError) throw error;
      this.logger.error({ err: error }, 'Could not send the customer phone confirmation code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'sms_delivery_failed', 'We could not send the text message. Check the number and try again.');
    }
    return { object: 'notice' as const, message: codeNotice(phone, channel), phone, channel };
  }

  /**
   * Udozo: the customer confirms their mobile later (the code did not arrive, or not now). The account is then usable
   * without it; anything that needs a confirmed mobile still asks, and the profile confirms it any time.
   */
  /**
   * Udozo: the mobile is confirmed later. With `raw`, the number is kept as typed (a mobile of the customer's country,
   * unconfirmed, no code texted), as at sign-up; a confirmed number is never replaced this way.
   */
  async deferPhone(customer: Customer, raw?: string) {
    if (customer.phoneVerifiedAt || (raw === undefined && customer.phoneDeferredAt)) {
      return presentCustomer(await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: { market: true } }));
    }
    const phone = raw === undefined ? undefined : normalisePhone(raw, customer.country);
    const inUse = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this number.', 'phone');
    if (phone && (await this.prisma.customer.findFirst({ where: { storeId: customer.storeId, phone, id: { not: customer.id } }, select: { id: true } }))) throw inUse();
    try {
      const updated = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { phoneDeferredAt: customer.phoneDeferredAt ?? new Date(), ...(phone ? { phone } : {}) },
        include: { market: true },
      });
      return presentCustomer(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw inUse();
      throw error;
    }
  }

  async verifyPhone(customer: Customer, code: string) {
    const phone = await this.consumeCode(customer, 'phone_verification', code);
    if (!phone) throw codeInvalid();
    try {
      const updated = await this.prisma.customer.update({ where: { id: customer.id }, data: { phone, phoneVerifiedAt: new Date() }, include: { market: true } });
      // A confirmed number replaced by another: the customer hears of it, in case it was not them.
      if (customer.phoneVerifiedAt && customer.phone && customer.phone !== phone) {
        await this.tellSecurity(customer, 'customer.security.phone_changed', 'Your mobile number changed', `Your account now uses a number ending ${phone.slice(-4)}. If you did not do this, reset your password now.`);
      }
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
    await this.tellSecurity(customer, 'customer.security.password_changed', 'Your password was reset', 'It was set with the code emailed to you, and every other session was signed out. If you did not do this, reset it again now.');
    return { customer: await this.present(updated), session: await this.startSession(customer.id) };
  }
}
