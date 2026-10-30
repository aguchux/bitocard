import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainsService } from '../domains/domains.service.js';
import { FxService } from '../fx/fx.service.js';
import { InvoicesService } from './invoices.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { PlansService } from '../plans/plans.service.js';
import { setupFeeOf } from './setup-fee.js';
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
    const fee = await setupFeeOf(this.prisma, resellerId);
    return {
      object: 'setup_fee' as const,
      charged: fee.charged,
      due: fee.due,
      amount: fee.charged || fee.paid ? Number(fee.paid?.amount ?? fee.amount) : 0,
      currency: fee.paid?.currency ?? fee.currency,
      paid_at: fee.paidAt?.toISOString() ?? null,
    };
  }

  /**
   * Takes the fee from the live wallet if it is still due (topped-up funds, then earnings), once: the hold's reference
   * is the seller's, so a repeat or a race takes it once. `storeId`: the store whose Premium it is paid with.
   */
  async pay(resellerId: string, actorId: string | null, storeId: string | null = null) {
    const fee = await setupFeeOf(this.prisma, resellerId);
    if (!fee.due || !fee.currency) return this.status(resellerId);
    const reference = `setup_fee:${resellerId}`;
    const hold = await this.wallets.hold({ resellerId, mode: 'live', amount: fee.amount, reference, description: 'Seller HQ setup fee' });
    await this.wallets.captureHold(hold.id, `Seller HQ setup fee: ${formatMoney(fee.amount, fee.currency)}`);
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

  /** Every market's setup fee, with what Premium's first month adds and whether the two pay for a domain. */
  async list() {
    const countries = await this.prisma.country.findMany({ orderBy: { code: 'asc' } });
    const fees = new Map((await this.prisma.setupFee.findMany()).map(fee => [fee.country, fee]));
    const endings = await this.domains.endingPrices();
    const data = [];
    for (const country of countries) data.push(await this.present(country, fees.get(country.code) ?? null, endings));
    return { object: 'list' as const, data };
  }

  /** Finance: switches a market's fee on or off and sets it, in the market's currency. Audited. */
  async set(actorId: string | null, code: string, input: { enabled: boolean; amount: number }) {
    const country = await this.prisma.country.findUnique({ where: { code: code.toUpperCase() } });
    if (!country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such market.', 'country');
    if (input.enabled && input.amount <= 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Set an amount above zero to charge a setup fee.', 'amount');
    const before = await this.prisma.setupFee.findUnique({ where: { country: country.code } });
    const data = { enabled: input.enabled, amountMinor: BigInt(input.amount), updatedById: actorId };
    const after = await this.prisma.setupFee.upsert({ where: { country: country.code }, create: { country: country.code, ...data }, update: data });
    await this.audit.record({
      actorId,
      action: 'setup_fee.changed',
      targetType: 'country',
      targetId: country.code,
      before: before ? { enabled: before.enabled, amount: Number(before.amountMinor) } : null,
      after: { enabled: after.enabled, amount: Number(after.amountMinor) },
    });
    return this.present(country, after, await this.domains.endingPrices());
  }

  /**
   * A market's fee as admins see it. `warnings`: `fees_below_domain_price` when the fee and one Premium month together
   * are less than the dearest domain ending on offer, so a free domain could cost Udozo more than it collected.
   */
  private async present(country: { code: string; name: string; currency: string }, fee: { enabled: boolean; amountMinor: bigint } | null, endings: Array<{ tld: string; price: number }> | null) {
    const premium = await this.prisma.plan.findUnique({ where: { code: premiumCode } });
    const month = premium ? await this.plans.localPrice(premium, country.currency) : null;
    let dearest: bigint | null = null;
    for (const ending of endings ?? []) {
      const local = country.currency === 'USD' ? BigInt(ending.price) : await this.fx.chargeForUsdCents(ending.price, country.currency).then(result => result.amount, () => null);
      if (local !== null && (dearest === null || local > dearest)) dearest = local;
    }
    const collected = (fee?.enabled ? fee.amountMinor : 0n) + (month?.amount ?? 0n);
    const warnings = dearest !== null && collected < dearest ? ['fees_below_domain_price'] : [];
    return {
      object: 'setup_fee_setting' as const,
      country: country.code,
      name: country.name,
      currency: country.currency,
      enabled: fee?.enabled ?? false,
      amount: Number(fee?.amountMinor ?? 0n),
      premium_month: month ? Number(month.amount) : null,
      dearest_domain: dearest === null ? null : Number(dearest),
      warnings,
    };
  }
}
