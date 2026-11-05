"use server";

import type { ShopBuyOrder, ShopBuyOrderAction } from "@bitocard/api-client/classifieds";
import { customerApi } from "@/lib/customer";
import type { ActionResult } from "@/lib/listing-actions";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const refused = (message: string, param = "parameter_invalid"): ActionResult<never> => ({ ok: false, message, code: param, signIn: false });
const steps: ShopBuyOrderAction[] = ["accept", "counter", "decline", "accept_counter", "cancel", "no_show", "complete", "bought", "void", "extend"];
const largest = 1_000_000_000_000_000;

function answer(result: Awaited<ReturnType<typeof customerApi<ShopBuyOrder>>>): ActionResult<ShopBuyOrder> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message, code: result.code, signIn: result.status === 401 };
}

const note = (text: string | undefined) => (text?.trim() ? text.trim().slice(0, 300) : undefined);

/**
 * The buyer asks to buy a listing at a price (minor units, for all the units), with an optional note and where they
 * would like to meet. The form's nonce makes a double tap send one.
 */
export async function createBuyOrder(listingId: string, input: { price: number; quantity: number; note?: string; meet_note?: string }, nonce?: string): Promise<ActionResult<ShopBuyOrder>> {
  if (!uuid.test(listingId)) return refused("No such listing.");
  if (!Number.isSafeInteger(input.price) || input.price <= 0 || input.price > largest) return refused("Give a price above zero.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) return refused("Choose how many.");
  const body = { price: input.price, quantity: input.quantity, note: note(input.note), meet_note: note(input.meet_note) };
  return answer(await customerApi<ShopBuyOrder>("POST", `/v1/classifieds/listings/${listingId}/buy-orders`, body, { idempotencyKey: nonce }));
}

/** A step on a buy order: the seller's accept, counter (a price), decline; the buyer's answer; either side's cancel. */
export async function buyOrderStep(id: string, action: ShopBuyOrderAction, input: { price?: number; reason?: string } = {}): Promise<ActionResult<ShopBuyOrder>> {
  if (!uuid.test(id) || !steps.includes(action)) return refused("No such buy order.");
  if (action === "counter" && (!input.price || !Number.isSafeInteger(input.price) || input.price <= 0 || input.price > largest)) return refused("Give a price above zero.");
  const body = { ...(input.price ? { price: input.price } : {}), ...(note(input.reason) ? { reason: note(input.reason) } : {}) };
  return answer(await customerApi<ShopBuyOrder>("POST", `/v1/classifieds/buy-orders/${id}/${action.replace(/_/g, "-")}`, body));
}

/** A seller's accepted buy orders for one of their listings: Mark sold asks which of them bought it. */
export async function acceptedBuyOrders(listingId: string): Promise<ShopBuyOrder[]> {
  if (!uuid.test(listingId)) return [];
  const result = await customerApi<{ data: ShopBuyOrder[] }>("GET", `/v1/classifieds/me/listings/${listingId}/buy-orders`);
  return result.ok ? result.data.data : [];
}
