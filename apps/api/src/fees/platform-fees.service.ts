import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type FeeCharge, type FeeKind, type FeeRule, type LedgerMode, Prisma, type ProductCategory } from '../generated/prisma/client.js';
import { LedgerService, type PreparedEntry } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { formatMoney } from '../notifications/templates.js';
import { InboxService } from '../notifications/inbox.service.js';

/** Billionths of a minor unit per minor unit. Rates are parts per billion, so base x rate is the fee in billionths. */
export const nanoPerMinor = 1_000_000_000n;
/** 10%, the highest rate. */
export const maxRatePpb = 100_000_000;

/** The exact fee in billionths of a minor unit: always a whole number, never rounded. */
export const exactFeeNano = (baseMinor: bigint, ratePpb: number) => baseMinor * BigInt(ratePpb);

/** The most a fee can charge: its exact amount rounded up (whatever the carry), or the minimum fee if higher. */
export function maxFeeMinor(exactNano: bigint, minFeeMinor: bigint | null) {
  const ceiling = (exactNano + nanoPerMinor - 1n) / nanoPerMinor;
  return minFeeMinor && minFeeMinor > ceiling ? minFeeMinor : ceiling;
}

/**
 * Charges whole minor units of the carried fraction plus the exact fee and carries the rest. A minimum fee can charge
 * more; what it adds is `extra` and the carry starts again from zero. Always: carry + exact + extra = charged x 1e9 + carry after.
 */
export function settleFee(carryBeforeNano: bigint, exactNano: bigint, minFeeMinor: bigint | null) {
  const total = carryBeforeNano + exactNano;
  const charged = total / nanoPerMinor;
  if (minFeeMinor && charged < minFeeMinor) return { charged: minFeeMinor, carryAfter: 0n, extra: minFeeMinor * nanoPerMinor - total };
  return { charged, carryAfter: total % nanoPerMinor, extra: 0n };
}

/** A rate as a percentage string, exactly (parts per billion / 10^7), for example 100000 -> "0.01". */
export function percentOf(ratePpb: number) {
  const whole = Math.floor(ratePpb / 10_000_000);
  const fraction = String(ratePpb % 10_000_000)
    .padStart(7, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const scopeKeyOf = (rule: { kind: FeeKind; countryCode?: string | null; category?: ProductCategory | null; planCode?: string | null }) =>
  `${rule.kind}:${rule.countryCode ?? '*'}:${rule.category ?? '*'}:${rule.planCode ?? '*'}`;

/** How specific a rule is: country, then category, then plan. */
const specificity = (rule: FeeRule) => (rule.countryCode ? 4 : 0) + (rule.category ? 2 : 0) + (rule.planCode ? 1 : 0);

export type FeeScope = { kind: FeeKind; countryCode: string | null; category: ProductCategory | null; planCode: string | null };

/** The most specific rule matching a transaction, from rules already loaded (pricing resolves many at once). */
export function pickFeeRule(rules: FeeRule[], input: FeeScope) {
  const matching = rules.filter(
    rule =>
      rule.kind === input.kind &&
      (rule.countryCode === null || rule.countryCode === input.countryCode) &&
      (rule.category === null || rule.category === input.category) &&
      (rule.planCode === null || rule.planCode === input.planCode),
  );
  return matching.sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
}

/** A fee locked by a quote: the rule and rate it used, so a later rule change cannot change a quoted fee. */
export type LockedFee = { ruleId: string | null; ratePpb: number; minFeeMinor: bigint | null };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such fee.');

export type FeeSource = { type: 'order' | 'payment'; id: string };

/**
 * BitoCard's fees on resellers' own-integration transactions (PLANS.md, Reseller's own integrations).
 *
 * Rates are parts per billion of the base (0 to 10%); the fee in billionths of a minor unit is exactly base x rate.
 * Before a transaction, the most the fee can be is held from the wallet (`hold`); on success `settle` returns the hold
 * and charges whole minor units of the reseller's carried fraction plus the exact fee, carrying the rest (the carry row
 * locked, so concurrent settlements add up); on failure `release` returns the hold and never touches the carry. Each
 * charge is its own journal entry (`fee:<source>`, type `platform_fee`) to the `platform_fees` revenue account, and
 * every charge keeps its rate, base, exact fee, amount charged and carry before and after.
 */
@Injectable()
export class PlatformFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  /** The rule for a transaction: the most specific match, or none (no fee). */
  async ruleFor(input: FeeScope) {
    return pickFeeRule(await this.prisma.feeRule.findMany({ where: { kind: input.kind } }), input);
  }

  /** What a fee would be, without holding anything. */
  async quote(input: { resellerId: string; kind: FeeKind; category?: ProductCategory | null; baseMinor: bigint; locked?: LockedFee }) {
    if (input.baseMinor < 0n) throw new Error('Fee base cannot be negative');
    const { reseller, currency } = await this.wallets.currencyOf(input.resellerId);
    const rule = input.locked
      ? { id: input.locked.ruleId, ratePpb: input.locked.ratePpb, minFeeMinor: input.locked.minFeeMinor }
      : await this.ruleFor({ kind: input.kind, countryCode: reseller.country, category: input.category ?? null, planCode: reseller.planCode });
    const ratePpb = rule?.ratePpb ?? 0;
    const exactNano = exactFeeNano(input.baseMinor, ratePpb);
    const minFee = rule?.minFeeMinor ?? null;
    return { reseller, currency, rule, ratePpb, exactNano, minFee, maxMinor: maxFeeMinor(exactNano, minFee) };
  }

  /**
   * Holds the most the fee can be for a transaction, before it is placed. Throws insufficient_funds if the wallet cannot
   * cover it. One fee per source: repeating returns the same fee.
   */
  async hold(input: { resellerId: string; mode: LedgerMode; kind: FeeKind; category?: ProductCategory | null; baseMinor: bigint; source: FeeSource; description: string; locked?: LockedFee }) {
    const reference = `fee:${input.source.type}:${input.source.id}`;
    const existing = await this.prisma.feeCharge.findUnique({ where: { reference } });
    if (existing) return existing;
    const quote = await this.quote(input);
    const hold =
      quote.maxMinor > 0n
        ? await this.wallets.hold({ resellerId: input.resellerId, mode: input.mode, amount: quote.maxMinor, reference: `${reference}:hold`, description: `${input.description}: BitoCard fee held` })
        : null;
    try {
      return await this.prisma.feeCharge.create({
        data: {
          resellerId: input.resellerId,
          mode: input.mode,
          currency: quote.currency,
          kind: input.kind,
          sourceType: input.source.type,
          sourceId: input.source.id,
          reference,
          category: input.category ?? null,
          countryCode: quote.reseller.country,
          planCode: quote.reseller.planCode,
          ruleId: quote.rule?.id ?? null,
          ratePpb: quote.ratePpb,
          baseMinor: input.baseMinor,
          minFeeMinor: quote.minFee,
          exactNano: quote.exactNano,
          heldMinor: quote.maxMinor,
          holdId: hold?.id ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.feeCharge.findUniqueOrThrow({ where: { reference } });
      throw error;
    }
  }

  /** The transaction succeeded: returns the hold and charges the fee with the carried fraction. Repeating does nothing. */
  async settle(chargeId: string) {
    const charge = await this.prisma.feeCharge.findUnique({ where: { id: chargeId } });
    if (!charge) throw notFound();
    if (charge.status !== 'held') return charge;
    const hold = charge.holdId ? await this.prisma.hold.findUniqueOrThrow({ where: { id: charge.holdId } }) : null;
    const owner = { resellerId: charge.resellerId };
    const accounts = {
      funding: await this.ledger.accountId(charge.mode, { kind: 'reseller_funding', currency: charge.currency, ...owner }),
      earnings: await this.ledger.accountId(charge.mode, { kind: 'reseller_earnings', currency: charge.currency, ...owner }),
      reserved: await this.ledger.accountId(charge.mode, { kind: 'reseller_reserved', currency: charge.currency, ...owner }),
      fees: await this.ledger.accountId(charge.mode, { kind: 'platform_fees', currency: charge.currency }),
    };
    // The carry row must exist before it can be locked. Insert-or-skip, so settlements at the same moment do not collide.
    await this.prisma.feeCarry.createMany({ data: [{ resellerId: charge.resellerId, mode: charge.mode, currency: charge.currency }], skipDuplicates: true });

    return this.prisma.$transaction(async tx => {
      // Only one of settle and release wins, even at the same moment.
      const claimed = await tx.feeCharge.updateMany({ where: { id: charge.id, status: 'held' }, data: { status: 'charged', settledAt: new Date() } });
      if (claimed.count === 0) return tx.feeCharge.findUniqueOrThrow({ where: { id: charge.id } });
      if (hold) {
        const holdClaimed = await tx.hold.updateMany({ where: { id: hold.id, status: 'held' }, data: { status: 'captured', resolvedAt: new Date() } });
        if (holdClaimed.count === 0) throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'fee_hold_resolved', 'The fee hold was already returned.');
      }
      const [row] = await tx.$queryRaw<Array<{ carry_nano: bigint }>>`
        SELECT carry_nano FROM fee_carries WHERE reseller_id = ${charge.resellerId}::uuid AND mode = ${charge.mode}::"LedgerMode" AND currency = ${charge.currency} FOR UPDATE`;
      const carryBefore = BigInt(row.carry_nano);
      const { charged, carryAfter, extra } = settleFee(carryBefore, charge.exactNano, charge.minFeeMinor);
      if (charged > charge.heldMinor) throw new Error(`Fee ${charge.id} would charge more than it held`);

      if (hold) {
        // The whole hold goes back first; the fee is then its own entry, so the wallet history reads clearly.
        await this.ledger.write(tx, {
          mode: charge.mode,
          type: 'hold_release',
          reference: `hold_release:${hold.id}`,
          resellerId: charge.resellerId,
          description: 'BitoCard fee hold returned',
          metadata: { hold_id: hold.id, fee_charge_id: charge.id },
          postings: [
            { accountId: accounts.reserved, kind: 'reseller_reserved', amount: hold.amountMinor },
            ...(hold.fromFundingMinor > 0n ? [{ accountId: accounts.funding, kind: 'reseller_funding' as const, amount: -hold.fromFundingMinor }] : []),
            ...(hold.fromEarningsMinor > 0n ? [{ accountId: accounts.earnings, kind: 'reseller_earnings' as const, amount: -hold.fromEarningsMinor }] : []),
          ],
        });
      }
      if (charged > 0n) {
        // Topped-up funds first, then earnings, as for every wallet charge.
        const balances = await this.ledger.lockBalances(tx, [accounts.funding, accounts.earnings]);
        const funding = balances.get(accounts.funding) ?? 0n;
        const fromFunding = funding < charged ? funding : charged;
        const entry: PreparedEntry = {
          mode: charge.mode,
          type: 'platform_fee',
          reference: charge.reference,
          resellerId: charge.resellerId,
          description: `BitoCard fee: ${percentOf(charge.ratePpb)}% of ${formatMoney(charge.baseMinor, charge.currency)}`,
          metadata: feeMetadata(charge),
          postings: [
            ...(fromFunding > 0n ? [{ accountId: accounts.funding, kind: 'reseller_funding' as const, amount: fromFunding }] : []),
            ...(charged - fromFunding > 0n ? [{ accountId: accounts.earnings, kind: 'reseller_earnings' as const, amount: charged - fromFunding }] : []),
            { accountId: accounts.fees, kind: 'platform_fees', amount: -charged },
          ],
        };
        await this.ledger.write(tx, entry);
      }
      await tx.feeCarry.update({
        where: { resellerId_mode_currency: { resellerId: charge.resellerId, mode: charge.mode, currency: charge.currency } },
        data: { carryNano: carryAfter },
      });
      return tx.feeCharge.update({
        where: { id: charge.id },
        data: { chargedMinor: charged, carryBeforeNano: carryBefore, carryAfterNano: carryAfter, extraNano: extra },
      });
    });
  }

  /** The transaction failed: returns the whole hold and charges nothing; the carry is untouched. Repeating does nothing. */
  async release(chargeId: string) {
    const charge = await this.prisma.feeCharge.findUnique({ where: { id: chargeId } });
    if (!charge) throw notFound();
    if (charge.status !== 'held') return charge;
    if (charge.holdId) {
      const hold = await this.wallets.releaseHold(charge.holdId, 'BitoCard fee hold returned: the transaction did not complete');
      // A settlement got there first.
      if (hold.status !== 'released') return this.prisma.feeCharge.findUniqueOrThrow({ where: { id: charge.id } });
    }
    await this.prisma.feeCharge.updateMany({ where: { id: charge.id, status: 'held' }, data: { status: 'released', settledAt: new Date(), chargedMinor: 0n } });
    return this.prisma.feeCharge.findUniqueOrThrow({ where: { id: charge.id } });
  }

  /**
   * Gives a charged fee back to the reseller's topped-up funds (nothing was delivered after all). Its own entry
   * (`fee:refund:<id>`); the carried fraction stays. Audited when an admin does it.
   */
  async refund(chargeId: string, actorId: string | null, reason: string) {
    const charge = await this.prisma.feeCharge.findUnique({ where: { id: chargeId } });
    if (!charge) throw notFound();
    if (charge.status === 'refunded') return charge;
    if (charge.status !== 'charged') throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'fee_not_charged', 'Only a charged fee can be refunded.');
    const amount = charge.chargedMinor ?? 0n;
    const entry =
      amount > 0n
        ? await this.ledger.prepare({
            mode: charge.mode,
            type: 'platform_fee_refund',
            reference: `fee:refund:${charge.id}`,
            resellerId: charge.resellerId,
            description: `BitoCard fee refunded: ${reason}`,
            metadata: feeMetadata(charge),
            lines: [
              { account: { kind: 'platform_fees', currency: charge.currency }, debit: amount },
              { account: { kind: 'reseller_funding', currency: charge.currency, resellerId: charge.resellerId }, credit: amount },
            ],
          })
        : null;
    const refunded = await this.prisma.$transaction(async tx => {
      const claimed = await tx.feeCharge.updateMany({ where: { id: charge.id, status: 'charged' }, data: { status: 'refunded', refundReason: reason } });
      if (claimed.count === 0) return tx.feeCharge.findUniqueOrThrow({ where: { id: charge.id } });
      if (entry) await this.ledger.write(tx, entry);
      return tx.feeCharge.findUniqueOrThrow({ where: { id: charge.id } });
    });
    if (actorId) await this.audit.record({ actorId, action: 'fee.refunded', targetType: 'fee_charge', targetId: charge.id, before: { status: charge.status }, after: { status: 'refunded', amount: amount.toString(), reason } });
    if (refunded.status === 'refunded' && amount > 0n) {
      await this.inbox.reseller(charge.resellerId, 'fee.refunded', {
        subject: charge.id,
        title: `${formatMoney(amount, charge.currency)} BitoCard fee refunded`,
        body: `BitoCard refunded its fee to your wallet. Reason: ${reason}`,
        link: '/wallet/fees',
        mode: charge.mode,
      });
    }
    return refunded;
  }

  // ---- Reseller views

  async list(resellerId: string, mode: LedgerMode, query: { month?: string; limit?: number; starting_after?: string }) {
    const limit = query.limit ?? 25;
    const rows = await this.prisma.feeCharge.findMany({
      where: { resellerId, mode, ...(query.month ? { createdAt: monthRange(query.month) } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.starting_after ? { cursor: { id: query.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: rows.slice(0, limit).map(presentCharge), has_more: rows.length > limit };
  }

  /** One month's fees and subscription charges, for the reseller's statement. */
  async statement(resellerId: string, mode: LedgerMode, month: string) {
    const { currency } = await this.wallets.currencyOf(resellerId);
    const range = monthRange(month);
    const charges = await this.prisma.feeCharge.findMany({ where: { resellerId, mode, currency, createdAt: range, status: { in: ['charged', 'refunded'] } } });
    const plans = await this.prisma.hold.findMany({ where: { resellerId, mode, currency, status: 'captured', reference: { startsWith: 'plan:' }, resolvedAt: range } });
    const sum = (rows: FeeCharge[]) => rows.reduce((total, row) => total + (row.chargedMinor ?? 0n), 0n);
    const byKind = (['supplier_order', 'gateway_payment'] as const).map(kind => {
      const rows = charges.filter(row => row.kind === kind);
      return {
        kind,
        transactions: rows.length,
        base: minor(rows.reduce((total, row) => total + row.baseMinor, 0n)),
        charged: minor(sum(rows)),
        refunded: minor(sum(rows.filter(row => row.status === 'refunded'))),
      };
    });
    const charged = sum(charges);
    const refunded = sum(charges.filter(row => row.status === 'refunded'));
    const subscription = plans.reduce((total, hold) => total + hold.amountMinor, 0n);
    const carry = await this.prisma.feeCarry.findUnique({ where: { resellerId_mode_currency: { resellerId, mode, currency } } });
    return {
      object: 'fee_statement' as const,
      month,
      mode,
      currency,
      fees: { transactions: charges.length, charged: minor(charged), refunded: minor(refunded), net: minor(charged - refunded), by_kind: byKind },
      subscription: minor(subscription),
      total: minor(charged - refunded + subscription),
      /** The fraction of a minor unit accrued but not yet charged, in billionths (always below one unit). */
      carried_nano: (carry?.carryNano ?? 0n).toString(),
    };
  }

  /** The rates that apply to the reseller now, per fee kind and category. */
  async ratesFor(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    const categories: Array<ProductCategory | null> = [null, 'gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'esim', 'software', 'virtual_numbers', 'virtual_cards'];
    const data = [];
    for (const kind of ['supplier_order', 'gateway_payment'] as const) {
      for (const category of kind === 'gateway_payment' ? [null] : categories) {
        const rule = await this.ruleFor({ kind, countryCode: reseller.country, category, planCode: reseller.planCode });
        data.push({ object: 'fee_rate' as const, kind, category, rate_ppb: rule?.ratePpb ?? 0, rate_percent: percentOf(rule?.ratePpb ?? 0), min_fee: rule?.minFeeMinor === null || !rule ? null : minor(rule.minFeeMinor) });
      }
    }
    return { object: 'list' as const, data };
  }

  // ---- Admin

  async rules() {
    const rows = await this.prisma.feeRule.findMany({ orderBy: [{ kind: 'asc' }, { scopeKey: 'asc' }] });
    return { object: 'list' as const, data: rows.map(presentRule) };
  }

  async setRule(adminId: string | null, input: { kind: FeeKind; country_code?: string | null; category?: ProductCategory | null; plan_code?: string | null; rate_ppb: number; min_fee_minor?: number | null }) {
    const countryCode = input.country_code?.toUpperCase() ?? null;
    if (countryCode && !(await this.prisma.country.findUnique({ where: { code: countryCode } }))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_unknown', 'No such country.', 'country_code');
    }
    if (input.plan_code && !(await this.prisma.plan.findUnique({ where: { code: input.plan_code } }))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'plan_unknown', 'No such plan.', 'plan_code');
    }
    if (input.min_fee_minor && !countryCode) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_required', 'A minimum fee is in a currency, so the rule needs a country.', 'min_fee_minor');
    }
    if (input.kind === 'gateway_payment' && input.category) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Gateway payment fees are not per category.', 'category');
    }
    const scope = { kind: input.kind, countryCode, category: input.category ?? null, planCode: input.plan_code ?? null };
    const scopeKey = scopeKeyOf(scope);
    const before = await this.prisma.feeRule.findUnique({ where: { scopeKey } });
    const data = { ...scope, ratePpb: input.rate_ppb, minFeeMinor: input.min_fee_minor ? BigInt(input.min_fee_minor) : null, updatedById: adminId };
    const after = await this.prisma.feeRule.upsert({ where: { scopeKey }, create: { scopeKey, ...data }, update: data });
    await this.audit.record({ actorId: adminId, action: 'fee_rule.set', targetType: 'fee_rule', targetId: scopeKey, before: before ? presentRule(before) : null, after: presentRule(after) });
    return presentRule(after);
  }

  async deleteRule(adminId: string | null, id: string) {
    const rule = await this.prisma.feeRule.findUnique({ where: { id } });
    if (!rule) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such fee rule.');
    await this.prisma.feeRule.delete({ where: { id } });
    await this.audit.record({ actorId: adminId, action: 'fee_rule.deleted', targetType: 'fee_rule', targetId: rule.scopeKey, before: presentRule(rule), after: null });
  }

  /** Fee revenue between two dates, grouped, per currency (charged and refunded). */
  async report(input: { from: Date; to: Date; mode: LedgerMode; groupBy: 'reseller' | 'kind' | 'category' | 'country' | 'plan' }) {
    const rows = await this.prisma.feeCharge.findMany({
      where: { mode: input.mode, status: { in: ['charged', 'refunded'] }, settledAt: { gte: input.from, lt: input.to } },
      include: { reseller: { select: { name: true } } },
    });
    const groups = new Map<string, { key: string; label: string; currency: string; transactions: number; charged: bigint; refunded: bigint }>();
    for (const row of rows) {
      const key = { reseller: row.resellerId, kind: row.kind, category: row.category ?? 'none', country: row.countryCode ?? 'none', plan: row.planCode ?? 'none' }[input.groupBy];
      const label = input.groupBy === 'reseller' ? row.reseller.name : key;
      const id = `${key}:${row.currency}`;
      const group = groups.get(id) ?? { key, label, currency: row.currency, transactions: 0, charged: 0n, refunded: 0n };
      group.transactions += 1;
      group.charged += row.chargedMinor ?? 0n;
      if (row.status === 'refunded') group.refunded += row.chargedMinor ?? 0n;
      groups.set(id, group);
    }
    return {
      object: 'fee_report' as const,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      mode: input.mode,
      group_by: input.groupBy,
      data: [...groups.values()]
        .sort((a, b) => (b.charged - b.refunded > a.charged - a.refunded ? 1 : -1))
        .map(group => ({ key: group.key, label: group.label, currency: group.currency, transactions: group.transactions, charged: minor(group.charged), refunded: minor(group.refunded), net: minor(group.charged - group.refunded) })),
    };
  }

  /**
   * Proves the fees add up: per reseller, mode and currency, exact fees plus minimum-fee extras equal what was charged
   * (in billionths) plus the carried fraction; and per mode and currency the `platform_fees` account holds exactly what
   * was charged less what was refunded.
   */
  async reconcile() {
    const sums = await this.prisma.$queryRaw<Array<{ reseller_id: string; mode: LedgerMode; currency: string; exact: bigint; extra: bigint; charged: bigint }>>`
      SELECT reseller_id, mode, currency, COALESCE(SUM(exact_nano), 0) AS exact, COALESCE(SUM(extra_nano), 0) AS extra, COALESCE(SUM(charged_minor), 0) AS charged
      FROM fee_charges WHERE status IN ('charged', 'refunded') GROUP BY reseller_id, mode, currency`;
    const carries = await this.prisma.feeCarry.findMany();
    const mismatches = [];
    for (const row of sums) {
      const carry = carries.find(item => item.resellerId === row.reseller_id && item.mode === row.mode && item.currency === row.currency)?.carryNano ?? 0n;
      const left = BigInt(row.exact) + BigInt(row.extra);
      const right = BigInt(row.charged) * nanoPerMinor + carry;
      if (left !== right) mismatches.push({ reseller_id: row.reseller_id, mode: row.mode, currency: row.currency, exact_plus_extra_nano: left.toString(), charged_plus_carry_nano: right.toString() });
    }
    const totals = await this.prisma.$queryRaw<Array<{ mode: LedgerMode; currency: string; net: bigint }>>`
      SELECT mode, currency, COALESCE(SUM(CASE WHEN status = 'charged' THEN charged_minor ELSE 0 END), 0) AS net
      FROM fee_charges WHERE status IN ('charged', 'refunded') GROUP BY mode, currency`;
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { kind: 'platform_fees' } });
    const ledger = [];
    for (const account of accounts) {
      const net = BigInt(totals.find(row => row.mode === account.mode && row.currency === account.currency)?.net ?? 0n);
      if (account.balanceMinor !== net) ledger.push({ mode: account.mode, currency: account.currency, account_balance: minor(account.balanceMinor), fees_net: minor(net) });
    }
    return { object: 'fee_reconciliation' as const, ok: mismatches.length === 0 && ledger.length === 0, checked: sums.length, mismatches, ledger_mismatches: ledger };
  }
}

function feeMetadata(charge: FeeCharge) {
  return {
    fee_charge_id: charge.id,
    source_type: charge.sourceType,
    source_id: charge.sourceId,
    rate_ppb: charge.ratePpb,
    base_minor: charge.baseMinor.toString(),
    exact_nano: charge.exactNano.toString(),
  };
}

/** The UTC calendar month `YYYY-MM`. */
export function monthRange(month: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'month must be YYYY-MM.', 'month');
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return { gte: start, lt: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
}

export function presentCharge(charge: FeeCharge) {
  return {
    object: 'fee_charge' as const,
    id: charge.id,
    mode: charge.mode,
    kind: charge.kind,
    status: charge.status,
    currency: charge.currency,
    source: { type: charge.sourceType, id: charge.sourceId },
    category: charge.category,
    rate_ppb: charge.ratePpb,
    rate_percent: percentOf(charge.ratePpb),
    base: minor(charge.baseMinor),
    min_fee: charge.minFeeMinor === null ? null : minor(charge.minFeeMinor),
    /** The exact fee in billionths of a minor unit. */
    exact_nano: charge.exactNano.toString(),
    held: minor(charge.heldMinor),
    charged: charge.chargedMinor === null ? null : minor(charge.chargedMinor),
    carry_before_nano: charge.carryBeforeNano?.toString() ?? null,
    carry_after_nano: charge.carryAfterNano?.toString() ?? null,
    refund_reason: charge.refundReason,
    created_at: charge.createdAt.toISOString(),
    settled_at: charge.settledAt?.toISOString() ?? null,
  };
}

function presentRule(rule: FeeRule) {
  return {
    object: 'fee_rule' as const,
    id: rule.id,
    kind: rule.kind,
    country_code: rule.countryCode,
    category: rule.category,
    plan_code: rule.planCode,
    rate_ppb: rule.ratePpb,
    rate_percent: percentOf(rule.ratePpb),
    min_fee_minor: rule.minFeeMinor === null ? null : minor(rule.minFeeMinor),
    updated_at: rule.updatedAt.toISOString(),
  };
}
