"use server";

import type { ShopListingAuction, ShopLotShipOptions } from "@bitocard/api-client/classifieds";
import { type CustomerResult, customerApi } from "./customer";

export type AuctionResult<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null; param: string | null; signIn: boolean };

const refPattern = /^\d{1,9}$/;
const unknown = { ok: false as const, message: "No such lot.", code: "resource_missing", param: null, signIn: false };

function answer<T>(result: CustomerResult<T>): AuctionResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in to carry on." : result.message, code: result.code, param: result.param, signIn: result.status === 401 };
}

/** Bids an amount (minor units) on a listing sold by auction. */
export async function bidOnListing(listingId: string, amount: number): Promise<AuctionResult<ShopListingAuction>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(listingId)) return { ok: false, message: "No such listing.", code: "resource_missing", param: null, signIn: false };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: "Give your bid.", code: "parameter_invalid", param: "amount", signIn: false };
  return answer(await customerApi<ShopListingAuction>("POST", `/v1/classifieds/listings/${listingId}/bids`, { amount }));
}

/** Pays for a lot of Udozo's won, from the Udozo wallet (the page refreshes itself after). */
export async function payLot(ref: string): Promise<AuctionResult<{ status: string }>> {
  if (!refPattern.test(ref)) return unknown;
  return answer(await customerApi<{ status: string }>("POST", `/v1/classifieds/auctions/${ref}/pay`, {}));
}

/** The buyer's code to show at the warehouse. */
export async function lotCollectionCode(ref: string): Promise<AuctionResult<{ code: string | null; collected_at: string | null }>> {
  if (!refPattern.test(ref)) return unknown;
  return answer(await customerApi<{ code: string | null; collected_at: string | null }>("GET", `/v1/classifieds/auctions/${ref}/collection-code`));
}

/** What sending a won lot to a Connect Centre costs, and the centres it can go to. */
export async function lotShipOptions(ref: string): Promise<AuctionResult<ShopLotShipOptions>> {
  if (!refPattern.test(ref)) return unknown;
  return answer(await customerApi<ShopLotShipOptions>("GET", `/v1/classifieds/auctions/${ref}/ship-options`));
}

/** The buyer pays the shipping and the Connect fee, and Udozo sends the lot from its warehouse to the centre they chose. */
export async function shipLot(ref: string, centreId: string, expectedTotal: number): Promise<AuctionResult<{ number: string; status: string }>> {
  if (!refPattern.test(ref)) return unknown;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(centreId) || !Number.isSafeInteger(expectedTotal) || expectedTotal < 0) {
    return { ok: false, message: "Choose a Connect Centre.", code: "parameter_invalid", param: "centre_id", signIn: false };
  }
  return answer(await customerApi<{ number: string; status: string }>("POST", `/v1/classifieds/auctions/${ref}/ship`, { centre_id: centreId, expected_total: expectedTotal }));
}

/** The buyer stops the move before Udozo sends it: their money back, collected at the warehouse again. */
export async function cancelLotShip(ref: string): Promise<AuctionResult<{ status: string }>> {
  if (!refPattern.test(ref)) return unknown;
  return answer(await customerApi<{ status: string }>("POST", `/v1/classifieds/auctions/${ref}/ship/cancel`, {}));
}
