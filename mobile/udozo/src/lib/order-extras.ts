/**
 * An order's extras in the app, in udozo.com's words (apps/udozo/components/account/connect-return.tsx, order-detail.tsx):
 * a Connect item's return to its seller and where it is, a return sent on to a centre near the seller, the claim to
 * what a Udozo auction left over, and a resale order's money for its supplier. Kept free of React Native so they run
 * under `node --test`; the API checks every step again.
 */
import type { ShopConnectAuction, ShopConnectReturn, ShopOrder, ShopReturnTransfer } from '../shared/classifieds';

/** Money as `shopMoney` writes it (the shared file is not loaded under `node --test`). */
function money(minor: number, currency: string) {
  const value = minor / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
  }
}

export const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const returnReasons: Record<ShopConnectReturn['reason'], string> = {
  not_collected: 'the buyer did not collect it in time',
  refused_at_check_in: 'it was refused at check-in',
  refused_at_counter: 'the buyer refused it at the counter',
  damaged: 'it was damaged',
};

/** The return's heading: its number and where it stands. */
export function returnTitle(item: Pick<ShopConnectReturn, 'number' | 'status' | 'place'>) {
  const state = item.status === 'collected' ? 'collected by the seller' : item.place === 'auctioned' ? 'ended at auction' : item.status === 'accepted' ? 'accepted' : item.status === 'cancelled' ? 'ended' : 'asked for';
  return `Return ${item.number}: ${state}`;
}

/** Where an abandoned item is, and where its seller collects it. */
export function placeWords(item: Pick<ShopConnectReturn, 'place' | 'warehouse'>, centreName: string) {
  if (item.place === 'auctioned') return 'Abandoned and sold at a Udozo auction to pay the storage owed.';
  if (item.place === 'udozo_warehouse' && item.warehouse) return `Abandoned: it is at ${item.warehouse.name}, ${item.warehouse.address}, ${item.warehouse.state} (${item.warehouse.hours}, ${item.warehouse.phone}). Collect it there after paying what is owed, before Udozo auctions it.`;
  if (item.place === 'in_transit') return 'Abandoned: Udozo has collected it and is taking it to its warehouse.';
  return `Abandoned: it waits at ${centreName} for Udozo's pickup to its warehouse. You can still collect it there after paying what is owed.`;
}

/** Where a return sent on to a centre near its seller stands, in one sentence. */
export function transferWords(move: ShopReturnTransfer, holding: string) {
  const to = `${move.to.name}, ${move.to.address}, ${move.to.state}`;
  if (move.status === 'paid') return `Waiting for ${holding} to send it to ${to}. Your days to collect start again when it arrives.`;
  if (move.status === 'sent') return `On its way to ${to}${move.courier ? ` with ${move.courier}${move.tracking_number ? ` (tracking ${move.tracking_number})` : ''}` : ''}.`;
  if (move.status === 'arrived') return `It is at ${to} (${move.to.hours}, ${move.to.phone}). Collect it there with your return code.`;
  return `Collected at ${move.to.name}.`;
}

/** Whether the seller can still have it sent on: accepted, at a centre, not moving, and within its free days. */
export const canShip = (item: ShopConnectReturn, now = Date.now()) =>
  item.status === 'accepted' &&
  !item.abandoned_at &&
  (!item.place || item.place === 'centre') &&
  !(item.transfer && item.transfer.status !== 'collected') &&
  Boolean(item.collect_by) &&
  new Date(item.collect_by as string).getTime() > now;

/** Where the seller's claim to what an auction left over stands, in one sentence. */
export function claimWords(auction: ShopConnectAuction, currency: string, now = Date.now()) {
  const left = auction.left_over ?? 0;
  const amount = money(left, currency);
  if (auction.claim?.status === 'paid') return `Your claim ${auction.claim.number} was paid: ${money(auction.claim.amount, currency)} is in your Udozo money.`;
  if (auction.claim?.status === 'requested') return `Your claim ${auction.claim.number} for ${amount} is with Udozo.`;
  if (auction.unclaimed_at) return `${amount} was left over, but it was not claimed in time, so it is now Udozo's.`;
  if (left <= 0) return 'Its sale paid what it could of the storage owed. Nothing is left over.';
  const open = !auction.claim_by || new Date(auction.claim_by).getTime() > now;
  if (!open) return `The days to claim the ${amount} left over have passed.`;
  const rejected = auction.claim?.status === 'rejected' ? `Your claim was not paid${auction.claim.decision_note ? `: ${auction.claim.decision_note}` : '.'} ` : '';
  return `${rejected}${amount} is left over for you after the storage owed. Claim it${auction.claim_by ? ` by ${when(auction.claim_by)}` : ''}, or it becomes Udozo's.`;
}

/** Can the seller claim now: something left over, not claimed or paid, and within the days. */
export const canClaim = (auction: ShopConnectAuction, now = Date.now()) =>
  (auction.left_over ?? 0) > 0 &&
  !auction.unclaimed_at &&
  auction.claim?.status !== 'requested' &&
  auction.claim?.status !== 'paid' &&
  (!auction.claim_by || new Date(auction.claim_by).getTime() > now);

/** A seller's money lines: their price (a resale order's supplier price and the reseller's discount), the fee, the payout. */
export function sellerLines(order: Pick<ShopOrder, 'price' | 'quantity' | 'resale' | 'delivery_fee' | 'seller_fee' | 'payout' | 'status'>, feeLabel: string) {
  const settled = order.status === 'released' || order.status === 'partly_refunded';
  const lines: { label: string; amount: number; strong?: boolean }[] = [{ label: order.resale ? (order.quantity > 1 ? `Your price × ${order.quantity}` : 'Your price') : 'Item price', amount: order.price }];
  if (order.resale) lines.push({ label: 'Reseller’s discount', amount: -(order.resale.supplier_price - order.resale.supplier_net) });
  if (order.delivery_fee) lines.push({ label: 'Delivery charge (yours)', amount: order.delivery_fee });
  lines.push({ label: feeLabel, amount: -(order.seller_fee ?? 0) }, { label: settled ? 'Paid to you' : 'You receive', amount: order.payout ?? 0, strong: true });
  return lines;
}
