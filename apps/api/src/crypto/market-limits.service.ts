import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CryptoMarketLimit, LedgerMode } from '../generated/prisma/client.js';
import type { Tx } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { formatMoney } from '../notifications/templates.js';

/** The global market's code (as `P2pService`'s `globalMarket`; kept here so this file needs nothing from it). */
const global = 'WW';
const dayMs = 86_400_000;

/** One party to a trade: their own country decides whether they trade across borders in this market. */
export type TradeParty = { customerId: string; home: string; taker: boolean };

export type MarketLimitInput = {
  mode: LedgerMode;
  market: string;
  currency: string;
  per_trade?: number | null;
  per_day?: number | null;
  cross_border_per_trade?: number | null;
  cross_border_per_day?: number | null;
  cross_border_hold_days?: number | null;
};

export function presentMarketLimit(row: CryptoMarketLimit) {
  const amount = (value: bigint | null) => (value === null ? null : minor(value));
  return {
    object: 'crypto_market_limit' as const,
    mode: row.mode,
    market: row.market,
    currency: row.currency,
    per_trade: amount(row.perTradeMinor),
    per_day: amount(row.perDayMinor),
    cross_border_per_trade: amount(row.crossBorderPerTradeMinor),
    cross_border_per_day: amount(row.crossBorderPerDayMinor),
    cross_border_hold_days: row.crossBorderHoldDays,
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Whether a party trades across borders in a market: always on the global market; in a country's book, when from elsewhere. */
export const crossBorder = (market: string, home: string) => market === global || home !== market;

/**
 * Limits on the P2P markets, per mode, market and currency: how much one customer may trade per trade and per 24 hours
 * (tighter for people from other countries in a country's book), and the longer payout hold on money from
 * cross-border trades. Admins start them low and raise them as operations prove trustworthy; live trading in a
 * market needs its limits set first. Checked inside the trade's transaction, after both parties' accounts are
 * locked, so parallel trades by one customer cannot pass a daily limit together.
 */
@Injectable()
export class CryptoMarketLimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(mode?: LedgerMode) {
    const rows = await this.prisma.cryptoMarketLimit.findMany({ where: mode ? { mode } : {}, orderBy: [{ mode: 'asc' }, { market: 'asc' }, { currency: 'asc' }] });
    return { object: 'list' as const, data: rows.map(presentMarketLimit) };
  }

  /** Sets a market's limits (null for none). The market is `WW` (US dollars) or a country (its currency or US dollars). Audited. */
  async set(adminId: string | null, input: MarketLimitInput) {
    const market = input.market.toUpperCase();
    const currency = input.currency.toUpperCase();
    const invalid = (message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);
    if (market === global) {
      if (currency !== 'USD') throw invalid('The global market trades in USD only.', 'currency');
    } else {
      const country = await this.prisma.country.findUnique({ where: { code: market }, select: { currency: true } });
      if (!country) throw invalid('Choose one of BitoCard’s markets, or WW for the global market.', 'market');
      if (currency !== country.currency && currency !== 'USD') throw invalid(`This market trades in ${country.currency} or USD.`, 'currency');
    }
    const amount = (value: number | null | undefined) => (value === undefined || value === null ? null : BigInt(value));
    const data = {
      perTradeMinor: amount(input.per_trade),
      perDayMinor: amount(input.per_day),
      crossBorderPerTradeMinor: amount(input.cross_border_per_trade),
      crossBorderPerDayMinor: amount(input.cross_border_per_day),
      crossBorderHoldDays: input.cross_border_hold_days ?? null,
      updatedById: adminId,
    };
    const key = { mode: input.mode, market, currency };
    const before = await this.prisma.cryptoMarketLimit.findUnique({ where: { mode_market_currency: key } });
    const row = await this.prisma.cryptoMarketLimit.upsert({ where: { mode_market_currency: key }, create: { ...key, ...data }, update: data });
    await this.audit.record({
      actorId: adminId,
      action: 'crypto.market_limits_changed',
      targetType: 'crypto_market',
      targetId: `${input.mode}:${market}:${currency}`,
      before: before ? presentMarketLimit(before) : null,
      after: presentMarketLimit(row),
    });
    return presentMarketLimit(row);
  }

  /**
   * Checks a trade of `fiat` against the market's limits for each party, inside the trade's transaction (after their
   * accounts are locked). Live, a market without limits set takes no trades. The taker is told what is left today;
   * an ad whose owner has reached a limit cannot take the trade.
   */
  async check(tx: Tx, input: { mode: LedgerMode; market: string; currency: string; fiat: bigint; parties: TradeParty[] }) {
    const row = await tx.cryptoMarketLimit.findUnique({ where: { mode_market_currency: { mode: input.mode, market: input.market, currency: input.currency } } });
    if (!row) {
      if (input.mode === 'live') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'market_limits_unset', 'This market is not open for trading yet.', 'market');
      return;
    }
    const since = new Date(Date.now() - dayMs);
    for (const party of input.parties) {
      // In a country's book, people from elsewhere have the tighter cross-border limits (each falls back to the
      // market's own); on the global market everyone has the market's own.
      const cross = input.market !== global && party.home !== input.market;
      const perTrade = cross ? (row.crossBorderPerTradeMinor ?? row.perTradeMinor) : row.perTradeMinor;
      const perDay = cross ? (row.crossBorderPerDayMinor ?? row.perDayMinor) : row.perDayMinor;
      const refuse = (left: bigint) =>
        party.taker
          ? new ApiError(
              HttpStatus.CONFLICT,
              'conflict_error',
              'trade_limit',
              left > 0n ? `You can trade up to ${formatMoney(left, input.currency)} in this market now.` : 'You have reached your trading limit in this market for today.',
              'fiat',
            )
          : new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'ad_limit', 'This ad cannot take this trade today. Choose another.', 'ad_id');
      if (perTrade !== null && input.fiat > perTrade) throw refuse(perTrade);
      if (perDay !== null) {
        const traded = await tx.p2pTrade.aggregate({
          where: { mode: input.mode, country: input.market, currency: input.currency, createdAt: { gt: since }, OR: [{ buyerId: party.customerId }, { sellerId: party.customerId }] },
          _sum: { fiatMinor: true },
        });
        const used = traded._sum.fiatMinor ?? 0n;
        if (used + input.fiat > perDay) throw refuse(perDay > used ? perDay - used : 0n);
      }
    }
  }
}
