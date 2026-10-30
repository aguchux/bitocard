import { InvoicesService } from '../billing/invoices.service.js';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { formatMoney } from '../notifications/templates.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { FxService } from '../fx/fx.service.js';
import type { Prisma, StoreDomain } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ProviderError } from '../payments/provider-error.js';
import { SettingsService } from '../settings/settings.service.js';
import { domainName, isManaged, lookupPublicRecords, mailProviders, mailRecords, managedComment, type MailProvider, type RecordInput, recordProblem, reservedDomain, tldOf } from './dns.js';
import { ResendDomains, type SendingRecord } from './resend-domains.js';
import { domainSender } from './sender.js';
import { type Contact, VercelDomains } from './vercel.js';
import { PlanAccessService } from '../plans/plan-access.js';

/** At most this many domains per store (in use: not removed or failed). */
/** The default domains per store; each plan sets its own (`domains_per_store`). */
export const maxDomainsPerStore = 5;
/** Purchased domains renew this long before they expire, from the wallet (Vercel's own auto-renew stays off). */
export const renewBeforeMs = 14 * 24 * 3600_000;
/** Renewal reminders, in days before expiry. */
export const reminderDays = [30, 7, 1];

const day = 24 * 3600_000;
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const missing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such domain.');
const unavailable = (message = 'Domains are not set up yet. Try again later.') => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'domains_unavailable', message);

/** Vercel registrar order statuses to outcomes (anything else is still in progress). */
export function orderOutcome(status: string | undefined) {
  const text = (status ?? '').toLowerCase();
  if (['completed', 'complete', 'succeeded', 'success'].includes(text)) return 'completed' as const;
  if (['failed', 'canceled', 'cancelled', 'refunded', 'error', 'rejected'].includes(text)) return 'failed' as const;
  return 'pending' as const;
}

type Verification = { challenges: Array<{ type: string; domain: string; value: string; reason: string }>; ipv4: string[]; cname: string | null; nameservers: string[] };

/**
 * Reseller stores' own domains: bought through BitoCard (Vercel's registrar: the reseller pays Vercel's price plus
 * BitoCard's margin from their wallet, posted as `domain_revenue`, Vercel's price as the cost) or connected (bought
 * elsewhere). Every domain is added to the storefront's Vercel project, which serves the store on it with HTTPS.
 * Domains on Vercel's nameservers (every purchased one, and connected ones whose nameservers point there) have their
 * DNS edited in SHQ; BitoCard's own records (the store, email) are protected. Gated by the `custom_domains` switch.
 */
@Injectable()
export class DomainsService {
  private readonly logger = new Logger('Domains');
  private readonly clients: () => { vercel: VercelDomains; resend: ResendDomains | null; marginBps: number | null; tlds: Set<string>; lookupUrl: string };

  constructor(
    private readonly invoices: InvoicesService,
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    private readonly settings: SettingsService,
    private readonly planAccess: PlanAccessService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {
    this.clients = integrations.derive(config => {
      const margin = config.DOMAIN_MARGIN_PERCENT?.trim();
      return {
        vercel: new VercelDomains({ token: config.VERCEL_API_TOKEN, teamId: config.VERCEL_TEAM_ID, project: config.VERCEL_STOREFRONT_PROJECT, baseUrl: config.VERCEL_API_URL }),
        resend: config.RESEND_API_KEY ? new ResendDomains(config.RESEND_API_KEY, config.RESEND_API_URL) : null,
        marginBps: margin && /^\d{1,3}(\.\d{1,2})?$/.test(margin) ? Math.round(Number(margin) * 100) : null,
        tlds: new Set(config.DOMAIN_TLDS.split(',').map(item => item.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)),
        lookupUrl: config.DOMAIN_DNS_LOOKUP_URL,
      };
    });
  }

  private get vercel() {
    const { vercel } = this.clients();
    if (!vercel.configured()) throw unavailable();
    return vercel;
  }

  /** What the reseller pays for a registration Vercel prices at `costCents`: the margin added, rounded up. */
  private priceFor(costCents: number) {
    const { marginBps } = this.clients();
    if (marginBps === null) throw unavailable('Buying domains is not open yet. You can still connect a domain you own.');
    return Math.ceil((costCents * (10_000 + marginBps)) / 10_000);
  }

  // Access ---------------------------------------------------------------------------------------------------------------

  /** The reseller's store, with the switch on and a plan with custom domains. */
  private async storeOf(resellerId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, resellerId } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such store.');
    if (!(await this.settings.isOn('custom_domains', resellerId))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'domains_not_enabled', 'Custom domains are not open for your account yet.');
    }
    // On Udozo a store goes live only on its own domain, so domains are open on every plan (the switch still gates them).
    if (this.appConfig.APP_PRODUCT !== 'udozo') await this.planAccess.requireForStore(store.id, 'custom_domains');
    return store;
  }

  private async domainOf(resellerId: string, storeId: string, id: string) {
    await this.storeOf(resellerId, storeId);
    const domain = await this.prisma.storeDomain.findFirst({ where: { id, storeId, resellerId, status: { notIn: ['removed'] } } });
    if (!domain) throw missing();
    return domain;
  }

  private async assertRoom(storeId: string) {
    const used = await this.prisma.storeDomain.count({ where: { storeId, status: { notIn: ['removed', 'failed'] } } });
    await this.planAccess.requireStoreRoom(storeId, 'domains_per_store', used, { code: 'too_many_domains', param: 'domain' });
  }

  private async assertFree(name: string) {
    if (await this.prisma.storeDomain.findFirst({ where: { name, status: { notIn: ['removed', 'failed'] } } })) {
      throw conflict('domain_in_use', 'This domain is already connected to a store.', 'domain');
    }
  }

  private parse(raw: string) {
    const name = domainName(raw);
    if (!name) throw invalid('domain_invalid', 'Enter a domain such as yourstore.com.', 'domain');
    if (reservedDomain(name)) throw invalid('domain_invalid', 'This domain cannot be used for a store.', 'domain');
    return name;
  }

  // Reading --------------------------------------------------------------------------------------------------------------

  async list(resellerId: string, storeId: string) {
    await this.storeOf(resellerId, storeId);
    const domains = await this.prisma.storeDomain.findMany({ where: { storeId, resellerId, status: { notIn: ['removed'] } }, orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }] });
    const { marginBps, tlds } = this.clients();
    return {
      object: 'list' as const,
      data: domains.map(domain => this.present(domain)),
      buying: { available: marginBps !== null && this.clients().vercel.configured(), tlds: [...tlds] },
      max_domains: (await this.planAccess.storeLimit(storeId, 'domains_per_store')).value,
    };
  }

  present(domain: StoreDomain) {
    const verification = (domain.verification ?? null) as Verification | null;
    const instructions =
      domain.dnsMode === 'external' && domain.status !== 'active'
        ? [
            { type: 'A', name: '@', value: verification?.ipv4[0] ?? '76.76.21.21' },
            { type: 'CNAME', name: 'www', value: verification?.cname ?? 'cname.vercel-dns.com' },
            ...(verification?.challenges ?? []).map(challenge => ({ type: challenge.type, name: challenge.domain, value: challenge.value })),
          ]
        : [];
    const sending = (domain.emailRecords ?? null) as SendingRecord[] | null;
    return {
      object: 'store_domain' as const,
      id: domain.id,
      name: domain.name,
      url: `https://${domain.name}`,
      source: domain.source,
      status: domain.status,
      dns_mode: domain.dnsMode as 'vercel' | 'external',
      primary: domain.primary,
      verified: domain.verified,
      configured: !domain.misconfigured,
      instructions,
      nameservers: domain.dnsMode === 'external' && verification?.nameservers.length ? verification.nameservers : null,
      expires_at: domain.expiresAt?.toISOString() ?? null,
      auto_renew: domain.source === 'purchased' ? domain.autoRenew : null,
      price: domain.priceCents !== null ? { amount: domain.priceCents, currency: 'USD' } : null,
      renewal_error: domain.renewalError,
      mail_provider: domain.mailProvider,
      email_sending: domain.emailDomainId
        ? { status: domain.emailStatus ?? 'pending', from: `orders@${domain.name}`, records: (sending ?? []).map(record => ({ type: record.type, name: record.name, value: record.value, priority: record.priority ?? null, status: record.status ?? null })) }
        : null,
      last_checked_at: domain.lastCheckedAt?.toISOString() ?? null,
      last_error: domain.lastError,
      created_at: domain.createdAt.toISOString(),
    };
  }

  /** Domains to buy: the name in each ending BitoCard sells (or only the one typed), with availability and price. */
  async search(resellerId: string, storeId: string, query: string) {
    await this.storeOf(resellerId, storeId);
    const { tlds } = this.clients();
    const typed = query.trim().toLowerCase();
    const base = typed.replace(/^www\./, '').split('.')[0]?.replace(/[^a-z0-9-]/g, '') ?? '';
    if (!base || base.length < 2 || base.length > 63 || base.startsWith('-') || base.endsWith('-')) throw invalid('domain_invalid', 'Enter a name such as yourstore.', 'q');
    const asked = typed.includes('.') ? tldOf(typed) : null;
    if (asked && !tlds.has(asked)) throw invalid('tld_not_offered', `Only ${[...tlds].map(tld => `.${tld}`).join(', ')} can be bought here for now. You can connect a domain you bought elsewhere.`, 'q');
    const names = (asked ? [asked] : [...tlds]).map(tld => `${base}.${tld}`);
    const vercel = this.vercel;
    const results = await Promise.all(
      names.map(async name => {
        const taken = await this.prisma.storeDomain.findFirst({ where: { name, status: { notIn: ['removed', 'failed'] } } });
        if (taken || reservedDomain(name)) return { object: 'domain_offer' as const, domain: name, available: false, price: null, renewal_price: null };
        try {
          if (!(await vercel.availability(name))) return { object: 'domain_offer' as const, domain: name, available: false, price: null, renewal_price: null };
          const cost = await vercel.price(name);
          return { object: 'domain_offer' as const, domain: name, available: true, price: { amount: this.priceFor(cost.purchaseCents), currency: 'USD' }, renewal_price: { amount: this.priceFor(cost.renewalCents), currency: 'USD' } };
        } catch (error) {
          if (error instanceof ApiError) throw error;
          this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', name }, 'Domain search failed');
          return { object: 'domain_offer' as const, domain: name, available: false, price: null, renewal_price: null };
        }
      }),
    );
    return { object: 'list' as const, data: results };
  }

  // Buying -----------------------------------------------------------------------------------------------------------------

  /**
   * Buys a domain for the store at the price the reseller saw (`expected_price`, US cents; a changed price is refused,
   * never charged). The price is held from the wallet (in the wallet's currency at today's rate), Vercel buys it, and the
   * hold is taken once the registrar confirms; a refused purchase returns it. Live only.
   */
  async purchase(resellerId: string, storeId: string, input: { domain: string; expected_price: number; contact: Contact }) {
    const store = await this.storeOf(resellerId, storeId);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (reseller.status !== 'active') throw conflict('reseller_not_verified', 'Finish verifying your business before buying a domain.');
    // At the credit limit, buying and renewing domains waits until what is owed is paid.
    await this.invoices.requireCredit(resellerId);
    const name = this.parse(input.domain);
    const { tlds } = this.clients();
    if (!tlds.has(tldOf(name))) throw invalid('tld_not_offered', `Only ${[...tlds].map(tld => `.${tld}`).join(', ')} can be bought here for now.`, 'domain');
    await this.assertRoom(store.id);
    await this.assertFree(name);
    const vercel = this.vercel;
    if (!(await vercel.availability(name).catch(() => false))) throw conflict('domain_unavailable', 'This domain is not available to buy.', 'domain');
    const cost = await vercel.price(name);
    const price = this.priceFor(cost.purchaseCents);
    if (price !== input.expected_price) throw conflict('price_changed', `The price is now USD ${(price / 100).toFixed(2)}. Check it and try again.`, 'expected_price');

    const domain = await this.prisma.storeDomain
      .create({ data: { resellerId, storeId: store.id, name, source: 'purchased', status: 'purchasing', dnsMode: 'vercel', costCents: cost.purchaseCents, priceCents: price } })
      .catch(error => {
        if ((error as { code?: string }).code === 'P2002') throw conflict('domain_in_use', 'This domain is already connected to a store.', 'domain');
        throw error;
      });
    const { currency } = await this.wallets.currencyOf(resellerId);
    const amount = currency === 'USD' ? BigInt(price) : (await this.fx.chargeForUsdCents(price, currency)).amount;
    let hold;
    try {
      hold = await this.wallets.hold({ resellerId, mode: 'live', amount, reference: `domain:${domain.id}:register`, description: `Domain: ${name}` });
    } catch (error) {
      await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { status: 'failed', lastError: 'insufficient_funds' } });
      throw error;
    }
    await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { holdId: hold.id } });
    return this.register(domain.id, name, cost.purchaseCents, input.contact);
  }

  /** Asks Vercel to buy a domain already recorded as `purchasing`, then settles it (or leaves it for the job). */
  private async register(id: string, name: string, costCents: number, contact: Contact) {
    try {
      const order = await this.vercel.buy(name, { years: 1, costCents, contact });
      await this.prisma.storeDomain.update({ where: { id }, data: { orderId: order.orderId } });
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        await this.failPurchase(id, error.message);
        throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'domain_purchase_failed', 'The domain could not be bought. Nothing was taken from your wallet.');
      }
      // Unclear: anything held stays held and the purchase is checked by the `domains` job.
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', domain: name }, 'Domain purchase unclear; checking later');
      await this.prisma.storeDomain.update({ where: { id }, data: { lastError: 'Waiting for the registrar to confirm.' } });
    }
    await this.checkPurchase(id);
    return this.present(await this.prisma.storeDomain.findUniqueOrThrow({ where: { id } }));
  }

  // Udozo's free domain ---------------------------------------------------------------------------------------------------

  /**
   * Premium's free domain for a Udozo store (docs/UDOZO_SPINOFF_PLAN.md, step 3): how many the store's plan gives
   * (`free_domains`), how many it has, and the most one may cost: what the store's Premium month and, when it was paid
   * with it, the seller's setup fee collected, in the wallet's currency. Never on BitoCard.
   */
  async freeDomain(resellerId: string, storeId: string, query?: string) {
    await this.storeOf(resellerId, storeId);
    const allowance = await this.freeAllowance(resellerId, storeId);
    // With `q`: the search's offers, each saying whether the free domain covers it (its price in the wallet's
    // currency within what the store's Premium collected), so Seller HQ can show it before the seller tries.
    const offers = query && allowance.available ? await this.coveredOffers(resellerId, storeId, query, allowance) : null;
    return {
      object: 'free_domain' as const,
      allowance: allowance.limit,
      used: allowance.used,
      available: allowance.available,
      covers_up_to: { amount: Number(allowance.covered), currency: allowance.currency },
      ...(offers ? { offers } : {}),
    };
  }

  private async coveredOffers(resellerId: string, storeId: string, query: string, allowance: { covered: bigint; currency: string }) {
    const { data } = await this.search(resellerId, storeId, query);
    return Promise.all(
      data.map(async offer => {
        if (!offer.available || !offer.price) return { domain: offer.domain, available: false, price: null, covered: false };
        const local = allowance.currency === 'USD' ? BigInt(offer.price.amount) : await this.fx.chargeForUsdCents(offer.price.amount, allowance.currency).then(result => result.amount, () => null);
        return { domain: offer.domain, available: true, price: local === null ? null : { amount: Number(local), currency: allowance.currency }, covered: local !== null && local <= allowance.covered };
      }),
    );
  }

  private async freeAllowance(resellerId: string, storeId: string) {
    const { currency } = await this.wallets.currencyOf(resellerId);
    if (this.appConfig.APP_PRODUCT !== 'udozo') return { limit: 0 as number | null, used: 0, available: false, covered: 0n, currency };
    const limit = (await this.planAccess.storeLimit(storeId, 'free_domains')).value;
    const used = await this.prisma.storeDomain.count({ where: { storeId, free: true, status: { notIn: ['removed', 'failed'] } } });
    const [subscription, reseller] = await Promise.all([
      this.prisma.storeSubscription.findUnique({ where: { storeId } }),
      this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { setupFeeStoreId: true, setupFeeMinor: true, setupFeeCurrency: true } }),
    ]);
    let covered = 0n;
    // Only a month the seller paid for (a plan an admin gave without billing collected nothing).
    if (subscription?.renewsAt && subscription.paidCurrency === currency) covered += subscription.paidMinor;
    if (reseller.setupFeeStoreId === storeId && reseller.setupFeeCurrency === currency) covered += reseller.setupFeeMinor ?? 0n;
    return { limit, used, available: (limit === null || used < limit) && covered > 0n, covered, currency };
  }

  /**
   * Buys the store's free domain: nothing is taken from the wallet, as long as the store has one left and the domain
   * costs no more than its Premium collected (`domain_not_covered` otherwise: choose another ending, or buy it as usual).
   */
  async purchaseFree(resellerId: string, storeId: string, input: { domain: string; contact: Contact }) {
    const store = await this.storeOf(resellerId, storeId);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (reseller.status !== 'active') throw conflict('reseller_not_verified', 'Finish verifying your business before buying a domain.');
    const name = this.parse(input.domain);
    const { tlds } = this.clients();
    if (!tlds.has(tldOf(name))) throw invalid('tld_not_offered', `Only ${[...tlds].map(tld => `.${tld}`).join(', ')} can be bought here for now.`, 'domain');
    const allowance = await this.freeAllowance(resellerId, store.id);
    if (!allowance.available) throw conflict('free_domain_unavailable', 'This store has no free domain left. Its Premium plan includes one per store.', 'domain');
    await this.assertRoom(store.id);
    await this.assertFree(name);
    const vercel = this.vercel;
    if (!(await vercel.availability(name).catch(() => false))) throw conflict('domain_unavailable', 'This domain is not available to buy.', 'domain');
    const cost = await vercel.price(name);
    const price = this.priceFor(cost.purchaseCents);
    const local = allowance.currency === 'USD' ? BigInt(price) : (await this.fx.chargeForUsdCents(price, allowance.currency)).amount;
    if (local > allowance.covered) {
      throw conflict('domain_not_covered', `${name} costs ${formatMoney(local, allowance.currency)}, more than the ${formatMoney(allowance.covered, allowance.currency)} your Premium covers. Choose another ending, or buy it as usual.`, 'domain');
    }
    const domain = await this.prisma.storeDomain
      .create({ data: { resellerId, storeId: store.id, name, source: 'purchased', status: 'purchasing', dnsMode: 'vercel', costCents: cost.purchaseCents, priceCents: 0, free: true } })
      .catch(error => {
        if ((error as { code?: string }).code === 'P2002') throw conflict('domain_in_use', 'This domain is already connected to a store.', 'domain');
        throw error;
      });
    // Two requests at once take one free domain between them: the later one is refused, never bought.
    const taken = await this.prisma.storeDomain.count({ where: { storeId: store.id, free: true, status: { notIn: ['removed', 'failed'] } } });
    if (allowance.limit !== null && taken > allowance.limit) {
      await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { status: 'failed', lastError: 'free_domain_used' } });
      throw conflict('free_domain_unavailable', 'This store has no free domain left. Its Premium plan includes one per store.', 'domain');
    }
    return this.register(domain.id, name, cost.purchaseCents, input.contact);
  }

  /** Udozo: whether a free domain renews free, as long as its store's plan still includes free domains. */
  private async renewsFree(domain: StoreDomain) {
    if (this.appConfig.APP_PRODUCT !== 'udozo' || !domain.free) return false;
    const limit = (await this.planAccess.storeLimit(domain.storeId, 'free_domains')).value;
    return limit === null || limit > 0;
  }

  /** The price of each ending sold (US cents, the margin added), for admins' checks; null while it cannot be read. */
  async endingPrices(): Promise<Array<{ tld: string; price: number }> | null> {
    const { vercel, tlds, marginBps } = this.clients();
    if (!vercel.configured() || marginBps === null) return null;
    try {
      return await Promise.all([...tlds].map(async tld => ({ tld, price: this.priceFor((await vercel.price(`pricecheck-example.${tld}`)).purchaseCents) })));
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Domain ending prices unavailable');
      return null;
    }
  }

  /** A purchase still being made: completed, failed (the money returned) or still waiting. */
  async checkPurchase(id: string) {
    const domain = await this.prisma.storeDomain.findUniqueOrThrow({ where: { id } });
    if (domain.status !== 'purchasing') return domain.status;
    const vercel = this.vercel;
    let outcome: 'completed' | 'failed' | 'pending' = 'pending';
    let detail: string | null = null;
    try {
      if (domain.orderId) {
        const order = await vercel.order(domain.orderId);
        outcome = orderOutcome(order.domains?.find(item => item.domainName?.toLowerCase() === domain.name)?.status ?? order.status);
        if (outcome === 'failed') detail = JSON.stringify(order.error ?? order.domains?.[0]?.error ?? order.status).slice(0, 300);
      } else {
        // The reply to the purchase was lost: it went through if the domain is now in the account.
        const info = await vercel.info(domain.name).catch(() => null);
        if (info?.name) outcome = 'completed';
        else if (Date.now() - domain.createdAt.getTime() > day) outcome = 'failed';
      }
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', domainId: id }, 'Could not read the domain order');
      return 'purchasing';
    }
    if (outcome === 'completed') await this.completePurchase(domain);
    else if (outcome === 'failed') await this.failPurchase(id, detail ?? 'The registrar refused the purchase.');
    return outcome === 'completed' ? 'pending' : outcome === 'failed' ? 'failed' : 'purchasing';
  }

  private async completePurchase(domain: StoreDomain) {
    const claimed = await this.prisma.storeDomain.updateMany({ where: { id: domain.id, status: 'purchasing' }, data: { status: 'pending', lastError: null } });
    if (claimed.count === 0) return;
    if (domain.holdId) {
      const hold = await this.prisma.hold.findUniqueOrThrow({ where: { id: domain.holdId } });
      await this.wallets.captureHold(hold.id, `Domain bought: ${domain.name}`, [{ kind: 'domain_revenue', amount: hold.amountMinor }]);
      await this.invoices.recordPaid({ resellerId: domain.resellerId, storeId: domain.storeId, currency: hold.currency, kind: 'domain', description: `Domain bought: ${domain.name}`, amount: hold.amountMinor, reference: hold.reference });
    }
    await this.postCost(domain, 'register', domain.costCents ?? 0);
    await this.attach(domain.name, true);
    await this.inbox.reseller(domain.resellerId, 'domain.purchased', { subject: `${domain.id}:purchased`, title: `${domain.name} is yours`, body: 'It is being connected to your store, usually within a few minutes.', link: '/store/domains' });
    await this.refresh(domain.id).catch(() => undefined);
  }

  private async failPurchase(id: string, detail: string) {
    const claimed = await this.prisma.storeDomain.updateMany({ where: { id, status: 'purchasing' }, data: { status: 'failed', lastError: detail.slice(0, 300) } });
    if (claimed.count === 0) return;
    const domain = await this.prisma.storeDomain.findUniqueOrThrow({ where: { id } });
    if (domain.holdId) await this.wallets.releaseHold(domain.holdId, `Domain not bought: ${domain.name}`);
    await this.inbox.reseller(domain.resellerId, 'domain.purchase_failed', { subject: `${id}:failed`, title: `${domain.name} could not be bought`, body: 'Nothing was taken from your wallet. Try again or choose another name.', link: '/store/domains' });
  }

  /** Vercel's price as BitoCard's cost, once per registration or renewal (USD, against the Vercel account). */
  private async postCost(domain: StoreDomain, what: string, cents: number) {
    if (cents <= 0) return;
    const reference = `domain_cost:${domain.id}:${what}`;
    if (await this.prisma.journalEntry.findUnique({ where: { reference } })) return;
    await this.ledger.post({
      mode: 'live',
      type: 'order_cost',
      reference,
      description: `Domain cost: ${domain.name}`,
      metadata: { domain_id: domain.id, supplier: 'vercel' },
      lines: [
        { account: { kind: 'cost_of_sales', currency: 'USD', provider: 'vercel' }, debit: BigInt(cents) },
        { account: { kind: 'supplier_float', currency: 'USD', provider: 'vercel' }, credit: BigInt(cents) },
      ],
    });
  }

  /** Serves the store on the domain (and redirects www to it). */
  private async attach(name: string, withWww: boolean) {
    const vercel = this.vercel;
    await vercel.addToProject(name);
    if (withWww) await vercel.addToProject(`www.${name}`).catch(error => this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', name }, 'Could not add www'));
  }

  // Connecting --------------------------------------------------------------------------------------------------------------

  /** Connects a domain the reseller bought elsewhere: added to the storefront, then waiting for their DNS. */
  async connect(resellerId: string, storeId: string, input: { domain: string }) {
    const store = await this.storeOf(resellerId, storeId);
    const name = this.parse(input.domain);
    await this.assertRoom(store.id);
    await this.assertFree(name);
    try {
      await this.attach(name, name.split('.').length === 2);
    } catch (error) {
      if (error instanceof ProviderError && error.definite) throw invalid('domain_refused', 'This domain cannot be connected. Check the name, or contact support if it is yours.', 'domain');
      throw unavailable('The domain could not be added right now. Try again in a moment.');
    }
    const domain = await this.prisma.storeDomain
      .create({ data: { resellerId, storeId: store.id, name, source: 'connected', status: 'pending', dnsMode: 'external' } })
      .catch(error => {
        if ((error as { code?: string }).code === 'P2002') throw conflict('domain_in_use', 'This domain is already connected to a store.', 'domain');
        throw error;
      });
    return this.present(await this.refresh(domain.id).catch(() => domain));
  }

  /** Reads the domain's state from Vercel: ownership, DNS, nameservers, expiry and the sending domain. */
  async refresh(id: string): Promise<StoreDomain> {
    const domain = await this.prisma.storeDomain.findUniqueOrThrow({ where: { id } });
    if (['purchasing', 'failed', 'removed', 'suspended'].includes(domain.status)) return domain;
    const vercel = this.vercel;
    try {
      let project = await vercel.projectDomain(domain.name);
      if (!project.verified) project = await vercel.verifyProjectDomain(domain.name).catch(() => project);
      const config = await vercel.domainConfig(domain.name);
      const info = await vercel.info(domain.name).catch(() => null);
      const onVercel = domain.source === 'purchased' || info?.serviceType === 'zeit.world' || Boolean(info?.nameservers?.length && info.intendedNameservers?.length && info.intendedNameservers.every(ns => info.nameservers!.includes(ns)));
      const active = project.verified && !config.misconfigured;
      const verification: Verification = {
        challenges: project.verification ?? [],
        ipv4: config.recommendedIPv4?.sort((a, b) => a.rank - b.rank)[0]?.value ?? [],
        cname: config.recommendedCNAME?.sort((a, b) => a.rank - b.rank)[0]?.value?.replace(/\.$/, '') ?? null,
        nameservers: info?.intendedNameservers ?? [],
      };
      const email = await this.refreshSending(domain);
      const expired = domain.source === 'purchased' && domain.expiresAt !== null && domain.expiresAt.getTime() < Date.now() && !(info?.expiresAt && info.expiresAt > Date.now());
      const updated = await this.prisma.storeDomain.update({
        where: { id },
        data: {
          verified: project.verified,
          misconfigured: config.misconfigured,
          verification: verification as unknown as Prisma.InputJsonValue,
          dnsMode: onVercel ? 'vercel' : 'external',
          status: expired ? 'expired' : active ? 'active' : 'pending',
          ...(domain.source === 'purchased' && info?.expiresAt ? { expiresAt: new Date(info.expiresAt) } : {}),
          ...email,
          lastCheckedAt: new Date(),
          lastError: null,
        },
      });
      if (active && domain.status !== 'active') {
        await this.becameActive(updated);
        return this.prisma.storeDomain.findUniqueOrThrow({ where: { id } });
      }
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^vercel: /, '') : 'unknown error';
      return this.prisma.storeDomain.update({ where: { id }, data: { lastCheckedAt: new Date(), lastError: message.slice(0, 300) } });
    }
  }

  private async becameActive(domain: StoreDomain) {
    // The first domain to work becomes the store's main address.
    if (!(await this.prisma.storeDomain.findFirst({ where: { storeId: domain.storeId, primary: true } }))) {
      await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { primary: true } }).catch(() => undefined);
    }
    await this.inbox.reseller(domain.resellerId, 'domain.active', { subject: `${domain.id}:active`, title: `Your store is live on ${domain.name}`, body: `Customers can shop at https://${domain.name}.`, link: '/store/domains' });
  }

  async check(resellerId: string, storeId: string, id: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    if (domain.status === 'purchasing') await this.checkPurchase(id);
    return this.present(await this.refresh(id));
  }

  async update(resellerId: string, storeId: string, id: string, input: { primary?: boolean; auto_renew?: boolean }) {
    const domain = await this.domainOf(resellerId, storeId, id);
    if (input.primary) {
      if (domain.status !== 'active') throw conflict('domain_not_active', 'Only a domain that is working can be the main address.');
      await this.prisma.$transaction([
        this.prisma.storeDomain.updateMany({ where: { storeId, primary: true }, data: { primary: false } }),
        this.prisma.storeDomain.update({ where: { id }, data: { primary: true } }),
      ]);
    } else if (input.primary === false) {
      await this.prisma.storeDomain.update({ where: { id }, data: { primary: false } });
    }
    if (input.auto_renew !== undefined) {
      if (domain.source !== 'purchased') throw invalid('parameter_invalid', 'Only domains bought here renew through BitoCard.', 'auto_renew');
      await this.prisma.storeDomain.update({ where: { id }, data: { autoRenew: input.auto_renew } });
    }
    return this.present(await this.prisma.storeDomain.findUniqueOrThrow({ where: { id } }));
  }

  /** Disconnects a connected domain from the store. A domain bought here stays with the store until it expires or moves. */
  async remove(resellerId: string, storeId: string, id: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    if (domain.source === 'purchased' && domain.status !== 'failed') {
      throw conflict('domain_purchased', 'A domain bought here stays with your store until it expires. To move it, get its transfer code.');
    }
    if (domain.status !== 'failed') {
      const vercel = this.vercel;
      await vercel.removeFromProject(domain.name);
      await vercel.removeFromProject(`www.${domain.name}`);
    }
    await this.prisma.storeDomain.update({ where: { id }, data: { status: 'removed', primary: false } });
    await this.liveOnlyOnDomain(domain.storeId);
    return { object: 'store_domain' as const, id, deleted: true };
  }

  /** The code to move a domain bought here to another registrar (owners only). */
  async transferCode(resellerId: string, storeId: string, id: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    if (domain.source !== 'purchased' || ['purchasing', 'failed'].includes(domain.status)) throw conflict('not_transferable', 'Only domains bought here have a transfer code.');
    const code = await this.vercel.authCode(domain.name).catch(error => {
      if (error instanceof ProviderError && error.definite) throw conflict('not_transferable', 'This domain cannot be transferred yet (domains are locked for 60 days after they are bought).');
      throw unavailable();
    });
    return { object: 'domain_transfer_code' as const, domain: domain.name, code };
  }

  // DNS --------------------------------------------------------------------------------------------------------------------

  private onVercel(domain: StoreDomain) {
    if (domain.dnsMode !== 'vercel') throw conflict('dns_external', 'This domain’s DNS is with your own provider. Point its nameservers to BitoCard to manage records here.');
  }

  async records(resellerId: string, storeId: string, id: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    this.onVercel(domain);
    const records = await this.vercel.records(domain.name);
    return {
      object: 'list' as const,
      data: records.map(record => ({ object: 'dns_record' as const, id: record.id, name: record.name, type: record.type, value: record.value, ttl: record.ttl ?? null, priority: record.mxPriority ?? null, protected: isManaged(record.comment) })),
    };
  }

  async addRecord(resellerId: string, storeId: string, id: string, input: RecordInput) {
    const domain = await this.domainOf(resellerId, storeId, id);
    this.onVercel(domain);
    const problem = recordProblem(input);
    if (problem) throw invalid('record_invalid', problem);
    const name = input.name.trim().toLowerCase().replace(/^@$/, '').replace(/\.$/, '');
    const existing = await this.vercel.records(domain.name);
    if (existing.length >= 100) throw conflict('too_many_records', 'This domain has the most records it can have here.');
    const recordId = await this.vercel.createRecord(domain.name, { name, type: input.type, value: input.value.trim(), ttl: input.ttl, mxPriority: input.priority });
    return { object: 'dns_record' as const, id: recordId, name, type: input.type, value: input.value.trim(), ttl: input.ttl ?? 3600, priority: input.priority ?? null, protected: false };
  }

  async deleteRecord(resellerId: string, storeId: string, id: string, recordId: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    this.onVercel(domain);
    const record = (await this.vercel.records(domain.name)).find(item => item.id === recordId);
    if (!record) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such record.');
    if (isManaged(record.comment)) throw conflict('record_protected', 'BitoCard keeps this record for your store or email. Change your email settings instead.');
    await this.vercel.deleteRecord(domain.name, recordId);
    return { object: 'dns_record' as const, id: recordId, deleted: true };
  }

  /** Before moving nameservers: the domain's public records BitoCard found, to copy across so email keeps working. */
  async importPreview(resellerId: string, storeId: string, id: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    if (domain.dnsMode === 'vercel') throw conflict('dns_on_vercel', 'This domain’s DNS is already managed here.');
    const records = await lookupPublicRecords(domain.name, this.clients().lookupUrl);
    const nameservers = ((domain.verification ?? null) as Verification | null)?.nameservers ?? [];
    return { object: 'dns_import' as const, domain: domain.name, records: records.map(record => ({ ...record, priority: record.priority ?? null, ttl: record.ttl ?? 3600 })), nameservers };
  }

  /** Copies the records the reseller confirmed to Vercel's DNS, ready for when the nameservers move. */
  async importRecords(resellerId: string, storeId: string, id: string, records: RecordInput[]) {
    const domain = await this.domainOf(resellerId, storeId, id);
    if (domain.dnsMode === 'vercel') throw conflict('dns_on_vercel', 'This domain’s DNS is already managed here.');
    const problems = records.map((record, index) => [index, recordProblem(record)] as const).filter(([, problem]) => problem);
    if (problems.length) throw invalid('record_invalid', `Record ${problems[0][0] + 1}: ${problems[0][1]}`, 'records');
    const vercel = this.vercel;
    const existing = await vercel.records(domain.name).catch(() => []);
    let created = 0;
    for (const record of records) {
      const name = record.name.trim().toLowerCase().replace(/^@$/, '');
      if (existing.some(item => item.name === name && item.type === record.type && item.value === record.value.trim())) continue;
      await vercel.createRecord(domain.name, { name, type: record.type, value: record.value.trim(), ttl: record.ttl, mxPriority: record.priority, comment: managedComment('imported') });
      created += 1;
    }
    const nameservers = ((domain.verification ?? null) as Verification | null)?.nameservers ?? [];
    return { object: 'dns_import' as const, domain: domain.name, created, nameservers };
  }

  // Email ------------------------------------------------------------------------------------------------------------------

  /**
   * Points the domain's email to a mailbox provider: on Vercel's DNS the records are written (and the previous provider's
   * removed); otherwise they are returned for the reseller to add at their DNS host.
   */
  async setMailProvider(resellerId: string, storeId: string, id: string, input: { provider: MailProvider | null; verification?: string }) {
    const domain = await this.domainOf(resellerId, storeId, id);
    const records = input.provider ? mailRecords(input.provider, domain.name, input.verification) : [];
    if (domain.dnsMode === 'vercel') {
      const vercel = this.vercel;
      const current = await vercel.records(domain.name);
      for (const record of current.filter(item => item.comment === managedComment('mail'))) await vercel.deleteRecord(domain.name, record.id);
      if (input.provider) {
        // Another MX or SPF at the domain itself would split the mail: those go (imported ones included) before the provider's.
        for (const record of current.filter(item => item.name === '' && (item.type === 'MX' || (item.type === 'TXT' && item.value.startsWith('v=spf1'))) && !isManaged(item.comment))) {
          await vercel.deleteRecord(domain.name, record.id);
        }
        for (const record of records) await vercel.createRecord(domain.name, { name: record.name, type: record.type, value: record.value, ttl: 3600, mxPriority: record.priority, comment: managedComment('mail') });
      }
    }
    await this.prisma.storeDomain.update({ where: { id }, data: { mailProvider: input.provider } });
    return {
      object: 'mail_setup' as const,
      domain: domain.name,
      provider: input.provider,
      provider_name: input.provider ? mailProviders[input.provider].name : null,
      written: domain.dnsMode === 'vercel',
      records: records.map(record => ({ type: record.type, name: record.name || '@', value: record.value, priority: record.priority ?? null })),
    };
  }

  /** Sends the store's order emails from `orders@<domain>`: the domain is verified with Resend (records written on Vercel DNS). */
  async enableSending(resellerId: string, storeId: string, id: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    if (domain.status !== 'active') throw conflict('domain_not_active', 'Connect the domain to your store first.');
    const { resend } = this.clients();
    if (!resend) throw unavailable('Sending from your domain is not available yet.');
    let sending = domain.emailDomainId ? await resend.get(domain.emailDomainId).catch(() => null) : null;
    if (!sending) {
      sending = await resend.create(domain.name).catch(error => {
        throw error instanceof ProviderError && error.definite ? conflict('email_domain_refused', 'This domain cannot be set up for sending. Contact support.') : unavailable();
      });
    }
    if (domain.dnsMode === 'vercel') {
      const vercel = this.vercel;
      const current = await vercel.records(domain.name);
      for (const record of sending.records) {
        const name = record.name.replace(new RegExp(`\\.?${domain.name.replace(/\./g, '\\.')}$`), '');
        if (current.some(item => item.name === name && item.type === record.type && item.value === record.value)) continue;
        await vercel.createRecord(domain.name, { name, type: record.type, value: record.value, ttl: 3600, mxPriority: record.priority, comment: managedComment('email') });
      }
    }
    await resend.verify(sending.id).catch(() => undefined);
    await this.prisma.storeDomain.update({ where: { id }, data: { emailDomainId: sending.id, emailStatus: sending.status, emailRecords: sending.records as unknown as Prisma.InputJsonValue } });
    return this.present(await this.prisma.storeDomain.findUniqueOrThrow({ where: { id } }));
  }

  private async refreshSending(domain: StoreDomain) {
    const { resend } = this.clients();
    if (!domain.emailDomainId || !resend || domain.emailStatus === 'verified') return {};
    const sending = await resend.get(domain.emailDomainId).catch(() => null);
    if (!sending) return {};
    if (sending.status !== 'verified') await resend.verify(sending.id).catch(() => undefined);
    return { emailStatus: sending.status, emailRecords: sending.records as unknown as Prisma.InputJsonValue };
  }

  /** The from address for a reseller's store emails: their own domain once verified for sending, else null (BitoCard's). */
  senderFor(resellerId: string, displayName: string) {
    return domainSender(this.prisma, resellerId, displayName);
  }

  // Renewals ---------------------------------------------------------------------------------------------------------------

  /** Renews a domain bought here for a year, paid from the wallet first (owners can renew early from SHQ). */
  async renew(resellerId: string, storeId: string, id: string) {
    const domain = await this.domainOf(resellerId, storeId, id);
    await this.renewDomain(domain);
    return this.present(await this.prisma.storeDomain.findUniqueOrThrow({ where: { id } }));
  }

  private async renewDomain(domain: StoreDomain) {
    if (domain.source !== 'purchased' || !domain.expiresAt || !['active', 'pending', 'expired'].includes(domain.status)) throw conflict('not_renewable', 'Only domains bought here are renewed through BitoCard.');
    if (domain.renewalError === 'renewal_pending') throw conflict('renewal_pending', 'A renewal is being confirmed. Nothing more will be taken for it.');
    await this.invoices.requireCredit(domain.resellerId);
    const period = domain.expiresAt.toISOString();
    const claimed = await this.prisma.storeDomain.updateMany({
      where: { id: domain.id, OR: [{ renewalAttemptAt: null }, { renewalAttemptAt: { lt: new Date(Date.now() - 5 * 60_000) } }] },
      data: { renewalAttemptAt: new Date() },
    });
    if (claimed.count === 0) throw conflict('renewal_in_progress', 'This domain is being renewed. Try again in a few minutes.');
    const vercel = this.vercel;
    const cost = await vercel.price(domain.name);
    if (await this.renewsFree(domain)) {
      // Udozo's free domain, while its store keeps Premium: renewed with nothing taken from the wallet.
      try {
        await vercel.renew(domain.name, { years: 1, costCents: cost.renewalCents });
      } catch (error) {
        if (error instanceof ProviderError && error.definite) {
          await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { renewalError: 'renewal_failed' } });
          throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'renewal_failed', 'The domain could not be renewed right now. Nothing was taken from your wallet.');
        }
        await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { renewalError: 'renewal_pending', holdId: null, costCents: cost.renewalCents } });
        return;
      }
      await this.finishRenewal(domain, null, cost.renewalCents, period);
      return;
    }
    const price = this.priceFor(cost.renewalCents);
    const { currency } = await this.wallets.currencyOf(domain.resellerId);
    const amount = currency === 'USD' ? BigInt(price) : (await this.fx.chargeForUsdCents(price, currency)).amount;
    let hold;
    try {
      hold = await this.wallets.hold({ resellerId: domain.resellerId, mode: 'live', amount, reference: `domain:${domain.id}:renew:${period}`, description: `Domain renewal: ${domain.name}` });
    } catch (error) {
      await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { renewalError: 'insufficient_funds' } });
      await this.inbox.reseller(domain.resellerId, 'domain.renewal_failed', {
        subject: `${domain.id}:renewal_failed:${period}:${new Date().toISOString().slice(0, 10)}`,
        title: `${domain.name} could not be renewed`,
        body: `Top up your wallet: it expires on ${period.slice(0, 10)}, and your store and email on it stop then.`,
        link: '/wallet',
      });
      throw error;
    }
    try {
      await vercel.renew(domain.name, { years: 1, costCents: cost.renewalCents });
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        await this.wallets.releaseHold(hold.id, `Domain renewal not made: ${domain.name}`);
        await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { renewalError: 'renewal_failed' } });
        throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'renewal_failed', 'The domain could not be renewed right now. Nothing was taken from your wallet.');
      }
      // Unclear: the money stays held; the job checks the expiry date rather than asking again (that could renew twice).
      await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { renewalError: 'renewal_pending', holdId: hold.id, costCents: cost.renewalCents } });
      return;
    }
    await this.finishRenewal(domain, hold.id, cost.renewalCents, period);
  }

  /** `holdId` null: a free renewal (Udozo's Premium domain), with nothing held to take. */
  private async finishRenewal(domain: StoreDomain, holdId: string | null, costCents: number, period: string) {
    if (holdId) {
      const hold = await this.prisma.hold.findUniqueOrThrow({ where: { id: holdId } });
      await this.wallets.captureHold(holdId, `Domain renewed: ${domain.name}`, [{ kind: 'domain_revenue', amount: hold.amountMinor }]);
      await this.invoices.recordPaid({ resellerId: domain.resellerId, storeId: domain.storeId, currency: hold.currency, kind: 'domain', description: `Domain renewed: ${domain.name}`, amount: hold.amountMinor, reference: hold.reference });
    }
    await this.postCost(domain, `renew:${period}`, costCents);
    const info = await this.vercel.info(domain.name).catch(() => null);
    const expiresAt = info?.expiresAt ? new Date(info.expiresAt) : new Date(domain.expiresAt!.getTime() + 365 * day);
    await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { expiresAt, renewalError: null, status: domain.status === 'expired' ? 'pending' : undefined } });
    await this.inbox.reseller(domain.resellerId, 'domain.renewed', { subject: `${domain.id}:renewed:${period}`, title: `${domain.name} is renewed`, body: `Paid up until ${expiresAt.toISOString().slice(0, 10)}.`, link: '/store/domains' });
  }

  /**
   * The `domains` job: purchases waiting for the registrar, domains waiting for DNS (checked every run for a week, then
   * daily), unclear renewals (settled once the expiry moves), renewal reminders, automatic renewals and expiries.
   */
  async run() {
    const outcome = { purchases: 0, checked: 0, renewed: 0, reminded: 0, expired: 0 };
    if (!this.clients().vercel.configured()) return { ...outcome, skipped: 'domains not configured' };
    for (const domain of await this.prisma.storeDomain.findMany({ where: { status: 'purchasing' }, take: 50 })) {
      await this.checkPurchase(domain.id).catch(error => this.logger.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'Purchase check failed'));
      outcome.purchases += 1;
    }
    const week = new Date(Date.now() - 7 * day);
    const pending = await this.prisma.storeDomain.findMany({
      where: { status: { in: ['pending', 'active'] }, OR: [{ status: 'pending', createdAt: { gte: week } }, { lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - day) } }] },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
    });
    for (const domain of pending) {
      await this.refresh(domain.id);
      outcome.checked += 1;
    }
    const purchased = await this.prisma.storeDomain.findMany({ where: { source: 'purchased', status: { in: ['active', 'pending', 'expired'] }, expiresAt: { not: null } }, take: 200 });
    for (const domain of purchased) {
      const left = domain.expiresAt!.getTime() - Date.now();
      if (domain.renewalError === 'renewal_pending' && (domain.holdId || domain.free)) {
        const info = await this.vercel.info(domain.name).catch(() => null);
        if (info?.expiresAt && info.expiresAt > domain.expiresAt!.getTime() + 30 * day) {
          await this.finishRenewal(domain, domain.holdId, domain.costCents ?? 0, domain.expiresAt!.toISOString());
          outcome.renewed += 1;
        } else if (Date.now() - (domain.renewalAttemptAt?.getTime() ?? 0) > day) {
          await this.inbox.admins('admin.domain.renewal_unclear', { subject: `${domain.id}:${domain.expiresAt!.toISOString()}`, title: `${domain.name}: renewal unconfirmed`, body: 'The renewal reply was lost and the expiry has not moved. Check it in Vercel, then settle or release the held amount.', link: '/resellers/domains' });
        }
        continue;
      }
      if (left < 0 && domain.status !== 'expired') {
        await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { status: 'expired', primary: false } });
        await this.liveOnlyOnDomain(domain.storeId);
        await this.inbox.reseller(domain.resellerId, 'domain.expired', { subject: `${domain.id}:expired:${domain.expiresAt!.toISOString()}`, title: `${domain.name} has expired`, body: 'Your store and email on it have stopped. Renew it now to get them back before it is released.', link: '/store/domains' });
        outcome.expired += 1;
        continue;
      }
      const reminded = (domain.remindedAt ?? {}) as Record<string, string>;
      for (const days of reminderDays) {
        const key = `${domain.expiresAt!.toISOString()}:${days}`;
        if (left > 0 && left <= days * day && !reminded[key] && !(domain.autoRenew && left <= renewBeforeMs && days > 1)) {
          await this.inbox.reseller(domain.resellerId, 'domain.renewal_due', {
            subject: `${domain.id}:${key}`,
            title: `${domain.name} expires in ${days} ${days === 1 ? 'day' : 'days'}`,
            body: domain.autoRenew ? 'It renews automatically from your wallet. Keep enough in it to cover the renewal.' : 'Automatic renewal is off: renew it from your store’s domains, or your store and email on it stop when it expires.',
            link: '/store/domains',
          });
          await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { remindedAt: { ...reminded, [key]: new Date().toISOString() } } });
          outcome.reminded += 1;
          break;
        }
      }
      if (domain.autoRenew && left <= renewBeforeMs && domain.renewalError !== 'insufficient_funds') {
        await this.renewDomain(domain).then(
          () => (outcome.renewed += 1),
          error => this.logger.warn({ err: error instanceof Error ? error.message : 'unknown', domainId: domain.id }, 'Automatic renewal not made'),
        );
      } else if (domain.autoRenew && left <= renewBeforeMs && domain.renewalError === 'insufficient_funds' && Date.now() - (domain.renewalAttemptAt?.getTime() ?? 0) > 12 * 3600_000) {
        // Funds were short: tried again twice a day until it expires.
        await this.prisma.storeDomain.update({ where: { id: domain.id }, data: { renewalError: null } });
      }
    }
    return outcome;
  }

  // Storefront and admins ----------------------------------------------------------------------------------------------------

  /** Public: which store a custom domain serves (active domains of published stores only). */
  async storefrontFor(host: string) {
    const name = domainName(host);
    const domain = name ? await this.prisma.storeDomain.findFirst({ where: { name, status: 'active' }, include: { store: { include: { reseller: true } } } }) : null;
    if (!domain || domain.store.status !== 'published' || domain.store.reseller.status === 'suspended') {
      throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No store is served on this domain.');
    }
    return { object: 'storefront_domain' as const, domain: domain.name, subdomain: domain.store.subdomain };
  }

  /** A store's main domain while it works, else null. */
  async primaryFor(storeId: string) {
    return (await this.prisma.storeDomain.findFirst({ where: { storeId, status: 'active', primary: true }, select: { name: true } }))?.name ?? null;
  }

  async adminList(query: { status?: string; q?: string }) {
    const domains = await this.prisma.storeDomain.findMany({
      where: { ...(query.status ? { status: query.status as StoreDomain['status'] } : { status: { not: 'removed' } }), ...(query.q ? { name: { contains: query.q.toLowerCase() } } : {}) },
      include: { store: { select: { name: true, subdomain: true } }, reseller: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { object: 'list' as const, data: domains.map(domain => ({ ...this.present(domain), reseller: { id: domain.resellerId, name: domain.reseller.name }, store: { id: domain.storeId, name: domain.store.name, subdomain: domain.store.subdomain }, cost: domain.costCents !== null ? { amount: domain.costCents, currency: 'USD' } : null })) };
  }

  /** Abuse or a dispute: the store stops being served on the domain (audited); reinstating serves it again. */
  /**
   * Udozo's stores take live payments only on their own domain (docs/UDOZO_SPINOFF_PLAN.md, step 3): a live store left
   * with no active domain goes back to the sandbox, and its reseller is told. Nothing on BitoCard.
   */
  async liveOnlyOnDomain(storeId: string) {
    if (this.appConfig.APP_PRODUCT !== 'udozo') return false;
    const active = await this.prisma.storeDomain.count({ where: { storeId, status: 'active' } });
    if (active > 0) return false;
    const moved = await this.prisma.store.updateMany({ where: { id: storeId, checkoutMode: 'live' }, data: { checkoutMode: 'test' } });
    if (moved.count === 0) return false;
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true, resellerId: true, updatedAt: true } });
    await this.inbox.reseller(store.resellerId, 'store.sandbox_without_domain', {
      subject: `${storeId}:sandbox:${store.updatedAt.toISOString()}`,
      title: `${store.name} is back in the sandbox`,
      body: 'It has no working domain, so it cannot take live payments. Connect or renew a domain, then switch it live again.',
      link: '/store/domains',
    });
    return true;
  }

  /** The `domains` job's sweep: every live Udozo store that has lost its last active domain goes back to the sandbox. */
  async liveStoresWithoutDomain() {
    if (this.appConfig.APP_PRODUCT !== 'udozo') return 0;
    const stores = await this.prisma.store.findMany({ where: { checkoutMode: 'live', reseller: { house: false }, domains: { none: { status: 'active' } } }, select: { id: true }, take: 100 });
    let moved = 0;
    for (const store of stores) if (await this.liveOnlyOnDomain(store.id)) moved += 1;
    return moved;
  }

  async adminSuspend(actorId: string | null, id: string, input: { reason: string }) {
    const before = await this.prisma.storeDomain.findUnique({ where: { id } });
    if (!before || ['removed', 'failed', 'purchasing'].includes(before.status)) throw missing();
    if (before.status === 'suspended') throw conflict('already_suspended', 'This domain is already suspended.');
    await this.vercel.removeFromProject(before.name);
    await this.vercel.removeFromProject(`www.${before.name}`);
    const after = await this.prisma.storeDomain.update({ where: { id }, data: { status: 'suspended', primary: false, lastError: input.reason.trim() } });
    await this.liveOnlyOnDomain(before.storeId);
    await this.audit.record({ actorId, action: 'domain.suspended', targetType: 'store_domain', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
    await this.inbox.reseller(before.resellerId, 'domain.suspended', { subject: `${id}:suspended:${after.updatedAt.toISOString()}`, title: `${before.name} is suspended`, body: 'Your store is no longer served on it. Contact support to find out why.', link: '/store/domains' });
    return this.present(after);
  }

  async adminReinstate(actorId: string | null, id: string, input: { reason: string }) {
    const before = await this.prisma.storeDomain.findUnique({ where: { id } });
    if (!before) throw missing();
    if (before.status !== 'suspended') throw conflict('not_suspended', 'This domain is not suspended.');
    await this.attach(before.name, before.name.split('.').length === 2);
    await this.prisma.storeDomain.update({ where: { id }, data: { status: 'pending', lastError: null } });
    const after = await this.refresh(id);
    await this.audit.record({ actorId, action: 'domain.reinstated', targetType: 'store_domain', targetId: id, before, after: { ...after, reason: input.reason.trim() } });
    return this.present(after);
  }

  /** Test connection (Settings > Integrations > Domains): the storefront project through the token and team. */
  async test() {
    const { vercel } = this.clients();
    if (!vercel.configured()) return { ok: false, message: 'Set the API token and the storefront project first.' };
    try {
      const name = await vercel.check();
      return { ok: true, message: `Connected to the ${name} project.` };
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^vercel: /, '') : 'unknown error';
      return { ok: false, message: error instanceof ProviderError && error.definite ? `Vercel refused these settings (${detail}).` : `Could not reach Vercel (${detail}).` };
    }
  }
}
