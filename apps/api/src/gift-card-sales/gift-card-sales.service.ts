import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { GiftCardSale, GiftCardSellOffer, LedgerMode, Reseller, Store } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { urlsFor } from '../integrations/endpoints.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { checkDocument } from '../kyc/files.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { ProviderError } from '../payments/provider-error.js';
import { SettingsService } from '../settings/settings.service.js';
import { registryBrand } from '../storefront/brand-registry.js';
import { templateSells } from '../stores/templates.js';
import { matchBrand, Prestmit, type PrestmitCard, type PrestmitTrade } from './prestmit.js';

/**
 * Customers sell their gift cards through BitoCard to Prestmit (decided 15 November 2026): Prestmit pays BitoCard's
 * Prestmit wallet in naira, and BitoCard credits the customer's wallet once Prestmit approves, less BitoCard's margin
 * (PRESTMIT_SELL_MARGIN_PERCENT, or the card's own). Never credited before approval; an unclear send is looked up by
 * BitoCard's own reference before anything is decided. BitoCard's own stores only (bitocard.com and its country
 * stores), in Nigeria (Prestmit pays in naira), behind the `gift_card_selling` switch. BitoCard's sandbox never calls
 * Prestmit to sell: its sales are decided with `simulate`.
 */

/** Prestmit pays in naira, so only customers whose wallet is in naira can sell. */
const payoutCountries: Record<string, string> = { NG: 'NGN' };
const maxAmount = 10_000;
const maxPhotos = 20;
/** Photos up to 4 MB each (Prestmit takes 5 MB), JPEG or PNG, checked from their bytes and stripped of metadata. */
const checkDelays = [15, 30, 60, 120, 360].map(minutes => minutes * 60_000);
const lateCheck = 12 * 60 * 60_000;
/** An unclear send Prestmit still has no trade for after this was never taken. */
const lostAfterMs = 30 * 60_000;
const syncEveryMs = 6 * 60 * 60_000;

export type SalePhoto = { name: string; type: string; data: Buffer };
export type SaleInput = { offer_id: string; amount: number; expected_payout?: number; code?: string };

const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such sale.');

export { matchBrand } from './prestmit.js';

/** A margin percentage (up to 2 decimals) in basis points; null when unset. */
export function marginBpsOf(percent: string | undefined) {
  if (!percent?.trim()) return null;
  const value = Math.round(Number(percent) * 100);
  return Number.isFinite(value) && value >= 0 && value <= 5000 ? value : null;
}

/** The provider's rate in kobo per unit, rounded down. */
const rateMinor = (rate: string | { toString(): string }) => BigInt(Math.floor(Number(rate.toString()) * 100));

/** What the customer gets of a total: the total less BitoCard's margin, rounded down. */
export const afterMargin = (total: bigint, marginBps: number) => (total * BigInt(10_000 - marginBps)) / 10_000n;

/** The most a reseller keeps of BitoCard's payout when PRESTMIT_RESELLER_SPREAD_CAP_PERCENT is unset: 10%. */
export const defaultSpreadCapBps = 1000;

/**
 * Who buys the card on a store: BitoCard's own stores (no reseller, no cut), or a reseller's store, where the reseller
 * keeps `spreadBps` of BitoCard's payout. `mode` follows the store (a reseller's store is the sandbox until it goes live).
 */
type Buyer = { resellerId: string | null; spreadBps: number; mode: LedgerMode; currency: string };

/** Whether a reseller's store's template sells gift cards (a single-product store only when its product is one). */
function templateSellsGiftCards(store: { template: string; focus: string | null }) {
  return store.focus ? store.focus.startsWith('gift_cards:') && templateSells(store, { key: store.focus, category: 'gift_cards' }) : templateSells(store, { key: '', category: 'gift_cards' });
}

@Injectable()
export class GiftCardSalesService {
  private readonly logger = new Logger(GiftCardSalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly stores: StoreSellers,
    private readonly identity: IdentityService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** Prestmit at the address its Sandbox switch says, and which of BitoCard's modes it serves. */
  private client() {
    const config = this.integrations.config;
    const sandbox = Boolean(config.PRESTMIT_SANDBOX);
    const prestmit = new Prestmit({ apiKey: config.PRESTMIT_API_KEY, apiSecret: config.PRESTMIT_API_SECRET, baseUrl: urlsFor(config, sandbox ? 'sandbox' : 'live').PRESTMIT_API_URL });
    return { prestmit, mode: (sandbox ? 'test' : 'live') as LedgerMode };
  }

  private defaultMargin() {
    return marginBpsOf(this.integrations.config.PRESTMIT_SELL_MARGIN_PERCENT);
  }

  private marginFor(offer: Pick<GiftCardSellOffer, 'marginBps'>) {
    return offer.marginBps ?? this.defaultMargin();
  }

  private mode() {
    return this.integrations.config.CHECKOUT_SANDBOX ? ('test' as const) : ('live' as const);
  }

  // Cards Prestmit buys.

  /** Saves the cards Prestmit buys now; those it no longer lists stop being offered. Admins' brand choices are kept. */
  async sync() {
    const { prestmit, mode } = this.client();
    if (!prestmit.configured()) return { synced: false, reason: 'not_configured' };
    const cards = await prestmit.sellableCards();
    const now = new Date();
    for (const card of cards) await this.saveCard(mode, card, now);
    const gone = await this.prisma.giftCardSellOffer.updateMany({ where: { mode, provider: 'prestmit', seenAt: { lt: now }, available: true }, data: { available: false } });
    return { synced: true, mode, cards: cards.length, gone: gone.count };
  }

  private async saveCard(mode: LedgerMode, card: PrestmitCard, now: Date) {
    const fields = { name: card.name, country: card.country, countryLabel: card.countryLabel, form: card.form, rate: card.rate, minimum: card.minimum, categoryName: card.category, terms: card.terms, available: true, seenAt: now };
    const where = { provider_mode_providerCardId: { provider: 'prestmit', mode, providerCardId: card.id } };
    const existing = await this.prisma.giftCardSellOffer.findUnique({ where, select: { brandSetByAdmin: true } });
    const brand = matchBrand(card.category, card.name);
    if (existing) await this.prisma.giftCardSellOffer.update({ where, data: { ...fields, ...(existing.brandSetByAdmin ? {} : { brand }) } });
    else await this.prisma.giftCardSellOffer.create({ data: { ...fields, mode, provider: 'prestmit', providerCardId: card.id, brand } });
  }

  /** Why selling is closed for customers of a country, or null when it is open. */
  private async closedFor(country: string | null | undefined, mode: LedgerMode = this.mode()) {
    if (!country || !payoutCountries[country]) return 'country_unsupported';
    if (!(await this.settings.isOnForCountry('gift_card_selling', country))) return 'not_enabled';
    if (this.defaultMargin() === null) return 'not_configured';
    if (mode === 'live' && !this.client().prestmit.configured()) return 'not_configured';
    return null;
  }

  /** The most a reseller may keep of BitoCard's payout, in basis points. */
  private spreadCap() {
    return marginBpsOf(this.integrations.config.PRESTMIT_RESELLER_SPREAD_CAP_PERCENT) ?? defaultSpreadCapBps;
  }

  /**
   * The reseller's cut, set by itself from what they already charge: their gift card markup (else their general
   * markup), held to the cap. They never set it apart: their customers sell at BitoCard's rate less the same share.
   */
  async resellerSpread(resellerId: string) {
    const rows = await this.prisma.resellerMarkup.findMany({ where: { resellerId, productId: null, OR: [{ category: 'gift_cards' }, { category: null }] } });
    const markup = rows.find(row => row.category === 'gift_cards')?.markupBps ?? rows.find(row => row.category === null)?.markupBps ?? 0;
    return Math.min(Math.max(markup, 0), this.spreadCap());
  }

  /**
   * Who buys cards on a store, or why it does not. BitoCard's own stores in the customer's country; a reseller's store
   * in its reseller's country, while `reseller_gift_card_buyback` is on for them (off by default), its template sells
   * gift cards, and, live, the reseller is verified.
   */
  private async buyerAt(store: Store & { reseller: Reseller }, customerCountry: string | null | undefined): Promise<{ buyer: Buyer } | { reason: string }> {
    if (this.stores.isHouse(store)) {
      const reason = await this.closedFor(customerCountry);
      return reason ? { reason } : { buyer: { resellerId: null, spreadBps: 0, mode: this.mode(), currency: payoutCountries[customerCountry!] } };
    }
    const reseller = store.reseller;
    if (store.status !== 'published' || reseller.status === 'suspended') return { reason: 'store_unavailable' };
    if (!templateSellsGiftCards(store)) return { reason: 'store_unavailable' };
    if (!(await this.settings.isOn('reseller_gift_card_buyback', reseller.id))) return { reason: 'store_unavailable' };
    const mode = this.stores.mode(store);
    if (mode === 'live' && reseller.status !== 'active') return { reason: 'store_unavailable' };
    const reason = await this.closedFor(reseller.country, mode);
    if (reason) return { reason };
    return { buyer: { resellerId: reseller.id, spreadBps: await this.resellerSpread(reseller.id), mode, currency: payoutCountries[reseller.country!] } };
  }

  /**
   * What a customer in `country` can sell of a product (`gift_cards:US:amazon`): the cards Prestmit buys of that
   * brand and country, each at its rate after BitoCard's margin. Public (it says nothing about anyone).
   */
  async offersFor(productKey: string | undefined, country: string | undefined, store?: string) {
    const code = country?.toUpperCase();
    // bitocard.com, or a reseller's store where buy back is on (`buyerAt`).
    const at = await this.stores.resolve(store && store !== 'bitocard' ? store : null).catch(() => null);
    const found = at ? await this.buyerAt(at, code) : { reason: 'store_unavailable' };
    const reason = 'reason' in found ? found.reason : null;
    const buyer = 'buyer' in found ? found.buyer : null;
    const currency = buyer?.currency ?? (code && payoutCountries[code]) ?? null;
    const empty = { object: 'gift_card_sell_options' as const, available: false, reason, currency, offers: [] as ReturnType<GiftCardSalesService['presentOffer']>[] };
    if (!buyer) return empty;
    const where: Record<string, unknown> = { mode: buyer.mode, provider: 'prestmit', enabled: true, available: true, brand: { not: null } };
    if (productKey) {
      const [category, keyCountry, keyBrand] = productKey.split(':');
      if (category !== 'gift_cards' || !keyCountry || !keyBrand) return { ...empty, reason: 'not_sellable' };
      // The product's own brand and country, not the key's: synced keys often carry a variant there
      // (`gift_cards:US:amazon-us` is brand `amazon`).
      const product = await this.prisma.product.findUnique({ where: { key: productKey }, select: { brand: true, country: true } });
      const brand = product?.brand || keyBrand;
      const productCountry = product?.country || keyCountry;
      const entry = registryBrand(brand)?.slug;
      where.brand = { in: [...new Set([brand, ...(entry ? [entry] : [])])] };
      where.country = productCountry === 'WW' ? null : productCountry;
    }
    const offers = await this.prisma.giftCardSellOffer.findMany({ where, orderBy: [{ rate: 'desc' }, { name: 'asc' }], take: productKey ? 20 : 500 });
    const shown = offers.filter(offer => this.marginFor(offer) !== null).map(offer => this.presentOffer(offer, buyer.currency, buyer.spreadBps));
    return { ...empty, available: shown.length > 0, reason: shown.length ? null : 'not_sellable', offers: productKey ? shown : shown.slice(0, 0), count: shown.length };
  }

  private presentOffer(offer: GiftCardSellOffer, currency: string, spreadBps = 0) {
    const margin = this.marginFor(offer) ?? 0;
    return {
      id: offer.id,
      name: offer.name,
      form: offer.form,
      minimum: offer.minimum,
      maximum: maxAmount,
      currency,
      /** What the customer gets per unit of the card's value, in minor units. */
      rate: Number(afterMargin(afterMargin(rateMinor(offer.rate), margin), spreadBps)),
      terms: offer.terms,
    };
  }

  // Selling.

  private async open(customer: CustomerWithStore): Promise<Buyer> {
    if (!customer.emailVerifiedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    const store = this.stores.isHouse(customer.store) ? { ...customer.store, reseller: { house: true } as Reseller } : await this.prisma.store.findUniqueOrThrow({ where: { id: customer.storeId }, include: { reseller: true } });
    const found = await this.buyerAt(store as Store & { reseller: Reseller }, customer.country);
    if ('reason' in found) {
      if (found.reason === 'store_unavailable') throw conflict('gift_card_selling_unavailable', 'Selling gift cards is not available in this store.');
      throw conflict('gift_card_selling_unavailable', found.reason === 'country_unsupported' ? 'Selling gift cards is not available in your country yet.' : 'Selling gift cards is not available right now.');
    }
    return found.buyer;
  }

  private async offer(id: string, mode: LedgerMode) {
    const offer = await this.prisma.giftCardSellOffer.findFirst({ where: { id, mode, enabled: true, available: true } });
    if (!offer || this.marginFor(offer) === null) throw invalid('card_unavailable', 'This card cannot be sold right now.', 'offer_id');
    return offer;
  }

  private price(offer: GiftCardSellOffer, amount: number, spreadBps: number) {
    if (!Number.isInteger(amount) || amount < offer.minimum || amount > maxAmount) {
      throw invalid('amount_out_of_range', `Enter a whole amount from ${offer.minimum} to ${maxAmount}.`, 'amount');
    }
    const margin = this.marginFor(offer)!;
    const total = rateMinor(offer.rate) * BigInt(amount);
    return { margin, total, payout: afterMargin(afterMargin(total, margin), spreadBps) };
  }

  /** What the customer would get for a card of this value, before sending it. */
  async quote(customer: CustomerWithStore, offerId: string, amount: number) {
    const { currency, mode, spreadBps } = await this.open(customer);
    const offer = await this.offer(offerId, mode);
    const { payout } = this.price(offer, amount, spreadBps);
    return { object: 'gift_card_sale_quote' as const, offer_id: offer.id, amount, currency, payout: Number(payout) };
  }

  /**
   * Sends the customer's card to Prestmit: photos of a physical card (1 to 20) or an e-code's code. Nothing is
   * credited until Prestmit approves it. `expected_payout`, when sent, is what the customer saw: less is refused.
   */
  async create(customer: CustomerWithStore, input: SaleInput, files: SalePhoto[]) {
    const { currency, mode, resellerId, spreadBps } = await this.open(customer);
    const offer = await this.offer(input.offer_id, mode);
    const { margin, payout } = this.price(offer, Number(input.amount), spreadBps);
    if (input.expected_payout !== undefined && payout < BigInt(input.expected_payout)) {
      throw conflict('rate_changed', `The rate for this card has changed: you would now get ${formatMoney(payout, currency)}. Check it and send again.`);
    }
    if (mode === 'live' && !(await this.identity.isCustomerVerified((await this.stores.sellerFor(customer)).id, mode, customer.id))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'customer_verification_required', 'Verify your identity before selling a gift card. It takes a few minutes and is needed once.');
    }
    const code = input.code?.trim();
    const form = code ? 'ecode' : 'physical';
    if (form === 'ecode' && offer.form === 'physical') throw invalid('photos_required', 'This card is bought as a physical card: send photos of it.', 'photos');
    if (form === 'physical' && offer.form === 'ecode') throw invalid('code_required', 'This card is bought as an e-code: send its code.', 'code');
    if (code && (code.length < 4 || code.length > 200)) throw invalid('parameter_invalid', 'Enter the card’s code as it is written (4 to 200 characters).', 'code');
    if (code && files.length) throw invalid('parameter_invalid', 'Send the code or photos, not both.', 'photos');
    const photos = form === 'physical' ? this.checkPhotos(files) : [];

    const sale = await this.prisma.giftCardSale.create({
      data: {
        mode,
        customerId: customer.id,
        storeId: customer.storeId,
        offerId: offer.id,
        form,
        amount: Number(input.amount),
        currency,
        rate: offer.rate,
        marginBps: margin,
        resellerId,
        resellerSpreadBps: spreadBps,
        quotedMinor: payout,
        codeHint: code ? code.slice(-4) : null,
        photos: photos.length,
      },
    });
    if (mode === 'test') {
      // BitoCard's sandbox never sells to Prestmit: decided with `simulate`.
      return this.present(await this.prisma.giftCardSale.update({ where: { id: sale.id }, data: { status: 'pending', providerReference: `SANDBOX-${sale.number}` } }), offer);
    }
    try {
      const trade = await this.client().prestmit.createTrade({ cardId: offer.providerCardId, amount: sale.amount, uniqueIdentifier: this.reference(sale), code, photos });
      const saved = await this.prisma.giftCardSale.update({ where: { id: sale.id }, data: { status: 'pending', providerReference: trade.reference || null, nextCheckAt: new Date(Date.now() + checkDelays[0]) } });
      return this.present(await this.apply(saved, trade), offer);
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        this.logger.warn({ err: error, sale: sale.id }, 'Prestmit refused a gift card sale');
        const failed = await this.prisma.giftCardSale.update({ where: { id: sale.id }, data: { status: 'failed', rejectionReason: 'Prestmit could not take this card. Check its details and try again.', decidedAt: new Date() } });
        return this.present(failed, offer);
      }
      // Unclear: Prestmit may have the trade. Looked up by BitoCard's reference before anything is decided.
      this.logger.warn({ err: error, sale: sale.id }, 'Gift card sale sent without a clear answer');
      return this.present(await this.prisma.giftCardSale.update({ where: { id: sale.id }, data: { nextCheckAt: new Date(Date.now() + 5 * 60_000) } }), offer);
    }
  }

  private checkPhotos(files: SalePhoto[]) {
    if (!files.length) throw invalid('photos_required', 'Add photos of the card: its front and its back with the code showing.', 'photos');
    if (files.length > maxPhotos) throw invalid('parameter_invalid', `Send at most ${maxPhotos} photos.`, 'photos');
    return files.map((file, index) => {
      const checked = checkDocument(file.data, file.type, false);
      if ('problem' in checked) throw invalid('upload_invalid', checked.problem, 'photos');
      return { name: `card-${index + 1}.${checked.contentType === 'image/png' ? 'png' : 'jpg'}`, type: checked.contentType, data: checked.bytes };
    });
  }

  /** BitoCard's reference on Prestmit's trade (`uniqueIdentifier`), the same every time. */
  private reference(sale: Pick<GiftCardSale, 'id'>) {
    return `bc_gs_${sale.id.replace(/-/g, '')}`;
  }

  /** Applies what Prestmit says of a trade: approved credits the wallet once, rejected closes it, anything else waits. */
  private async apply(sale: GiftCardSale, trade: PrestmitTrade): Promise<GiftCardSale> {
    if (trade.status === 'COMPLETED' || trade.status === 'APPROVED') return this.complete(sale, trade.totalAmount);
    if (trade.status === 'REJECTED') return this.reject(sale, trade.rejectionReason);
    return sale;
  }

  private async complete(sale: GiftCardSale, totalNaira: number | null) {
    const total = totalNaira !== null ? BigInt(Math.round(totalNaira * 100)) : rateMinor(sale.rate) * BigInt(sale.amount);
    // BitoCard keeps its margin of what Prestmit paid; a reseller's store keeps its cut of the rest.
    const bitocardPays = afterMargin(total, sale.marginBps);
    const payout = afterMargin(bitocardPays, sale.resellerSpreadBps);
    const margin = total - bitocardPays;
    const earning = sale.resellerId ? bitocardPays - payout : 0n;
    const reseller = earning > 0n ? await this.prisma.reseller.findUniqueOrThrow({ where: { id: sale.resellerId! }, include: { countryRef: true } }) : null;
    const entry = await this.ledger.prepare({
      mode: sale.mode,
      type: 'gift_card_sale',
      reference: `gift_card_sale:${sale.id}`,
      resellerId: sale.resellerId,
      description: `Gift card sold (GS-${String(sale.number).padStart(6, '0')})`,
      metadata: { gift_card_sale_id: sale.id, provider: 'prestmit', provider_reference: sale.providerReference },
      lines: [
        { account: { kind: 'supplier_float', currency: sale.currency, provider: 'prestmit' }, debit: total },
        ...(payout > 0n ? [{ account: { kind: 'customer_wallet' as const, currency: sale.currency, customerId: sale.customerId }, credit: payout }] : []),
        ...(margin > 0n ? [{ account: { kind: 'platform_revenue' as const, currency: sale.currency }, credit: margin }] : []),
        ...(earning > 0n ? [{ account: { kind: 'reseller_earnings_held' as const, currency: sale.currency, resellerId: sale.resellerId! }, credit: earning }] : []),
      ],
    });
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.giftCardSale.updateMany({
        where: { id: sale.id, status: { in: ['submitting', 'pending'] } },
        data: { status: 'completed', providerTotalMinor: total, payoutMinor: payout, resellerEarningMinor: sale.resellerId ? earning : null, decidedAt: new Date(), nextCheckAt: null },
      });
      if (!claimed.count) return null;
      const written = await this.ledger.write(tx, entry);
      // The reseller's cut waits out their market's payout hold, as a sale's profit does.
      if (reseller) {
        await tx.earningsLot.create({
          data: {
            resellerId: reseller.id,
            mode: sale.mode,
            currency: sale.currency,
            amountMinor: earning,
            reference: `gift_card_sale:${sale.id}`,
            releaseAt: new Date(Date.now() + (reseller.countryRef?.payoutHoldDays ?? 0) * 86_400_000),
          },
        });
      }
      return tx.giftCardSale.update({ where: { id: sale.id }, data: { entryId: written.id } });
    });
    if (!done) return this.prisma.giftCardSale.findUniqueOrThrow({ where: { id: sale.id } });
    await this.inbox.customer({ customerId: done.customerId, storeId: done.storeId }, 'customer.gift_card_sale.accepted', {
      subject: done.id,
      title: `${formatMoney(payout, done.currency)} added to your wallet`,
      body: 'Your gift card was accepted and the money is in your wallet.',
      link: `/account/sold/${done.id}`,
      mode: done.mode,
    });
    return done;
  }

  private async reject(sale: GiftCardSale, reason: string | null) {
    const claimed = await this.prisma.giftCardSale.updateMany({
      where: { id: sale.id, status: { in: ['submitting', 'pending'] } },
      data: { status: 'rejected', rejectionReason: reason ?? 'The card could not be accepted.', decidedAt: new Date(), nextCheckAt: null },
    });
    const done = await this.prisma.giftCardSale.findUniqueOrThrow({ where: { id: sale.id } });
    if (claimed.count) {
      await this.inbox.customer({ customerId: done.customerId, storeId: done.storeId }, 'customer.gift_card_sale.declined', {
        subject: done.id,
        title: 'Your gift card was not accepted',
        body: done.rejectionReason ?? 'The card could not be accepted.',
        link: `/account/sold/${done.id}`,
        mode: done.mode,
      });
    }
    return done;
  }

  /** Checks one sale with Prestmit by BitoCard's reference. */
  private async check(sale: GiftCardSale) {
    const { prestmit, mode } = this.client();
    if (sale.mode !== 'live' || mode !== 'live' || !prestmit.configured()) return sale;
    let trade: PrestmitTrade | null;
    try {
      trade = await prestmit.findTrade(this.reference(sale));
    } catch (error) {
      this.logger.warn({ err: error, sale: sale.id }, 'Gift card sale not checked');
      return this.later(sale);
    }
    if (!trade) {
      // Prestmit has no trade under our reference: one sent unclearly long enough ago was never taken.
      if (sale.status === 'submitting' && Date.now() - sale.createdAt.getTime() > lostAfterMs) {
        const failed = await this.prisma.giftCardSale.updateMany({ where: { id: sale.id, status: 'submitting' }, data: { status: 'failed', rejectionReason: 'The card did not reach the buyer. Nothing was taken: send it again.', decidedAt: new Date(), nextCheckAt: null } });
        if (failed.count) return this.prisma.giftCardSale.findUniqueOrThrow({ where: { id: sale.id } });
      }
      return this.later(sale);
    }
    if (sale.status === 'submitting') sale = await this.prisma.giftCardSale.update({ where: { id: sale.id }, data: { status: 'pending', providerReference: trade.reference || sale.providerReference } });
    const applied = await this.apply(sale, trade);
    return applied.status === 'pending' ? this.later(applied) : applied;
  }

  private later(sale: GiftCardSale) {
    const delay = checkDelays[sale.checks] ?? lateCheck;
    return this.prisma.giftCardSale.update({ where: { id: sale.id }, data: { checks: { increment: 1 }, nextCheckAt: new Date(Date.now() + delay) } });
  }

  /** Every 15 minutes: the cards Prestmit buys (every 6 hours) and live sales due a check. */
  async job() {
    const last = await this.prisma.giftCardSellOffer.findFirst({ where: { provider: 'prestmit', mode: this.client().mode }, orderBy: { seenAt: 'desc' }, select: { seenAt: true } });
    let sync: unknown = 'skipped';
    if (!last || Date.now() - last.seenAt.getTime() > syncEveryMs) sync = await this.sync().catch(error => ({ synced: false, reason: error instanceof Error ? error.message : 'failed' }));
    const due = await this.prisma.giftCardSale.findMany({ where: { mode: 'live', status: { in: ['submitting', 'pending'] }, nextCheckAt: { lte: new Date() } }, orderBy: { nextCheckAt: 'asc' }, take: 50 });
    let decided = 0;
    for (const sale of due) {
      const checked = await this.check(sale);
      if (checked.status !== 'pending' && checked.status !== 'submitting') decided += 1;
    }
    return { sync, checked: due.length, decided };
  }

  /** Prestmit's webhook names a trade; it is read back from Prestmit by our reference, never trusted from the body. */
  async notified(payload: unknown) {
    const data = payload && typeof payload === 'object' ? ((payload as Record<string, unknown>).data as Record<string, unknown> | undefined) : undefined;
    const identifiers = [data?.uniqueIdentifier, data?.partnersApiIdentifier, data?.unique_identifier].filter((value): value is string => typeof value === 'string');
    const id = identifiers.map(value => /^bc_gs_([0-9a-f]{32})$/.exec(value)?.[1]).find(Boolean);
    if (!id) return { received: true };
    const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
    const sale = await this.prisma.giftCardSale.findUnique({ where: { id: uuid } });
    if (sale && (sale.status === 'pending' || sale.status === 'submitting')) await this.check(sale);
    return { received: true };
  }

  /** BitoCard's sandbox: decides a pending sale as Prestmit would. */
  async simulate(customer: CustomerWithStore, id: string, outcome: 'approved' | 'rejected') {
    const sale = await this.own(customer, id);
    if (sale.mode !== 'test') throw conflict('live_sale', 'Only sandbox sales can be simulated.');
    if (sale.status !== 'pending') throw conflict('sale_closed', 'This sale has already been decided.');
    const done = outcome === 'approved' ? await this.complete(sale, null) : await this.reject(sale, 'The card’s code was already used (sandbox).');
    return this.present(done, await this.prisma.giftCardSellOffer.findUniqueOrThrow({ where: { id: done.offerId } }));
  }

  private async own(customer: CustomerWithStore, id: string) {
    const sale = await this.prisma.giftCardSale.findFirst({ where: { id, customerId: customer.id } });
    if (!sale) throw notFound();
    return sale;
  }

  async list(customer: CustomerWithStore) {
    const sales = await this.prisma.giftCardSale.findMany({ where: { customerId: customer.id }, include: { offer: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { object: 'list' as const, data: sales.map(sale => this.present(sale, sale.offer)) };
  }

  async get(customer: CustomerWithStore, id: string) {
    const sale = await this.own(customer, id);
    return this.present(sale, await this.prisma.giftCardSellOffer.findUniqueOrThrow({ where: { id: sale.offerId } }));
  }

  /** A sale as the customer sees it: never Prestmit's name, its rate or BitoCard's margin. */
  present(sale: GiftCardSale, offer: Pick<GiftCardSellOffer, 'name' | 'brand' | 'country'>) {
    const brand = offer.brand ? registryBrand(offer.brand) : null;
    return {
      object: 'gift_card_sale' as const,
      id: sale.id,
      number: `GS-${String(sale.number).padStart(6, '0')}`,
      mode: sale.mode,
      status: sale.status === 'submitting' ? 'pending' : sale.status,
      card: { name: offer.name, brand: brand?.name ?? null, brand_slug: offer.brand, country: offer.country },
      form: sale.form,
      amount: sale.amount,
      currency: sale.currency,
      quoted: Number(sale.quotedMinor),
      paid: sale.payoutMinor === null ? null : Number(sale.payoutMinor),
      code_hint: sale.codeHint,
      photos: sale.photos,
      reason: sale.rejectionReason,
      created_at: sale.createdAt.toISOString(),
      decided_at: sale.decidedAt?.toISOString() ?? null,
    };
  }

  // Resellers.

  /**
   * Buy back on the reseller's stores: whether it is open for them, their cut (their gift card markup, capped) and the
   * cards their customers sold, with what each customer got and what the reseller earned. Never Prestmit's name, its
   * rate or BitoCard's margin.
   */
  async resellerBuyBack(resellerId: string, mode: LedgerMode) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const enabled = await this.settings.isOn('reseller_gift_card_buyback', resellerId);
    const reason = !enabled ? 'not_enabled' : await this.closedFor(reseller.country, mode);
    const sales = await this.prisma.giftCardSale.findMany({
      where: { resellerId, mode },
      include: { offer: true, customer: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      object: 'gift_card_buy_back' as const,
      mode,
      available: reason === null,
      reason,
      currency: (reseller.country && payoutCountries[reseller.country]) ?? null,
      /** Your cut of BitoCard's rate, from your gift card markup (else your general markup), up to `cap_bps`. */
      spread_bps: await this.resellerSpread(resellerId),
      cap_bps: this.spreadCap(),
      data: sales.map(sale => ({
        ...this.present(sale, sale.offer),
        customer: sale.customer,
        spread_bps: sale.resellerSpreadBps,
        earned: sale.resellerEarningMinor === null ? null : Number(sale.resellerEarningMinor),
      })),
    };
  }

  // Admins.

  async adminSales(filter: { status?: string; mode?: LedgerMode }) {
    const sales = await this.prisma.giftCardSale.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.mode ? { mode: filter.mode } : {}) },
      include: { offer: true, customer: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      object: 'list' as const,
      data: sales.map(sale => ({
        ...this.present(sale, sale.offer),
        customer: sale.customer,
        rate: sale.rate.toString(),
        margin_bps: sale.marginBps,
        provider_total: sale.providerTotalMinor === null ? null : Number(sale.providerTotalMinor),
        provider_reference: sale.providerReference,
      })),
    };
  }

  async adminOffers(mode: LedgerMode = 'live') {
    const offers = await this.prisma.giftCardSellOffer.findMany({ where: { mode, provider: 'prestmit' }, orderBy: [{ available: 'desc' }, { name: 'asc' }] });
    return {
      object: 'list' as const,
      default_margin_bps: this.defaultMargin(),
      data: offers.map(offer => ({
        id: offer.id,
        provider_card_id: offer.providerCardId,
        name: offer.name,
        category: offer.categoryName,
        country: offer.country,
        country_label: offer.countryLabel,
        form: offer.form,
        rate: offer.rate.toString(),
        minimum: offer.minimum,
        brand: offer.brand,
        brand_set_by_admin: offer.brandSetByAdmin,
        enabled: offer.enabled,
        available: offer.available,
        margin_bps: offer.marginBps,
        seen_at: offer.seenAt.toISOString(),
      })),
    };
  }

  async updateOffer(adminId: string, id: string, input: { enabled?: boolean; brand?: string | null; margin_bps?: number | null }) {
    const before = await this.prisma.giftCardSellOffer.findUnique({ where: { id } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such card.');
    if (input.brand && !registryBrand(input.brand)) throw invalid('brand_unknown', 'Choose a brand from the brand registry.', 'brand');
    const after = await this.prisma.giftCardSellOffer.update({
      where: { id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.brand !== undefined ? { brand: input.brand ? registryBrand(input.brand)!.slug : null, brandSetByAdmin: input.brand !== null } : {}),
        ...(input.margin_bps !== undefined ? { marginBps: input.margin_bps } : {}),
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'gift_card_sell_offer.changed',
      targetType: 'gift_card_sell_offer',
      targetId: id,
      before: { enabled: before.enabled, brand: before.brand, margin_bps: before.marginBps },
      after: { enabled: after.enabled, brand: after.brand, margin_bps: after.marginBps },
    });
    return (await this.adminOffers(after.mode)).data.find(offer => offer.id === id);
  }
}
