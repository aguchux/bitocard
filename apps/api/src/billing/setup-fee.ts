import type { PrismaService } from '../database/prisma.service.js';

/**
 * A seller's one-time Seller HQ setup fee on Udozo (docs/UDOZO_SPINOFF_PLAN.md, step 3): what their market charges (its
 * `setup_fees` row, in the market's currency), and whether it is still due. A fee switched off, or set to nothing, is
 * never due; one already paid stays paid whatever the market changes later.
 */
export async function setupFeeOf(prisma: PrismaService, resellerId: string) {
  const reseller = await prisma.reseller.findUniqueOrThrow({
    where: { id: resellerId },
    select: { country: true, house: true, setupFeePaidAt: true, setupFeeMinor: true, setupFeeCurrency: true, countryRef: { select: { currency: true } } },
  });
  const fee = reseller.country ? await prisma.setupFee.findUnique({ where: { country: reseller.country } }) : null;
  const charged = Boolean(fee?.enabled && fee.amountMinor > 0n && !reseller.house);
  return {
    country: reseller.country,
    currency: reseller.countryRef?.currency ?? null,
    amount: fee?.amountMinor ?? 0n,
    charged,
    paidAt: reseller.setupFeePaidAt,
    paid: reseller.setupFeePaidAt ? { amount: reseller.setupFeeMinor ?? 0n, currency: reseller.setupFeeCurrency } : null,
    due: charged && !reseller.setupFeePaidAt,
  };
}
