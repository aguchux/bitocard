import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Udozo's purchases (docs/UDOZO_RATINGS_PLAN.md phase 1): every completed sale, UdozoPay or buy order, is a row giving
 * its buyer one review of the seller, and the right to join the conversation on reviews of the same product from the
 * same seller. Pure helpers, used inside the transactions that complete a sale.
 */

const dayMs = 86_400_000;
/** The market's review window when it sets none. */
export const defaultReviewWindowDays = 30;

/** Letters and digits only, lower case: the same as the migration's backfill (`lower(regexp_replace(…))`). */
export const keyPart = (text: string) => text.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/**
 * What "the same product" means: the same brand and model (as the registry writes them, so sellers' ads agree), else
 * the same listing.
 */
export function productKeyOf(listing: { id: string; title: string | null }, brand: string | null | undefined, model: string | null | undefined) {
  const [b, m] = [brand?.trim() ?? '', model?.trim() ?? ''];
  if (b && m && keyPart(b) && keyPart(m)) return { key: `bm:${keyPart(b)}:${keyPart(m)}`, label: `${b} ${m}`.slice(0, 120) };
  return { key: `l:${listing.id}`, label: (listing.title ?? 'A listing').slice(0, 120) };
}

type Tx = Prisma.TransactionClient;

/**
 * Records a completed purchase, once (a second call for the same order or buy order changes nothing). Called in the
 * transaction that completes the sale.
 */
export async function recordPurchase(
  tx: Tx,
  input: { source: 'safe_pay' | 'buy_order'; orderId?: string; buyOrderId?: string; listingId: string; sellerId: string; buyerId: string; country: string; completedAt: Date },
) {
  if (input.buyerId === input.sellerId) return;
  const [listing, features, settings] = await Promise.all([
    tx.classifiedListing.findUnique({ where: { id: input.listingId }, select: { id: true, title: true } }),
    tx.classifiedListingFeature.findMany({ where: { listingId: input.listingId, feature: { key: { in: ['brand', 'model'] } } }, select: { valueText: true, feature: { select: { key: true } } } }),
    tx.classifiedMarketSettings.findUnique({ where: { country: input.country }, select: { reviewWindowDays: true } }),
  ]);
  if (!listing) return;
  const value = (key: string) => features.find(row => row.feature.key === key)?.valueText ?? null;
  const product = productKeyOf(listing, value('brand'), value('model'));
  const days = settings?.reviewWindowDays ?? defaultReviewWindowDays;
  await tx.classifiedPurchase.createMany({
    data: [
      {
        source: input.source,
        orderId: input.orderId ?? null,
        buyOrderId: input.buyOrderId ?? null,
        listingId: input.listingId,
        sellerId: input.sellerId,
        buyerId: input.buyerId,
        country: input.country,
        productKey: product.key,
        productLabel: product.label,
        completedAt: input.completedAt,
        reviewClosesAt: new Date(input.completedAt.getTime() + days * dayMs),
      },
    ],
    skipDuplicates: true,
  });
}
