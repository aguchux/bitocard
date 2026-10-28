import { randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { HouseService } from '../checkout/house.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type CryptoAsset, type LedgerMode, type P2pAd, type P2pPaymentMethod, Prisma } from '../generated/prisma/client.js';
import { LedgerService, type PreparedEntry, type Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { SettingsService } from '../settings/settings.service.js';
import { feeFor, fiatFor, fromUnits, toUnits, unitsFor } from './amounts.js';
import { type CryptoContext, CryptoWalletsService, isTrader, notFound } from './crypto-wallets.service.js';
import { P2pFeesService } from './p2p-fees.service.js';
import { P2pStandingService } from './p2p-standing.service.js';
import { P2pTrustService, type Trust } from './p2p-trust.service.js';
import { P2pWordsService } from './p2p-words.service.js';
import { isReversible } from '../afrippa/payment-methods.service.js';

export type AdSide = 'buy' | 'sell';
const openStatuses = ['active', 'paused'];
/** Ads a customer can have open (active or paused) at once, per mode. */
export const maxOpenAds = 10;
/** Escrow ads: how long a buyer may take to pay once an order opens, and how many payment methods an ad lists. */
export const paymentWindows = [15, 30, 60] as const;
export const maxAdPaymentMethods = 5;

const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const marketUnavailable = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'market_unavailable', 'You cannot trade in this market.', 'market');

/** The global market's code: one book per asset in US dollars, across countries (stored as the ads' country). */
export const globalMarket = 'WW';
export const globalCurrency = 'USD';

/** A market a customer trades in, in one of its currencies. */
export type MarketBook = { market: string; currency: string };

/** A trader's figures: their orders (shown as `trades_30d` and `trades_total`) and trust figures. */
type Stats = { trades_30d: number; trades_total: number } & Partial<Trust>;
type Owner = { id: string; nickname: string };
/** An escrow ad's payment methods: what anyone sees (where to pay, never the details), and for its owner which of theirs. */
type AdMethod = Pick<P2pPaymentMethod, 'id' | 'kind' | 'label' | 'currency' | 'hint'>;

/**
 * Afrippa's P2P markets: traders post escrow ads, one order book per mode, market, currency and asset, and others take
 * them through orders (`P2pOrdersService`): the buyer pays the seller directly and the coins are held in escrow until
 * the seller releases them. A market is a country (its residents trade in its local currency or US dollars; residents
 * of other allowed countries in its local currency, where its `crypto_cross_border` switch is on) or the global market
 * (`WW`, US dollars only, for residents of every country where `crypto_global` is on, even where their own market is
 * off). A sell ad locks its coins (and its seller's fee) when posted; a buy ad locks nothing. BitoCard's instant trades,
 * paid from its fiat wallets, and the fiat buy ads locked are retired and dropped (docs/CRYPTO_SPINOFF_PLAN.md, step 3
 * item 8).
 */
@Injectable()
export class P2pService {
  private readonly logger = new Logger(P2pService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: CryptoWalletsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly house: HouseService,
    private readonly fees: P2pFeesService,
    private readonly standing: P2pStandingService,
    private readonly trustFigures: P2pTrustService,
    private readonly words: P2pWordsService,
  ) {}

  /** Whether other countries' residents may trade in `country`'s local book: its market open, and cross-border on there. */
  async crossBorderInto(country: string) {
    const [cross, crypto, p2p] = await Promise.all([
      this.settings.isOnForCountry('crypto_cross_border', country),
      this.settings.isOnForCountry('crypto_wallets', country),
      this.settings.isOnForCountry('p2p_trading', country),
    ]);
    return cross && crypto && p2p;
  }

  /** Whether a trader may trade in other countries' books: their own market open, or global trading open for their country. */
  private async abroadAllowed(context: CryptoContext, home: boolean) {
    return home || (await this.wallets.globalOpenFor(context.country));
  }

  /**
   * Which market and currency a customer may trade in, with every check for trading (store open, email, not frozen,
   * identity checked live), else `market_unavailable` or `currency_unsupported`:
   * - their own market (the default): its local currency or US dollars, with crypto and P2P on for their country;
   * - the global market (`WW`): US dollars, while it is open for their country, whether or not their own market is;
   * - another country's market: its local currency only, where it takes cross-border trades and the customer's own
   *   country is allowed (its own market open, or global trading open for it).
   * Only Afrippa's traders trade: anyone else is `market_unavailable`.
   */
  async access(customer: CustomerWithStore, requested?: { market?: string; currency?: string }): Promise<{ context: CryptoContext; book: MarketBook }> {
    // The market is Afrippa's: only its traders trade (BitoCard's own customers' instant trades are retired).
    if (!isTrader(customer)) throw marketUnavailable();
    const context = await this.wallets.requireOpen(customer);
    const market = (requested?.market ?? context.country).toUpperCase();
    const home = await this.wallets.homeOpen(context);
    let currency: string;
    if (market === context.country) {
      if (!home) {
        if (!(await this.wallets.enabled(context))) throw conflict('crypto_not_enabled', 'Crypto is not available in your country yet.');
        throw conflict('p2p_not_enabled', 'P2P trading is not available in your country yet.');
      }
      currency = this.tradeCurrency(context.currency, requested?.currency);
    } else if (market === globalMarket) {
      if (!(await this.wallets.globalAllowed(context, home))) throw marketUnavailable();
      currency = this.oneCurrency(globalCurrency, requested?.currency);
    } else {
      const country = /^[A-Z]{2}$/.test(market) ? await this.prisma.country.findUnique({ where: { code: market }, select: { currency: true } }) : null;
      if (!country) throw marketUnavailable();
      if (!(await this.abroadAllowed(context, home)) || !(await this.crossBorderInto(market))) throw marketUnavailable();
      currency = this.oneCurrency(country.currency, requested?.currency);
    }
    await this.wallets.requireEligible(context);
    await this.profileFor(customer.id);
    return { context, book: { market, currency } };
  }

  /**
   * The markets a customer may trade in now, their own first: their own (local and US dollars), the global market,
   * and every other country taking cross-border trades.
   */
  async markets(customer: CustomerWithStore) {
    if (!isTrader(customer)) throw marketUnavailable();
    const context = await this.wallets.requireOpen(customer);
    const home = await this.wallets.homeOpen(context);
    const global = await this.wallets.globalAllowed(context, home);
    const abroad = await this.abroadAllowed(context, home);
    const countries = await this.prisma.country.findMany({ orderBy: { name: 'asc' }, select: { code: true, name: true, currency: true } });
    const data: Array<{ object: 'p2p_market'; market: string; name: string; currencies: string[]; home: boolean; cross_border: boolean }> = [];
    const own = countries.find(country => country.code === context.country);
    if (home && own) data.push({ object: 'p2p_market', market: own.code, name: own.name, currencies: [...new Set([own.currency, globalCurrency])], home: true, cross_border: false });
    if (global) data.push({ object: 'p2p_market', market: globalMarket, name: 'Global', currencies: [globalCurrency], home: false, cross_border: true });
    if (abroad) {
      for (const country of countries) {
        if (country.code === context.country || !(await this.crossBorderInto(country.code))) continue;
        data.push({ object: 'p2p_market', market: country.code, name: country.name, currencies: [country.currency], home: false, cross_border: true });
      }
    }
    return { object: 'list' as const, data };
  }

  // -- Profiles -------------------------------------------------------------------------------------------------

  /** The customer's P2P profile, made with a generated nickname the first time. */
  private async profileFor(customerId: string) {
    const existing = await this.prisma.p2pProfile.findUnique({ where: { customerId } });
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nickname = `Trader${randomBytes(3).toString('hex').toUpperCase()}`;
      try {
        return await this.prisma.p2pProfile.create({ data: { customerId, nickname, nicknameKey: nickname.toLowerCase() } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        const raced = await this.prisma.p2pProfile.findUnique({ where: { customerId } });
        if (raced) return raced;
      }
    }
    throw new Error('Could not make a nickname');
  }

  async profile(customer: CustomerWithStore) {
    const context = await this.wallets.context(customer);
    const profile = await this.profileFor(customer.id);
    const stats = (await this.stats([customer.id], context.mode)).get(customer.id)!;
    return { object: 'p2p_profile' as const, nickname: profile.nickname, nickname_chosen: profile.chosen, ...stats };
  }

  /** Chooses the nickname others see, once (3 to 20 letters, numbers or underscores). */
  async setNickname(customer: CustomerWithStore, nickname: string) {
    const profile = await this.profileFor(customer.id);
    if (profile.chosen) throw conflict('nickname_locked', 'Your nickname is already set.', 'nickname');
    // Afrippa's traders: no contact details or refused words in a nickname.
    if (isTrader(customer)) await this.words.check(nickname, customer.country, 'nickname');
    try {
      const claimed = await this.prisma.p2pProfile.updateMany({ where: { customerId: customer.id, chosen: false }, data: { nickname, nicknameKey: nickname.toLowerCase(), chosen: true } });
      if (claimed.count !== 1) throw conflict('nickname_locked', 'Your nickname is already set.', 'nickname');
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('nickname_taken', 'Someone already uses this nickname. Choose another.', 'nickname');
      throw error;
    }
    return this.profile(customer);
  }

  /** Each trader's figures: their released orders (in the last 30 days and ever) and trust figures. */
  private async stats(ids: string[], mode: LedgerMode) {
    const result = new Map<string, Stats>(ids.map(id => [id, { trades_30d: 0, trades_total: 0 }]));
    for (const [id, trust] of await this.trustFigures.trust(ids, mode)) result.set(id, { trades_30d: trust.orders_30d, trades_total: trust.orders_total, ...trust });
    return result;
  }

  // -- The market -----------------------------------------------------------------------------------------------

  /** Fiat an ad can still take, and its limits per order now (the last part of an ad may be below its minimum). */
  private capacity(ad: P2pAd, asset: CryptoAsset) {
    const available = fiatFor(ad.remainingAmount, ad.priceMinor, asset.decimals, ad.side === 'sell');
    const max = available < ad.maxFiatMinor ? available : ad.maxFiatMinor;
    const min = available < ad.minFiatMinor ? available : ad.minFiatMinor;
    return { available, min, max };
  }

  private presentAd(ad: P2pAd, asset: CryptoAsset, owner: Owner, stats: Stats | undefined, viewerId?: string, methods: AdMethod[] = []) {
    const capacity = this.capacity(ad, asset);
    const mine = viewerId === ad.customerId;
    return {
      object: 'p2p_ad' as const,
      id: ad.id,
      mode: ad.mode,
      /** sell: the trader sells crypto (you buy from them); buy: they buy it. */
      side: ad.side as AdSide,
      asset: ad.asset,
      decimals: asset.decimals,
      currency: ad.currency,
      country: ad.country,
      /** The ad's market: a country, or `WW` for the global market. */
      market: ad.country,
      /** Fiat minor units per whole unit of the asset. */
      price: minor(ad.priceMinor),
      available: fromUnits(ad.remainingAmount, asset.decimals),
      total: fromUnits(ad.totalAmount, asset.decimals),
      filled: fromUnits(ad.filledAmount, asset.decimals),
      min_fiat: minor(capacity.min),
      max_fiat: minor(capacity.max),
      terms: ad.terms,
      status: ad.status,
      /** Taken through an order and paid directly to the seller within `payment_window` minutes. */
      payment_window: ad.paymentWindowMinutes,
      /** Where the buyer pays (sell ads) or pays from (buy ads): never the details, which show only inside an order. */
      payment_methods: methods.map(method => ({ kind: method.kind, label: method.label, currency: method.currency, reversible: isReversible(method), ...(mine ? { id: method.id, hint: method.hint } : {}) })),
      /** The owner's sell ad: the seller's fee it keeps locked on top of the coins it offers. */
      fee_locked: mine ? fromUnits(ad.feeLocked, asset.decimals) : null,
      mine,
      trader: { nickname: owner.nickname, ...(stats ?? { trades_30d: 0, trades_total: 0 }) },
      created_at: ad.createdAt.toISOString(),
      updated_at: ad.updatedAt.toISOString(),
    };
  }

  private async owners(ads: P2pAd[], mode: LedgerMode) {
    const ids = [...new Set(ads.map(ad => ad.customerId))];
    const [profiles, stats, links] = await Promise.all([
      this.prisma.p2pProfile.findMany({ where: { customerId: { in: ids } } }),
      this.stats(ids, mode),
      this.prisma.p2pAdPaymentMethod.findMany({ where: { adId: { in: ads.map(ad => ad.id) } }, include: { paymentMethod: true } }),
    ]);
    const names = new Map(profiles.map(profile => [profile.customerId, profile.nickname]));
    const methods = new Map<string, AdMethod[]>();
    for (const link of links) methods.set(link.adId, [...(methods.get(link.adId) ?? []), link.paymentMethod]);
    return { owner: (id: string): Owner => ({ id, nickname: names.get(id) ?? 'Trader' }), stats, methods };
  }

  /**
   * The order book a customer sees: to buy, the sell ads cheapest first; to sell, the buy ads paying most first.
   * Never their own ads, paused ones or ads of frozen accounts. With `fiat`, only ads that take that amount.
   */
  async market(customer: CustomerWithStore, query: { asset: string; side: AdSide; market?: string; currency?: string; q?: string; fiat?: number; limit?: number }) {
    const { context, book } = await this.access(customer, query);
    const currency = book.currency;
    const asset = await this.wallets.asset(query.asset);
    const ads = await this.book(context.mode, book, asset, query.side, customer.id, 200, query.q?.trim());
    const fiat = query.fiat !== undefined ? BigInt(query.fiat) : null;
    const usable = ads.filter(ad => {
      const capacity = this.capacity(ad, asset);
      if (capacity.available <= 0n) return false;
      return fiat === null || (fiat >= capacity.min && fiat <= capacity.max);
    });
    const shown = usable.slice(0, query.limit ?? 50);
    const { owner, stats, methods } = await this.owners(shown, context.mode);
    const fees = await this.fees.rates(asset, book.market, context.mode).catch(() => null);
    return {
      object: 'list' as const,
      market: book.market,
      asset: asset.code,
      currency,
      side: query.side,
      /** Afrippa's fees on an order here, in the coin: the buyer's from what they receive, the seller's on top. */
      fees: fees && { buyer_bps: fees.buyerBps, seller_bps: fees.sellerBps },
      data: shown.map(ad => this.presentAd(ad, asset, owner(ad.customerId), stats.get(ad.customerId), customer.id, methods.get(ad.id))),
    };
  }

  private tradeCurrency(local: string, requested?: string) {
    const currency = requested?.toUpperCase() ?? local;
    if (currency !== local && currency !== globalCurrency) throw invalid('currency_unsupported', 'Use your local wallet or your US dollar wallet.', 'currency');
    return currency;
  }

  /** A market that trades in one currency only (the global market, or another country's local book). */
  private oneCurrency(only: string, requested?: string) {
    const currency = requested?.toUpperCase() ?? only;
    if (currency !== only) throw invalid('currency_unsupported', `This market trades in ${only} only.`, 'currency');
    return currency;
  }

  /**
   * Whether an ad's owner may still trade in its market: the same checks as for the customer taking it (the market
   * open to them, their identity check, their store open, not frozen). An owner who lost any of them has their ads
   * kept off the market, and taking one is refused.
   */
  async ownerCanTrade(customerId: string, book: MarketBook, known = new Map<string, Promise<boolean>>()) {
    if (!known.has(customerId)) {
      known.set(
        customerId,
        (async () => {
          const owner = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { store: { include: { reseller: { select: { house: true } } } }, market: true } });
          if (!owner || owner.status !== 'active') return false;
          try {
            const { context } = await this.access(owner, book);
            // An Afrippa trader paused or cooling off after a lost appeal keeps their ads off the market.
            if (isTrader(owner) && (await this.standing.restriction(owner.id, context.mode))) return false;
            return true;
          } catch {
            return false;
          }
        })(),
      );
    }
    return known.get(customerId)!;
  }

  /** The ads of a book for one side. */
  private async book(mode: LedgerMode, book: MarketBook, asset: CryptoAsset, side: AdSide, viewerId: string | null, take: number, trader?: string) {
    // To buy, the viewer takes sell ads (cheapest first); to sell, buy ads (highest first).
    const adSide = side === 'buy' ? 'sell' : 'buy';
    const known = new Map<string, Promise<boolean>>();
    // Never the viewer's own ads, nor those of traders they blocked or who blocked them.
    const hidden = viewerId ? [viewerId, ...(await this.trustFigures.blockedWith(viewerId))] : [];
    const ads = await this.prisma.p2pAd.findMany({
      where: { mode, country: book.market, currency: book.currency, asset: asset.code, side: adSide, status: 'active', ...(viewerId ? { customerId: { notIn: hidden } } : {}), remainingAmount: { gt: 0 }, customer: { cryptoFrozenAt: null, ...(trader ? { p2pProfile: { nickname: { contains: trader, mode: 'insensitive' } } } : {}) } },
      orderBy: [{ priceMinor: adSide === 'sell' ? 'asc' : 'desc' }, { createdAt: 'asc' }],
      take,
    });
    const able = await Promise.all(ads.map(ad => this.ownerCanTrade(ad.customerId, book, known)));
    return ads.filter((_, index) => able[index]);
  }

  /**
   * An order's amounts against an ad: the coins (from `amount`, or the most `fiat` buys) and their fiat, rounded in the
   * ad owner's favour. Checked against the ad's limits; throws a clear refusal otherwise.
   */
  terms(ad: P2pAd, asset: CryptoAsset, input: { fiat?: number; amount?: string }) {
    let amount = input.amount !== undefined ? toUnits(input.amount, asset.decimals) : unitsFor(BigInt(input.fiat!), ad.priceMinor, asset.decimals);
    // The ad's shown maximum is its rest rounded in the owner's favour, which may buy a part of a unit more than is left:
    // asking for all of it takes the whole rest.
    if (input.amount === undefined && amount > ad.remainingAmount && BigInt(input.fiat!) >= this.capacity(ad, asset).available) amount = ad.remainingAmount;
    if (amount <= 0n) throw invalid('amount_too_small', 'This amount is too small to trade.', input.amount !== undefined ? 'amount' : 'fiat');
    if (amount > ad.remainingAmount) throw conflict('amount_unavailable', `This ad has only ${fromUnits(ad.remainingAmount, asset.decimals)} ${asset.code} left.`, 'amount');
    const whole = amount === ad.remainingAmount;
    const fiat = fiatFor(amount, ad.priceMinor, asset.decimals, ad.side === 'sell');
    if (fiat <= 0n) throw invalid('amount_too_small', 'This amount is too small to trade.', 'amount');
    if (fiat > ad.maxFiatMinor) throw invalid('above_ad_limit', `This ad takes at most ${minor(ad.maxFiatMinor) / 100} ${ad.currency} per trade.`, 'fiat');
    if (fiat < ad.minFiatMinor && !whole) throw invalid('below_ad_limit', `This ad takes at least ${minor(ad.minFiatMinor) / 100} ${ad.currency} per trade.`, 'fiat');
    return { amount, fiat };
  }

  // -- Public pages (crypto.bitocard.com) ----------------------------------------------------------------------

  /**
   * The markets BitoCard Crypto shows, with no sign-in: the global market while it is open, and every country set to
   * show (`crypto_app`, for that country by itself), with their currencies and how many ads each book has. In the
   * mode bitocard.com sells in (its Customer checkout sandbox), as the trading pages are.
   */
  async publicMarkets() {
    const mode = this.house.mode();
    const countries = await this.prisma.country.findMany({ orderBy: { name: 'asc' }, select: { code: true, name: true, currency: true } });
    const shown = [];
    for (const country of countries) if ((await this.settings.isSetFor('crypto_app', { countryCode: country.code })) === true) shown.push(country);
    const global = await this.settings.isOnGlobally('crypto_global');
    const counts = await this.prisma.p2pAd.groupBy({
      by: ['country', 'currency'],
      where: { mode, status: 'active', remainingAmount: { gt: 0 }, country: { in: [...(global ? [globalMarket] : []), ...shown.map(country => country.code)] } },
      _count: { _all: true },
    });
    const ads = (market: string, currency: string) => counts.find(row => row.country === market && row.currency === currency)?._count._all ?? 0;
    // Whether visitors are asked to install BitoCard Crypto as an app: the global level on the global market, each
    // country's own (else the global level) on its market.
    const installGlobal = await this.settings.isOnGlobally('crypto_install_prompt');
    const install = new Map(await Promise.all(shown.map(async country => [country.code, await this.settings.isOnForCountry('crypto_install_prompt', country.code)] as const)));
    const entry = (market: string, name: string, currencies: string[]) => ({
      object: 'crypto_market' as const,
      market,
      name,
      currencies,
      ads: Object.fromEntries(currencies.map(currency => [currency, ads(market, currency)])),
      install_prompt: market === globalMarket ? installGlobal : (install.get(market) ?? false),
    });
    return {
      object: 'list' as const,
      mode,
      /** The coins on sale, in the order shown. */
      assets: (await this.wallets.assets()).map(asset => asset.code),
      data: [...(global ? [entry(globalMarket, 'Global', [globalCurrency])] : []), ...shown.map(country => entry(country.code, country.name, [...new Set([country.currency, globalCurrency])]))],
    };
  }

  /** A market's book for the public pages: the same ads traders see (nicknames, prices, limits), with no viewer. */
  async publicAds(market: string, query: { asset: string; side: AdSide; currency?: string; q?: string; fiat?: number; limit?: number }) {
    const code = market.toUpperCase();
    const listed = (await this.publicMarkets()).data.find(item => item.market === code);
    if (!listed) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'market_unavailable', 'This market is not open.', 'market');
    const currency = query.currency?.toUpperCase() ?? listed.currencies[0];
    if (!listed.currencies.includes(currency)) throw invalid('currency_unsupported', `This market trades in ${listed.currencies.join(' or ')}.`, 'currency');
    const mode = this.house.mode();
    const asset = await this.wallets.asset(query.asset);
    const book: MarketBook = { market: code, currency };
    const ads = await this.book(mode, book, asset, query.side, null, 200, query.q?.trim());
    const fiat = query.fiat !== undefined ? BigInt(query.fiat) : null;
    const usable = ads.filter(ad => {
      const capacity = this.capacity(ad, asset);
      return capacity.available > 0n && (fiat === null || (fiat >= capacity.min && fiat <= capacity.max));
    });
    const shown = usable.slice(0, query.limit ?? 50);
    const { owner, stats, methods } = await this.owners(shown, mode);
    return { object: 'list' as const, market: code, asset: asset.code, currency, side: query.side, data: shown.map(ad => this.presentAd(ad, asset, owner(ad.customerId), stats.get(ad.customerId), undefined, methods.get(ad.id))) };
  }

  /** A trader's public card by nickname: their orders and trust figures, open ads and the markets they are in. Nothing else about them. */
  async publicTrader(nickname: string) {
    const mode = this.house.mode();
    const profile = await this.prisma.p2pProfile.findUnique({ where: { nicknameKey: nickname.toLowerCase() }, include: { customer: { select: { status: true, cryptoFrozenAt: true } } } });
    if (!profile || profile.customer.status !== 'active' || profile.customer.cryptoFrozenAt) throw notFound('trader');
    const stats = (await this.stats([profile.customerId], mode)).get(profile.customerId)!;
    const ads = await this.prisma.p2pAd.findMany({ where: { customerId: profile.customerId, mode, status: 'active', remainingAmount: { gt: 0 } }, select: { country: true } });
    return {
      object: 'p2p_trader' as const,
      nickname: profile.nickname,
      ...stats,
      open_ads: ads.length,
      markets: [...new Set(ads.map(ad => ad.country))].sort(),
      since: profile.createdAt.toISOString(),
    };
  }

  // -- Ads ------------------------------------------------------------------------------------------------------

  async myAds(customer: CustomerWithStore, query: { status?: 'open' | 'closed' }) {
    const context = await this.wallets.context(customer);
    const ads = await this.prisma.p2pAd.findMany({
      where: { customerId: customer.id, mode: context.mode, ...(query.status === 'closed' ? { status: { notIn: openStatuses } } : { status: { in: openStatuses } }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.presentAds(ads, context.mode, customer.id);
  }

  private async presentAds(ads: P2pAd[], mode: LedgerMode, viewerId?: string) {
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    const { owner, stats, methods } = await this.owners(ads, mode);
    return { object: 'list' as const, data: ads.map(ad => this.presentAd(ad, assets.get(ad.asset)!, owner(ad.customerId), stats.get(ad.customerId), viewerId, methods.get(ad.id))) };
  }

  /**
   * Posts an escrow ad, listing where buyers pay (or the seller is paid from). A sell ad locks all its coins and its
   * seller's fee from the wallet now (nothing is posted if the balance is short); a buy ad locks nothing.
   */
  async createAd(
    customer: CustomerWithStore,
    input: { side: AdSide; asset: string; market?: string; currency?: string; price: number; amount: string; min_fiat: number; max_fiat: number; terms?: string; payment_method_ids?: string[]; payment_window?: number },
  ) {
    const { context, book } = await this.access(customer, input);
    await this.standing.require(customer.id, context.mode);
    // An ad's terms never carry contact that moves the trade off Afrippa, or refused words.
    await this.words.check(input.terms, book.market, 'terms');
    const methods = await this.adMethods(customer.id, context.mode, book.currency, input.payment_method_ids);
    const window = this.paymentWindow(input.payment_window ?? 15);
    const currency = book.currency;
    const asset = await this.wallets.asset(input.asset);
    const rates = await this.fees.rates(asset, book.market, context.mode);
    const amount = toUnits(input.amount, asset.decimals);
    const price = BigInt(input.price);
    if (amount <= 0n) throw invalid('parameter_invalid', 'Enter an amount above zero.', 'amount');
    if (input.max_fiat < input.min_fiat) throw invalid('parameter_invalid', 'The maximum per trade must be at least the minimum.', 'max_fiat');
    const open = await this.prisma.p2pAd.count({ where: { customerId: customer.id, mode: context.mode, status: { in: openStatuses } } });
    if (open >= maxOpenAds) throw conflict('too_many_ads', `You can have ${maxOpenAds} ads open at once. Close one first.`);
    const id = randomUUID();
    const base = {
      id,
      mode: context.mode,
      customerId: customer.id,
      country: book.market,
      currency,
      asset: asset.code,
      side: input.side,
      priceMinor: price,
      totalAmount: amount,
      remainingAmount: amount,
      minFiatMinor: BigInt(input.min_fiat),
      maxFiatMinor: BigInt(input.max_fiat),
      terms: input.terms?.trim() || null,
      paymentWindowMinutes: window,
    };
    const listed = methods.map(method => ({ paymentMethodId: method.id }));
    // A sell ad keeps its seller's fee locked beside the coins it offers, so buyers can take all of them.
    const feeLocked = input.side === 'sell' ? feeFor(amount, rates.sellerBps) : 0n;
    let ad: P2pAd;
    if (input.side === 'sell') {
      const walletId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'crypto_wallet', asset.code));
      const lockedId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'crypto_locked', asset.code));
      ad = await this.prisma.$transaction(async tx => {
        await this.ledger.lockBalances(tx, [walletId, lockedId]);
        const created = await tx.p2pAd.create({ data: { ...base, feeLocked, paymentMethods: { create: listed } } });
        await this.write(tx, context.mode, `p2p_ad:${id}:lock`, 'p2p_ad_lock', `${asset.code} locked for your sell ad`, { ad_id: id }, [
          { accountId: walletId, kind: 'crypto_wallet', amount: amount + feeLocked },
          { accountId: lockedId, kind: 'crypto_locked', amount: -(amount + feeLocked) },
        ]);
        return created;
      });
    } else {
      // A buy ad locks nothing: the seller's coins go to escrow when an order opens.
      if (fiatFor(amount, price, asset.decimals, false) <= 0n) throw invalid('amount_too_small', 'This amount is too small to trade.', 'amount');
      ad = await this.prisma.p2pAd.create({ data: { ...base, paymentMethods: { create: listed } } });
    }
    return (await this.presentAds([ad], context.mode, customer.id)).data[0];
  }

  /**
   * The payment methods an escrow ad lists: one to five of the owner's own, not removed, past their 24-hour wait and in
   * the ad's currency.
   */
  private async adMethods(customerId: string, mode: LedgerMode, currency: string, ids: string[] | undefined) {
    const wanted = [...new Set(ids ?? [])];
    if (wanted.length === 0) throw invalid('parameter_missing', 'Choose at least one of your payment methods for this ad.', 'payment_method_ids');
    if (wanted.length > maxAdPaymentMethods) throw invalid('parameter_invalid', `An ad lists at most ${maxAdPaymentMethods} payment methods.`, 'payment_method_ids');
    const found = await this.prisma.p2pPaymentMethod.findMany({ where: { id: { in: wanted }, customerId, mode, removedAt: null } });
    if (found.length !== wanted.length) throw invalid('parameter_invalid', 'Choose your own saved payment methods.', 'payment_method_ids');
    if (found.some(method => method.currency !== currency)) throw invalid('payment_method_currency', `Choose payment methods in ${currency}, the ad's currency.`, 'payment_method_ids');
    if (found.some(method => method.usableFrom > new Date())) throw conflict('payment_method_not_ready', 'A new payment method can be used 24 hours after it was added.', 'payment_method_ids');
    return found;
  }

  private paymentWindow(minutes: number) {
    if (!(paymentWindows as readonly number[]).includes(minutes)) throw invalid('parameter_invalid', 'Choose a payment window of 15, 30 or 60 minutes.', 'payment_window');
    return minutes;
  }

  /** Writes a balanced entry inside `tx`, locking every account it touches first (in one order, so trades never deadlock). */
  private async write(tx: Tx, mode: LedgerMode, reference: string, type: string, description: string, metadata: Record<string, unknown>, postings: PreparedEntry['postings']) {
    await this.ledger.lockBalances(tx, [...new Set(postings.map(posting => posting.accountId))]);
    return this.ledger.write(tx, { mode, type, reference, description, metadata, postings });
  }

  /** Locks the ad's row for the rest of `tx` and reads it fresh. */
  private async lockAd(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM p2p_ads WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.p2pAd.findUnique({ where: { id } });
  }

  /** Changes an ad: its price, limits, terms, payment methods and window, or pauses and resumes it. */
  async updateAd(
    customer: CustomerWithStore,
    id: string,
    input: { price?: number; min_fiat?: number; max_fiat?: number; terms?: string | null; status?: 'active' | 'paused'; payment_method_ids?: string[]; payment_window?: number },
  ) {
    const owned = await this.wallets.context(customer);
    const found = await this.prisma.p2pAd.findFirst({ where: { id, customerId: customer.id, mode: owned.mode } });
    if (!found) throw notFound('ad');
    // Changing an ad is trading in its market: the market must still be open to the customer (closing it never needs this).
    const { context } = await this.access(customer, { market: found.country, currency: found.currency });
    await this.words.check(input.terms, found.country, 'terms');
    const methods = input.payment_method_ids !== undefined ? await this.adMethods(customer.id, context.mode, found.currency, input.payment_method_ids) : null;
    const window = input.payment_window !== undefined ? this.paymentWindow(input.payment_window) : null;
    const ad = await this.prisma.$transaction(async tx => {
      const ad = await this.lockAd(tx, id);
      if (!ad || !openStatuses.includes(ad.status)) throw conflict('ad_closed', 'This ad is closed.');
      const price = input.price !== undefined ? BigInt(input.price) : ad.priceMinor;
      const min = input.min_fiat !== undefined ? BigInt(input.min_fiat) : ad.minFiatMinor;
      const max = input.max_fiat !== undefined ? BigInt(input.max_fiat) : ad.maxFiatMinor;
      if (max < min) throw invalid('parameter_invalid', 'The maximum per trade must be at least the minimum.', 'max_fiat');
      const data: Prisma.P2pAdUpdateInput = { priceMinor: price, minFiatMinor: min, maxFiatMinor: max };
      if (input.terms !== undefined) data.terms = input.terms?.trim() || null;
      if (input.status) data.status = input.status;
      if (window !== null) data.paymentWindowMinutes = window;
      if (methods) {
        await tx.p2pAdPaymentMethod.deleteMany({ where: { adId: id } });
        await tx.p2pAdPaymentMethod.createMany({ data: methods.map(method => ({ adId: id, paymentMethodId: method.id })) });
      }
      return tx.p2pAd.update({ where: { id }, data });
    });
    return (await this.presentAds([ad], context.mode, customer.id)).data[0];
  }

  /** Closes an ad and gives back what a sell ad still locks (its coins and seller's fee). Once. */
  async cancelAd(customer: CustomerWithStore, id: string) {
    const context = await this.wallets.context(customer);
    const found = await this.prisma.p2pAd.findFirst({ where: { id, customerId: customer.id, mode: context.mode } });
    if (!found) throw notFound('ad');
    const ad = await this.close(found);
    return (await this.presentAds([ad], context.mode, customer.id)).data[0];
  }

  private async close(found: P2pAd) {
    const lockedId = await this.ledger.accountId(found.mode, this.wallets.ref(found.customerId, 'crypto_locked', found.asset));
    const walletId = await this.ledger.accountId(found.mode, this.wallets.ref(found.customerId, 'crypto_wallet', found.asset));
    return this.prisma.$transaction(async tx => {
      const ad = await this.lockAd(tx, found.id);
      if (!ad || !openStatuses.includes(ad.status)) throw conflict('ad_closed', 'This ad is already closed.');
      const reference = `p2p_ad:${ad.id}:release`;
      if (ad.side === 'sell' && ad.remainingAmount + ad.feeLocked > 0n) {
        const back = ad.remainingAmount + ad.feeLocked;
        await this.write(tx, ad.mode, reference, 'p2p_ad_release', `${ad.asset} back from your closed sell ad`, { ad_id: ad.id }, [
          { accountId: lockedId, kind: 'crypto_locked', amount: back },
          { accountId: walletId, kind: 'crypto_wallet', amount: -back },
        ]);
      }
      return tx.p2pAd.update({ where: { id: ad.id }, data: { status: 'cancelled', feeLocked: 0n } });
    });
  }

  // -- Nicknames ------------------------------------------------------------------------------------------------

  async nicknames(ids: string[]) {
    const profiles = await this.prisma.p2pProfile.findMany({ where: { customerId: { in: ids } } });
    return new Map(profiles.map(profile => [profile.customerId, profile.nickname]));
  }

  // -- Admin ----------------------------------------------------------------------------------------------------

  async adminAds(query: { mode?: LedgerMode; status?: string; asset?: string; customer_id?: string; limit?: number }) {
    const ads = await this.prisma.p2pAd.findMany({
      where: { ...(query.mode ? { mode: query.mode } : {}), ...(query.status ? { status: query.status } : {}), ...(query.asset ? { asset: query.asset.toUpperCase() } : {}), ...(query.customer_id ? { customerId: query.customer_id } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
    // Each ad's trader stats in its own mode: a list of both modes mixes test and live ads.
    const [live, test] = await Promise.all((['live', 'test'] as const).map(mode => this.presentAds(ads.filter(ad => ad.mode === mode), mode)));
    const byId = new Map([...live.data, ...test.data].map(item => [item.id, item]));
    const listed = { object: 'list' as const, data: ads.map(ad => byId.get(ad.id)!) };
    const owners = await this.prisma.customer.findMany({ where: { id: { in: ads.map(ad => ad.customerId) } }, select: { id: true, email: true } });
    const emails = new Map(owners.map(owner => [owner.id, owner.email]));
    return { ...listed, data: listed.data.map((item, index) => ({ ...item, customer: { id: ads[index].customerId, email: emails.get(ads[index].customerId) ?? null } })) };
  }

  /** Operations close an ad (for example a misleading one): what it locks goes back to its owner. Audited. */
  async adminCancelAd(adminId: string | null, id: string, reason: string) {
    const found = await this.prisma.p2pAd.findUnique({ where: { id } });
    if (!found) throw notFound('ad');
    const ad = await this.close(found);
    await this.audit.record({ actorId: adminId, action: 'p2p.ad_cancelled', targetType: 'p2p_ad', targetId: id, before: { status: found.status }, after: { status: ad.status, reason } });
    return (await this.presentAds([ad], ad.mode)).data[0];
  }
}
