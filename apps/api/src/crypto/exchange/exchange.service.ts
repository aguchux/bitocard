import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { HouseService, houseRootId } from '../../checkout/house.service.js';
import { StoreSellers } from '../../checkout/store-sellers.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CryptoAsset, ExchangeMarkup, ExchangeQuote, ExchangeTrade, LedgerMode, Prisma } from '../../generated/prisma/client.js';
import { FxService } from '../../fx/fx.service.js';
import { type AccountRef, LedgerService, type PreparedEntry } from '../../ledger/ledger.service.js';
import { minor } from '../../ledger/mode.js';
import { formatMoney } from '../../notifications/templates.js';
import { InboxService } from '../../notifications/inbox.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { fromUnits, toUnits } from '../amounts.js';
import { type CryptoContext, CryptoWalletsService, notFound } from '../crypto-wallets.service.js';
import type { UsdPrice } from '../price-feed.js';
import { CryptoPricesService } from '../prices.js';
import { available, deskPrice, type ExchangeSide, markupEarned, marketPriceMinor, maxMarkupBps, quoteLifetimeMs, tradeTerms } from './pricing.js';

/** BitoCard's own desk: its fiat reserves on each market's house account, its coins on the root house account. */
export const bitocardDesk = 'bitocard';

const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const short = (message: string, param?: string) => new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'reserve_insufficient', message, param);

/** Why a pair cannot be traded now, for the screen. */
export type ClosedReason = 'not_offered' | 'price_unavailable' | 'conversion_unavailable';

export const exchangeTradeNumber = (number: number) => `EX-${String(number).padStart(6, '0')}`;

/** BitoCard's coin reserve is shared by every market; a reseller's reserve serves only that reseller's store. */
export const cryptoReserveRef = (asset: string, ownerId = houseRootId): AccountRef => ({ kind: 'reserve_crypto', currency: asset, resellerId: ownerId });
/** A market's fiat reserve (its house account). */
export const fiatReserveRef = (houseId: string, currency: string): AccountRef => ({ kind: 'reserve_fiat', currency, resellerId: houseId });

type Pair = {
  asset: CryptoAsset;
  market: UsdPrice | null;
  fxMid: Prisma.Decimal | null;
  markup: ExchangeMarkup | null;
  closed: ClosedReason | null;
  reserveCoins: bigint;
  reserveFiat: bigint;
  /** The most markup the desk may charge now: a reseller desk is held to its market's cap whenever it prices. */
  capBps: number;
};

/**
 * The instant exchange with BitoCard's desk: customers on bitocard.com buy coins with their money (P2P money first,
 * then the store wallet) or sell coins for P2P money, straight from BitoCard's reserves. Every coin is priced from its
 * live US dollar market price (CoinGecko, at most a minute old) at the currency's mid rate, plus only BitoCard's markup.
 * Never coin to coin. A price is held for 30 seconds as a quote; the trade then moves everything in one ledger entry,
 * and never more than the reserve holds at that moment.
 */
@Injectable()
export class ExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: CryptoWalletsService,
    private readonly stores: StoreSellers,
    private readonly house: HouseService,
    private readonly prices: CryptoPricesService,
    private readonly fx: FxService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  // -- Who may trade -------------------------------------------------------------------------------------------------

  /** Everything new crypto business needs, an open store, and the exchange switch. */
  async requireTrader(customer: CustomerWithStore): Promise<CryptoContext> {
    const context = await this.wallets.require(customer);
    if (!(await this.settings.isOn('crypto_exchange', context.seller.id))) throw conflict('exchange_not_enabled', 'The instant exchange is not available in your country yet.');
    return context;
  }

  // -- Pairs ---------------------------------------------------------------------------------------------------------

  private async balance(mode: LedgerMode, ref: AccountRef) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: ref.kind, mode, currency: ref.currency, resellerId: ref.resellerId ?? null }, select: { balanceMinor: true } });
    return account?.balanceMinor ?? 0n;
  }

  /** Each coin's market price, markup and reserves in one currency, and why it is closed when it is. */
  private async desk(context: CryptoContext, asset?: string, currency = context.currency) {
    const house = this.stores.isHouse(context.customer.store);
    if (house) return { id: bitocardDesk, name: 'BitoCard', fiatOwner: context.seller.id, coinOwner: houseRootId, enabled: true, capBps: maxMarkupBps };
    const resellerId = context.seller.id;
    const [allowed, ownMarkup, choice] = await Promise.all([
      this.settings.isOn('reseller_desks', resellerId),
      asset ? this.prisma.exchangeMarkup.findUnique({ where: { desk_mode_asset_currency: { desk: resellerId, mode: context.mode, asset, currency } }, select: { enabled: true } }) : null,
      this.prisma.exchangeDesk.findUnique({ where: { resellerId } }),
    ]);
    if (allowed && (!asset || ownMarkup?.enabled)) {
      return { id: resellerId, name: context.customer.store.name, fiatOwner: resellerId, coinOwner: resellerId, enabled: true, capBps: await this.markupCap(context.country) };
    }
    if (choice?.fallbackToBitocard ?? true) {
      const market = await this.house.resellerFor(context.country);
      return { id: bitocardDesk, name: 'BitoCard', fiatOwner: market.id, coinOwner: houseRootId, enabled: true, capBps: maxMarkupBps };
    }
    return { id: resellerId, name: context.customer.store.name, fiatOwner: resellerId, coinOwner: resellerId, enabled: false, capBps: 0 };
  }

  /** The most a reseller desk may mark up in a market: the market's markup cap, never above BitoCard's 20%. */
  private async markupCap(country: string) {
    const market = await this.prisma.country.findUnique({ where: { code: country }, select: { exchangeMarkupCapBps: true } });
    return Math.min(maxMarkupBps, market?.exchangeMarkupCapBps ?? 0);
  }

  private async pairs(mode: LedgerMode, currency: string, fiatOwner: string | null, deskId: string, coinOwner: string, assets: CryptoAsset[], capBps = maxMarkupBps): Promise<Pair[]> {
    const [markets, markups] = await Promise.all([
      this.prices.live(assets.map(asset => asset.code)),
      this.prisma.exchangeMarkup.findMany({ where: { desk: deskId, mode, currency, asset: { in: assets.map(asset => asset.code) } } }),
    ]);
    let fxMid: Prisma.Decimal | null = null;
    try {
      fxMid = await this.fx.mid(currency);
    } catch {
      fxMid = null;
    }
    const reserveFiat = fiatOwner ? await this.balance(mode, fiatReserveRef(fiatOwner, currency)) : 0n;
    const pairs: Pair[] = [];
    for (const asset of assets) {
      const markup = markups.find(row => row.asset === asset.code) ?? null;
      const market = markets.get(asset.code) ?? null;
      const closed: ClosedReason | null = !markup?.enabled || !asset.enabled ? 'not_offered' : !market ? 'price_unavailable' : !fxMid ? 'conversion_unavailable' : null;
      pairs.push({ asset, market, fxMid, markup, closed, reserveCoins: await this.balance(mode, cryptoReserveRef(asset.code, coinOwner)), reserveFiat, capBps });
    }
    return pairs;
  }

  private side(pair: Pair, side: ExchangeSide) {
    if (pair.closed || !pair.market || !pair.fxMid || !pair.markup) return null;
    // A cap lowered after a markup was saved still holds: the price never carries more than the cap allows.
    const markupBps = Math.min(side === 'buy' ? pair.markup.buyMarkupBps : pair.markup.sellMarkupBps, pair.capBps);
    const price = deskPrice(pair.market.e8, pair.fxMid, markupBps, side);
    const most = available(side, price, pair.asset.decimals, side === 'buy' ? pair.reserveCoins : pair.reserveFiat);
    return { price, markupBps, most };
  }

  private presentPair(pair: Pair) {
    const view = (side: ExchangeSide) => {
      const terms = this.side(pair, side);
      if (!terms) return null;
      return {
        /** Fiat minor units per whole coin, the markup included. */
        price: minor(terms.price),
        markup_bps: terms.markupBps,
        min_fiat: minor(pair.markup!.minFiatMinor),
        max_fiat: pair.markup!.maxFiatMinor === null ? null : minor(pair.markup!.maxFiatMinor),
        /** What BitoCard's reserve allows now: the most coins to buy and what they cost, or the most money to sell for. */
        available_amount: fromUnits(terms.most.amount, pair.asset.decimals),
        available_fiat: minor(terms.most.fiat),
      };
    };
    return {
      asset: pair.asset.code,
      name: pair.asset.name,
      decimals: pair.asset.decimals,
      market: pair.market
        ? {
            usd: pair.market.text,
            change_24h: pair.market.change24h,
            updated_at: pair.market.updatedAt ? new Date(pair.market.updatedAt).toISOString() : null,
            /** The market price per whole coin in the currency (minor units), before any markup. */
            price: pair.fxMid ? Number(marketPriceMinor(pair.market.e8, pair.fxMid).toDecimalPlaces(0).toFixed(0)) : null,
          }
        : null,
      closed: pair.closed,
      buy: view('buy'),
      sell: view('sell'),
    };
  }

  // -- Customers -----------------------------------------------------------------------------------------------------

  /** What the customer can trade now: each coin's market price, BitoCard's prices and reserves, and their balances. */
  async overview(customer: CustomerWithStore, asked?: string, requestedCurrency?: string) {
    const context = await this.wallets.context(customer);
    const currency = (requestedCurrency ?? context.currency).toUpperCase();
    if (currency !== context.currency && currency !== 'USD') throw invalid('currency_unsupported', 'Use your local wallet or your US dollar wallet.', 'currency');
    let reason: { code: string; message: string } | null = null;
    try {
      await this.requireTrader(customer);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      reason = { code: error.code, message: error.message };
    }
    const assets = (await this.wallets.assets()).filter(asset => !asked || asset.code === asked.toUpperCase());
    const desks = await Promise.all(assets.map(asset => this.desk(context, asset.code, currency)));
    const pairs = reason ? [] : await Promise.all(assets.map(async (asset, index) => {
      const desk = desks[index]!;
      const [pair] = await this.pairs(context.mode, currency, desk.enabled ? desk.fiatOwner : null, desk.id, desk.coinOwner, [asset], desk.capBps);
      return { ...pair, closed: desk.enabled ? pair.closed : 'not_offered' as ClosedReason };
    }));
    const desk = desks[0] ?? await this.desk(context);
    const rows = await this.prisma.ledgerAccount.findMany({
      where: { customerId: customer.id, mode: context.mode, kind: { in: ['crypto_wallet', 'customer_withdrawable', 'customer_wallet'] } },
      select: { kind: true, currency: true, balanceMinor: true },
    });
    const held = (kind: string, code: string) => rows.find(row => row.kind === kind && row.currency === code)?.balanceMinor ?? 0n;
    return {
      object: 'exchange' as const,
      mode: context.mode,
      currency,
      desk: { id: desk.id, name: desk.name },
      enabled: !reason,
      reason: reason?.code ?? null,
      message: reason?.message ?? null,
      quote_seconds: quoteLifetimeMs / 1000,
      balances: { proceeds: minor(held('customer_withdrawable', currency)), wallet: minor(held('customer_wallet', currency)) },
      assets: pairs.map((pair, index) => ({ ...this.presentPair(pair), desk: { id: desks[index]!.id, name: desks[index]!.name }, holding: fromUnits(held('crypto_wallet', pair.asset.code), pair.asset.decimals) })),
    };
  }

  /** A price held for 30 seconds: exactly what the trade will move, refused when BitoCard's reserve cannot cover it. */
  async quote(customer: CustomerWithStore, input: { asset: string; side: ExchangeSide; amount?: string; fiat?: number }) {
    const context = await this.requireTrader(customer);
    if ((input.amount === undefined) === (input.fiat === undefined)) throw invalid('parameter_missing', 'Send either amount or fiat.', 'amount');
    const asset = await this.wallets.asset(input.asset);
    const desk = await this.desk(context, asset.code);
    if (!desk.enabled) throw conflict('pair_unavailable', 'This store does not offer this exchange pair.');
    const [pair] = await this.pairs(context.mode, context.currency, desk.fiatOwner, desk.id, desk.coinOwner, [asset], desk.capBps);
    const terms = this.side(pair, input.side);
    if (!terms) throw this.closedError(pair.closed ?? 'not_offered', asset.code, desk.name);
    const { amount, fiat } = tradeTerms(input.side, terms.price, asset.decimals, input.amount !== undefined ? { amount: toUnits(input.amount, asset.decimals) } : { fiat: BigInt(input.fiat!) });
    if (amount <= 0n || fiat <= 0n) throw invalid('amount_too_small', 'This amount is too small to trade. Enter a bigger amount.', input.amount !== undefined ? 'amount' : 'fiat');
    const markup = pair.markup!;
    if (fiat < markup.minFiatMinor) throw invalid('below_limit', `The smallest trade is ${formatMoney(markup.minFiatMinor, context.currency)}.`, 'fiat');
    if (markup.maxFiatMinor !== null && fiat > markup.maxFiatMinor) throw invalid('above_limit', `The largest trade is ${formatMoney(markup.maxFiatMinor, context.currency)}.`, 'fiat');
    this.checkReserve(input.side, asset, context.currency, amount, fiat, terms.most, desk.name);
    const quote = await this.prisma.exchangeQuote.create({
      data: {
        desk: desk.id,
        mode: context.mode,
        customerId: customer.id,
        side: input.side,
        asset: asset.code,
        currency: context.currency,
        amount,
        fiatMinor: fiat,
        priceMinor: terms.price,
        marketUsdE8: pair.market!.e8,
        marketAt: pair.market!.updatedAt ? new Date(pair.market!.updatedAt) : null,
        fxMid: pair.fxMid!,
        markupBps: terms.markupBps,
        expiresAt: new Date(Date.now() + quoteLifetimeMs),
      },
    });
    return { ...this.presentQuote(quote, asset), available: { amount: fromUnits(terms.most.amount, asset.decimals), fiat: minor(terms.most.fiat) }, capped: input.side === 'buy' ? amount === terms.most.amount : fiat === terms.most.fiat };
  }

  /** Settles a quote at once: claimed, every account locked, the reserve and the customer's balance checked, one entry. */
  async trade(customer: CustomerWithStore, quoteId: string) {
    const context = await this.requireTrader(customer);
    const quote = await this.prisma.exchangeQuote.findFirst({ where: { id: quoteId, customerId: customer.id } });
    if (!quote) throw notFound('quote');
    const desk = await this.desk(context, quote.asset);
    if (quote.desk !== desk.id || quote.mode !== context.mode || quote.currency !== context.currency) throw notFound('quote');
    if (quote.usedAt) throw conflict('quote_used', 'This price was already used. Get a new quote.', 'quote_id');
    if (quote.expiresAt <= new Date()) throw conflict('quote_expired', 'This price is no longer held. Get a new quote.', 'quote_id');
    const asset = await this.wallets.asset(quote.asset);
    const { mode, currency } = context;
    const side = quote.side as ExchangeSide;
    const ids = {
      // The desk's own fiat reserve: on a fallback to BitoCard that is the market's house account, never the store's reseller.
      reserveFiat: await this.ledger.accountId(mode, fiatReserveRef(desk.fiatOwner, currency)),
      reserveCoins: await this.ledger.accountId(mode, cryptoReserveRef(asset.code, desk.coinOwner)),
      coins: await this.ledger.accountId(mode, this.wallets.ref(customer.id, 'crypto_wallet', asset.code)),
      proceeds: await this.ledger.accountId(mode, this.wallets.ref(customer.id, 'customer_withdrawable', currency)),
      wallet: await this.ledger.accountId(mode, this.wallets.ref(customer.id, 'customer_wallet', currency)),
    };
    const id = randomUUID();
    const markup = markupEarned(side, quote.fiatMinor, quote.amount, quote.marketUsdE8, quote.fxMid, asset.decimals);

    const trade = await this.prisma.$transaction(async tx => {
      const claimed = await tx.exchangeQuote.updateMany({ where: { id: quote.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) throw conflict('quote_expired', 'This price is no longer held. Get a new quote.', 'quote_id');
      // Every account the trade touches, locked at once in one order, so parallel trades never deadlock.
      const balances = await this.ledger.lockBalances(tx, Object.values(ids));
      const has = (accountId: string) => balances.get(accountId) ?? 0n;
      // The customer's coin account is locked, so their parallel trades in this coin are counted one at a time.
      await exchangeDailyLimit(asset, quote.amount, async since =>
        (await tx.exchangeTrade.aggregate({ _sum: { amount: true }, where: { customerId: customer.id, mode, asset: asset.code, createdAt: { gte: since } } }))._sum.amount ?? 0n,
      );
      let fromProceeds = 0n;
      let fromWallet = 0n;
      const postings: PreparedEntry['postings'] = [];
      if (side === 'buy') {
        if (has(ids.reserveCoins) < quote.amount) throw short(`${desk.name} now has ${fromUnits(has(ids.reserveCoins), asset.decimals)} ${asset.code} available. The trade did not happen.`, 'amount');
        if (has(ids.proceeds) + has(ids.wallet) < quote.fiatMinor) {
          throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'insufficient_funds', `Your ${currency} balance is too low for this trade. Add money to your wallet first.`);
        }
        fromProceeds = has(ids.proceeds) < quote.fiatMinor ? has(ids.proceeds) : quote.fiatMinor;
        fromWallet = quote.fiatMinor - fromProceeds;
        if (fromProceeds > 0n) postings.push({ accountId: ids.proceeds, kind: 'customer_withdrawable', amount: fromProceeds });
        if (fromWallet > 0n) postings.push({ accountId: ids.wallet, kind: 'customer_wallet', amount: fromWallet });
        postings.push(
          { accountId: ids.reserveFiat, kind: 'reserve_fiat', amount: -quote.fiatMinor },
          { accountId: ids.reserveCoins, kind: 'reserve_crypto', amount: quote.amount },
          { accountId: ids.coins, kind: 'crypto_wallet', amount: -quote.amount },
        );
      } else {
        if (has(ids.coins) < quote.amount) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'insufficient_funds', `Your ${asset.code} balance is too low for this trade.`);
        if (has(ids.reserveFiat) < quote.fiatMinor) throw short(`${desk.name} can now pay up to ${formatMoney(has(ids.reserveFiat), currency)}. The trade did not happen.`, 'fiat');
        postings.push(
          { accountId: ids.coins, kind: 'crypto_wallet', amount: quote.amount },
          { accountId: ids.reserveCoins, kind: 'reserve_crypto', amount: -quote.amount },
          { accountId: ids.reserveFiat, kind: 'reserve_fiat', amount: quote.fiatMinor },
          { accountId: ids.proceeds, kind: 'customer_withdrawable', amount: -quote.fiatMinor },
        );
      }
      const row = await tx.exchangeTrade.create({
        data: {
          id,
          quoteId: quote.id,
          desk: desk.id,
          mode,
          customerId: customer.id,
          side,
          asset: asset.code,
          currency,
          amount: quote.amount,
          fiatMinor: quote.fiatMinor,
          priceMinor: quote.priceMinor,
          marketUsdE8: quote.marketUsdE8,
          fxMid: quote.fxMid,
          markupBps: quote.markupBps,
          markupMinor: markup,
          fromProceeds,
          fromWallet,
        },
      });
      await this.ledger.write(tx, {
        mode,
        type: 'exchange_trade',
        reference: `exchange_trade:${id}`,
        // A customer's trade: kept out of the house account's wallet transactions.
        resellerId: null,
        description: `${side === 'buy' ? 'Bought' : 'Sold'} ${fromUnits(quote.amount, asset.decimals)} ${asset.code} (${exchangeTradeNumber(row.number)})`,
        metadata: { exchange_trade_id: id, quote_id: quote.id, side, asset: asset.code },
        postings,
      });
      return { row, reserveAfter: side === 'buy' ? has(ids.reserveCoins) - quote.amount : has(ids.reserveFiat) - quote.fiatMinor };
    });
    // Told after the trade commits; a failed notice never undoes it.
    await this.afterTrade(customer, context, desk, asset, trade.row, trade.reserveAfter);
    return this.presentTrade(trade.row, asset, desk.name);
  }

  /** The customer's receipt notice, and the desk's owner told when the reserve the trade drew on runs low. */
  private async afterTrade(customer: CustomerWithStore, context: CryptoContext, desk: { id: string; name: string; fiatOwner: string }, asset: CryptoAsset, trade: ExchangeTrade, reserveAfter: bigint) {
    const bought = trade.side === 'buy';
    await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.exchange.completed', {
      subject: trade.id,
      title: `${bought ? 'You bought' : 'You sold'} ${fromUnits(trade.amount, asset.decimals)} ${asset.code}`,
      body: `${exchangeTradeNumber(trade.number)}: ${formatMoney(trade.fiatMinor, trade.currency)} ${bought ? 'paid' : 'added to your P2P money'}.`,
      link: '/account/crypto/exchange',
      mode: trade.mode,
    });
    const day = new Date().toISOString().slice(0, 10);
    if (desk.id === bitocardDesk) {
      const alert = bought
        ? asset.exchangeReserveAlert === null ? null : toUnits(asset.exchangeReserveAlert, asset.decimals)
        : (await this.prisma.country.findUnique({ where: { code: context.country }, select: { exchangeReserveAlertMinor: true } }))?.exchangeReserveAlertMinor ?? null;
      if (alert === null || reserveAfter >= alert) return;
      const left = bought ? `${fromUnits(reserveAfter, asset.decimals)} ${asset.code}` : formatMoney(reserveAfter, trade.currency);
      await this.inbox.admins('admin.exchange.reserve_low', {
        subject: `${trade.mode}:${bought ? asset.code : `${context.country}:${trade.currency}`}:${day}`,
        title: `BitoCard's ${bought ? asset.code : trade.currency} exchange reserve is low`,
        body: `${left} left after ${exchangeTradeNumber(trade.number)}. Fund it from Crypto > Exchange > Reserves.`,
        link: '/crypto/exchange',
        mode: trade.mode,
      });
      return;
    }
    // A reseller desk: told once a day per coin or currency when the reserve can no longer cover its smallest trade.
    const markup = await this.prisma.exchangeMarkup.findUnique({ where: { desk_mode_asset_currency: { desk: desk.id, mode: trade.mode, asset: asset.code, currency: trade.currency } } });
    const covers = bought ? (reserveAfter * trade.priceMinor) / 10n ** BigInt(asset.decimals) : reserveAfter;
    if (covers >= (markup?.minFiatMinor ?? 1n)) return;
    await this.inbox.reseller(desk.id, 'exchange.reserve_low', {
      subject: `${trade.mode}:${bought ? asset.code : trade.currency}:${day}`,
      title: `Your ${bought ? asset.code : trade.currency} exchange reserve is running out`,
      body: `Customers can no longer ${bought ? 'buy' : 'sell'} ${asset.code} at your desk. Fund the reserve in Exchange > Desk.`,
      link: '/exchange/desk',
      mode: trade.mode,
    });
  }

  async trades(customer: CustomerWithStore, page: { limit?: number; starting_after?: string }) {
    const { mode } = await this.wallets.context(customer);
    const result = await this.list({ customerId: customer.id, mode }, page);
    return { ...result, data: result.data.map(row => ({ ...row, desk: { id: row.desk.id, name: row.desk.id === bitocardDesk ? 'BitoCard' : customer.store.name } })) };
  }

  async getTrade(customer: CustomerWithStore, id: string) {
    const trade = await this.prisma.exchangeTrade.findFirst({ where: { id, customerId: customer.id } });
    if (!trade) throw notFound('trade');
    return this.presentTrade(trade, await this.wallets.asset(trade.asset, 'asset', true), trade.desk === bitocardDesk ? 'BitoCard' : customer.store.name);
  }

  private checkReserve(side: ExchangeSide, asset: CryptoAsset, currency: string, amount: bigint, fiat: bigint, most: { amount: bigint; fiat: bigint }, deskName: string) {
    if (side === 'buy' && amount > most.amount) throw short(`${deskName} has ${fromUnits(most.amount, asset.decimals)} ${asset.code} available right now.`, 'amount');
    if (side === 'sell' && fiat > most.fiat) throw short(`${deskName} can pay up to ${formatMoney(most.fiat, currency)} right now.`, 'fiat');
  }

  private closedError(reason: ClosedReason, asset: string, deskName: string) {
    if (reason === 'price_unavailable') return new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'price_unavailable', `${asset} prices are unavailable right now. Try again in a minute.`);
    if (reason === 'conversion_unavailable') return new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'conversion_unavailable', 'Prices in your currency are paused right now. Try again later.');
    return conflict('pair_unavailable', `${deskName} does not trade ${asset} here right now.`, 'asset');
  }

  // -- Admins --------------------------------------------------------------------------------------------------------

  /** BitoCard's reserves in a mode: every coin (shared by every market) and each market's money, with live prices. */
  async reserves(mode: LedgerMode) {
    const assets = await this.wallets.assets(true);
    const markets = await this.prices.live(assets.map(asset => asset.code));
    const countries = await this.prisma.country.findMany({ orderBy: { code: 'asc' } });
    const houses = await this.prisma.reseller.findMany({ where: { house: true, country: { not: null } }, select: { id: true, country: true } });
    const coins = [];
    for (const asset of assets) {
      const price = markets.get(asset.code) ?? null;
      coins.push({
        asset: asset.code,
        name: asset.name,
        decimals: asset.decimals,
        enabled: asset.enabled,
        balance: fromUnits(await this.balance(mode, cryptoReserveRef(asset.code)), asset.decimals),
        market: price ? { usd: price.text, change_24h: price.change24h, updated_at: price.updatedAt ? new Date(price.updatedAt).toISOString() : null } : null,
      });
    }
    const money = [];
    for (const country of countries) {
      const house = houses.find(row => row.country === country.code);
      for (const currency of [...new Set([country.currency, 'USD'])]) {
        money.push({ country: country.code, name: country.name, currency, balance: minor(house ? await this.balance(mode, fiatReserveRef(house.id, currency)) : 0n) });
      }
    }
    return { object: 'exchange_reserves' as const, mode, coins, markets: money };
  }

  /** A reseller's own desk, isolated from BitoCard and every other reseller. */
  async resellerReserves(resellerId: string, mode: LedgerMode) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { country: true, name: true, house: true } });
    if (reseller.house || !reseller.country) throw invalid('exchange_unavailable', 'This reseller has no exchange desk.');
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: reseller.country }, select: { currency: true } });
    const currencies = [...new Set([country.currency, 'USD'])];
    const assets = await this.wallets.assets(true);
    const [coins, money] = await Promise.all([
      Promise.all(assets.map(async asset => ({ asset: asset.code, name: asset.name, enabled: asset.enabled, balance: fromUnits(await this.balance(mode, cryptoReserveRef(asset.code, resellerId)), asset.decimals) }))),
      Promise.all(currencies.map(async currency => ({ currency, balance: minor(await this.balance(mode, fiatReserveRef(resellerId, currency))) }))),
    ]);
    return { object: 'exchange_reserves' as const, mode, desk: { id: resellerId, name: reseller.name }, coins, wallets: money };
  }

  /** A reseller's own desk may be changed only while the `reseller_desks` switch is on, and live only once verified. */
  private async requireOwnDesk(resellerId: string, mode: LedgerMode) {
    if (!(await this.settings.isOn('reseller_desks', resellerId))) throw conflict('exchange_not_enabled', 'Running your own exchange desk is not enabled for your business yet.');
    if (mode === 'live') {
      const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { status: true } });
      if (reseller.status !== 'active') throw conflict('exchange_unavailable', 'Your business must be verified before running a live exchange desk.');
    }
  }

  async resellerDesk(resellerId: string) {
    const [enabled, choice, reseller] = await Promise.all([
      this.settings.isOn('reseller_desks', resellerId),
      this.prisma.exchangeDesk.findUnique({ where: { resellerId } }),
      this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { country: true } }),
    ]);
    const markupCapBps = reseller.country ? await this.markupCap(reseller.country) : 0;
    return { object: 'exchange_desk' as const, enabled, fallback_to_bitocard: choice?.fallbackToBitocard ?? true, markup_cap_bps: markupCapBps };
  }

  async setResellerDesk(resellerId: string, fallbackToBitocard: boolean) {
    if (!(await this.settings.isOn('reseller_desks', resellerId))) throw conflict('exchange_not_enabled', 'Running your own exchange desk is not enabled for your business yet.');
    await this.prisma.exchangeDesk.upsert({ where: { resellerId }, create: { resellerId, fallbackToBitocard }, update: { fallbackToBitocard } });
    return this.resellerDesk(resellerId);
  }

  /** Put topped-up reseller money behind customer exchanges, or return it to the reseller's spendable wallet. */
  async transferResellerFiat(resellerId: string, mode: LedgerMode, input: { currency: string; amount: number; direction: 'fund' | 'withdraw' }) {
    await this.requireOwnDesk(resellerId, mode);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { country: true, house: true } });
    if (reseller.house || !reseller.country) throw invalid('exchange_unavailable', 'This reseller has no exchange desk.');
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: reseller.country }, select: { currency: true } });
    const currency = input.currency.toUpperCase();
    if (![country.currency, 'USD'].includes(currency)) throw invalid('currency_unsupported', 'Only your country and US dollar wallets can be used.', 'currency');
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw invalid('parameter_invalid', 'Enter an amount above zero.', 'amount');
    const funding: AccountRef = { kind: 'reseller_funding', resellerId, currency };
    const earnings: AccountRef = { kind: 'reseller_earnings', resellerId, currency };
    const reserve = fiatReserveRef(resellerId, currency);
    const fromFunding = input.direction === 'fund' ? (await this.balance(mode, funding) < amount ? await this.balance(mode, funding) : amount) : 0n;
    await this.ledger.post({
      mode,
      type: input.direction === 'fund' ? 'exchange_reserve_fund' : 'exchange_reserve_withdraw',
      reference: `exchange_reserve_transfer:${randomUUID()}`,
      resellerId,
      description: `${input.direction === 'fund' ? 'Funded' : 'Drew down'} ${currency} exchange reserve`,
      lines: input.direction === 'fund'
        ? [...(fromFunding ? [{ account: funding, debit: fromFunding }] : []), ...(amount > fromFunding ? [{ account: earnings, debit: amount - fromFunding }] : []), { account: reserve, credit: amount }]
        : [{ account: reserve, debit: amount }, { account: funding, credit: amount }],
    });
    return this.resellerReserves(resellerId, mode);
  }

  /** BitoCard's markup for every coin in every market currency (defaults until set), with the live prices they give. */
  async markups(mode: LedgerMode) {
    return this.markupsFor(mode, bitocardDesk);
  }

  async resellerMarkups(resellerId: string, mode: LedgerMode) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { country: true } });
    if (!reseller.country) throw invalid('country_required', 'Set your business country first.');
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: reseller.country }, select: { currency: true } });
    return this.markupsFor(mode, resellerId, [...new Set([country.currency, 'USD'])]);
  }

  private async markupsFor(mode: LedgerMode, deskId: string, selectedCurrencies?: string[]) {
    const assets = await this.wallets.assets();
    const currencies = selectedCurrencies ?? [...new Set(['USD', ...(await this.prisma.country.findMany({ select: { currency: true } })).map(row => row.currency)])].sort();
    const data = [];
    for (const currency of currencies) {
      for (const pair of await this.pairs(mode, currency, null, deskId, deskId === bitocardDesk ? houseRootId : deskId, assets)) {
        const markup = pair.markup;
        const buyBps = markup?.buyMarkupBps ?? 150;
        const sellBps = markup?.sellMarkupBps ?? 150;
        const live = pair.market && pair.fxMid;
        data.push({
          object: 'exchange_markup' as const,
          asset: pair.asset.code,
          currency,
          enabled: markup?.enabled ?? false,
          buy_markup_bps: buyBps,
          sell_markup_bps: sellBps,
          min_fiat: minor(markup?.minFiatMinor ?? 0n),
          max_fiat: markup?.maxFiatMinor === null || markup?.maxFiatMinor === undefined ? null : minor(markup.maxFiatMinor),
          market_usd: pair.market?.text ?? null,
          market_price: live ? Number(marketPriceMinor(pair.market!.e8, pair.fxMid!).toDecimalPlaces(0).toFixed(0)) : null,
          buy_price: live ? minor(deskPrice(pair.market!.e8, pair.fxMid!, buyBps, 'buy')) : null,
          sell_price: live ? minor(deskPrice(pair.market!.e8, pair.fxMid!, sellBps, 'sell')) : null,
          updated_at: markup?.updatedAt.toISOString() ?? null,
        });
      }
    }
    return { object: 'list' as const, mode, data };
  }

  async setMarkup(actorId: string | null, input: { mode: LedgerMode; asset: string; currency: string; buy_markup_bps: number; sell_markup_bps: number; min_fiat: number; max_fiat: number | null; enabled: boolean }) {
    return this.saveMarkup(bitocardDesk, actorId, input);
  }

  async setResellerMarkup(resellerId: string, actorId: string | null, input: { mode: LedgerMode; asset: string; currency: string; buy_markup_bps: number; sell_markup_bps: number; min_fiat: number; max_fiat: number | null; enabled: boolean }) {
    await this.requireOwnDesk(resellerId, input.mode);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { country: true } });
    if (!reseller.country) throw invalid('country_required', 'Set your business country first.');
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: reseller.country }, select: { currency: true, exchangeMarkupCapBps: true } });
    if (![market.currency, 'USD'].includes(input.currency.toUpperCase())) throw invalid('currency_unsupported', 'Only your country and US dollar wallets can be used.', 'currency');
    const cap = Math.min(maxMarkupBps, market.exchangeMarkupCapBps);
    if (input.buy_markup_bps > cap || input.sell_markup_bps > cap) throw invalid('markup_above_cap', `Your market allows exchange markups of at most ${cap / 100}%.`, 'buy_markup_bps');
    return this.saveMarkup(resellerId, actorId, input);
  }

  private async saveMarkup(deskId: string, actorId: string | null, input: { mode: LedgerMode; asset: string; currency: string; buy_markup_bps: number; sell_markup_bps: number; min_fiat: number; max_fiat: number | null; enabled: boolean }) {
    const asset = await this.wallets.asset(input.asset, 'asset', true);
    const currency = input.currency.toUpperCase();
    if (currency !== 'USD' && !(await this.prisma.country.findFirst({ where: { currency } }))) throw invalid('currency_unsupported', `No market trades in ${currency}.`, 'currency');
    if (input.buy_markup_bps > maxMarkupBps || input.sell_markup_bps > maxMarkupBps) throw invalid('parameter_invalid', 'Markups are at most 20%.', 'buy_markup_bps');
    if (input.max_fiat !== null && input.max_fiat < input.min_fiat) throw invalid('parameter_invalid', 'The largest trade must be at least the smallest.', 'max_fiat');
    const key = { desk: deskId, mode: input.mode, asset: asset.code, currency };
    const before = await this.prisma.exchangeMarkup.findUnique({ where: { desk_mode_asset_currency: key } });
    const data = {
      buyMarkupBps: input.buy_markup_bps,
      sellMarkupBps: input.sell_markup_bps,
      minFiatMinor: BigInt(input.min_fiat),
      maxFiatMinor: input.max_fiat === null ? null : BigInt(input.max_fiat),
      enabled: input.enabled,
    };
    const after = await this.prisma.exchangeMarkup.upsert({ where: { desk_mode_asset_currency: key }, create: { ...key, ...data }, update: data });
    await this.audit.record({ actorId, action: 'exchange.markup_changed', targetType: 'exchange_markup', targetId: after.id, before, after });
    return (await this.markupsFor(input.mode, deskId, [currency])).data.find(row => row.asset === asset.code && row.currency === currency);
  }

  async adminTrades(filter: { mode?: LedgerMode; asset?: string; customer_id?: string; desk?: string; limit?: number; starting_after?: string }) {
    return this.list(
      { ...(filter.mode ? { mode: filter.mode } : {}), ...(filter.asset ? { asset: filter.asset.toUpperCase() } : {}), ...(filter.customer_id ? { customerId: filter.customer_id } : {}), ...(filter.desk ? { desk: filter.desk } : {}) },
      filter,
      true,
    );
  }

  /** Customers' trades at a reseller's own desk, for that reseller (their customers, their markup earned). */
  async deskTrades(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const rows = await this.prisma.exchangeTrade.findMany({
      where: { desk: resellerId, mode },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
      include: { customer: { select: { id: true, name: true, email: true } } },
    });
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map(row => ({
        object: 'desk_trade' as const,
        id: row.id,
        number: exchangeTradeNumber(row.number),
        mode: row.mode,
        side: row.side as ExchangeSide,
        asset: row.asset,
        currency: row.currency,
        amount: fromUnits(row.amount, assets.get(row.asset)!.decimals),
        fiat: minor(row.fiatMinor),
        price: minor(row.priceMinor),
        markup: minor(row.markupMinor),
        customer: { id: row.customer.id, name: row.customer.name, email: row.customer.email },
        created_at: row.createdAt.toISOString(),
      })),
      has_more: rows.length > limit,
    };
  }

  /** Every reseller running a desk: whether it may, its fallback choice, the pairs it offers and its reserves. */
  async adminDesks(mode: LedgerMode) {
    const [desks, offering] = await Promise.all([
      this.prisma.exchangeDesk.findMany({ select: { resellerId: true, fallbackToBitocard: true } }),
      this.prisma.exchangeMarkup.findMany({ where: { mode, desk: { not: bitocardDesk } }, select: { desk: true, asset: true, currency: true, enabled: true, buyMarkupBps: true, sellMarkupBps: true } }),
    ]);
    const ids = [...new Set([...desks.map(row => row.resellerId), ...offering.map(row => row.desk)])];
    const resellers = await this.prisma.reseller.findMany({ where: { id: { in: ids }, house: false }, select: { id: true, name: true, country: true, status: true } });
    const balances = await this.prisma.ledgerAccount.findMany({
      where: { mode, resellerId: { in: ids }, kind: { in: ['reserve_fiat', 'reserve_crypto'] } },
      select: { resellerId: true, kind: true, currency: true, balanceMinor: true },
    });
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    const data = [];
    for (const reseller of resellers) {
      const own = balances.filter(row => row.resellerId === reseller.id && row.balanceMinor !== 0n);
      data.push({
        object: 'exchange_desk_summary' as const,
        reseller: { id: reseller.id, name: reseller.name, country: reseller.country, status: reseller.status },
        allowed: await this.settings.isOn('reseller_desks', reseller.id),
        fallback_to_bitocard: desks.find(row => row.resellerId === reseller.id)?.fallbackToBitocard ?? true,
        pairs: offering
          .filter(row => row.desk === reseller.id)
          .map(row => ({ asset: row.asset, currency: row.currency, enabled: row.enabled, buy_markup_bps: row.buyMarkupBps, sell_markup_bps: row.sellMarkupBps })),
        reserves: {
          fiat: own.filter(row => row.kind === 'reserve_fiat').map(row => ({ currency: row.currency, balance: minor(row.balanceMinor) })),
          coins: own.filter(row => row.kind === 'reserve_crypto').map(row => ({ asset: row.currency, balance: fromUnits(row.balanceMinor, assets.get(row.currency)?.decimals ?? 8) })),
        },
      });
    }
    return { object: 'list' as const, mode, data };
  }

  private async list(where: Prisma.ExchangeTradeWhereInput, page: { limit?: number; starting_after?: string }, admin = false) {
    const limit = page.limit ?? 25;
    const rows = await this.prisma.exchangeTrade.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
      ...(admin ? { include: { customer: { select: { id: true, name: true, email: true } } } } : {}),
    });
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map(row => {
        const view = this.presentTrade(row, assets.get(row.asset)!);
        const owner = (row as ExchangeTrade & { customer?: { id: string; name: string; email: string } }).customer;
        return admin ? { ...view, customer: owner ?? null, markup: minor(row.markupMinor), market_usd: fromUnits(row.marketUsdE8, 8) } : view;
      }),
      has_more: rows.length > limit,
    };
  }

  // -- Views ---------------------------------------------------------------------------------------------------------

  private presentQuote(quote: ExchangeQuote, asset: CryptoAsset) {
    return {
      object: 'exchange_quote' as const,
      id: quote.id,
      mode: quote.mode,
      side: quote.side as ExchangeSide,
      asset: quote.asset,
      currency: quote.currency,
      amount: fromUnits(quote.amount, asset.decimals),
      fiat: minor(quote.fiatMinor),
      price: minor(quote.priceMinor),
      markup_bps: quote.markupBps,
      market_usd: fromUnits(quote.marketUsdE8, 8),
      market_updated_at: quote.marketAt?.toISOString() ?? null,
      fx_rate: quote.fxMid.toDecimalPlaces(6).toString(),
      expires_at: quote.expiresAt.toISOString(),
      created_at: quote.createdAt.toISOString(),
    };
  }

  presentTrade(trade: ExchangeTrade, asset: Pick<CryptoAsset, 'decimals'>, deskName = trade.desk === bitocardDesk ? 'BitoCard' : 'Reseller store') {
    return {
      object: 'exchange_trade' as const,
      id: trade.id,
      number: exchangeTradeNumber(trade.number),
      mode: trade.mode,
      desk: { id: trade.desk, name: deskName },
      side: trade.side as ExchangeSide,
      asset: trade.asset,
      currency: trade.currency,
      amount: fromUnits(trade.amount, asset.decimals),
      fiat: minor(trade.fiatMinor),
      price: minor(trade.priceMinor),
      markup_bps: trade.markupBps,
      from_proceeds: minor(trade.fromProceeds),
      from_wallet: minor(trade.fromWallet),
      created_at: trade.createdAt.toISOString(),
    };
  }
}

/**
 * The asset's daily exchange limit per taker (`crypto_assets.exchange_daily_limit`, coin units; null: none), checked
 * inside the trade's transaction with the taker's coin account locked, so parallel trades cannot pass it.
 */
export async function exchangeDailyLimit(asset: CryptoAsset, amount: bigint, tradedSince: (since: Date) => Promise<bigint>) {
  if (asset.exchangeDailyLimit === null) return;
  const limit = toUnits(asset.exchangeDailyLimit, asset.decimals);
  const used = await tradedSince(new Date(Date.now() - 24 * 60 * 60 * 1000));
  if (used + amount > limit) {
    const left = limit > used ? limit - used : 0n;
    throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalid_request_error', 'exchange_limit', `You can exchange ${fromUnits(left, asset.decimals)} more ${asset.code} in the next 24 hours.`, 'amount');
  }
}
