import type { PrismaService } from '../database/prisma.service.js';
import { paidPlansOn } from '../plans/plan-access.js';
import type { FxService } from '../fx/fx.service.js';

/** The `setup_fees` row for every market: its amount is in US cents, charged in each market's currency at the `pay` rate. */
export const everyMarket = 'WW';

/**
 * A seller's one-time Seller HQ setup fee on Udozo (docs/UDOZO_SPINOFF_PLAN.md, step 3): their market's own
 * `setup_fees` row (in the market's currency) when it has one, else the row for every market (`WW`, in US dollars,
 * converted at FxService's `pay` rate when `fx` is given), and whether it is still due. A fee switched off, or set to
 * nothing, is never due, and so is every fee while Udozo's paid plans are off (`paid_plans`); one already paid stays
 * paid whatever changes later. `amount` is null when the dollar amount
 * cannot be converted now (no exchange rate) or `fx` was not given.
 */
export async function setupFeeOf(prisma: PrismaService, resellerId: string, fx?: FxService) {
  const reseller = await prisma.reseller.findUniqueOrThrow({
    where: { id: resellerId },
    select: { country: true, house: true, setupFeePaidAt: true, setupFeeMinor: true, setupFeeCurrency: true, countryRef: { select: { currency: true } } },
  });
  const rows = reseller.country ? await prisma.setupFee.findMany({ where: { country: { in: [reseller.country, everyMarket] } } }) : [];
  const fee = rows.find(row => row.country === reseller.country) ?? rows.find(row => row.country === everyMarket) ?? null;
  const currency = reseller.countryRef?.currency ?? null;
  const charged = Boolean(fee?.enabled && fee.amountMinor > 0n && !reseller.house) && (await paidPlansOn(prisma, 'udozo'));
  const inDollars = fee?.country === everyMarket;
  let amount: bigint | null = fee ? (inDollars ? null : fee.amountMinor) : 0n;
  if (fee && inDollars && currency) {
    if (currency === 'USD') amount = fee.amountMinor;
    else if (fx) amount = await fx.chargeForUsdCents(Number(fee.amountMinor), currency).then(
      result => result.amount,
      () => null,
    );
  }
  return {
    country: reseller.country,
    currency,
    amount,
    /** `market`: the market's own fee; `every_market`: Udozo's fee for every market, set in US dollars. */
    source: fee ? (inDollars ? ('every_market' as const) : ('market' as const)) : null,
    charged,
    paidAt: reseller.setupFeePaidAt,
    paid: reseller.setupFeePaidAt ? { amount: reseller.setupFeeMinor ?? 0n, currency: reseller.setupFeeCurrency } : null,
    due: charged && !reseller.setupFeePaidAt,
  };
}
