// Auctions on udozo.com (docs/UDOZO_AUCTIONS_PLAN.md): every lot, a seller's or Udozo's own, is an auction listing, so
// these are only the words and sums the listing pages and cards use. Safe in client components.

export const auctionPath = (cc: string) => `/${cc.toLowerCase()}/auctions`;

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

/** What a card shows of a listing at auction: the price to beat, and a line of bids and time left (null: not at auction). */
export function auctionCard(card: { sale_method?: string; price: { amount: number | null }; auction?: { status: string; current_price: number | null; bids: number; ends_at: string } | null }, now = Date.now()) {
  if (card.sale_method !== "auction" || !card.auction) return null;
  const lot = card.auction;
  const bids = `${lot.bids} ${lot.bids === 1 ? "bid" : "bids"}`;
  const line = lot.status === "live" ? `Auction · ${bids} · ends in ${timeLeft(lot.ends_at, now)}` : lot.status === "awaiting_payment" || lot.status === "sold" ? "Auction ended" : "Auction";
  return { amount: lot.current_price ?? card.price.amount, line };
}
