import { randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { HouseService } from '../checkout/house.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type AccountKind, type CryptoAsset, type LedgerMode, type P2pAd, type P2pTrade, Prisma } from '../generated/prisma/client.js';
import { insufficientFunds, LedgerService, type PreparedEntry, type Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { feeFor, fiatFor, fromUnits, toUnits, unitsFor } from './amounts.js';
import { type CryptoContext, CryptoWalletsService, cryptoFeesRef, notFound } from './crypto-wallets.service.js';
import { CryptoMarketLimitsService, crossBorder } from './market-limits.service.js';

export type AdSide = 'buy' | 'sell';
const openStatuses = ['active', 'paused'];
/** Ads a customer can have open (active or paused) at once, per mode. */
export const maxOpenAds = 10;

const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const adUnavailable = () => conflict('ad_unavailable', 'This ad is no longer available. Choose another.', 'ad_id');
const marketUnavailable = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'market_unavailable', 'You cannot trade in this market.', 'market');

/** The global market's code: one book per asset in US dollars, across countries (stored as the ads' country). */
export const globalMarket = 'WW';
export const globalCurrency = 'USD';

/** A market a customer trades in, in one of its currencies. */
export type MarketBook = { market: string; currency: string };

type Stats = { trades_30d: number; trades_total: number };
type Owner = { id: string; nickname: string };

export const tradeNumber = (n: number) => `P2P-${String(n).padStart(6, '0')}`;

/**
 * The P2P markets: store customers buy and sell crypto with each other, paid from their BitoCard wallets (instant
 * trades), one order book per mode, market, currency and asset. A market is a country (its residents trade in its
 * local currency or US dollars; residents of other allowed countries in its local currency, where its
 * `crypto_cross_border` switch is on) or the global market (`WW`, US dollars only, for residents of every country
 * where `crypto_global` is on, even where their own market is off). A sell ad locks its crypto when posted; a buy ad locks the fiat
 * it needs (P2P proceeds first, then the wallet). Taking an ad settles both legs in one transaction, with the ad's row
 * locked first: the crypto (less BitoCard's fee) to the buyer, the fiat to the seller's P2P proceeds (withdrawable).
 * Either everything moves or nothing does, so no trade can be paid twice, half paid or paid from money that is not
 * there (the ledger never lets a customer account go below zero, and the ad's amounts are checked by the database).
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
    private readonly inbox: InboxService,
    private readonly limits: CryptoMarketLimitsService,
    private readonly house: HouseService,
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

  /** Whether this customer may trade in other countries' books: their own country allowed, and their reseller agreeing. */
  private async abroadAllowed(context: CryptoContext, home: boolean) {
    if (context.customer.store.reseller.house) return home || (await this.wallets.globalOpenFor(context.country));
    return home && (await this.settings.isOn('crypto_trade_abroad', context.seller.id));
  }

  /**
   * Which market and currency a customer may trade in, with every check for trading (store open, email, not frozen,
   * identity checked live), else `market_unavailable` or `currency_unsupported`:
   * - their own market (the default): its local currency or US dollars, with crypto and P2P on for their seller;
   * - the global market (`WW`): US dollars, while it is open for their country, whether or not their own market is;
   * - another country's market: its local currency only, where it takes cross-border trades and the customer's own
   *   country is allowed (its own market open, or global trading open for it).
   * Customers of a reseller's store trade outside their own market only while it is open and their reseller allows it
   * (`crypto_global`, `crypto_trade_abroad`): their store is their door into every market, never crypto.bitocard.com.
   */
  async access(customer: CustomerWithStore, requested?: { market?: string; currency?: string }): Promise<{ context: CryptoContext; book: MarketBook }> {
    const context = await this.wallets.requireOpen(customer);
    const market = (requested?.market ?? context.country).toUpperCase();
    const home = await this.wallets.homeOpen(context);
    let currency: string;
    if (market === context.country) {
      if (!home) {
        if (!(await this.wallets.enabled(context.seller))) throw conflict('crypto_not_enabled', 'Crypto is not available in your country yet.');
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
    try {
      const claimed = await this.prisma.p2pProfile.updateMany({ where: { customerId: customer.id, chosen: false }, data: { nickname, nicknameKey: nickname.toLowerCase(), chosen: true } });
      if (claimed.count !== 1) throw conflict('nickname_locked', 'Your nickname is already set.', 'nickname');
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('nickname_taken', 'Someone already uses this nickname. Choose another.', 'nickname');
      throw error;
    }
    return this.profile(customer);
  }

  /** Completed trades per customer: in the last 30 days and ever. */
  private async stats(ids: string[], mode: LedgerMode) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const count = async (field: 'buyerId' | 'sellerId', recent: boolean) =>
      this.prisma.p2pTrade.groupBy({ by: [field], where: { mode, status: 'completed', [field]: { in: ids }, ...(recent ? { createdAt: { gte: since } } : {}) }, _count: { _all: true } });
    const [buys, sales, recentBuys, recentSales] = await Promise.all([count('buyerId', false), count('sellerId', false), count('buyerId', true), count('sellerId', true)]);
    const result = new Map<string, Stats>(ids.map(id => [id, { trades_30d: 0, trades_total: 0 }]));
    const add = (rows: Array<Record<string, unknown> & { _count: { _all: number } }>, field: 'buyerId' | 'sellerId', key: keyof Stats) => {
      for (const row of rows) result.get(row[field] as string)![key] += row._count._all;
    };
    add(buys, 'buyerId', 'trades_total');
    add(sales, 'sellerId', 'trades_total');
    add(recentBuys, 'buyerId', 'trades_30d');
    add(recentSales, 'sellerId', 'trades_30d');
    return result;
  }

  // -- The market -----------------------------------------------------------------------------------------------

  /** Fiat an ad can still take, and its limits per order now (the last part of an ad may be below its minimum). */
  private capacity(ad: P2pAd, asset: CryptoAsset) {
    const available = ad.side === 'sell' ? fiatFor(ad.remainingAmount, ad.priceMinor, asset.decimals, true) : ad.fiatLockedMinor;
    const max = available < ad.maxFiatMinor ? available : ad.maxFiatMinor;
    const min = available < ad.minFiatMinor ? available : ad.minFiatMinor;
    return { available, min, max };
  }

  private presentAd(ad: P2pAd, asset: CryptoAsset, owner: Owner, stats: Stats | undefined, viewerId?: string) {
    const capacity = this.capacity(ad, asset);
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
      fee_bps: asset.p2pFeeBps,
      terms: ad.terms,
      status: ad.status,
      mine: viewerId === ad.customerId,
      trader: { nickname: owner.nickname, ...(stats ?? { trades_30d: 0, trades_total: 0 }) },
      created_at: ad.createdAt.toISOString(),
      updated_at: ad.updatedAt.toISOString(),
    };
  }

  private async owners(ads: P2pAd[], mode: LedgerMode) {
    const ids = [...new Set(ads.map(ad => ad.customerId))];
    const [profiles, stats] = await Promise.all([this.prisma.p2pProfile.findMany({ where: { customerId: { in: ids } } }), this.stats(ids, mode)]);
    const names = new Map(profiles.map(profile => [profile.customerId, profile.nickname]));
    return { owner: (id: string): Owner => ({ id, nickname: names.get(id) ?? 'Trader' }), stats };
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
    const { owner, stats } = await this.owners(shown, context.mode);
    return { object: 'list' as const, market: book.market, asset: asset.code, currency, side: query.side, data: shown.map(ad => this.presentAd(ad, asset, owner(ad.customerId), stats.get(ad.customerId), customer.id)) };
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
  private async ownerCanTrade(customerId: string, book: MarketBook, known = new Map<string, Promise<boolean>>()) {
    if (!known.has(customerId)) {
      known.set(
        customerId,
        (async () => {
          const owner = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { store: { include: { reseller: { select: { house: true } } } }, market: true } });
          if (!owner || owner.status !== 'active') return false;
          try {
            await this.access(owner, book);
            return true;
          } catch {
            return false;
          }
        })(),
      );
    }
    return known.get(customerId)!;
  }

  private async book(mode: LedgerMode, book: MarketBook, asset: CryptoAsset, side: AdSide, viewerId: string | null, take: number, trader?: string) {
    // To buy, the viewer takes sell ads (cheapest first); to sell, buy ads (highest first).
    const adSide = side === 'buy' ? 'sell' : 'buy';
    const known = new Map<string, Promise<boolean>>();
    const ads = await this.prisma.p2pAd.findMany({
      where: { mode, country: book.market, currency: book.currency, asset: asset.code, side: adSide, status: 'active', ...(viewerId ? { customerId: { not: viewerId } } : {}), remainingAmount: { gt: 0 }, customer: { cryptoFrozenAt: null, ...(trader ? { p2pProfile: { nickname: { contains: trader, mode: 'insensitive' } } } : {}) } },
      orderBy: [{ priceMinor: adSide === 'sell' ? 'asc' : 'desc' }, { createdAt: 'asc' }],
      take,
    });
    const able = await Promise.all(ads.map(ad => this.ownerCanTrade(ad.customerId, book, known)));
    return ads.filter((_, index) => able[index]);
  }

  /** The best ad for buying or selling an amount (fiat or crypto) right now, with the trade it would make. */
  async quote(customer: CustomerWithStore, query: { asset: string; side: AdSide; market?: string; currency?: string; fiat?: number; amount?: string }) {
    const { context, book } = await this.access(customer, query);
    const asset = await this.wallets.asset(query.asset);
    if ((query.fiat === undefined) === (query.amount === undefined)) throw invalid('parameter_missing', 'Send either fiat or amount.', 'fiat');
    const ads = await this.book(context.mode, book, asset, query.side, customer.id, 200);
    for (const ad of ads) {
      try {
        const terms = this.terms(ad, asset, { fiat: query.fiat, amount: query.amount });
        const { owner, stats } = await this.owners([ad], context.mode);
        return { object: 'p2p_quote' as const, side: query.side, ad: this.presentAd(ad, asset, owner(ad.customerId), stats.get(ad.customerId), customer.id), ...this.presentTerms(terms, asset, ad) };
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    throw conflict('no_matching_ad', 'Nobody can take this amount right now. Try another amount or post your own ad.', query.fiat !== undefined ? 'fiat' : 'amount');
  }

  /**
   * A trade's amounts against an ad: the crypto (from `amount`, or the most `fiat` buys), its fiat rounded in the ad
   * owner's favour (a buy ad's last fill takes all it still locks), and BitoCard's fee. Checked against the ad's
   * limits; throws a clear refusal otherwise.
   */
  private terms(ad: P2pAd, asset: CryptoAsset, input: { fiat?: number; amount?: string }) {
    let amount = input.amount !== undefined ? toUnits(input.amount, asset.decimals) : unitsFor(BigInt(input.fiat!), ad.priceMinor, asset.decimals);
    // The ad's shown maximum is its rest rounded in the owner's favour, which may buy a part of a unit more than is left:
    // asking for all of it takes the whole rest.
    if (input.amount === undefined && amount > ad.remainingAmount && BigInt(input.fiat!) >= this.capacity(ad, asset).available) amount = ad.remainingAmount;
    if (amount <= 0n) throw invalid('amount_too_small', 'This amount is too small to trade.', input.amount !== undefined ? 'amount' : 'fiat');
    if (amount > ad.remainingAmount) throw conflict('amount_unavailable', `This ad has only ${fromUnits(ad.remainingAmount, asset.decimals)} ${asset.code} left.`, 'amount');
    const whole = amount === ad.remainingAmount;
    const fiat = ad.side === 'buy' && whole ? ad.fiatLockedMinor : fiatFor(amount, ad.priceMinor, asset.decimals, ad.side === 'sell');
    if (fiat <= 0n) throw invalid('amount_too_small', 'This amount is too small to trade.', 'amount');
    if (fiat > ad.maxFiatMinor) throw invalid('above_ad_limit', `This ad takes at most ${minor(ad.maxFiatMinor) / 100} ${ad.currency} per trade.`, 'fiat');
    if (fiat < ad.minFiatMinor && !whole) throw invalid('below_ad_limit', `This ad takes at least ${minor(ad.minFiatMinor) / 100} ${ad.currency} per trade.`, 'fiat');
    const fee = feeFor(amount, asset.p2pFeeBps);
    if (fee >= amount) throw invalid('amount_too_small', 'This amount is too small to trade.', 'amount');
    return { amount, fiat, fee, received: amount - fee };
  }

  private presentTerms(terms: { amount: bigint; fiat: bigint; fee: bigint; received: bigint }, asset: CryptoAsset, ad: P2pAd) {
    return {
      asset: asset.code,
      currency: ad.currency,
      price: minor(ad.priceMinor),
      amount: fromUnits(terms.amount, asset.decimals),
      fee: fromUnits(terms.fee, asset.decimals),
      /** What the buyer receives: the amount less BitoCard's fee. */
      received: fromUnits(terms.received, asset.decimals),
      fiat: minor(terms.fiat),
      /** BitoCard's fee rate the amounts were worked out with: send it back with the trade to refuse a changed fee. */
      fee_bps: asset.p2pFeeBps,
    };
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
    const entry = (market: string, name: string, currencies: string[]) => ({
      object: 'crypto_market' as const,
      market,
      name,
      currencies,
      ads: Object.fromEntries(currencies.map(currency => [currency, ads(market, currency)])),
    });
    return {
      object: 'list' as const,
      mode,
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
    const { owner, stats } = await this.owners(shown, mode);
    return { object: 'list' as const, market: code, asset: asset.code, currency, side: query.side, data: shown.map(ad => this.presentAd(ad, asset, owner(ad.customerId), stats.get(ad.customerId))) };
  }

  /** A trader's public card by nickname: completed trades, open ads and the markets they are in. Nothing else about them. */
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
    const { owner, stats } = await this.owners(ads, mode);
    return { object: 'list' as const, data: ads.map(ad => this.presentAd(ad, assets.get(ad.asset)!, owner(ad.customerId), stats.get(ad.customerId), viewerId)) };
  }

  /** Accounts the customer's fiat leaves from, in the order spent: P2P proceeds, then the wallet. */
  private async fiatSources(customerId: string, mode: LedgerMode, currency: string) {
    return {
      proceedsId: await this.ledger.accountId(mode, this.wallets.ref(customerId, 'customer_withdrawable', currency)),
      walletId: await this.ledger.accountId(mode, this.wallets.ref(customerId, 'customer_wallet', currency)),
    };
  }

  /** Splits `amount` over the locked balances: proceeds first, then the wallet. Too little in both is insufficient_funds. */
  private split(balances: Map<string, bigint>, sources: { proceedsId: string; walletId: string }, amount: bigint) {
    const proceeds = balances.get(sources.proceedsId) ?? 0n;
    const wallet = balances.get(sources.walletId) ?? 0n;
    if (proceeds + wallet < amount) throw insufficientFunds();
    const fromProceeds = proceeds < amount ? proceeds : amount;
    return { fromProceeds, fromWallet: amount - fromProceeds };
  }

  /**
   * Posts an ad. A sell ad locks all its crypto from the wallet now; a buy ad locks the fiat it needs (rounded up)
   * from the customer's P2P proceeds, then their wallet. Nothing is posted if the balance is short.
   */
  async createAd(customer: CustomerWithStore, input: { side: AdSide; asset: string; market?: string; currency?: string; price: number; amount: string; min_fiat: number; max_fiat: number; terms?: string }) {
    const { context, book } = await this.access(customer, input);
    const currency = book.currency;
    const asset = await this.wallets.asset(input.asset);
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
    };
    let ad: P2pAd;
    if (input.side === 'sell') {
      const walletId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'crypto_wallet', asset.code));
      const lockedId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'crypto_locked', asset.code));
      ad = await this.prisma.$transaction(async tx => {
        await this.ledger.lockBalances(tx, [walletId, lockedId]);
        const created = await tx.p2pAd.create({ data: base });
        await this.write(tx, context.mode, `p2p_ad:${id}:lock`, 'p2p_ad_lock', `${asset.code} locked for your sell ad`, { ad_id: id }, [
          { accountId: walletId, kind: 'crypto_wallet', amount },
          { accountId: lockedId, kind: 'crypto_locked', amount: -amount },
        ]);
        return created;
      });
    } else {
      const needed = fiatFor(amount, price, asset.decimals, true);
      if (needed <= 0n) throw invalid('amount_too_small', 'This amount is too small to trade.', 'amount');
      const sources = await this.fiatSources(customer.id, context.mode, currency);
      const lockedId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'p2p_fiat_locked', currency));
      ad = await this.prisma.$transaction(async tx => {
        const balances = await this.ledger.lockBalances(tx, [sources.proceedsId, sources.walletId, lockedId]);
        const { fromProceeds, fromWallet } = this.split(balances, sources, needed);
        const created = await tx.p2pAd.create({ data: { ...base, fiatLockedMinor: needed, fiatFromProceeds: fromProceeds } });
        await this.write(tx, context.mode, `p2p_ad:${id}:lock`, 'p2p_ad_lock', `${currency} locked for your buy ad`, { ad_id: id }, [
          ...(fromProceeds > 0n ? [{ accountId: sources.proceedsId, kind: 'customer_withdrawable' as const, amount: fromProceeds }] : []),
          ...(fromWallet > 0n ? [{ accountId: sources.walletId, kind: 'customer_wallet' as const, amount: fromWallet }] : []),
          { accountId: lockedId, kind: 'p2p_fiat_locked', amount: -needed },
        ]);
        return created;
      });
    }
    return (await this.presentAds([ad], context.mode, customer.id)).data[0];
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

  /**
   * Changes an ad: its price, limits, terms, or pauses and resumes it. A buy ad's new price locks more fiat or gives
   * back what it no longer needs, in the same transaction.
   */
  async updateAd(customer: CustomerWithStore, id: string, input: { price?: number; min_fiat?: number; max_fiat?: number; terms?: string | null; status?: 'active' | 'paused' }) {
    const owned = await this.wallets.context(customer);
    const found = await this.prisma.p2pAd.findFirst({ where: { id, customerId: customer.id, mode: owned.mode } });
    if (!found) throw notFound('ad');
    // Changing an ad is trading in its market: the market must still be open to the customer (closing it never needs this).
    const { context } = await this.access(customer, { market: found.country, currency: found.currency });
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: found.asset } });
    const sources = await this.fiatSources(customer.id, context.mode, found.currency);
    const lockedId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'p2p_fiat_locked', found.currency));
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
      if (ad.side === 'buy' && price !== ad.priceMinor) {
        const needed = fiatFor(ad.remainingAmount, price, asset.decimals, true);
        const delta = needed - ad.fiatLockedMinor;
        const reference = `p2p_ad:${id}:relock:${randomUUID()}`;
        if (delta > 0n) {
          const balances = await this.ledger.lockBalances(tx, [sources.proceedsId, sources.walletId, lockedId]);
          const { fromProceeds, fromWallet } = this.split(balances, sources, delta);
          await this.write(tx, context.mode, reference, 'p2p_ad_lock', `More ${found.currency} locked for your buy ad`, { ad_id: id }, [
            ...(fromProceeds > 0n ? [{ accountId: sources.proceedsId, kind: 'customer_withdrawable' as const, amount: fromProceeds }] : []),
            ...(fromWallet > 0n ? [{ accountId: sources.walletId, kind: 'customer_wallet' as const, amount: fromWallet }] : []),
            { accountId: lockedId, kind: 'p2p_fiat_locked', amount: -delta },
          ]);
          data.fiatLockedMinor = needed;
          data.fiatFromProceeds = ad.fiatFromProceeds + fromProceeds;
        } else if (delta < 0n) {
          const back = this.giveBack(ad, -delta);
          await this.write(tx, context.mode, reference, 'p2p_ad_release', `${found.currency} your buy ad no longer needs`, { ad_id: id }, this.releasePostings(sources, lockedId, back));
          data.fiatLockedMinor = needed;
          data.fiatFromProceeds = ad.fiatFromProceeds - back.toProceeds;
        }
      }
      return tx.p2pAd.update({ where: { id }, data });
    });
    return (await this.presentAds([ad], context.mode, customer.id)).data[0];
  }

  /** Fiat a buy ad gives back, to the wallet part first, then proceeds (so proceeds never exceed what is locked). */
  private giveBack(ad: P2pAd, amount: bigint) {
    const walletPart = ad.fiatLockedMinor - ad.fiatFromProceeds;
    const toWallet = walletPart < amount ? walletPart : amount;
    return { toWallet, toProceeds: amount - toWallet, total: amount };
  }

  private releasePostings(sources: { proceedsId: string; walletId: string }, lockedId: string, back: { toWallet: bigint; toProceeds: bigint; total: bigint }): PreparedEntry['postings'] {
    return [
      { accountId: lockedId, kind: 'p2p_fiat_locked', amount: back.total },
      ...(back.toProceeds > 0n ? [{ accountId: sources.proceedsId, kind: 'customer_withdrawable' as const, amount: -back.toProceeds }] : []),
      ...(back.toWallet > 0n ? [{ accountId: sources.walletId, kind: 'customer_wallet' as const, amount: -back.toWallet }] : []),
    ];
  }

  /** Closes an ad and gives back what it still locks: the crypto of a sell ad, the fiat of a buy ad. Once. */
  async cancelAd(customer: CustomerWithStore, id: string) {
    const context = await this.wallets.context(customer);
    const found = await this.prisma.p2pAd.findFirst({ where: { id, customerId: customer.id, mode: context.mode } });
    if (!found) throw notFound('ad');
    const ad = await this.close(found);
    return (await this.presentAds([ad], context.mode, customer.id)).data[0];
  }

  private async close(found: P2pAd) {
    const lockedId = await this.ledger.accountId(found.mode, this.wallets.ref(found.customerId, found.side === 'sell' ? 'crypto_locked' : 'p2p_fiat_locked', found.side === 'sell' ? found.asset : found.currency));
    const walletId = await this.ledger.accountId(found.mode, this.wallets.ref(found.customerId, 'crypto_wallet', found.asset));
    const sources = await this.fiatSources(found.customerId, found.mode, found.currency);
    return this.prisma.$transaction(async tx => {
      const ad = await this.lockAd(tx, found.id);
      if (!ad || !openStatuses.includes(ad.status)) throw conflict('ad_closed', 'This ad is already closed.');
      const reference = `p2p_ad:${ad.id}:release`;
      if (ad.side === 'sell' && ad.remainingAmount > 0n) {
        await this.write(tx, ad.mode, reference, 'p2p_ad_release', `${ad.asset} back from your closed sell ad`, { ad_id: ad.id }, [
          { accountId: lockedId, kind: 'crypto_locked', amount: ad.remainingAmount },
          { accountId: walletId, kind: 'crypto_wallet', amount: -ad.remainingAmount },
        ]);
      } else if (ad.side === 'buy' && ad.fiatLockedMinor > 0n) {
        await this.write(tx, ad.mode, reference, 'p2p_ad_release', `${ad.currency} back from your closed buy ad`, { ad_id: ad.id }, this.releasePostings(sources, lockedId, this.giveBack(ad, ad.fiatLockedMinor)));
      }
      return tx.p2pAd.update({ where: { id: ad.id }, data: { status: 'cancelled', fiatLockedMinor: 0n, fiatFromProceeds: 0n } });
    });
  }

  // -- Trades ---------------------------------------------------------------------------------------------------

  /**
   * Takes an ad: an instant trade paid from BitoCard wallets. `price` must be the ad's price the customer saw (a
   * changed price is refused, never charged). With `preview`, only the trade it would make. Otherwise, in one
   * transaction with the ad's row locked: the ad's amounts, the crypto (seller's lock or wallet) to the buyer less
   * BitoCard's fee, the fiat (buyer's proceeds then wallet, or their buy ad's lock) to the seller's P2P proceeds.
   */
  async trade(customer: CustomerWithStore, input: { ad_id: string; price: number; fee_bps?: number; amount?: string; fiat?: number; preview?: boolean }) {
    if ((input.fiat === undefined) === (input.amount === undefined)) throw invalid('parameter_missing', 'Send either fiat or amount.', 'fiat');
    const owned = await this.wallets.context(customer);
    const found = await this.prisma.p2pAd.findFirst({ where: { id: input.ad_id, mode: owned.mode } });
    if (!found || found.status !== 'active') throw adUnavailable();
    // The ad's market decides: the taker must be allowed to trade there, in its currency.
    const { context } = await this.access(customer, { market: found.country, currency: found.currency });
    if (found.customerId === customer.id) throw conflict('own_ad', 'This is your own ad.', 'ad_id');
    if (!(await this.ownerCanTrade(found.customerId, { market: found.country, currency: found.currency }))) throw adUnavailable();
    const asset = await this.wallets.asset(found.asset);
    if (BigInt(input.price) !== found.priceMinor) throw conflict('price_changed', 'The price of this ad changed. Check the new price and try again.', 'price');
    // The fee the customer was shown, when they send it: a changed fee is refused like a changed price.
    if (input.fee_bps !== undefined && input.fee_bps !== asset.p2pFeeBps) throw conflict('fee_changed', 'BitoCard’s fee for this coin changed. Check the new amounts and try again.', 'fee_bps');
    const terms = this.terms(found, asset, input);
    // The viewer's side: taking a sell ad buys, taking a buy ad sells.
    if (input.preview) return { object: 'p2p_quote' as const, side: found.side === 'sell' ? ('buy' as const) : ('sell' as const), ...this.presentTerms(terms, asset, found) };

    const ownerSells = found.side === 'sell';
    const buyerId = ownerSells ? customer.id : found.customerId;
    const sellerId = ownerSells ? found.customerId : customer.id;
    const { mode } = context;
    const currency = found.currency;
    const account = (id: string, kind: AccountKind, code: string) => this.ledger.accountId(mode, this.wallets.ref(id, kind, code));
    const sellerCrypto = await account(sellerId, ownerSells ? 'crypto_locked' : 'crypto_wallet', asset.code);
    const buyerCrypto = await account(buyerId, 'crypto_wallet', asset.code);
    const feesId = await this.ledger.accountId(mode, cryptoFeesRef(asset.code));
    // Sale money is P2P money (withdrawable) in the trade's currency, whatever the market: cashed out where the
    // seller's own country's rails pay that currency, else spent in a market that trades in it.
    const sellerCreditKind: AccountKind = 'customer_withdrawable';
    const sellerProceeds = await account(sellerId, sellerCreditKind, currency);
    const buyerSources = await this.fiatSources(buyerId, mode, currency);
    const buyerLocked = await account(buyerId, 'p2p_fiat_locked', currency);
    const id = randomUUID();

    const run = this.prisma.$transaction(async tx => {
      const ad = await this.lockAd(tx, found.id);
      if (!ad || ad.status !== 'active') throw adUnavailable();
      if (ad.priceMinor !== found.priceMinor) throw conflict('price_changed', 'The price of this ad changed. Check the new price and try again.', 'price');
      const owner = await tx.customer.findUniqueOrThrow({ where: { id: ad.customerId }, select: { cryptoFrozenAt: true, country: true } });
      if (owner.cryptoFrozenAt) throw adUnavailable();
      const ownerHome = owner.country ?? ad.country;
      // The ad as it is now: another trade may have taken part of it since it was read.
      const now = this.terms(ad, asset, input);
      let fromProceeds = 0n;
      let fromWallet = 0n;
      const fiatPostings: PreparedEntry['postings'] = [];
      const adData: Prisma.P2pAdUpdateInput = { remainingAmount: ad.remainingAmount - now.amount, filledAmount: ad.filledAmount + now.amount };
      // Every account the trade touches, locked at once in one order, so trades crossing each other never deadlock.
      const balances = await this.ledger.lockBalances(tx, [sellerCrypto, buyerCrypto, feesId, sellerProceeds, buyerSources.proceedsId, buyerSources.walletId, buyerLocked]);
      if (ownerSells) {
        ({ fromProceeds, fromWallet } = this.split(balances, buyerSources, now.fiat));
        if (fromProceeds > 0n) fiatPostings.push({ accountId: buyerSources.proceedsId, kind: 'customer_withdrawable', amount: fromProceeds });
        if (fromWallet > 0n) fiatPostings.push({ accountId: buyerSources.walletId, kind: 'customer_wallet', amount: fromWallet });
      } else {
        // A buy ad's fiat is already locked: its proceeds part is spent first.
        fromProceeds = ad.fiatFromProceeds < now.fiat ? ad.fiatFromProceeds : now.fiat;
        fromWallet = now.fiat - fromProceeds;
        fiatPostings.push({ accountId: buyerLocked, kind: 'p2p_fiat_locked', amount: now.fiat });
        adData.fiatLockedMinor = ad.fiatLockedMinor - now.fiat;
        adData.fiatFromProceeds = ad.fiatFromProceeds - fromProceeds;
      }
      // The market's limits for both parties, with their accounts locked: parallel trades cannot pass them together.
      await this.limits.check(tx, {
        mode,
        market: ad.country,
        currency: ad.currency,
        fiat: now.fiat,
        parties: [
          { customerId: customer.id, home: context.country, taker: true },
          { customerId: ad.customerId, home: ownerHome, taker: false },
        ],
      });
      if (ad.remainingAmount === now.amount) adData.status = 'completed';
      await tx.p2pAd.update({ where: { id: ad.id }, data: adData });
      const trade = await tx.p2pTrade.create({
        data: {
          id,
          mode,
          adId: ad.id,
          buyerId,
          sellerId,
          takerId: customer.id,
          country: ad.country,
          currency: ad.currency,
          asset: asset.code,
          priceMinor: ad.priceMinor,
          amount: now.amount,
          feeAmount: now.fee,
          fiatMinor: now.fiat,
          fiatFromProceeds: fromProceeds,
          fiatFromWallet: fromWallet,
          crossBorder: crossBorder(ad.country, context.country) || crossBorder(ad.country, ownerHome),
          completedAt: new Date(),
        },
      });
      await this.write(tx, mode, `p2p_trade:${id}`, 'p2p_trade', `P2P trade ${tradeNumber(trade.number)}: ${fromUnits(now.amount, asset.decimals)} ${asset.code}`, { trade_id: id, ad_id: ad.id }, [
        { accountId: sellerCrypto, kind: ownerSells ? 'crypto_locked' : 'crypto_wallet', amount: now.amount },
        { accountId: buyerCrypto, kind: 'crypto_wallet', amount: -now.received },
        ...(now.fee > 0n ? [{ accountId: feesId, kind: 'crypto_fees' as const, amount: -now.fee }] : []),
        ...fiatPostings,
        { accountId: sellerProceeds, kind: sellerCreditKind, amount: -now.fiat },
      ]);
      return trade;
    });
    let trade: P2pTrade;
    try {
      trade = await run;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') {
        // Say whose balance is short: the taker's own, or the ad's (which cannot happen while its lock holds).
        throw new ApiError(
          HttpStatus.PAYMENT_REQUIRED,
          'invalid_request_error',
          'insufficient_funds',
          ownerSells ? `Your ${currency} balance is too low for this trade. Add money to your wallet first.` : `Your ${asset.code} balance is too low for this trade.`,
        );
      }
      throw error;
    }
    await this.notifyOwner(trade, found, asset);
    return this.presentTrade(trade, asset, customer.id, await this.nicknames([trade.buyerId, trade.sellerId]));
  }

  private async notifyOwner(trade: P2pTrade, ad: P2pAd, asset: CryptoAsset) {
    const owner = await this.prisma.customer.findUnique({ where: { id: ad.customerId }, select: { storeId: true } });
    if (!owner) return;
    const sold = ad.side === 'sell';
    const destination = 'P2P balance';
    await this.inbox.customer({ customerId: ad.customerId, storeId: owner.storeId }, 'customer.p2p.trade_completed', {
      subject: trade.id,
      title: sold ? `You sold ${fromUnits(trade.amount, asset.decimals)} ${asset.code}` : `You bought ${fromUnits(trade.amount - trade.feeAmount, asset.decimals)} ${asset.code}`,
      body: sold ? `${trade.currency} ${(minor(trade.fiatMinor) / 100).toFixed(2)} is in your ${destination}.` : `Paid ${trade.currency} ${(minor(trade.fiatMinor) / 100).toFixed(2)} from your buy ad.`,
      link: `/account/crypto/trades/${trade.id}`,
      mode: trade.mode,
    });
  }

  private async nicknames(ids: string[]) {
    const profiles = await this.prisma.p2pProfile.findMany({ where: { customerId: { in: ids } } });
    return new Map(profiles.map(profile => [profile.customerId, profile.nickname]));
  }

  presentTrade(trade: P2pTrade, asset: Pick<CryptoAsset, 'decimals'>, viewerId: string | null, names: Map<string, string>) {
    const buying = viewerId === trade.buyerId;
    const counterparty = buying ? trade.sellerId : trade.buyerId;
    return {
      object: 'p2p_trade' as const,
      id: trade.id,
      number: tradeNumber(trade.number),
      mode: trade.mode,
      /** From the viewer's side: they bought or sold (admins see the buyer's side). */
      side: viewerId === null || buying ? ('buy' as const) : ('sell' as const),
      role: viewerId === null ? null : viewerId === trade.takerId ? ('taker' as const) : ('maker' as const),
      ad_id: trade.adId,
      /** The market traded in: a country, or `WW` for the global market. */
      market: trade.country,
      asset: trade.asset,
      currency: trade.currency,
      price: minor(trade.priceMinor),
      amount: fromUnits(trade.amount, asset.decimals),
      fee: fromUnits(trade.feeAmount, asset.decimals),
      received: fromUnits(trade.amount - trade.feeAmount, asset.decimals),
      fiat: minor(trade.fiatMinor),
      counterparty: { nickname: names.get(counterparty) ?? 'Trader' },
      settlement: trade.settlement,
      status: trade.status,
      created_at: trade.createdAt.toISOString(),
      completed_at: trade.completedAt?.toISOString() ?? null,
    };
  }

  async trades(customer: CustomerWithStore, page: { limit?: number; starting_after?: string; asset?: string }) {
    const context = await this.wallets.context(customer);
    const limit = page.limit ?? 25;
    const rows = await this.prisma.p2pTrade.findMany({
      where: { mode: context.mode, OR: [{ buyerId: customer.id }, { sellerId: customer.id }], ...(page.asset ? { asset: page.asset.toUpperCase() } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    const names = await this.nicknames(rows.flatMap(row => [row.buyerId, row.sellerId]));
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => this.presentTrade(row, assets.get(row.asset)!, customer.id, names)), has_more: rows.length > limit };
  }

  async getTrade(customer: CustomerWithStore, id: string) {
    const trade = await this.prisma.p2pTrade.findFirst({ where: { id, OR: [{ buyerId: customer.id }, { sellerId: customer.id }] } });
    if (!trade) throw notFound('trade');
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: trade.asset } });
    return this.presentTrade(trade, asset, customer.id, await this.nicknames([trade.buyerId, trade.sellerId]));
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

  async adminTrades(query: { mode?: LedgerMode; asset?: string; customer_id?: string; limit?: number }) {
    const rows = await this.prisma.p2pTrade.findMany({
      where: {
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.asset ? { asset: query.asset.toUpperCase() } : {}),
        ...(query.customer_id ? { OR: [{ buyerId: query.customer_id }, { sellerId: query.customer_id }] } : {}),
      },
      include: { buyer: { select: { email: true } }, seller: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    const names = await this.nicknames(rows.flatMap(row => [row.buyerId, row.sellerId]));
    return {
      object: 'list' as const,
      data: rows.map(row => ({
        ...this.presentTrade(row, assets.get(row.asset)!, null, names),
        taker: row.takerId === row.buyerId ? ('buyer' as const) : ('seller' as const),
        buyer: { id: row.buyerId, email: row.buyer.email, nickname: names.get(row.buyerId) ?? null },
        seller: { id: row.sellerId, email: row.seller.email, nickname: names.get(row.sellerId) ?? null },
      })),
    };
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
