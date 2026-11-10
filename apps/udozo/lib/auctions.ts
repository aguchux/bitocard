// Udozo auctions on udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 7b): the API's lot as anyone sees it, and the words
// and sums its pages use. Safe in client components; the pages read lots with `lib/auction-reads.ts`.

export type AuctionStatus = "scheduled" | "live" | "awaiting_payment" | "sold" | "unsold" | "cancelled";
export type AuctionLot = {
  object: "connect_auction";
  id: string;
  number: string;
  ref: string;
  status: AuctionStatus;
  country: string;
  currency: string;
  title: string;
  description: string;
  photos: string[];
  warehouse: { name: string; state: string };
  start_price: number;
  current_price: number | null;
  next_bid: number | null;
  bids: number;
  starts_at: string;
  ends_at: string;
  rules: { step_pct: number; step_min: number; extend_minutes: number; pay_hours: number };
  recent_bids: Array<{ name: string; amount: number; at: string }>;
  viewer?: { highest: number | null; leading: boolean; to_pay: { amount: number; pay_by: string | null } | null; won: boolean; seller: boolean };
};

export const auctionPath = (cc: string, ref?: string) => `/${cc.toLowerCase()}/auctions${ref ? `/${ref}` : ""}`;

export const auctionStatusWords: Record<AuctionStatus, string> = {
  scheduled: "Bidding opens soon",
  live: "Bidding open",
  awaiting_payment: "Bidding closed",
  sold: "Sold",
  unsold: "Not sold",
  cancelled: "Withdrawn",
};

/** How long until a time, in words: "2 days", "3 hours", "12 minutes", or "now". */
export function timeLeft(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

/** What the viewer can do with the lot now, in one sentence. */
export function lotNext(lot: AuctionLot) {
  const viewer = lot.viewer;
  if (viewer?.won) return "You bought it. Show your collection code at the warehouse to collect it.";
  if (viewer?.to_pay) return "You won it. Pay from your Udozo wallet before your time runs out, or it goes to the next bidder.";
  if (viewer?.seller) return "This is your item: you cannot bid on it. Until the first bid, you can still collect it at the warehouse after paying what is owed.";
  if (lot.status === "live") return viewer?.leading ? "You are the highest bidder." : viewer?.highest ? "You were outbid." : null;
  if (lot.status === "scheduled") return "Bidding has not opened yet.";
  return null;
}

/** What a card shows of a listing at auction: the price to beat, and a line of bids and time left (null: not at auction). */
export function auctionCard(card: { sale_method?: string; price: { amount: number | null }; auction?: { status: string; current_price: number | null; bids: number; ends_at: string } | null }, now = Date.now()) {
  if (card.sale_method !== "auction" || !card.auction) return null;
  const lot = card.auction;
  const bids = `${lot.bids} ${lot.bids === 1 ? "bid" : "bids"}`;
  const line = lot.status === "live" ? `Auction · ${bids} · ends in ${timeLeft(lot.ends_at, now)}` : lot.status === "awaiting_payment" || lot.status === "sold" ? "Auction ended" : "Auction";
  return { amount: lot.current_price ?? card.price.amount, line };
}
