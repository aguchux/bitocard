import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ClassifiedResaleSettings } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { invalid } from './rules.js';

/** BitoCard's limits where a country has no row yet. */
export const resaleDefaults = { discountMinBps: 500, discountMaxBps: 5000, markupMaxBps: 3000, resellerFeeBps: null, resellerFeeCapMinor: null, acceptHours: 24, resellerStrikeLimit: 3 } as const;

type Limits = Omit<ClassifiedResaleSettings, 'updatedAt'> & { updatedAt: Date | null; markupCapBps: number };

const unavailable = (message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'resale_unavailable', message);

/**
 * B2B reselling's rules (`docs/BITOCARD_B2B_RESELLING_PLAN.md`, stage 1): BitoCard's limits per country on what a
 * supplier may offer resellers, whether resale is open in a country (the `classifieds_resale` switch and the reseller
 * fee set), and whether a supplier may open their listings to resellers (identity checked and a payout account, live).
 */
@Injectable()
export class ResaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly identity: IdentityService,
    private readonly stores: StoreSellers,
    private readonly audit: AuditService,
  ) {}

  /** The country's limits: its row, else the defaults, the markup limit never above the country's markup cap. */
  async limits(country: string): Promise<Limits> {
    const [row, market] = await Promise.all([this.prisma.classifiedResaleSettings.findUnique({ where: { country } }), this.prisma.country.findUnique({ where: { code: country }, select: { markupCapPercent: true } })]);
    const markupCapBps = Math.round(Number(market?.markupCapPercent ?? 100) * 100);
    const base = row ?? { country, ...resaleDefaults, updatedAt: null };
    return { ...base, markupMaxBps: Math.min(base.markupMaxBps, markupCapBps), markupCapBps };
  }

  /** Whether suppliers in the country can open listings to resellers, and why not. */
  async availability(country: string) {
    const [on, limits] = await Promise.all([this.settings.isOnForCountry('classifieds_resale', country), this.limits(country)]);
    const reason = !on ? 'switch_off' : limits.resellerFeeBps === null || limits.resellerFeeCapMinor === null ? 'not_set_up' : null;
    return { open: reason === null, reason, limits };
  }

  /** A supplier's resale terms, checked against the country's limits. */
  checkTerms(limits: Limits, discountBps: number | null, markupMaxBps: number | null) {
    if (discountBps === null || discountBps < limits.discountMinBps || discountBps > limits.discountMaxBps) {
      throw invalid('resale_discount_out_of_range', `Resellers' discount must be from ${limits.discountMinBps / 100}% to ${limits.discountMaxBps / 100}% in this country.`, 'resale_discount_bps');
    }
    if (markupMaxBps === null || markupMaxBps < 0 || markupMaxBps > limits.markupMaxBps) {
      throw invalid('resale_markup_out_of_range', `Resellers may sell at most ${limits.markupMaxBps / 100}% above your price in this country.`, 'resale_markup_max_bps');
    }
  }

  /** What stops this customer opening listings to resellers, if anything (live: their identity check and a payout account). */
  private async readiness(customer: CustomerWithStore, country: string) {
    const mode = this.stores.mode(customer.store);
    if (mode === 'test') return { identity_checked: true, payout_account: true };
    const house = await this.stores.sellerFor(customer);
    const [checked, account] = await Promise.all([
      this.identity.isCustomerVerified(house.id, mode, customer.id),
      this.prisma.customerBankAccount.findFirst({ where: { customerId: customer.id, mode, country, removedAt: null }, select: { id: true } }),
    ]);
    return { identity_checked: checked, payout_account: Boolean(account) };
  }

  /** Before a listing is opened to resellers: resale open in the country, and the supplier ready. */
  async requireSupplier(customer: CustomerWithStore, country: string) {
    const { open, reason } = await this.availability(country);
    if (!open) throw unavailable(reason === 'switch_off' ? 'Selling through resellers is not open in your country yet.' : 'Selling through resellers is not set up in your country yet.');
    const ready = await this.readiness(customer, country);
    if (!ready.identity_checked || !ready.payout_account) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'supplier_not_ready', 'To let resellers sell your listings, finish your identity check and add a payout bank account first.', ready.identity_checked ? 'payout_account' : 'identity');
    }
  }

  /** For the Shop tab's Post an ad: whether the supplier can open listings to resellers, the limits, and what is missing. */
  async forSupplier(customer: CustomerWithStore, country: string) {
    const [{ open, reason, limits }, ready] = await Promise.all([this.availability(country), this.readiness(customer, country)]);
    return {
      object: 'classified_resale_availability' as const,
      country,
      open,
      reason,
      ...ready,
      ready: open && ready.identity_checked && ready.payout_account,
      discount_min_bps: limits.discountMinBps,
      discount_max_bps: limits.discountMaxBps,
      markup_max_bps: limits.markupMaxBps,
    };
  }

  // ---- Admins ----

  private present(limits: Limits) {
    return {
      object: 'classified_resale_settings' as const,
      country: limits.country,
      discount_min_bps: limits.discountMinBps,
      discount_max_bps: limits.discountMaxBps,
      markup_max_bps: limits.markupMaxBps,
      /** The country's markup cap (Markup Protection Scheme): the markup limit is never above it. */
      markup_cap_bps: limits.markupCapBps,
      reseller_fee_bps: limits.resellerFeeBps,
      reseller_fee_cap: limits.resellerFeeCapMinor === null ? null : Number(limits.resellerFeeCapMinor),
      accept_hours: limits.acceptHours,
      reseller_strike_limit: limits.resellerStrikeLimit,
      updated_at: limits.updatedAt?.toISOString() ?? null,
    };
  }

  private async requireCountry(country: string) {
    if (!(await this.prisma.country.findUnique({ where: { code: country }, select: { code: true } }))) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such country.');
  }

  async adminSettings(country: string) {
    await this.requireCountry(country);
    return { ...this.present(await this.limits(country)), open: (await this.availability(country)).open };
  }

  async updateSettings(
    actorId: string | null,
    country: string,
    input: Partial<{ discount_min_bps: number; discount_max_bps: number; markup_max_bps: number; reseller_fee_bps: number; reseller_fee_cap: number; accept_hours: number; reseller_strike_limit: number }>,
  ) {
    const before = await this.adminSettings(country);
    const current = await this.limits(country);
    const next = {
      discountMinBps: input.discount_min_bps ?? current.discountMinBps,
      discountMaxBps: input.discount_max_bps ?? current.discountMaxBps,
      markupMaxBps: input.markup_max_bps ?? current.markupMaxBps,
      resellerFeeBps: input.reseller_fee_bps ?? current.resellerFeeBps,
      resellerFeeCapMinor: input.reseller_fee_cap !== undefined ? BigInt(input.reseller_fee_cap) : current.resellerFeeCapMinor,
      acceptHours: input.accept_hours ?? current.acceptHours,
      resellerStrikeLimit: input.reseller_strike_limit ?? current.resellerStrikeLimit,
    };
    if (next.discountMinBps > next.discountMaxBps) throw invalid('parameter_invalid', 'The smallest discount cannot be above the largest.', 'discount_min_bps');
    if (next.markupMaxBps > current.markupCapBps) throw invalid('parameter_invalid', `The markup limit cannot be above the country's markup cap (${current.markupCapBps / 100}%).`, 'markup_max_bps');
    await this.prisma.classifiedResaleSettings.upsert({ where: { country }, create: { country, ...next }, update: next });
    const after = await this.adminSettings(country);
    await this.audit.record({ actorId, action: 'classifieds.resale_settings_changed', targetType: 'country', targetId: country, before, after });
    return after;
  }
}
