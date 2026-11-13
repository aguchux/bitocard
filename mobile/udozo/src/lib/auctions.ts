/**
 * Auctions in the app: where a lot stands and what it says to its reader, and whether a bid can be sent, as udozo.com's
 * listing page has them (apps/udozo/components/listing-auction.tsx, lib/auctions.ts). Kept free of React Native so they
 * run under `node --test`; the API checks every bid again.
 */
import type { ShopListingAuction } from '../shared/classifieds';

import { money } from './format.ts';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** How long until a time, in words: "2 days", "3 hours", "12 minutes", or "now". */
export function timeLeft(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${Math.floor(hours / 24)} days`;
}

/** Where the auction stands, in words: open with time left, waiting for the winner, sold or not sold. */
export function auctionState(auction: Pick<ShopListingAuction, 'status' | 'starts_at' | 'ends_at'>, now = Date.now()) {
  if (auction.status === 'scheduled') return `Bidding opens ${when(auction.starts_at)}`;
  if (auction.status === 'live') return `Ends in ${timeLeft(auction.ends_at, now)} (${when(auction.ends_at)})`;
  if (auction.status === 'awaiting_payment') return 'Bidding has ended: the winner is paying.';
  if (auction.status === 'sold') return 'Sold at auction.';
  if (auction.status === 'unsold') return 'The auction ended without a sale.';
  return 'This auction was withdrawn.';
}

/** What the reader's place in the auction is, in one sentence (null: nothing to say). */
export function auctionNote(auction: Pick<ShopListingAuction, 'status' | 'kind' | 'viewer'>, currency: string) {
  const viewer = auction.viewer;
  if (viewer?.seller) return auction.status === 'live' ? 'Your listing is at auction: it sells to the highest bid at or above your reserve.' : null;
  const udozos = auction.kind === 'abandoned';
  if (viewer?.won && udozos && viewer.transfer && viewer.transfer.status !== 'collected') return 'You bought it at auction. Collect it at the Connect Centre you chose with your collection code.';
  if (viewer?.won) return udozos ? 'You bought it at auction. Show your collection code at the warehouse to collect it.' : 'You bought it at auction.';
  if (viewer?.to_pay) {
    const by = viewer.to_pay.pay_by ? ` by ${when(viewer.to_pay.pay_by)}` : '';
    return `You won it at ${money(viewer.to_pay.amount, currency)}. Pay ${udozos ? 'from your Udozo wallet' : 'with UdozoPay'}${by}, or it goes to the next bidder.`;
  }
  if (auction.status === 'live' && viewer?.leading) return 'You are the highest bidder.';
  if (auction.status === 'live' && viewer?.highest) return 'You were outbid.';
  return null;
}

/** Why a bid typed (in minor units, or null when unreadable) cannot be sent; null when it can. */
export function bidProblem(minor: number | null, nextBid: number | null, currency: string) {
  if (minor === null) return 'Give your bid as an amount.';
  if (nextBid !== null && minor < nextBid) return `Bid at least ${money(nextBid, currency)}.`;
  return null;
}

/** The API's refusals of a bid, in words the bidder can act on (else its own message). */
export function bidRefusal(code: string, message: string) {
  if (code === 'bid_too_low') return `${message} Someone may have bid since: try the new amount.`;
  if (code === 'auction_not_live') return 'Bidding is not open on this auction now.';
  if (code === 'phone_required') return 'Confirm your mobile number to bid.';
  if (code === 'own_item') return 'You cannot bid on your own listing.';
  return message;
}
