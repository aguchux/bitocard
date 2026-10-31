import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainsService } from '../domains/domains.service.js';
import { FxService } from '../fx/fx.service.js';
import { InvoicesService } from './invoices.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { PlansService } from '../plans/plans.service.js';
import { everyMarket, setupFeeOf } from './setup-fee.js';
import { formatMoney } from '../notifications/templates.js';

const premiumCode = 'premium';



/**
 * Udozo's one-time Seller HQ setup fee (docs/UDOZO_SPINOFF_PLAN.md, step 3). Udozo's finance admins switch it on and set
 * it per market; a seller pays it once from their live wallet, with their first Premium month or on its own, and no
 * store goes live before it is paid. With the first Premium month it pays for that store's free domain.
 */
@Injectable()
export class SetupFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly fx: FxService,
    private readonly domains: DomainsService,
  ) {}

  /** The seller's setup fee: whether their market charges one, how much, and whether it is paid. */
  async status(resellerId: string) {
    const fee = await setupFeeOf(this.prisma, resellerId, this.fx);
    const amount = fee.paid ? fee.paid.amount : fee.charged ? fee.amount : 0n;
    return {
      object: 'setup_fee' as const,
      charged: fee.charged,
      due: fee.due,
      /** In `currency`'s minor units; null while Udozo's fee in US dollars cannot be converted (no exchange rate). */
      amount: amount === null ? null : Number(amount),
      currency: fee.paid?.currency ?? fee.currency,
      paid_at: fee.paidAt?.toISOString() ?? null,
    };
  }

  /**
   * Takes the fee from the live wallet if it is still due (topped-up funds, then earnings), once: the hold's reference
   * is the seller's, so a repeat or a race takes it once. `storeId`: the store whose Premium it is paid with.
   */
  async pay(resellerId: string, actorId: string | null, storeId: string | null = null) {
    const fee = await setupFeeOf(this.prisma, resellerId, this.fx);
    if (!fee.due || !fee.currency) return this.status(resellerId);
    // Udozo's fee in US dollars, converted now; without a rate it cannot be charged yet (`conversion_unavailable`).
    if (fee.amount === null) await this.fx.chargeForUsdCents(1, fee.currency);
    const reference = `setup_fee:${resellerId}`;
    const hold = await this.wallets.hold({ resellerId, mode: 'live', amount: fee.amount!, reference, description: 'Seller HQ setup fee' });
    await this.wallets.captureHold(hold.id, `Seller HQ setup fee: ${formatMoney(hold.amountMinor, fee.currency)}`);
    const claimed = await this.prisma.reseller.updateMany({
      where: { id: resellerId, setupFeePaidAt: null },
      data: { setupFeePaidAt: new Date(), setupFeeMinor: hold.amountMinor, setupFeeCurrency: hold.currency, setupFeeStoreId: storeId },
    });
    if (claimed.count > 0) {
      await this.invoices.recordPaid({ resellerId, storeId, currency: hold.currency, kind: 'subscription', description: 'Seller HQ setup fee', amount: hold.amountMinor, reference });
      await this.audit.record({ actorId, action: 'reseller.setup_fee_paid', targetType: 'reseller', targetId: resellerId, after: { amount: Number(hold.amountMinor), currency: hold.currency, store_id: storeId } });
    }
    return this.status(resellerId);
  }

  // Admins -----------------------------------------------------------------------------------------------------------

  /**
   * Udozo's fee for every market (in US dollars) and each market's, with what Premium's first month adds and whether the
   * two pay for a domain. A market without its own fee charges the one for every market, in its currency.
   */
  async list() {
    const countries = await this.prisma.country.findMany({ orderBy: { code: 'asc' } });
    const fees = new Map((await this.prisma.setupFee.findMany()).map(fee => [fee.country, fee]));
    const endings = await this.domains.endingPrices();
    const all = fees.get(everyMarket) ?? null;
    const data = [];
    for (const country of countries) data.push(await this.present(country, fees.get(country.code) ?? null, all, endings));
    return { object: 'list' as const, every_market: this.presentEveryMarket(all), data };
  }

  /**
   * Finance: switches a fee on or off and sets it, audited: a market's (`code`, in its currency) or Udozo's for every
   * market (`WW`, in US cents).
   */
  async set(actorId: string | null, code: string, input: { enabled: boolean; amount: number }) {
    const key = code.toUpperCase();
    const country = key === everyMarket ? null : await this.prisma.country.findUnique({ where: { code: key } });
    if (key !== everyMarket && !country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such market.', 'country');
    if (input.enabled && input.amount <= 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Set an amount above zero to charge a setup fee.', 'amount');
    const before = await this.prisma.setupFee.findUnique({ where: { country: key } });
    const data = { enabled: input.enabled, amountMinor: BigInt(input.amount), updatedById: actorId };
    const after = await this.prisma.setupFee.upsert({ where: { country: key }, create: { country: key, ...data }, update: data });
    await this.audit.record({
      actorId,
      action: 'setup_fee.changed',
      targetType: 'country',
      targetId: key,
      before: before ? { enabled: before.enabled, amount: Number(before.amountMinor) } : null,
      after: { enabled: after.enabled, amount: Number(after.amountMinor) },
    });
    if (!country) return this.presentEveryMarket(after);
    return this.present(country, after, await this.prisma.setupFee.findUnique({ where: { country: everyMarket } }), await this.domains.endingPrices());
  }

  /** Finance: a market goes back to charging Udozo's fee for every market. Audited. */
  async clear(actorId: string | null, code: string) {
    const key = code.toUpperCase();
    const country = key === everyMarket ? null : await this.prisma.country.findUnique({ where: { code: key } });
    if (!country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such market.', 'country');
    const before = await this.prisma.setupFee.findUnique({ where: { country: key } });
    if (before) {
      await this.prisma.setupFee.delete({ where: { country: key } });
      await this.audit.record({ actorId, action: 'setup_fee.cleared', targetType: 'country', targetId: key, before: { enabled: before.enabled, amount: Number(before.amountMinor) }, after: null });
    }
    return this.present(country, null, await this.prisma.setupFee.findUnique({ where: { country: everyMarket } }), await this.domains.endingPrices());
  }

  /** Udozo's fee for every market, in US cents. */
  private presentEveryMarket(fee: { enabled: boolean; amountMinor: bigint } | null) {
    return { object: 'setup_fee_default' as const, currency: 'USD', enabled: fee?.enabled ?? false, amount: Number(fee?.amountMinor ?? 0n) };
  }

  /**
   * A market's fee as admins see it. `warnings`: `fees_below_domain_price` when the fee and one Premium month together
   * are less than the dearest domain ending on offer, so a free domain could cost Udozo more than it collected.
   */
  private async present(country: { code: string; name: string; currency: string }, own: { enabled: boolean; amountMinor: bigint } | null, all: { enabled: boolean; amountMinor: bigint } | null, endings: Array<{ tld: string; price: number }> | null) {
    // The market's own fee, else Udozo's for every market in the market's currency (null without a rate).
    let fee: { enabled: boolean; amountMinor: bigint | null } | null = own;
    if (!own && all) {
      const amountMinor = country.currency === 'USD' ? all.amountMinor : await this.fx.chargeForUsdCents(Number(all.amountMinor), country.currency).then(result => result.amount, () => null);
      fee = { enabled: all.enabled, amountMinor };
    }
    const premium = await this.prisma.plan.findUnique({ where: { code: premiumCode } });
    const month = premium ? await this.plans.localPrice(premium, country.currency) : null;
    let dearest: bigint | null = null;
    for (const ending of endings ?? []) {
      const local = country.currency === 'USD' ? BigInt(ending.price) : await this.fx.chargeForUsdCents(ending.price, country.currency).then(result => result.amount, () => null);
      if (local !== null && (dearest === null || local > dearest)) dearest = local;
    }
    const collected = (fee?.enabled ? (fee.amountMinor ?? 0n) : 0n) + (month?.amount ?? 0n);
    const warnings = dearest !== null && collected < dearest ? ['fees_below_domain_price'] : [];
    return {
      object: 'setup_fee_setting' as const,
      country: country.code,
      name: country.name,
      currency: country.currency,
      /** `market`: its own fee; `every_market`: Udozo's fee for every market, converted; null: no fee at all. */
      source: own ? ('market' as const) : all ? ('every_market' as const) : null,
      enabled: fee?.enabled ?? false,
      /** In the market's currency; null while Udozo's fee in US dollars cannot be converted (no exchange rate). */
      amount: fee ? (fee.amountMinor === null ? null : Number(fee.amountMinor)) : 0,
      premium_month: month ? Number(month.amount) : null,
      dearest_domain: dearest === null ? null : Number(dearest),
      warnings,
    };
  }
}
