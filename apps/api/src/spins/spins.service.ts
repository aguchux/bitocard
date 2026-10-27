import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, Prisma, type Reseller, type Spin, type SpinAllowance } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { FxService } from '../fx/fx.service.js';
import { walletCurrencies } from '../ledger/wallet.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';

/** What every customer can win in all, in US cents. */
export const spinTotalCents = 100;
/** How many spins a customer gets, chosen at random when they start (inclusive). */
export const spinCount = { min: 50, max: 100 } as const;
/** Spins a customer may take per day (UTC) where the market sets none (admins set it per market: `countries.spin_daily_limit`). */
export const spinDailyLimit = 2;

/**
 * The wheel, clockwise from the top: each segment a win in US cents. Every win the schedule can hold (1, 2, 3, 4, 5,
 * 6, 8 or 10 cents) has at least one segment; the smallest win has three.
 */
export const spinSegments: ReadonlyArray<{ cents: number }> = [
  { cents: 1 },
  { cents: 5 },
  { cents: 2 },
  { cents: 10 },
  { cents: 1 },
  { cents: 3 },
  { cents: 4 },
  { cents: 2 },
  { cents: 1 },
  { cents: 8 },
  { cents: 3 },
  { cents: 6 },
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

/** A segment showing this win, chosen at random among those that do. */
const segmentFor = (cents: number) => {
  const showing = spinSegments.map((item, index) => ({ ...item, index })).filter(item => item.cents === cents);
  return showing[randomInt(showing.length)].index;
};

const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);
const usd = (cents: number) => (cents / 100).toFixed(2);
const startOfDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const nextDay = (now = new Date()) => new Date(startOfDay(now).getTime() + 24 * 60 * 60_000);
const publicClaimDays = 30;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
/** The gates whose refusal the status page explains instead of failing. */
const gateCodes = ['email_not_verified', 'store_unavailable', 'country_required'];

/** Where a customer spins: their store's seller, its mode, and the seller's country and currency. */
type SpinContext = { mode: LedgerMode; seller: Reseller; country: string; currency: string };

/**
 * Spin and win (`spin_rewards` switch, off by default), a BitoCard promotion paid in **US dollars** (crypto has left
 * BitoCard; `docs/CRYPTO_SPINOFF_PLAN.md`): each customer, once per person (email) and mode across every store, wins
 * $1 over 50 to 100 spins, at most the market's daily limit (two unless admins change it). The wins are fixed on the
 * server when they start; the wheel only shows them, and customers are not shown the total. Each win is credited at
 * once to the customer's **spin rewards** (`promotions` to `spin_rewards`, US cents, reference `spin_win:<id>`): kept
 * apart from their wallet, never withdrawn, only moved into their store wallet (`exchange`), in US dollars as they are
 * or in their country's currency at BitoCard's rate, to buy the store's products.
 */
@Injectable()
export class SpinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
    private readonly stores: StoreSellers,
  ) {}

  /** The customer's store seller, mode and market (`store_unavailable` without a country). */
  private async context(customer: CustomerWithStore): Promise<SpinContext> {
    const seller = this.stores.isHouse(customer.store)
      ? await this.stores.sellerFor(customer)
      : await this.prisma.reseller.findUniqueOrThrow({ where: { id: customer.store.resellerId } });
    if (!seller.country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'store_unavailable', 'This store is not open.');
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: seller.country }, select: { code: true, currency: true } });
    return { mode: this.stores.mode(customer.store), seller, country: market.code, currency: market.currency };
  }

  /** The public Customer Catcher is BitoCard-only and separately enabled per market in Admin > Spin rewards. */
  private async publicContext(storeKey: string | null, askedCountry?: string) {
    const store = await this.stores.resolve(storeKey);
    if (!this.stores.isHouse(store)) throw conflict('public_spins_not_enabled', 'The public wheel is not available on this store.');
    const countryCode = this.stores.isRoot(store) ? askedCountry?.toUpperCase() : store.reseller.country ?? undefined;
    if (!countryCode) throw conflict('country_required', 'Choose your country before you spin.');
    const country = await this.prisma.country.findUnique({ where: { code: countryCode } });
    if (!country || !country.publicSpinsEnabled) throw conflict('public_spins_not_enabled', 'The public wheel is not open in this country yet.');
    const seller = await this.stores.seller(store, country.code);
    if (!(await this.settings.isOn('spin_rewards', seller.id))) throw conflict('spins_not_enabled', 'Spin and win is not available in this country yet.');
    return { store, country, mode: this.stores.mode(store) };
  }

  private publicWins(row: { wins: Prisma.JsonValue }) {
    return (Array.isArray(row.wins) ? row.wins : []) as Array<{ id: string; number: number; usd: string; segment: number; created_at: string }>;
  }

  private segments() {
    return spinSegments.map((item, index) => ({ index, usd: usd(item.cents) }));
  }

  private presentPublic(row: { status: string; limit: number; spinsUsed: number; wonCents: number; wins: Prisma.JsonValue; expiresAt: Date; invalidatedReason: string | null }) {
    const active = row.status === 'active' && row.expiresAt > new Date();
    return {
      object: 'public_spin_rewards' as const,
      enabled: active && row.spinsUsed < row.limit,
      reason: active ? null : row.status === 'invalidated' ? row.invalidatedReason : row.status,
      segments: this.segments(),
      daily_limit: row.limit,
      allowance: {
        won_usd: usd(row.wonCents),
        spins_used: row.spinsUsed,
        today_left: Math.max(0, row.limit - row.spinsUsed),
        daily_limit: row.limit,
        next_spin_at: null,
        finished: row.spinsUsed >= row.limit,
      },
      recent: this.publicWins(row).toReversed(),
      rewards: { usd: usd(row.wonCents), exchange_currencies: [] },
      claim_expires_at: row.expiresAt.toISOString(),
    };
  }

  /** Reads the visitor claim named by the opaque storefront cookie, or an empty six-spin wheel. */
  async publicStatus(storeKey: string | null, country: string | undefined, token?: string) {
    const context = await this.publicContext(storeKey, country);
    const row = token ? await this.prisma.publicSpinClaim.findUnique({ where: { tokenHash: tokenHash(token) } }) : null;
    if (row && row.storeId === context.store.id && row.countryCode === context.country.code && row.mode === context.mode) {
      if (row.status === 'active' && row.expiresAt <= new Date()) {
        const expired = await this.prisma.publicSpinClaim.update({ where: { id: row.id }, data: { status: 'expired' } });
        return this.presentPublic(expired);
      }
      return this.presentPublic(row);
    }
    const limit = context.country.publicSpinLimit;
    return this.presentPublic({ status: 'active', limit, spinsUsed: 0, wonCents: 0, wins: [], expiresAt: new Date(Date.now() + publicClaimDays * 86_400_000), invalidatedReason: null });
  }

  /** One of the visitor's fixed spins. The returned token is kept only in an HttpOnly storefront cookie. */
  async publicSpin(storeKey: string | null, country: string | undefined, token?: string) {
    const context = await this.publicContext(storeKey, country);
    let raw = token;
    let claim = raw ? await this.prisma.publicSpinClaim.findUnique({ where: { tokenHash: tokenHash(raw) } }) : null;
    if (!claim) {
      raw = randomBytes(32).toString('base64url');
      const limit = context.country.publicSpinLimit;
      const count = randomInt(Math.max(spinCount.min, limit), spinCount.max + 1);
      claim = await this.prisma.publicSpinClaim.create({
        data: {
          tokenHash: tokenHash(raw),
          storeId: context.store.id,
          countryCode: context.country.code,
          mode: context.mode,
          limit,
          // The visitor uses the first `limit`; after claiming, the same schedule becomes their authenticated
          // allowance, so visitor and later account spins still add up to exactly the promotion's $1 in all.
          schedule: spinSchedule(count),
          expiresAt: new Date(Date.now() + publicClaimDays * 86_400_000),
        },
      });
    }
    if (claim.storeId !== context.store.id || claim.countryCode !== context.country.code || claim.mode !== context.mode) throw conflict('claim_invalid', 'This spin claim belongs to another store or country.');
    if (claim.status !== 'active' || claim.expiresAt <= new Date()) throw conflict('claim_expired', 'This spin claim is no longer available.');
    if (claim.spinsUsed >= claim.limit) throw conflict('public_spins_finished', 'Create an account to claim your wins and keep spinning.');
    const cents = claim.schedule[claim.spinsUsed];
    const outcome = { id: randomUUID(), number: claim.spinsUsed + 1, usd: usd(cents), segment: segmentFor(cents), created_at: new Date().toISOString() };
    const updated = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM public_spin_claims WHERE id = ${claim!.id}::uuid FOR UPDATE`;
      const fresh = await tx.publicSpinClaim.findUniqueOrThrow({ where: { id: claim!.id } });
      if (fresh.status !== 'active' || fresh.spinsUsed !== outcome.number - 1) throw conflict('spin_in_progress', 'Your last spin is still being counted. Try again.');
      return tx.publicSpinClaim.update({
        where: { id: fresh.id },
        data: { spinsUsed: { increment: 1 }, wonCents: { increment: cents }, wins: [...this.publicWins(fresh), outcome] as Prisma.InputJsonValue },
      });
    });
    return { token: raw!, spin: { object: 'spin' as const, ...outcome, allowance: this.presentPublic(updated).allowance }, status: this.presentPublic(updated) };
  }

  private async invalidatePublicClaim(id: string, reason: string) {
    return this.prisma.publicSpinClaim.update({ where: { id }, data: { status: 'invalidated', invalidatedReason: reason } });
  }

  /** What a signed-in customer may claim on first login; also invalidates an ineligible or already-used claim. */
  async publicClaimStatus(customer: CustomerWithStore, token?: string) {
    if (!token) return null;
    const claim = await this.prisma.publicSpinClaim.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!claim || claim.storeId !== customer.storeId) return null;
    if (claim.status !== 'active') return { object: 'public_spin_claim', status: claim.status, reason: claim.invalidatedReason, message: claim.invalidatedReason === 'daily_limit' ? 'Your saved visitor spins expired because you already used today’s registered spins.' : null };
    if (claim.expiresAt <= new Date()) {
      await this.prisma.publicSpinClaim.update({ where: { id: claim.id }, data: { status: 'expired' } });
      return { object: 'public_spin_claim', status: 'expired', reason: 'expired', message: 'Your saved visitor spins have expired.' };
    }
    const context = await this.context(customer);
    if (context.mode !== claim.mode || context.country !== claim.countryCode) {
      await this.invalidatePublicClaim(claim.id, 'market_changed');
      return { object: 'public_spin_claim', status: 'invalidated', reason: 'market_changed', message: 'Those visitor spins were for another market and cannot be claimed here.' };
    }
    const earlier = await this.prisma.publicSpinClaim.findFirst({ where: { id: { not: claim.id }, mode: context.mode, status: 'claimed', customer: { email: customer.email.toLowerCase() } }, select: { id: true } });
    if (earlier) {
      await this.invalidatePublicClaim(claim.id, 'already_claimed');
      return { object: 'public_spin_claim', status: 'invalidated', reason: 'already_claimed', message: 'This account has already claimed a Customer Catcher win.' };
    }
    const allowance = await this.prisma.spinAllowance.findFirst({ where: { customerId: customer.id, mode: context.mode } });
    if (allowance) {
      const limit = await this.dailyLimit(context.country);
      const reason = (await this.spinsToday(allowance.id)) >= limit ? 'daily_limit' : 'already_started';
      await this.invalidatePublicClaim(claim.id, reason);
      return {
        object: 'public_spin_claim', status: 'invalidated', reason,
        message: reason === 'daily_limit' ? 'Your saved visitor spins were removed because you already used today’s registered spins.' : 'This account has already started Spin and win, so the visitor claim cannot be added.',
      };
    }
    const currencies = walletCurrencies(context.currency);
    const amounts = (await Promise.all(currencies.map(async currency => ({ currency, amount: Number((await this.fx.exchange(BigInt(claim.wonCents), 'USD', currency)).amount) })))).filter(item => item.amount > 0);
    return { object: 'public_spin_claim', status: 'active', reason: null, usd: usd(claim.wonCents), spins: claim.spinsUsed, currencies: amounts };
  }

  /** Credits the whole visitor total once to the customer's local or USD store wallet. */
  async claimPublic(customer: CustomerWithStore, token: string | undefined, currencyAsked: string) {
    if (!customer.emailVerifiedAt) throw conflict('email_not_verified', 'Confirm your email before claiming your wins.');
    const status = await this.publicClaimStatus(customer, token);
    if (!status || status.status !== 'active' || !token) throw conflict('claim_invalid', status?.message ?? 'There is no visitor win to claim.');
    const claim = await this.prisma.publicSpinClaim.findUniqueOrThrow({ where: { tokenHash: tokenHash(token) } });
    if (claim.spinsUsed < 1) throw conflict('nothing_to_exchange', 'Spin first, then claim your win.');
    const selected = status.currencies?.find(item => item.currency === currencyAsked.toUpperCase());
    if (!selected) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'currency_unsupported', 'Choose your local or US dollar wallet.', 'currency');
    const amount = BigInt(selected.amount);
    const id = randomUUID();
    const entry = await this.ledger.prepare({
      mode: claim.mode,
      type: 'public_spin_claim',
      reference: `public_spin_claim:${claim.id}`,
      description: 'Customer Catcher spin wins',
      metadata: { public_spin_claim_id: claim.id, usd: usd(claim.wonCents), spins: claim.spinsUsed },
      lines: [
        { account: { kind: 'promotions', currency: selected.currency }, debit: amount },
        { account: { kind: 'customer_wallet', currency: selected.currency, customerId: customer.id }, credit: amount },
      ],
    });
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM public_spin_claims WHERE id = ${claim.id}::uuid FOR UPDATE`;
      const fresh = await tx.publicSpinClaim.findUniqueOrThrow({ where: { id: claim.id } });
      if (fresh.status !== 'active') throw conflict('claim_invalid', 'This visitor win has already been handled.');
      await tx.spinAllowance.create({
        data: {
          customerId: customer.id,
          mode: claim.mode,
          emailKey: customer.email.toLowerCase(),
          schedule: claim.schedule,
          totalCents: spinTotalCents,
          spinsUsed: claim.spinsUsed,
          wonCents: claim.wonCents,
        },
      }).catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('claimed_elsewhere', 'This account has already started or claimed Spin and win.');
        throw error;
      });
      await this.ledger.write(tx, entry);
      await tx.publicSpinClaim.update({ where: { id: claim.id }, data: { status: 'claimed', customerId: customer.id, claimCurrency: selected.currency, claimAmountMinor: amount, claimedAt: new Date() } });
    });
    return { object: 'public_spin_claim', id, status: 'claimed', usd: usd(claim.wonCents), currency: selected.currency, amount: Number(amount) };
  }

  /**
   * The customer's context once every gate passes; throws the gate's refusal otherwise: a confirmed email, their store
   * open (a reseller's published), the promotion switched on for the store's seller, and not started at another store.
   */
  private async gate(customer: CustomerWithStore): Promise<SpinContext> {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
    if (!this.stores.isHouse(customer.store)) await this.stores.seller(customer.store, '');
    const context = await this.context(customer);
    if (!(await this.settings.isOn('spin_rewards', context.seller.id))) {
      throw conflict('spins_not_enabled', 'Spin and win is not available in your country yet.');
    }
    const other = await this.prisma.spinAllowance.findUnique({ where: { mode_emailKey: { mode: context.mode, emailKey: customer.email.toLowerCase() } }, select: { customerId: true } });
    if (other && other.customerId !== customer.id) throw conflict('claimed_elsewhere', 'You have already had your Spin and win at another store.');
    return context;
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

  private rewardsRef(customerId: string) {
    return { kind: 'spin_rewards' as const, currency: 'USD', customerId };
  }

  /** The customer's spin rewards in US cents, not yet moved into their wallet. */
  private async rewards(customerId: string, mode: LedgerMode) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'spin_rewards', customerId, mode, currency: 'USD' }, select: { balanceMinor: true } });
    return Number(account?.balanceMinor ?? 0n);
  }

  private presentSpin(spin: Spin) {
    return { id: spin.id, number: spin.number, usd: usd(spin.cents), segment: spin.segment, created_at: spin.createdAt.toISOString() };
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
    let reason: string | null = null;
    try {
      await this.gate(customer);
    } catch (error) {
      if (!(error instanceof ApiError) || !(gateCodes.includes(error.code) || error.code === 'spins_not_enabled' || error.code === 'claimed_elsewhere')) throw error;
      reason = error.code === 'spins_not_enabled' || error.code === 'store_unavailable' || error.code === 'country_required' ? 'not_enabled' : error.code;
    }
    const market = await this.context(customer).catch(() => null);
    const mode = market?.mode ?? this.stores.mode(customer.store);
    const allowance = await this.prisma.spinAllowance.findFirst({ where: { customerId: customer.id, mode } });
    const limit = await this.dailyLimit(market?.country);
    // Every win, newest first: an allowance has at most 100 spins, so the dialog pages through them all.
    const recent = allowance ? await this.prisma.spin.findMany({ where: { allowanceId: allowance.id }, orderBy: { number: 'desc' }, take: 100 }) : [];
    return {
      object: 'spin_rewards' as const,
      mode,
      enabled: reason === null && (!allowance || allowance.spinsUsed < allowance.schedule.length),
      reason,
      segments: this.segments(),
      daily_limit: limit,
      allowance: this.present(allowance, allowance ? await this.spinsToday(allowance.id) : 0, limit),
      recent: recent.map(spin => this.presentSpin(spin)),
      rewards: { usd: usd(await this.rewards(customer.id, mode)), exchange_currencies: walletCurrencies(market?.currency) },
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

  /** One spin: the next win of the customer's schedule, credited to their spin rewards at once. Once per number. */
  async spin(customer: CustomerWithStore) {
    const context = await this.gate(customer);
    const allowance = await this.allowanceFor(customer, context.mode);
    const limit = await this.dailyLimit(context.country);
    const number = allowance.spinsUsed + 1;
    if (number > allowance.schedule.length) throw conflict('spins_finished', 'You have used all your spins.');
    const cents = allowance.schedule[number - 1];
    const id = randomUUID();
    const entry = await this.ledger.prepare({
      mode: context.mode,
      type: 'spin_win',
      reference: `spin_win:${id}`,
      description: `Spin and win: $${usd(cents)}`,
      metadata: { spin_id: id, usd: usd(cents) },
      lines: [
        { account: { kind: 'promotions', currency: 'USD' }, debit: BigInt(cents) },
        { account: this.rewardsRef(customer.id), credit: BigInt(cents) },
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
        data: { id, allowanceId: allowance.id, customerId: customer.id, mode: context.mode, number, cents, asset: 'USD', amount: BigInt(cents), segment: segmentFor(cents), priceUsd: null },
      });
      await tx.spinAllowance.update({ where: { id: allowance.id }, data: { spinsUsed: number, wonCents: { increment: cents } } });
      await this.ledger.write(tx, entry);
      return created;
    });
    const updated = await this.prisma.spinAllowance.findUniqueOrThrow({ where: { id: allowance.id } });
    return { object: 'spin' as const, ...this.presentSpin(spin), allowance: this.present(updated, await this.spinsToday(allowance.id), limit)! };
  }

  /**
   * Moves every spin reward the customer holds into their store wallet: in US dollars as they are, or in their
   * country's currency at BitoCard's `receive` rate (rounded down), the rate of wallet conversions. One entry: US
   * dollars straight from `spin_rewards` to the wallet; another currency gives the dollars back to `promotions` and
   * books the money from `promotions` to the wallet. `preview` only quotes; `expected_amount` (what the preview showed)
   * refuses a lower amount (`rate_changed`). Needs no switch: rewards already won are never trapped.
   */
  async exchange(customer: CustomerWithStore, input: { currency?: string; preview?: boolean; expected_amount?: number }) {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
    const context = await this.context(customer);
    const currencies = walletCurrencies(context.currency);
    const currency = (input.currency ?? context.currency).toUpperCase();
    if (!currencies.includes(currency)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'currency_unsupported', `Rewards go to your ${currencies.join(' or ')} wallet.`, 'currency');
    }
    const cents = await this.rewards(customer.id, context.mode);
    if (cents < 1) throw conflict('nothing_to_exchange', 'You have no rewards to move yet.');
    const converted = currency === 'USD' ? { amount: BigInt(cents), rate: '1' } : await this.fx.exchange(BigInt(cents), 'USD', currency);
    if (converted.amount < 1n) throw conflict('nothing_to_exchange', 'Your rewards are too small to move yet: keep spinning.');
    const quote = { usd: usd(cents), currency, amount: Number(converted.amount), rate: converted.rate.toString() };
    if (input.preview) return { object: 'spin_exchange_preview' as const, ...quote };
    if (input.expected_amount !== undefined && converted.amount < BigInt(input.expected_amount)) {
      throw conflict('rate_changed', 'The rate changed. Check the new amount and try again.');
    }
    const id = randomUUID();
    const wallet = { kind: 'customer_wallet' as const, currency, customerId: customer.id };
    const entry = await this.ledger.prepare({
      mode: context.mode,
      type: 'spin_exchange',
      reference: `spin_exchange:${id}`,
      description: 'Spin and win rewards',
      metadata: { spin_exchange_id: id, usd: usd(cents) },
      lines:
        currency === 'USD'
          ? [
              { account: this.rewardsRef(customer.id), debit: BigInt(cents) },
              { account: wallet, credit: BigInt(cents) },
            ]
          : [
              { account: this.rewardsRef(customer.id), debit: BigInt(cents) },
              { account: { kind: 'promotions', currency: 'USD' }, credit: BigInt(cents) },
              { account: { kind: 'promotions', currency }, debit: converted.amount },
              { account: wallet, credit: converted.amount },
            ],
    });
    const created = await this.prisma.$transaction(async tx => {
      const row = await tx.spinExchange.create({
        data: { id, customerId: customer.id, mode: context.mode, amounts: { USD: String(cents) }, usdCents: cents, currency, amountMinor: converted.amount, rate: converted.rate.toString() },
      });
      // A parallel exchange already moved them: the rewards account's balance check refuses this one.
      await this.ledger.write(tx, entry).catch((error: unknown) => {
        throw error instanceof ApiError && error.code === 'insufficient_funds' ? conflict('nothing_to_exchange', 'Your rewards were just moved.') : error;
      });
      return row;
    });
    return { object: 'spin_exchange' as const, id: created.id, ...quote, created_at: created.createdAt.toISOString() };
  }

  // -- Admin ----------------------------------------------------------------------------------------------------

  /** Spins in a mode (newest first), what they won in all and how many customers have started. */
  async adminList(query: { mode?: LedgerMode; customer_id?: string }) {
    const mode = query.mode ?? 'live';
    const where = { mode, ...(query.customer_id ? { customerId: query.customer_id } : {}) };
    const [rows, totals, customers, exchanged] = await Promise.all([
      this.prisma.spin.findMany({ where, include: { customer: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.spin.aggregate({ where, _sum: { cents: true }, _count: { _all: true } }),
      this.prisma.spinAllowance.count({ where: { mode, ...(query.customer_id ? { customerId: query.customer_id } : {}) } }),
      this.prisma.spinExchange.groupBy({ by: ['currency'], where, _sum: { usdCents: true, amountMinor: true }, _count: { _all: true } }),
    ]);
    return {
      object: 'list' as const,
      data: rows.map(row => ({ ...this.presentSpin(row), mode: row.mode, customer: { id: row.customerId, email: row.customer.email } })),
      totals: { mode, usd: usd(totals._sum.cents ?? 0), spins: totals._count._all },
      customers,
      exchanged: exchanged.map(item => ({ currency: item.currency, amount: Number(item._sum.amountMinor ?? 0n), usd: usd(item._sum.usdCents ?? 0), exchanges: item._count._all })),
    };
  }
}
