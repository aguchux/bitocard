"use server";

import { revalidatePath } from "next/cache";
import type { ShopListingAuction } from "@bitocard/api-client/classifieds";
import type { AuctionLot } from "./auctions";
import { auctionPath } from "./auctions";
import { type CustomerResult, customerApi } from "./customer";

export type AuctionResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; param: string | null; signIn: boolean };

const refPattern = /^\d{1,9}$/;
const unknown = { ok: false as const, message: "No such lot.", code: "resource_missing", param: null, signIn: false };

function answer<T>(result: CustomerResult<T>): AuctionResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in to carry on." : result.message, code: result.code, param: result.param, signIn: result.status === 401 };
}

/** Bids an amount (minor units) on a lot. */
export async function placeBid(ref: string, amount: number): Promise<AuctionResult<AuctionLot>> {
  if (!refPattern.test(ref)) return unknown;
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: "Give your bid.", code: "parameter_invalid", param: "amount", signIn: false };
  const result = answer(await customerApi<AuctionLot>("POST", `/v1/classifieds/auctions/${ref}/bids`, { amount }));
  if (result.ok) revalidatePath(auctionPath(result.data.country, ref));
  return result;
}

/** Bids an amount (minor units) on a listing sold by auction. */
export async function bidOnListing(listingId: string, amount: number): Promise<AuctionResult<ShopListingAuction>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(listingId)) return { ok: false, message: "No such listing.", code: "resource_missing", param: null, signIn: false };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: "Give your bid.", code: "parameter_invalid", param: "amount", signIn: false };
  return answer(await customerApi<ShopListingAuction>("POST", `/v1/classifieds/listings/${listingId}/bids`, { amount }));
}

/** Pays for a lot won, from the Udozo wallet. */
export async function payLot(ref: string): Promise<AuctionResult<AuctionLot>> {
  if (!refPattern.test(ref)) return unknown;
  const result = answer(await customerApi<AuctionLot>("POST", `/v1/classifieds/auctions/${ref}/pay`, {}));
  if (result.ok) revalidatePath(auctionPath(result.data.country, ref));
  return result;
}

/** The buyer's code to show at the warehouse. */
export async function lotCollectionCode(ref: string): Promise<AuctionResult<{ code: string | null; collected_at: string | null }>> {
  if (!refPattern.test(ref)) return unknown;
  return answer(await customerApi<{ code: string | null; collected_at: string | null }>("GET", `/v1/classifieds/auctions/${ref}/collection-code`));
}
