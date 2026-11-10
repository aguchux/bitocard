import "server-only";
import { shopApi } from "./api";
import type { AuctionLot } from "./auctions";
import { customerApi } from "./customer";

/** A market's lots, open and coming (cached half a minute); empty, with `ok: false`, while the API cannot answer. */
export async function auctionsOf(cc: string): Promise<{ ok: boolean; lots: AuctionLot[] }> {
  const result = await shopApi<{ data: AuctionLot[] }>(`/v1/classifieds/auctions?country=${cc.toUpperCase()}`, { revalidate: 30 });
  return result.ok ? { ok: true, lots: result.data.data } : { ok: false, lots: [] };
}

/** One lot as the visitor sees it: with their own bids and what they can do when signed in. Never cached. */
export async function auctionLot(ref: string): Promise<AuctionLot | null> {
  if (!/^\d{1,9}$/.test(ref)) return null;
  const result = await customerApi<AuctionLot>("GET", `/v1/classifieds/auctions/${ref}`);
  return result.ok ? result.data : null;
}
