/**
 * Udozo buy orders as each side reads them (docs/UDOZO_RATINGS_PLAN.md phase 0): pure functions, shared by the service,
 * the chats (each step's card carries the order as it stands) and the tests.
 */

export const buyOrderStatuses = ['requested', 'countered', 'accepted', 'completed', 'declined', 'cancelled', 'lapsed', 'expired', 'no_show', 'voided'] as const;
export type BuyOrderStatus = (typeof buyOrderStatuses)[number];
/** Statuses still in play (one per buyer and listing, a partial unique index). */
export const openBuyOrderStatuses: BuyOrderStatus[] = ['requested', 'countered', 'accepted'];
export const buyOrderActions = ['accept', 'counter', 'decline', 'accept_counter', 'cancel', 'no_show', 'complete', 'bought', 'void', 'confirm', 'extend'] as const;
export type BuyOrderAction = (typeof buyOrderActions)[number];
export type BuyOrderSide = 'buyer' | 'seller';

const dayMs = 86_400_000;
/** The buyer may say they did not buy it for this long after the seller marked it sold. */
export const voidWindowMs = 7 * dayMs;
/** The buyer said they bought it: with no word from the seller it completes by itself after this. */
export const autoCompleteMs = 3 * dayMs;
/** Voids in this window... */
export const voidWindowCountMs = 90 * dayMs;
/** ...this many pause the seller's buy orders... */
export const voidsBeforePause = 3;
/** ...for this long. */
export const voidPauseMs = 30 * dayMs;
/** Buy orders are kept this long after they end (the privacy notice's retention). */
export const keepBuyOrdersMs = 2 * 365 * dayMs;
/** A note or meeting note is at most this long. */
export const maxBuyNote = 300;

export type BuyOrderRow = {
  id: string;
  number: bigint;
  buyerId: string;
  sellerId: string;
  status: string;
  priceMinor: bigint;
  counterMinor: bigint | null;
  currency: string;
  quantity: number;
  meetExtended: boolean;
  boughtAt: Date | null;
  completedAt: Date | null;
  completedBy: string | null;
  /** The buyer said yes, they bought it (or reviewed it): no longer to confirm. */
  buyerConfirmedAt?: Date | null;
};

export const buyOrderNumber = (number: bigint | number) => `BO-${String(number).padStart(6, '0')}`;

export function sideOf(row: { buyerId: string; sellerId: string }, customerId: string | null): BuyOrderSide | null {
  return row.buyerId === customerId ? 'buyer' : row.sellerId === customerId ? 'seller' : null;
}

/** The buyer may still say they did not buy it (a sale the seller marked, within 7 days). */
export function voidUntil(row: Pick<BuyOrderRow, 'status' | 'completedAt' | 'completedBy'>) {
  if (row.status !== 'completed' || row.completedBy !== 'seller' || !row.completedAt) return null;
  return new Date(row.completedAt.getTime() + voidWindowMs);
}

/** What one side can do with the order now. */
export function actionsFor(row: BuyOrderRow, side: BuyOrderSide, now = new Date()): BuyOrderAction[] {
  switch (row.status) {
    case 'requested':
      return side === 'seller' ? ['accept', 'counter', 'decline'] : ['cancel'];
    case 'countered':
      return side === 'buyer' ? ['accept_counter', 'cancel'] : ['cancel'];
    case 'accepted': {
      if (side === 'seller') return ['complete', ...(row.meetExtended ? [] : (['extend'] as const)), 'no_show', 'cancel'];
      return [...(row.boughtAt ? [] : (['bought'] as const)), 'no_show', 'cancel'];
    }
    case 'completed': {
      const until = voidUntil(row);
      return side === 'buyer' && until && until > now ? (row.buyerConfirmedAt ? ['void'] : ['confirm', 'void']) : [];
    }
    default:
      return [];
  }
}

export function summary(row: BuyOrderRow, viewerId: string | null, now = new Date()) {
  const side = sideOf(row, viewerId);
  if (!side) return null;
  return {
    object: 'classified_buy_order' as const,
    id: row.id,
    number: buyOrderNumber(row.number),
    status: row.status as BuyOrderStatus,
    role: side,
    price: Number(row.priceMinor),
    counter: row.status === 'countered' && row.counterMinor !== null ? Number(row.counterMinor) : null,
    currency: row.currency,
    quantity: row.quantity,
    actions: actionsFor(row, side, now),
  };
}
