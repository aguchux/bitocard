import { HttpStatus, Injectable } from '@nestjs/common';
import { houseStoreId } from '../checkout/house-ids.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { CustomersService, type CustomerWithStore } from './customers.service.js';

/** A handoff code lasts this long: long enough for one redirect and the page that posts it. */
export const handoffMs = 60_000;

const refused = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'handoff_invalid', 'This sign-in link has expired or was already used. Sign in again.');

/**
 * Signing a bitocard.com customer in on another of BitoCard's own sites without their password: bitocard.com and its
 * country stores (ng.bitocard.com…) share one account but each keeps its own session cookie.
 * The site the customer is signed in on asks for a code for the other (`issue`, `to` one of BitoCard's own origins);
 * the code travels in the address's fragment, so it never reaches a log or a Referer, and that site's server exchanges
 * it once, within 60 seconds, for a new session there (`exchange`, naming its own origin). Only the code's hash is kept.
 * Resellers' stores and their customers never take part.
 */
@Injectable()
export class HandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly customers: CustomersService,
  ) {}

  /**
   * The origin, if it is one of BitoCard's own sites a customer may be handed to: bitocard.com (`STOREFRONT_URL`) or a
   * published BitoCard country store under it (`<cc>.<host>`, same scheme and port). Crypto and BitoCard Shop have left
   * BitoCard (docs/CRYPTO_SPINOFF_PLAN.md, docs/UDOZO_SPINOFF_PLAN.md): their sites have accounts of their own and are
   * never targets (Udozo's handoff, to its stores' own domains, is step 3 of its plan).
   */
  async target(to: string) {
    let url: URL;
    try {
      url = new URL(to);
    } catch {
      return null;
    }
    if (`${url.origin}` !== to.replace(/\/+$/, '')) return null;
    const store = new URL(this.integrations.config.STOREFRONT_URL);
    if (url.origin === store.origin) return url.origin;
    const suffix = `.${store.host}`;
    if (url.protocol === store.protocol && url.host.endsWith(suffix)) {
      const subdomain = url.host.slice(0, -suffix.length);
      if (/^[a-z]{2}$/.test(subdomain) && (await this.customers.countryStore(subdomain))) return url.origin;
    }
    return null;
  }

  async issue(customer: CustomerWithStore, to: string) {
    if (customer.storeId !== houseStoreId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'handoff_unavailable', "Only BitoCard accounts can move between BitoCard's sites.");
    const origin = await this.target(to);
    if (!origin) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', "Choose one of BitoCard's own sites.", 'to');
    const code = `bch_${randomToken()}`;
    const now = Date.now();
    const expiresAt = new Date(now + handoffMs);
    await this.prisma.customerHandoff.create({ data: { customerId: customer.id, codeHash: sha256(code), toOrigin: origin, expiresAt } });
    // Codes are spent or dead within a minute: anything an hour old is gone.
    await this.prisma.customerHandoff.deleteMany({ where: { expiresAt: { lt: new Date(now - 60 * 60_000) } } });
    return { object: 'customer_handoff' as const, code, to: origin, expires_at: expiresAt.toISOString() };
  }

  /** The code for a new session on `origin` (the exchanging site's own): once, before it expires, only there. */
  async exchange(code: string, origin: string) {
    const target = await this.target(origin);
    if (!target || !code.startsWith('bch_')) throw refused();
    const now = new Date();
    const codeHash = sha256(code);
    const claimed = await this.prisma.customerHandoff.updateMany({ where: { codeHash, usedAt: null, toOrigin: target, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (!claimed.count) throw refused();
    const handoff = await this.prisma.customerHandoff.findUniqueOrThrow({ where: { codeHash }, include: { customer: true } });
    const customer = handoff.customer;
    if (customer.status !== 'active' || customer.storeId !== houseStoreId) throw refused();
    await this.prisma.customer.update({ where: { id: customer.id }, data: { lastSignInAt: now } });
    return { customer: await this.customers.present(customer), session: await this.customers.startSession(customer.id) };
  }
}
