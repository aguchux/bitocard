import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, TaxRate } from '../generated/prisma/client.js';

export type TaxBreakdown = { name: string; rateBps: number; pricesIncludeTax: boolean; net: bigint; tax: bigint; gross: bigint };

/** Integer division rounding half away from zero (amounts are never negative here). */
const roundDiv = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (denominator * 2n);

/** Tax on an amount. With prices including tax the amount is the gross; otherwise it is the net and tax is added. */
export function computeTax(rate: Pick<TaxRate, 'name' | 'rateBps' | 'pricesIncludeTax'>, amount: bigint): TaxBreakdown {
  const bps = BigInt(rate.rateBps);
  if (rate.pricesIncludeTax) {
    const tax = roundDiv(amount * bps, 10_000n + bps);
    return { name: rate.name, rateBps: rate.rateBps, pricesIncludeTax: true, net: amount - tax, tax, gross: amount };
  }
  const tax = roundDiv(amount * bps, 10_000n);
  return { name: rate.name, rateBps: rate.rateBps, pricesIncludeTax: false, net: amount, tax, gross: amount + tax };
}

export function presentTaxRate(rate: TaxRate) {
  return {
    object: 'tax_rate' as const,
    country: rate.countryCode,
    name: rate.name,
    rate_bps: rate.rateBps,
    prices_include_tax: rate.pricesIncludeTax,
    confirmed: rate.confirmed,
    updated_at: rate.updatedAt.toISOString(),
  };
}

/**
 * Tax BitoCard collects as seller of record, by the customer's country. Live sales need a rate a finance admin has
 * confirmed after tax advice; the sandbox uses unconfirmed rates so integrations can be built in the meantime.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async calculate(countryCode: string, amount: bigint, mode: LedgerMode) {
    const rate = await this.prisma.taxRate.findUnique({ where: { countryCode } });
    if (!rate || (mode === 'live' && !rate.confirmed)) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'tax_not_configured', `Sales to ${countryCode} are not open yet.`);
    }
    return computeTax(rate, amount);
  }

  async list() {
    const rates = await this.prisma.taxRate.findMany({ orderBy: { countryCode: 'asc' } });
    return { object: 'list' as const, data: rates.map(presentTaxRate) };
  }

  async set(actorId: string | null, countryCode: string, input: { name: string; rate_bps: number; prices_include_tax: boolean; confirmed: boolean }) {
    if (!(await this.prisma.country.findUnique({ where: { code: countryCode } }))) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such country.');
    }
    const before = await this.prisma.taxRate.findUnique({ where: { countryCode } });
    const data = { name: input.name, rateBps: input.rate_bps, pricesIncludeTax: input.prices_include_tax, confirmed: input.confirmed };
    const after = await this.prisma.taxRate.upsert({ where: { countryCode }, create: { countryCode, ...data }, update: data });
    await this.audit.record({ actorId, action: 'tax_rate.updated', targetType: 'country', targetId: countryCode, before, after });
    return presentTaxRate(after);
  }
}
