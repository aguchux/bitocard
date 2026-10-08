import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { numericCode, randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Order, type OrderAccess, type OrderDelivery, Prisma, type Product, type Reseller, type Store } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { minor } from '../ledger/mode.js';
import { EmailService } from '../notifications/email.service.js';
import { orderAccessCodeEmail, orderRevealedEmail } from '../notifications/templates.js';

const minute = 60_000;
/** Access links: `bca_` and 32 random bytes, base64url. */
const tokenPattern = /^bca_[A-Za-z0-9_-]{40,60}$/;
/** Deliveries whose code and PIN are secrets: hidden until the customer presses Reveal. */
const secretKinds = new Set(['gift_card', 'licence_key', 'token']);
/** What the page may show of the recipient: what the customer typed, nothing BitoCard added. */
const recipientFields = ['phone', 'account_number', 'account_name', 'current_package', 'email'] as const;
const codeLifetimeMs = 10 * minute;
const resendAfterMs = minute;
const maxCodesPerDay = 10;
const maxCodeAttempts = 5;
/** How long a confirmed code opens the order on that device. */
export const accessPassMs = 30 * minute;
const alertEveryMs = 24 * 60 * minute;

/** How the customer proves an order is theirs: signed in at its store, a code to the order's email, or no way (the store has the codes). */
export type AccessMethod = 'customer' | 'email' | 'none';
/** What the store's server sends: the customer's session (hosted stores) and/or an access pass from a confirmed code. */
export type AccessProof = { customerSession?: string; pass?: string };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This link is not valid. Ask the store for a new one.');
const proofRequired = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'access_required', 'Sign in, or enter the code we email you, to see this order.');
const codeInvalid = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');

type AccessOrder = Order & { product: Product; deliveries: OrderDelivery[]; reseller: Reseller & { stores: Store[] } };
type AccessRow = OrderAccess & { order: AccessOrder };

/** `a***@example.com`: enough for the customer to recognise their address, never the whole of it. */
export function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return domain ? `${local.slice(0, 1)}***@${domain}` : '***';
}

/**
 * Order pages. Every order has one permanent link (`/a/<token>` on its store's address, a neutral page on
 * bitocard.com for resellers without a hosted store), made the first time it is needed. The link only points at the
 * order: its page shows the order only to the customer who proves it is theirs, signed in at the store it was bought
 * from (hosted stores), or with a code emailed to the order's address (resellers' own systems; a 30-minute pass on
 * that device). Without either, it shows nothing but the store's name. Codes stay hidden until Reveal, which is
 * unlimited for that customer, recorded, and followed by an email to them at most once a day. Replacing the link ends
 * the old one and every pass.
 */
@Injectable()
export class OrderAccessService {
  private readonly logger = new Logger('OrderAccess');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly email: EmailService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  // -- The link, for the reseller -----------------------------------------------------------------------------------

  /** The order's link for its reseller (made once, on first use). */
  async link(order: Pick<Order, 'id' | 'resellerId'>) {
    let row = await this.prisma.orderAccess.findUnique({ where: { orderId: order.id } });
    if (!row) {
      const token = `bca_${randomToken()}`;
      try {
        row = await this.prisma.orderAccess.create({ data: { orderId: order.id, tokenHash: sha256(token), tokenEncrypted: this.encryption().encrypt(token) } });
      } catch (error) {
        // Made at the same moment by another request: use that one.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        row = await this.prisma.orderAccess.findUniqueOrThrow({ where: { orderId: order.id } });
      }
    }
    return this.presentLink(row, await this.urlFor(order.resellerId, this.encryption().decrypt(row.tokenEncrypted)));
  }

  /** A new link for the order; the old one, and every pass made with it, stop working at once. */
  async replace(resellerId: string, mode: Order['mode'], orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, resellerId, mode }, select: { id: true, resellerId: true } });
    if (!order) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such order.');
    await this.link(order);
    const token = `bca_${randomToken()}`;
    const row = await this.prisma.$transaction(async tx => {
      await tx.orderAccessCode.updateMany({ where: { orderId, consumedAt: null }, data: { consumedAt: new Date() } });
      return tx.orderAccess.update({ where: { orderId }, data: { tokenHash: sha256(token), tokenEncrypted: this.encryption().encrypt(token), replacedAt: new Date() } });
    });
    return this.presentLink(row, await this.urlFor(resellerId, token));
  }

  private presentLink(row: OrderAccess, url: string) {
    return { object: 'order_access_link' as const, url, revealed_at: row.revealedAt?.toISOString() ?? null, replaced_at: row.replacedAt?.toISOString() ?? null };
  }

  /** On the reseller's published hosted store; otherwise BitoCard's store address (a neutral page). */
  private async urlFor(resellerId: string, token: string) {
    const base = new URL(this.integrations.config.STOREFRONT_URL);
    const store = await this.prisma.store.findFirst({ where: { resellerId, status: 'published' }, select: { subdomain: true } });
    const host = store && store.subdomain !== 'bitocard' ? `${store.subdomain}.${base.host}` : base.host;
    return `${base.protocol}//${host}/a/${token}`;
  }

  // -- Proof ---------------------------------------------------------------------------------------------------------

  private async find(token: string): Promise<AccessRow> {
    if (!tokenPattern.test(token)) throw notFound();
    const access = await this.prisma.orderAccess.findUnique({
      where: { tokenHash: sha256(token) },
      include: { order: { include: { product: true, deliveries: true, reseller: { include: { stores: true } } } } },
    });
    if (!access) throw notFound();
    return access as AccessRow;
  }

  private method(order: Order): AccessMethod {
    if (order.customerId) return 'customer';
    return this.orderEmail(order) ? 'email' : 'none';
  }

  private orderEmail(order: Order) {
    const email = (order.recipient as Record<string, unknown> | null)?.email;
    return typeof email === 'string' && email.includes('@') ? email : null;
  }

  /** Whether the caller has shown the order is theirs. */
  private async proven(access: AccessRow, proof: AccessProof) {
    const { order } = access;
    if (order.customerId) {
      if (!proof.customerSession) return false;
      const session = await this.prisma.customerSession.findUnique({ where: { tokenHash: sha256(proof.customerSession) }, include: { customer: true } });
      return Boolean(session && !session.revokedAt && session.expiresAt > new Date() && session.customer.status === 'active' && session.customer.id === order.customerId);
    }
    return Boolean(proof.pass && this.passValid(proof.pass, access));
  }

  /** A pass: `<payload>.<signature>`, HMAC-SHA256 keyed with ENCRYPTION_KEY, bound to the order and its current link. */
  private signPass(payload: string) {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return createHmac('sha256', this.config.ENCRYPTION_KEY).update(`order-access-pass:${payload}`).digest('base64url');
  }

  private makePass(access: OrderAccess, now = Date.now()) {
    const expires = now + accessPassMs;
    const payload = Buffer.from(JSON.stringify({ o: access.orderId, h: access.tokenHash.slice(0, 16), e: Math.floor(expires / 1000) })).toString('base64url');
    return { pass: `${payload}.${this.signPass(payload)}`, expires_at: new Date(expires).toISOString() };
  }

  private passValid(pass: string, access: OrderAccess) {
    const [payload, signature] = pass.split('.');
    if (!payload || !signature) return false;
    const expected = Buffer.from(this.signPass(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    try {
      const { o, h, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { o?: string; h?: string; e?: number };
      return o === access.orderId && h === access.tokenHash.slice(0, 16) && typeof e === 'number' && e * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  // -- The page ------------------------------------------------------------------------------------------------------

  /** The page: the store's name and how to prove the order is yours; the order itself (codes hidden) once proven. */
  async view(token: string, proof: AccessProof) {
    const access = await this.find(token);
    const method = this.method(access.order);
    const verified = method !== 'none' && (await this.proven(access, proof));
    const email = method === 'email' ? this.orderEmail(access.order) : null;
    return {
      object: 'order_access' as const,
      store: this.presentStore(access.order),
      access: { method, verified, email_hint: email ? maskEmail(email) : null },
      order: verified ? this.presentOrder(access, false) : null,
    };
  }

  /** Emails a code that opens the order's page (orders with an email and no store account). */
  async sendCode(token: string) {
    const access = await this.find(token);
    const email = this.method(access.order) === 'email' ? this.orderEmail(access.order) : null;
    if (!email) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'access_code_unavailable', 'This order cannot be opened with an emailed code.');
    const now = Date.now();
    const recent = await this.prisma.orderAccessCode.findMany({ where: { orderId: access.orderId, createdAt: { gt: new Date(now - alertEveryMs) } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (recent[0] && now - recent[0].createdAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    if (recent.length >= maxCodesPerDay) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'too_many_codes', 'Too many codes were asked for today. Try again tomorrow, or contact the store.');
    const code = numericCode();
    const created = await this.prisma.$transaction(async tx => {
      await tx.orderAccessCode.updateMany({ where: { orderId: access.orderId, consumedAt: null }, data: { consumedAt: new Date() } });
      return tx.orderAccessCode.create({ data: { orderId: access.orderId, codeHash: this.codeDigest(access.orderId, code), expiresAt: new Date(now + codeLifetimeMs) } });
    });
    try {
      await this.email.send(orderAccessCodeEmail(email, { store: this.presentStore(access.order).name, product: access.order.product.name, code }));
    } catch (error) {
      // Not sent: cancel it so another can be asked for at once.
      await this.prisma.orderAccessCode.updateMany({ where: { id: created.id, consumedAt: null }, data: { consumedAt: new Date() } });
      throw error;
    }
    return { object: 'order_access_code' as const, email_hint: maskEmail(email), expires_at: created.expiresAt.toISOString() };
  }

  private codeDigest(orderId: string, code: string) {
    return sha256(`order-access:${orderId}:${code}`);
  }

  /** Exchanges the emailed code for a 30-minute pass to the order's page. */
  async verifyCode(token: string, code: string) {
    const access = await this.find(token);
    if (this.method(access.order) !== 'email') throw codeInvalid();
    const record = await this.prisma.orderAccessCode.findFirst({ where: { orderId: access.orderId, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!record) throw codeInvalid();
    if (record.expiresAt <= new Date()) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_expired', 'That code has expired. Ask for a new one.', 'code');
    // Claim a try before comparing, in one statement, so parallel guesses can never get past the limit.
    const attempt = await this.prisma.orderAccessCode.updateMany({ where: { id: record.id, consumedAt: null, attempts: { lt: maxCodeAttempts } }, data: { attempts: { increment: 1 } } });
    if (attempt.count === 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_attempts_exceeded', 'Too many wrong tries. Ask for a new code.', 'code');
    if (!sameDigest(record.codeHash, this.codeDigest(access.orderId, code))) throw codeInvalid();
    const consumed = await this.prisma.orderAccessCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw codeInvalid();
    return { object: 'order_access_pass' as const, ...this.makePass(access) };
  }

  /** The order with its codes, PINs and tokens (delivered orders only), for the proven customer; recorded, with an email alert. */
  async reveal(token: string, proof: AccessProof) {
    const access = await this.find(token);
    if (this.method(access.order) === 'none' || !(await this.proven(access, proof))) throw proofRequired();
    if (access.order.status !== 'completed') return { object: 'order_access' as const, store: this.presentStore(access.order), order: this.presentOrder(access, false) };
    const now = new Date();
    const updated = await this.prisma.orderAccess.update({ where: { orderId: access.orderId }, data: { reveals: { increment: 1 }, revealedAt: access.revealedAt ?? now } });
    await this.alert(access, now);
    return { object: 'order_access' as const, store: this.presentStore(access.order), order: this.presentOrder({ ...access, ...updated }, true) };
  }

  /** Tells the customer their codes were shown, at most once a day (claimed first, so it is sent once). Never throws. */
  private async alert(access: AccessRow, now: Date) {
    try {
      const claimed = await this.prisma.orderAccess.updateMany({
        where: { orderId: access.orderId, OR: [{ alertedAt: null }, { alertedAt: { lt: new Date(now.getTime() - alertEveryMs) } }] },
        data: { alertedAt: now },
      });
      if (claimed.count === 0) return;
      const to = access.order.customerId
        ? (await this.prisma.customer.findUnique({ where: { id: access.order.customerId }, select: { email: true } }))?.email
        : this.orderEmail(access.order);
      if (to) await this.email.send(orderRevealedEmail(to, { store: this.presentStore(access.order).name, product: access.order.product.name, at: now }));
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', orderId: access.orderId }, 'Could not send the reveal alert');
    }
  }

  private presentStore(order: AccessOrder) {
    const store = order.reseller.stores.find(item => item.status === 'published') ?? null;
    return { name: store?.name ?? order.reseller.name, subdomain: store?.subdomain ?? null, logo_url: store?.logoUrl ?? null, primary_color: store?.primaryColor ?? '#070f4c' };
  }

  private presentOrder(access: AccessRow, withCodes: boolean) {
    const { order } = access;
    // Codes only on a delivered order: a refunded order's codes are no longer the customer's to use.
    const showCodes = withCodes && order.status === 'completed';
    const encryption = order.deliveries.length ? this.encryption() : null;
    const recipient = (order.recipient ?? {}) as Record<string, unknown>;
    return {
      mode: order.mode,
      status: order.status,
      product: {
        key: order.product.key,
        name: order.product.name,
        category: order.product.category,
        country: order.product.country,
        brand: order.product.brand,
        features: order.product.features,
      },
      quantity: order.quantity,
      face_value: minor(order.faceValueMinor),
      face_currency: order.faceCurrency,
      recipient: Object.fromEntries(recipientFields.filter(field => typeof recipient[field] === 'string').map(field => [field, recipient[field] as string])),
      deliveries:
        order.status === 'completed'
          ? order.deliveries.map(delivery => {
              const open = !secretKinds.has(delivery.kind) || showCodes;
              return {
                kind: delivery.kind,
                hidden: !open,
                code: open && delivery.codeEncrypted && encryption ? encryption.decrypt(delivery.codeEncrypted) : null,
                pin: open && delivery.pinEncrypted && encryption ? encryption.decrypt(delivery.pinEncrypted) : null,
                serial: delivery.serial,
                details: (delivery.details ?? {}) as Record<string, string>,
              };
            })
          : [],
      redeem_instructions: order.product.redeemInstructions,
      revealed_at: access.revealedAt?.toISOString() ?? null,
      created_at: order.createdAt.toISOString(),
      completed_at: order.completedAt?.toISOString() ?? null,
    };
  }
}
