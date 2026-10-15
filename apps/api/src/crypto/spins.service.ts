import { randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type CryptoAsset, type LedgerMode, Prisma, type Spin, type SpinAllowance } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { fromUnits } from './amounts.js';
import { type CryptoContext, CryptoWalletsService } from './crypto-wallets.service.js';
import { FxService } from '../fx/fx.service.js';
import { walletCurrencies } from '../ledger/wallet.service.js';
import { CryptoPricesService, unitsForCents } from './prices.js';

/** What every customer can win in all, in US cents. */
export const spinTotalCents = 100;
/** How many spins a customer gets, chosen at random when they start (inclusive). */
export const spinCount = { min: 50, max: 100 } as const;
/** Spins a customer may take per day (UTC) where the market sets none (admins set it per market: `countries.spin_daily_limit`). */
export const spinDailyLimit = 2;

/** The coins Spin and win pays: dollar stablecoins at $1, BNB at CoinGecko's price. */
type SpinAsset = 'USDT' | 'USDC' | 'BNB';
const stablecoins: SpinAsset[] = ['USDT', 'USDC'];

/**
 * The wheel, clockwise from the top: each segment a coin and a win in US cents. Every win the schedule can hold
 * (1, 2, 3, 4, 5, 6, 8 or 10 cents) has at least one segment, and the smallest win has one per coin.
 */
export const spinSegments: ReadonlyArray<{ asset: SpinAsset; cents: number }> = [
  { asset: 'USDT', cents: 1 },
  { asset: 'BNB', cents: 5 },
  { asset: 'USDC', cents: 2 },
  { asset: 'USDT', cents: 10 },
  { asset: 'BNB', cents: 1 },
  { asset: 'USDC', cents: 3 },
  { asset: 'USDT', cents: 4 },
  { asset: 'BNB', cents: 2 },
  { asset: 'USDC', cents: 1 },
  { asset: 'USDT', cents: 8 },
  { asset: 'BNB', cents: 3 },
  { asset: 'USDC', cents: 6 },
];
const winValues = [...new Set(spinSegments.map(item => item.cents))].sort((a, b) => a - b);

/**
 * A customer's wins, fixed when they start: `count` spins of 1 to 10 cents (values on the wheel) adding up to exactly
 * `total`. Every spin starts at the smallest win; the rest is handed out a step at a time to random spins.
 */
export function spinSchedule(count: number, total = spinTotalCents, random: (max: number) => number = max => randomInt(max)): number[] {
  if (count * winValues[0] > total || count * winValues.at(-1)! < total) throw new Error(`${count} spins cannot add up to ${total} cents`);
  const wins = Array.from({ length: count }, () => winValues[0]);
  let left = total - count * winValues[0];
  const step = (value: number) => winValues.find(item => item > value);
  for (let tries = 0; left > 0 && tries < 100_000; tries += 1) {
    const index = random(count);
    const next = step(wins[index]);
    if (next !== undefined && next - wins[index] <= left) {
      left -= next - wins[index];
      wins[index] = next;
    }
  }
  // Random steps can leave a remainder no random pick fitted: hand it to the first spins that can take it.
  for (let index = 0; left > 0 && index < count; index += 1) {
    let next = step(wins[index]);
    while (next !== undefined && next - wins[index] <= left) {
      left -= next - wins[index];
      wins[index] = next;
      next = step(wins[index]);
    }
  }
  if (left !== 0) throw new Error('Could not share out the spin wins');
  return wins;
}

const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const usd = (cents: number) => (cents / 100).toFixed(2);
const startOfDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const nextDay = (now = new Date()) => new Date(startOfDay(now).getTime() + 24 * 60 * 60_000);
/** The gates whose refusal the status page explains instead of failing. */
const gateCodes = ['crypto_not_enabled', 'email_not_verified', 'customer_verification_required', 'crypto_account_frozen', 'store_unavailable', 'country_required'];

/**
 * Spin and win (`spin_rewards` switch, off by default; needs crypto wallets): each customer, once per person (email)
 * and mode across every store, wins $1 in BNB, USDT and USDC over 50 to 100 spins, at most the market's daily limit
 * (two unless admins change it). The wins are
 * fixed on the server when they start; the wheel only shows them, and customers are not shown the total. Each win is
 * credited at once to the customer's **spin rewards** (`crypto_promotions` to `crypto_spin_rewards`, reference
 * `crypto_spin:<id>`): kept apart from their own crypto, never withdrawn on chain or traded, only exchanged into their
 * store wallet (`exchange`) to buy the store's products. No crypto leaves BitoCard, so nothing is paid out of custody.
 */
@Injectable()
export class SpinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: CryptoWalletsService,
    private readonly settings: SettingsService,
    private readonly prices: CryptoPricesService,
    private readonly fx: FxService,
  ) {}

  /** The customer's crypto context once every gate passes; throws the gate's refusal otherwise. */
  private async gate(customer: CustomerWithStore): Promise<CryptoContext> {
    const context = await this.wallets.require(customer);
    if (!(await this.settings.isOn('spin_rewards', context.seller.id))) {
      throw conflict('spins_not_enabled', 'Spin and win is not available in your country yet.');
    }
    const other = await this.prisma.spinAllowance.findUnique({ where: { mode_emailKey: { mode: context.mode, emailKey: customer.email.toLowerCase() } }, select: { customerId: true } });
    if (other && other.customerId !== customer.id) throw conflict('claimed_elsewhere', 'You have already had your Spin and win at another store.');
    return context;
  }

  private async assets() {
    return new Map((await this.prisma.cryptoAsset.findMany({ where: { code: { in: ['USDT', 'USDC', 'BNB'] }, enabled: true } })).map(asset => [asset.code, asset]));
  }

  /** The customer's progress, without the total or how many spins are left: what they have won and today's spins. */
  private present(allowance: SpinAllowance | null, today: number, limit: number) {
    if (!allowance) return null;
    const left = allowance.schedule.length - allowance.spinsUsed;
    const todayLeft = left > 0 ? Math.max(0, Math.min(limit - today, left)) : 0;
    return {
      won_usd: usd(allowance.wonCents),
      spins_used: allowance.spinsUsed,
      today_left: todayLeft,
      daily_limit: limit,
      next_spin_at: left > 0 && todayLeft === 0 ? nextDay().toISOString() : null,
      finished: left === 0,
    };
  }

  /**
   * The customer's spin rewards per coin and their value now, in 1e-8 US dollars (stablecoins at $1, BNB at its price;
   * BNB without a price cannot be valued, so it waits).
   */
  private async rewards(customerId: string, mode: LedgerMode) {
    const [accounts, assets] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { kind: 'crypto_spin_rewards', customerId, mode, balanceMinor: { gt: 0 } }, orderBy: { currency: 'asc' } }),
      this.prisma.cryptoAsset.findMany({ select: { code: true, decimals: true } }),
    ]);
    const decimals = new Map(assets.map(asset => [asset.code, asset.decimals]));
    const bnb = accounts.some(account => account.currency === 'BNB') ? await this.prices.usd('BNB') : null;
    const coins = accounts.map(account => {
      const places = decimals.get(account.currency) ?? 8;
      const priceE8 = stablecoins.includes(account.currency as SpinAsset) ? 100_000_000n : account.currency === 'BNB' ? (bnb?.e8 ?? null) : null;
      const usdE8 = priceE8 === null ? null : (account.balanceMinor * priceE8) / 10n ** BigInt(places);
      return { asset: account.currency, units: account.balanceMinor, amount: fromUnits(account.balanceMinor, places), usdE8 };
    });
    const valued = coins.filter(coin => coin.usdE8 !== null);
    const usdE8 = valued.reduce((sum, coin) => sum + coin.usdE8!, 0n);
    return { coins, valued, cents: Number(usdE8 / 1_000_000n) };
  }

  private presentRewards(rewards: Awaited<ReturnType<SpinsService['rewards']>>, currencies: string[]) {
    return {
      coins: rewards.coins.map(coin => ({ asset: coin.asset, amount: coin.amount, usd: coin.usdE8 === null ? null : usd(Number(coin.usdE8 / 1_000_000n)) })),
      usd: usd(rewards.cents),
      exchange_currencies: currencies,
    };
  }

  private presentSpin(spin: Spin, assets: Map<string, Pick<CryptoAsset, 'decimals'>>) {
    return {
      id: spin.id,
      number: spin.number,
      asset: spin.asset,
      amount: fromUnits(spin.amount, assets.get(spin.asset)?.decimals ?? 8),
      usd: usd(spin.cents),
      segment: spin.segment,
      created_at: spin.createdAt.toISOString(),
    };
  }

  /** The market's spins per day (`countries.spin_daily_limit`, set by admins on Settings > Markets). */
  private async dailyLimit(country: string | null | undefined) {
    if (!country) return spinDailyLimit;
    const market = await this.prisma.country.findUnique({ where: { code: country }, select: { spinDailyLimit: true } });
    return market?.spinDailyLimit ?? spinDailyLimit;
  }

  private spinsToday(allowanceId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.spin.count({ where: { allowanceId, createdAt: { gte: startOfDay() } } });
  }

  /** The wheel, the customer's progress and their latest wins; why they cannot spin, if they cannot. */
  async status(customer: CustomerWithStore) {
    const segments = spinSegments.map((item, index) => ({ index, asset: item.asset, usd: usd(item.cents) }));
    let reason: string | null = null;
    let mode: LedgerMode;
    try {
      mode = (await this.gate(customer)).mode;
    } catch (error) {
      if (!(error instanceof ApiError) || !(gateCodes.includes(error.code) || error.code === 'spins_not_enabled' || error.code === 'claimed_elsewhere')) throw error;
      reason = error.code === 'spins_not_enabled' || error.code === 'store_unavailable' || error.code === 'country_required' ? 'not_enabled' : error.code;
      mode = (await this.wallets.context(customer).catch(() => null))?.mode ?? 'live';
    }
    const allowance = await this.prisma.spinAllowance.findFirst({ where: { customerId: customer.id, mode } });
    const market = await this.wallets.context(customer).catch(() => null);
    const limit = await this.dailyLimit(market?.country);
    const recent = allowance ? await this.prisma.spin.findMany({ where: { allowanceId: allowance.id }, orderBy: { number: 'desc' }, take: 10 }) : [];
    const assets = await this.prisma.cryptoAsset.findMany({ select: { code: true, decimals: true } });
    return {
      object: 'spin_rewards' as const,
      mode,
      enabled: reason === null && (!allowance || allowance.spinsUsed < allowance.schedule.length),
      reason,
      segments,
      daily_limit: limit,
      allowance: this.present(allowance, allowance ? await this.spinsToday(allowance.id) : 0, limit),
      recent: recent.map(spin => this.presentSpin(spin, new Map(assets.map(asset => [asset.code, asset])))),
      rewards: this.presentRewards(await this.rewards(customer.id, mode), walletCurrencies(market?.currency)),
    };
  }

  /** The customer's allowance in this mode, started now (its wins fixed) if it is their first spin. */
  private async allowanceFor(customer: CustomerWithStore, mode: LedgerMode) {
    const existing = await this.prisma.spinAllowance.findFirst({ where: { customerId: customer.id, mode } });
    if (existing) return existing;
    const count = randomInt(spinCount.min, spinCount.max + 1);
    try {
      return await this.prisma.spinAllowance.create({
        data: { customerId: customer.id, mode, emailKey: customer.email.toLowerCase(), schedule: spinSchedule(count), totalCents: spinTotalCents },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      // Started by a parallel spin (theirs), or the same person at another store first.
      const raced = await this.prisma.spinAllowance.findFirst({ where: { customerId: customer.id, mode } });
      if (raced) return raced;
      throw conflict('claimed_elsewhere', 'You have already had your Spin and win at another store.');
    }
  }

  /** The coin and amount for a win: a segment showing it (enabled coins first), BNB at its price or else a stablecoin. */
  private async payout(cents: number, assets: Map<string, CryptoAsset>) {
    const showing = spinSegments.map((item, index) => ({ ...item, index })).filter(item => item.cents === cents);
    const usable = showing.filter(item => assets.has(item.asset));
    const segment = (usable.length ? usable : showing)[randomInt((usable.length ? usable : showing).length)];
    if (segment.asset === 'BNB' && assets.has('BNB')) {
      const price = await this.prices.usd('BNB');
      const amount = price ? unitsForCents(cents, assets.get('BNB')!.decimals, price.e8) : 0n;
      if (price && amount > 0n) return { segment: segment.index, asset: assets.get('BNB')!, amount, priceUsd: price.text };
    }
    // A stablecoin at $1: the segment's own, or the first one on (BNB without a price, or a coin switched off).
    const stable = stablecoins.includes(segment.asset) && assets.has(segment.asset) ? assets.get(segment.asset)! : stablecoins.map(code => assets.get(code)).find(Boolean);
    if (!stable) throw conflict('spins_not_enabled', 'Spin and win is not available right now.');
    return { segment: segment.index, asset: stable, amount: BigInt(cents) * 10n ** BigInt(stable.decimals - 2), priceUsd: null };
  }

  /** One spin: the next win of the customer's schedule, credited to their spin rewards at once. Once per number. */
  async spin(customer: CustomerWithStore) {
    const context = await this.gate(customer);
    const allowance = await this.allowanceFor(customer, context.mode);
    const limit = await this.dailyLimit(context.country);
    const number = allowance.spinsUsed + 1;
    if (number > allowance.schedule.length) throw conflict('spins_finished', 'You have used all your spins.');
    const cents = allowance.schedule[number - 1];
    const assets = await this.assets();
    const win = await this.payout(cents, assets);
    const id = randomUUID();
    const entry = await this.ledger.prepare({
      mode: context.mode,
      type: 'crypto_spin',
      reference: `crypto_spin:${id}`,
      description: `Spin and win: ${fromUnits(win.amount, win.asset.decimals)} ${win.asset.code}`,
      metadata: { spin_id: id, asset: win.asset.code, usd: usd(cents) },
      lines: [
        { account: { kind: 'crypto_promotions', currency: win.asset.code }, debit: win.amount },
        { account: this.wallets.ref(customer.id, 'crypto_spin_rewards', win.asset.code), credit: win.amount },
      ],
    });
    const spin = await this.prisma.$transaction(async tx => {
      // The allowance row is the lock: one spin at a time per customer, so a number is paid once and the daily limit holds.
      await tx.$queryRaw`SELECT id FROM spin_allowances WHERE id = ${allowance.id}::uuid FOR UPDATE`;
      const fresh = await tx.spinAllowance.findUniqueOrThrow({ where: { id: allowance.id } });
      if (fresh.spinsUsed !== number - 1) throw conflict('spin_in_progress', 'Your last spin is still being counted. Try again.');
      if ((await this.spinsToday(allowance.id, tx)) >= limit) {
        throw conflict('spin_limit_today', `You have used today’s ${limit === 1 ? 'spin' : `${limit} spins`}. Come back from ${nextDay().toISOString()}.`);
      }
      const created = await tx.spin.create({
        data: { id, allowanceId: allowance.id, customerId: customer.id, mode: context.mode, number, cents, asset: win.asset.code, amount: win.amount, segment: win.segment, priceUsd: win.priceUsd },
      });
      await tx.spinAllowance.update({ where: { id: allowance.id }, data: { spinsUsed: number, wonCents: { increment: cents } } });
      await this.ledger.write(tx, entry);
      return created;
    });
    const updated = await this.prisma.spinAllowance.findUniqueOrThrow({ where: { id: allowance.id } });
    return {
      object: 'spin' as const,
      ...this.presentSpin(spin, assets),
      allowance: this.present(updated, await this.spinsToday(allowance.id), limit)!,
    };
  }

  /**
   * Exchanges every spin reward the customer holds into their store wallet in US dollars or their country's currency:
   * valued in US cents (stablecoins at $1, BNB at CoinGecko's price; rounded down), then at BitoCard's `receive` rate for
   * the country's currency (rounded down), the rate of wallet conversions. One entry moves the coins back to
   * `crypto_promotions` and books the money from `promotions` to the customer's `customer_wallet`. `preview` only
   * quotes; `expected_amount` (what the preview showed) refuses a lower amount (`rate_changed`). Needs no switch:
   * rewards already won are never trapped (`requireHolder`).
   */
  async exchange(customer: CustomerWithStore, input: { currency?: string; preview?: boolean; expected_amount?: number }) {
    const context = await this.wallets.requireHolder(customer, 'exchanging your rewards');
    const currencies = walletCurrencies(context.currency);
    const currency = (input.currency ?? context.currency).toUpperCase();
    if (!currencies.includes(currency)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'currency_unsupported', `Rewards go to your ${currencies.join(' or ')} wallet.`, 'currency');
    }
    const rewards = await this.rewards(customer.id, context.mode);
    if (rewards.cents < 1) {
      const message = !rewards.coins.length
        ? 'You have no rewards to exchange yet.'
        : rewards.valued.length < rewards.coins.length
          ? 'Your rewards cannot be valued right now. Try again shortly.'
          : 'Your rewards are too small to exchange yet: keep spinning.';
      throw conflict('nothing_to_exchange', message);
    }
    const converted = await this.fx.exchange(BigInt(rewards.cents), 'USD', currency);
    if (converted.amount < 1n) throw conflict('nothing_to_exchange', 'Your rewards are too small to exchange yet.');
    const quote = { usd: usd(rewards.cents), currency, amount: Number(converted.amount), rate: converted.rate.toString() };
    if (input.preview) return { object: 'spin_exchange_preview' as const, ...quote, coins: this.presentRewards(rewards, currencies).coins };
    if (input.expected_amount !== undefined && converted.amount < BigInt(input.expected_amount)) {
      throw conflict('rate_changed', 'The rate changed. Check the new amount and try again.');
    }
    const id = randomUUID();
    const entry = await this.ledger.prepare({
      mode: context.mode,
      type: 'spin_exchange',
      reference: `spin_exchange:${id}`,
      description: 'Spin and win rewards',
      metadata: { spin_exchange_id: id, usd: usd(rewards.cents) },
      lines: [
        ...rewards.valued.flatMap(coin => [
          { account: this.wallets.ref(customer.id, 'crypto_spin_rewards', coin.asset), debit: coin.units },
          { account: { kind: 'crypto_promotions' as const, currency: coin.asset }, credit: coin.units },
        ]),
        { account: { kind: 'promotions', currency }, debit: converted.amount },
        { account: { kind: 'customer_wallet', currency, customerId: customer.id }, credit: converted.amount },
      ],
    });
    const created = await this.prisma.$transaction(async tx => {
      const row = await tx.spinExchange.create({
        data: {
          id,
          customerId: customer.id,
          mode: context.mode,
          amounts: Object.fromEntries(rewards.valued.map(coin => [coin.asset, coin.units.toString()])),
          usdCents: rewards.cents,
          currency,
          amountMinor: converted.amount,
          rate: converted.rate.toString(),
        },
      });
      // A parallel exchange already moved them: the rewards account's balance check refuses this one.
      await this.ledger.write(tx, entry).catch((error: unknown) => {
        throw error instanceof ApiError && error.code === 'insufficient_funds' ? conflict('nothing_to_exchange', 'Your rewards were just exchanged.') : error;
      });
      return row;
    });
    return { object: 'spin_exchange' as const, id: created.id, ...quote, created_at: created.createdAt.toISOString() };
  }

  // -- Admin ----------------------------------------------------------------------------------------------------

  /** Spins in a mode (newest first), totals per coin and how many customers have started. */
  async adminList(query: { mode?: LedgerMode; customer_id?: string }) {
    const mode = query.mode ?? 'live';
    const where = { mode, ...(query.customer_id ? { customerId: query.customer_id } : {}) };
    const [rows, totals, customers, assets, exchanged] = await Promise.all([
      this.prisma.spin.findMany({ where, include: { customer: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.spin.groupBy({ by: ['asset'], where, _sum: { amount: true, cents: true }, _count: { _all: true } }),
      this.prisma.spinAllowance.count({ where: { mode, ...(query.customer_id ? { customerId: query.customer_id } : {}) } }),
      this.prisma.cryptoAsset.findMany({ select: { code: true, decimals: true } }),
      this.prisma.spinExchange.groupBy({ by: ['currency'], where, _sum: { usdCents: true, amountMinor: true }, _count: { _all: true } }),
    ]);
    const decimals = new Map(assets.map(asset => [asset.code, asset]));
    return {
      object: 'list' as const,
      data: rows.map(row => ({ ...this.presentSpin(row, decimals), mode: row.mode, customer: { id: row.customerId, email: row.customer.email } })),
      totals: totals.map(item => ({ mode, asset: item.asset, amount: fromUnits(item._sum.amount ?? 0n, decimals.get(item.asset)?.decimals ?? 8), usd: usd(item._sum.cents ?? 0), spins: item._count._all })),
      customers,
      exchanged: exchanged.map(item => ({ currency: item.currency, amount: Number(item._sum.amountMinor ?? 0n), usd: usd(item._sum.usdCents ?? 0), exchanges: item._count._all })),
    };
  }
}
