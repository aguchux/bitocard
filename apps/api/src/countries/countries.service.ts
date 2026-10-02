import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ApiError } from '../common/errors/api-error';
import { AuditService } from '../audit/audit.service';
import { type Country, type CountryCategory, ProductCategory } from '../generated/prisma/client';

export const productCategories = Object.values(ProductCategory);

type CountryWithCategories = Country & { categories: CountryCategory[] };

const missing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such country.');

/** Public view: what is open in a country. */
export function presentCountry(country: CountryWithCategories) {
  return {
    object: 'country' as const,
    code: country.code,
    name: country.name,
    currency: country.currency,
    reseller_signup: country.resellerSignup,
    categories: country.categories.filter(c => c.enabled).map(c => ({ category: c.category, customer_verification: c.customerVerification })),
  };
}

/** Admin view: every setting. */
export function presentCountryAdmin(country: CountryWithCategories) {
  return {
    ...presentCountry(country),
    reserved_accounts: country.reservedAccounts,
    markup_cap_percent: country.markupCapPercent,
    payout_hold_days: country.payoutHoldDays,
    min_withdrawal_minor: Number(country.minWithdrawalMinor),
    categories: country.categories
      .sort((a, b) => productCategories.indexOf(a.category) - productCategories.indexOf(b.category))
      .map(c => ({ category: c.category, enabled: c.enabled, customer_verification: c.customerVerification, taxable: c.taxable })),
  };
}

export type CountryUpdate = Partial<{
  name: string;
  reseller_signup: boolean;
  reserved_accounts: boolean;
  markup_cap_percent: number;
  payout_hold_days: number;
  min_withdrawal_minor: number;
}>;

/** Markets: which countries are open, their currency, money rules and the product categories sold there. */
@Injectable()
export class CountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(onlyOpen: boolean) {
    return this.prisma.country.findMany({ where: onlyOpen ? { resellerSignup: true } : {}, include: { categories: true }, orderBy: { name: 'asc' } });
  }

  async get(code: string) {
    const country = await this.prisma.country.findUnique({ where: { code: code.toUpperCase() }, include: { categories: true } });
    if (!country) throw missing();
    return country;
  }

  async assertSignupOpen(code: string) {
    const country = await this.prisma.country.findUnique({ where: { code } });
    if (!country?.resellerSignup) {
      const open = await this.prisma.country.findMany({ where: { resellerSignup: true }, orderBy: { code: 'asc' } });
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'invalid_request_error',
        'country_not_supported',
        `Reseller sign-up is open in ${open.map(c => c.code).join(', ') || 'no countries'} for now.`,
        'country',
      );
    }
    return country;
  }

  /** Adds a market, closed and with every category off until an admin opens it. */
  async create(actorId: string | null, input: { code: string; name: string; currency: string; min_withdrawal_minor: number }) {
    const code = input.code.toUpperCase();
    if (await this.prisma.country.findUnique({ where: { code } })) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_exists', 'This country already exists.', 'code');
    }
    const country = await this.prisma.country.create({
      data: {
        code,
        name: input.name,
        currency: input.currency.toUpperCase(),
        minWithdrawalMinor: BigInt(input.min_withdrawal_minor),
        categories: { create: productCategories.map(category => ({ category })) },
      },
      include: { categories: true },
    });
    await this.audit.record({ actorId, action: 'country.created', targetType: 'country', targetId: code, after: country });
    return country;
  }

  async update(actorId: string | null, code: string, input: CountryUpdate) {
    const before = await this.get(code);
    const country = await this.prisma.country.update({
      where: { code: before.code },
      data: {
        name: input.name,
        resellerSignup: input.reseller_signup,
        reservedAccounts: input.reserved_accounts,
        markupCapPercent: input.markup_cap_percent,
        payoutHoldDays: input.payout_hold_days,
        minWithdrawalMinor: input.min_withdrawal_minor === undefined ? undefined : BigInt(input.min_withdrawal_minor),
      },
      include: { categories: true },
    });
    await this.audit.record({ actorId, action: 'country.updated', targetType: 'country', targetId: country.code, before, after: country });
    return country;
  }

  async updateCategory(actorId: string | null, code: string, category: ProductCategory, input: { enabled?: boolean; customer_verification?: boolean; taxable?: boolean }) {
    const country = await this.get(code);
    const before = country.categories.find(c => c.category === category);
    const after = await this.prisma.countryCategory.upsert({
      where: { countryCode_category: { countryCode: country.code, category } },
      create: { countryCode: country.code, category, enabled: input.enabled ?? false, customerVerification: input.customer_verification ?? false, taxable: input.taxable ?? false },
      update: { enabled: input.enabled, customerVerification: input.customer_verification, taxable: input.taxable },
    });
    await this.audit.record({ actorId, action: 'country.category_updated', targetType: 'country', targetId: country.code, before, after });
    return this.get(country.code);
  }
}
