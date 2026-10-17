import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { HouseService } from '../../checkout/house.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CryptoAsset, LedgerMode, ResellerDeskQuote, ResellerDeskTrade } from '../../generated/prisma/client.js';
import { FxService } from '../../fx/fx.service.js';
import { type AccountRef, LedgerService, type PreparedEntry } from '../../ledger/ledger.service.js';
import { minor } from '../../ledger/mode.js';
import { walletCurrencies } from '../../ledger/wallet.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { fromUnits, toUnits } from '../amounts.js';
import { CryptoWalletsService } from '../crypto-wallets.service.js';
import { CryptoPricesService } from '../prices.js';
import { available, deskPrice, type ExchangeSide, markupEarned, quoteLifetimeMs, tradeTerms } from './pricing.js';
import { bitocardDesk, cryptoReserveRef, fiatReserveRef, exchangeDailyLimit } from './exchange.service.js';

const error = (status: HttpStatus, code: string, message: string) => new ApiError(status,
  status === HttpStatus.BAD_REQUEST || status === HttpStatus.PAYMENT_REQUIRED ? 'invalid_request_error'
    : status === HttpStatus.NOT_FOUND ? 'not_found_error' : status === HttpStatus.SERVICE_UNAVAILABLE ? 'api_error' : 'conflict_error', code, message);
const fundingRef = (resellerId: string, currency: string): AccountRef => ({ kind: 'reseller_funding', resellerId, currency });
const earningsRef = (resellerId: string, currency: string): AccountRef => ({ kind: 'reseller_earnings', resellerId, currency });
const coinRef = (resellerId: string, asset: string): AccountRef => ({ kind: 'reseller_crypto', resellerId, currency: asset });

/** A reseller trades its funded fiat wallet and coin reserve with BitoCard's own desk. */
@Injectable()
export class ResellerDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly house: HouseService,
    private readonly wallets: CryptoWalletsService,
    private readonly prices: CryptoPricesService,
    private readonly fx: FxService,
    private readonly settings: SettingsService,
  ) {}

  private async reseller(resellerId: string, mode: LedgerMode) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { id: true, country: true, status: true, house: true } });
    if (reseller.house || !reseller.country) throw error(HttpStatus.CONFLICT, 'exchange_unavailable', 'Set your business country before trading.');
    if (mode === 'live' && reseller.status !== 'active') throw error(HttpStatus.CONFLICT, 'exchange_unavailable', 'Your business must be verified before live trading.');
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: reseller.country }, select: { currency: true } });
    const switches = await Promise.all(['crypto_wallets', 'reseller_exchange'].map(key => this.settings.isOn(key as 'crypto_wallets' | 'reseller_exchange', resellerId)));
    if (switches.some(enabled => !enabled)) throw error(HttpStatus.CONFLICT, 'exchange_not_enabled', 'Exchange with BitoCard is not enabled for your business yet.');
    return { ...reseller, local: country.currency };
  }

  private async balance(mode: LedgerMode, ref: AccountRef) {
    const row = await this.prisma.ledgerAccount.findFirst({ where: { mode, kind: ref.kind, currency: ref.currency, resellerId: ref.resellerId }, select: { balanceMinor: true } });
    return row?.balanceMinor ?? 0n;
  }

  private async pair(resellerId: string, mode: LedgerMode, currency: string, asset: CryptoAsset) {
    const reseller = await this.reseller(resellerId, mode);
    if (!walletCurrencies(reseller.local).includes(currency)) throw error(HttpStatus.CONFLICT, 'currency_unsupported', 'Use your country or US dollar wallet.');
    const [marketMap, markup, mid, house] = await Promise.all([
      this.prices.live([asset.code]),
      this.prisma.exchangeMarkup.findUnique({ where: { desk_mode_asset_currency: { desk: bitocardDesk, mode, asset: asset.code, currency } } }),
      this.fx.mid(currency),
      this.house.resellerFor(reseller.country!),
    ]);
    const market = marketMap.get(asset.code);
    if (!market) throw error(HttpStatus.SERVICE_UNAVAILABLE, 'price_unavailable', 'A live price is not available.');
    if (!markup?.enabled) throw error(HttpStatus.CONFLICT, 'pair_unavailable', 'BitoCard does not offer this pair now.');
    return { market, markup, mid, house };
  }

  async overview(resellerId: string, mode: LedgerMode, currency: string) {
    const reseller = await this.reseller(resellerId, mode);
    if (!walletCurrencies(reseller.local).includes(currency)) throw error(HttpStatus.CONFLICT, 'currency_unsupported', 'Use your country or US dollar wallet.');
    const assets = await this.wallets.assets();
    const rows = await Promise.all(assets.map(async asset => {
      try {
        const pair = await this.pair(resellerId, mode, currency, asset);
        const houseFiat = fiatReserveRef(pair.house.id, currency);
        const [houseCoins, houseMoney, myCoins, myFunding, myEarnings] = await Promise.all([
          this.balance(mode, cryptoReserveRef(asset.code)), this.balance(mode, houseFiat), this.balance(mode, coinRef(resellerId, asset.code)),
          this.balance(mode, fundingRef(resellerId, currency)), this.balance(mode, earningsRef(resellerId, currency)),
        ]);
        const buyPrice = deskPrice(pair.market.e8, pair.mid, pair.markup.buyMarkupBps, 'buy');
        const sellPrice = deskPrice(pair.market.e8, pair.mid, pair.markup.sellMarkupBps, 'sell');
        return { asset: asset.code, name: asset.name, decimals: asset.decimals, market_usd: pair.market.text, buy_price: minor(buyPrice), sell_price: minor(sellPrice),
          available_to_buy: fromUnits(houseCoins, asset.decimals), available_to_sell_for: minor(houseMoney),
          your_coins: fromUnits(myCoins, asset.decimals), your_wallet: minor(myFunding + myEarnings) };
      } catch (caught) {
        if (!(caught instanceof ApiError)) throw caught;
        const myCoins = await this.balance(mode, coinRef(resellerId, asset.code));
        return { asset: asset.code, name: asset.name, decimals: asset.decimals, closed: caught.code, your_coins: fromUnits(myCoins, asset.decimals) };
      }
    }));
    return { object: 'reseller_exchange' as const, mode, currency, desk: { id: bitocardDesk, name: 'BitoCard' }, quote_seconds: quoteLifetimeMs / 1000, assets: rows };
  }

  async quote(resellerId: string, mode: LedgerMode, input: { asset: string; currency: string; side: ExchangeSide; amount?: string; fiat?: number }) {
    if ((input.amount === undefined) === (input.fiat === undefined)) throw error(HttpStatus.BAD_REQUEST, 'parameter_missing', 'Send either amount or fiat.');
    const asset = await this.wallets.asset(input.asset);
    const currency = input.currency.toUpperCase();
    const pair = await this.pair(resellerId, mode, currency, asset);
    const markupBps = input.side === 'buy' ? pair.markup.buyMarkupBps : pair.markup.sellMarkupBps;
    const price = deskPrice(pair.market.e8, pair.mid, markupBps, input.side);
    const { amount, fiat } = tradeTerms(input.side, price, asset.decimals, input.amount !== undefined ? { amount: toUnits(input.amount, asset.decimals) } : { fiat: BigInt(input.fiat!) });
    if (amount <= 0n || fiat <= 0n) throw error(HttpStatus.BAD_REQUEST, 'amount_too_small', 'Enter a larger amount.');
    if (fiat < pair.markup.minFiatMinor || (pair.markup.maxFiatMinor !== null && fiat > pair.markup.maxFiatMinor)) throw error(HttpStatus.BAD_REQUEST, 'trade_limit', 'This amount is outside BitoCard’s trade limits.');
    const reserve = input.side === 'buy' ? await this.balance(mode, cryptoReserveRef(asset.code)) : await this.balance(mode, fiatReserveRef(pair.house.id, currency));
    const most = available(input.side, price, asset.decimals, reserve);
    if ((input.side === 'buy' && amount > most.amount) || (input.side === 'sell' && fiat > most.fiat)) throw error(HttpStatus.PAYMENT_REQUIRED, 'reserve_insufficient', 'BitoCard’s reserve cannot cover this amount.');
    const row = await this.prisma.resellerDeskQuote.create({ data: { resellerId, mode, side: input.side, asset: asset.code, currency, amount, fiatMinor: fiat, priceMinor: price,
      marketUsdE8: pair.market.e8, fxMid: pair.mid, markupBps, expiresAt: new Date(Date.now() + quoteLifetimeMs) } });
    return this.presentQuote(row, asset);
  }

  async trade(resellerId: string, mode: LedgerMode, quoteId: string) {
    const reseller = await this.reseller(resellerId, mode);
    const quote = await this.prisma.resellerDeskQuote.findFirst({ where: { id: quoteId, resellerId, mode } });
    if (!quote) throw error(HttpStatus.NOT_FOUND, 'resource_missing', 'No such quote.');
    if (quote.usedAt || quote.expiresAt <= new Date()) throw error(HttpStatus.CONFLICT, 'quote_expired', 'Get a new quote.');
    if (!walletCurrencies(reseller.local).includes(quote.currency)) throw error(HttpStatus.CONFLICT, 'currency_unsupported', 'This wallet is no longer available.');
    const asset = await this.wallets.asset(quote.asset);
    const house = await this.house.resellerFor(reseller.country!);
    const ids = {
      houseFiat: await this.ledger.accountId(mode, fiatReserveRef(house.id, quote.currency)),
      houseCoins: await this.ledger.accountId(mode, cryptoReserveRef(asset.code)),
      myCoins: await this.ledger.accountId(mode, coinRef(resellerId, asset.code)),
      funding: await this.ledger.accountId(mode, fundingRef(resellerId, quote.currency)),
      earnings: await this.ledger.accountId(mode, earningsRef(resellerId, quote.currency)),
    };
    const id = randomUUID();
    const row = await this.prisma.$transaction(async tx => {
      const claimed = await tx.resellerDeskQuote.updateMany({ where: { id: quote.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) throw error(HttpStatus.CONFLICT, 'quote_expired', 'Get a new quote.');
      const balances = await this.ledger.lockBalances(tx, Object.values(ids));
      const has = (accountId: string) => balances.get(accountId) ?? 0n;
      await exchangeDailyLimit(asset, quote.amount, async since =>
        (await tx.resellerDeskTrade.aggregate({ _sum: { amount: true }, where: { resellerId, mode, asset: asset.code, createdAt: { gte: since } } }))._sum.amount ?? 0n,
      );
      const postings: PreparedEntry['postings'] = [];
      if (quote.side === 'buy') {
        if (has(ids.houseCoins) < quote.amount) throw error(HttpStatus.PAYMENT_REQUIRED, 'reserve_insufficient', 'BitoCard’s coin reserve changed.');
        if (has(ids.funding) + has(ids.earnings) < quote.fiatMinor) throw error(HttpStatus.PAYMENT_REQUIRED, 'insufficient_funds', 'Your wallet balance is too low.');
        const fromFunding = has(ids.funding) < quote.fiatMinor ? has(ids.funding) : quote.fiatMinor;
        if (fromFunding) postings.push({ accountId: ids.funding, kind: 'reseller_funding', amount: fromFunding });
        if (quote.fiatMinor > fromFunding) postings.push({ accountId: ids.earnings, kind: 'reseller_earnings', amount: quote.fiatMinor - fromFunding });
        postings.push({ accountId: ids.houseFiat, kind: 'reserve_fiat', amount: -quote.fiatMinor },
          { accountId: ids.houseCoins, kind: 'reserve_crypto', amount: quote.amount },
          { accountId: ids.myCoins, kind: 'reseller_crypto', amount: -quote.amount });
      } else {
        if (has(ids.myCoins) < quote.amount) throw error(HttpStatus.PAYMENT_REQUIRED, 'insufficient_funds', 'Your coin reserve is too low.');
        if (has(ids.houseFiat) < quote.fiatMinor) throw error(HttpStatus.PAYMENT_REQUIRED, 'reserve_insufficient', 'BitoCard’s money reserve changed.');
        postings.push({ accountId: ids.myCoins, kind: 'reseller_crypto', amount: quote.amount },
          { accountId: ids.houseCoins, kind: 'reserve_crypto', amount: -quote.amount },
          { accountId: ids.houseFiat, kind: 'reserve_fiat', amount: quote.fiatMinor },
          { accountId: ids.funding, kind: 'reseller_funding', amount: -quote.fiatMinor });
      }
      const trade = await tx.resellerDeskTrade.create({ data: { id, quoteId: quote.id, resellerId, mode, side: quote.side, asset: quote.asset, currency: quote.currency,
        amount: quote.amount, fiatMinor: quote.fiatMinor, priceMinor: quote.priceMinor,
        markupMinor: markupEarned(quote.side as ExchangeSide, quote.fiatMinor, quote.amount, quote.marketUsdE8, quote.fxMid, asset.decimals) } });
      await this.ledger.write(tx, { mode, type: 'reseller_exchange_trade', reference: `reseller_exchange_trade:${id}`, resellerId,
        description: `${quote.side === 'buy' ? 'Bought' : 'Sold'} ${fromUnits(quote.amount, asset.decimals)} ${asset.code} with BitoCard`,
        metadata: { quote_id: quote.id, trade_id: id, side: quote.side, asset: quote.asset }, postings });
      return trade;
    });
    return this.presentTrade(row, asset);
  }

  async trades(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const rows = await this.prisma.resellerDeskTrade.findMany({ where: { resellerId, mode }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}) });
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    return { object: 'list' as const, data: rows.slice(0, limit).map(row => this.presentTrade(row, assets.get(row.asset)!)), has_more: rows.length > limit };
  }

  /** Every reseller's trades with BitoCard's desk, for admins (newest first), with BitoCard's markup earned. */
  async adminTrades(filter: { mode?: LedgerMode; asset?: string; reseller_id?: string; limit?: number; starting_after?: string }) {
    const limit = filter.limit ?? 25;
    const rows = await this.prisma.resellerDeskTrade.findMany({
      where: { ...(filter.mode ? { mode: filter.mode } : {}), ...(filter.asset ? { asset: filter.asset.toUpperCase() } : {}), ...(filter.reseller_id ? { resellerId: filter.reseller_id } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const names = new Map((await this.prisma.reseller.findMany({ where: { id: { in: rows.map(row => row.resellerId) } }, select: { id: true, name: true } })).map(row => [row.id, row.name]));
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map(row => ({ ...this.presentTrade(row, assets.get(row.asset)!), reseller: { id: row.resellerId, name: names.get(row.resellerId) ?? null } })),
      has_more: rows.length > limit,
    };
  }

  /** Move the reseller's own coins into or out of its customer-facing desk, without changing total custody. */
  async transferCoins(resellerId: string, mode: LedgerMode, input: { asset: string; amount: string; direction: 'fund' | 'withdraw' }) {
    await this.reseller(resellerId, mode);
    // Coins behind the reseller's own desk: only while running a desk is switched on for them.
    if (!(await this.settings.isOn('reseller_desks', resellerId))) throw error(HttpStatus.CONFLICT, 'exchange_not_enabled', 'Running your own exchange desk is not enabled for your business yet.');
    const asset = await this.wallets.asset(input.asset);
    const amount = toUnits(input.amount, asset.decimals);
    if (amount <= 0n) throw error(HttpStatus.BAD_REQUEST, 'amount_too_small', 'Enter an amount above zero.');
    const wallet = coinRef(resellerId, asset.code);
    const reserve = cryptoReserveRef(asset.code, resellerId);
    await this.ledger.post({ mode, type: 'exchange_coin_reserve_transfer', reference: `exchange_coin_reserve_transfer:${randomUUID()}`, resellerId,
      description: `${input.direction === 'fund' ? 'Funded' : 'Drew down'} ${asset.code} customer exchange reserve`,
      lines: input.direction === 'fund'
        ? [{ account: wallet, debit: amount }, { account: reserve, credit: amount }]
        : [{ account: reserve, debit: amount }, { account: wallet, credit: amount }],
    });
    return { object: 'reseller_coin_balance' as const, mode, asset: asset.code,
      wallet: fromUnits(await this.balance(mode, wallet), asset.decimals), reserve: fromUnits(await this.balance(mode, reserve), asset.decimals) };
  }

  private presentQuote(row: ResellerDeskQuote, asset: CryptoAsset) {
    return { object: 'reseller_exchange_quote' as const, id: row.id, mode: row.mode, side: row.side, asset: row.asset, currency: row.currency,
      amount: fromUnits(row.amount, asset.decimals), fiat: minor(row.fiatMinor), price: minor(row.priceMinor), markup_bps: row.markupBps,
      expires_at: row.expiresAt.toISOString(), created_at: row.createdAt.toISOString() };
  }

  private presentTrade(row: ResellerDeskTrade, asset: Pick<CryptoAsset, 'decimals'>) {
    return { object: 'reseller_exchange_trade' as const, id: row.id, number: `RE-${String(row.number).padStart(6, '0')}`, mode: row.mode, side: row.side,
      asset: row.asset, currency: row.currency, amount: fromUnits(row.amount, asset.decimals), fiat: minor(row.fiatMinor), price: minor(row.priceMinor),
      markup: minor(row.markupMinor), created_at: row.createdAt.toISOString() };
  }
}
