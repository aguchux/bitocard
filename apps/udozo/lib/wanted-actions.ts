"use server";

import { revalidatePath } from "next/cache";
import { customerApi } from "@/lib/customer";
import { uuidPattern, toMinor } from "@/lib/shop";
import { conditionsFor, type WantedCreated, wantedErrorText, type WantedRequest, wantedScreen } from "@/lib/wanted";

/**
 * Wanted requests for the signed-in customer: posting one (what they need, its category and place, a budget and
 * condition), closing it, and a seller answering one with their listing. They call the API with the customer's session.
 */

export type WantedState = { ok: true; data: WantedCreated } | { ok: false; message: string; param?: string | null } | null;

export async function postWanted(_previous: WantedState, form: FormData): Promise<WantedState> {
  const words = String(form.get("words") ?? "").trim();
  const category = String(form.get("category_id") ?? "");
  const area = String(form.get("area_id") ?? "");
  const state = String(form.get("state_id") ?? "");
  const budget = String(form.get("budget_max") ?? "").trim();
  const details = String(form.get("details") ?? "").trim();
  if (words.length < 3) return { ok: false, message: "Say what you are looking for in a few words.", param: "words" };
  if (!uuidPattern.test(category)) return { ok: false, message: "Choose a category.", param: "category_id" };
  const budgetMax = budget ? toMinor(budget) : null;
  if (budget && budgetMax === null) return { ok: false, message: "Type the budget as a number, for example 450000.", param: "budget_max" };
  const result = await customerApi<WantedCreated>("POST", "/v1/classifieds/wanted", {
    words: words.slice(0, 80),
    category_id: category,
    ...(uuidPattern.test(area) ? { area_id: area } : uuidPattern.test(state) ? { state_id: state } : {}),
    ...(budgetMax ? { budget_max: budgetMax } : {}),
    ...(details ? { details: details.slice(0, 300) } : {}),
    conditions: conditionsFor(String(form.get("condition") ?? "any")),
  });
  if (!result.ok) return { ok: false, message: wantedErrorText(result), param: result.param };
  revalidatePath(wantedScreen);
  return { ok: true, data: result.data };
}

export async function closeWanted(id: string, fulfilled: boolean): Promise<{ ok: true; data: WantedRequest } | { ok: false; message: string }> {
  if (!uuidPattern.test(id)) return { ok: false, message: "No such request." };
  const result = await customerApi<WantedRequest>("POST", `/v1/classifieds/wanted/${id}/close`, { fulfilled: Boolean(fulfilled) });
  if (!result.ok) return { ok: false, message: wantedErrorText(result) };
  revalidatePath(wantedScreen, "layout");
  return { ok: true, data: result.data };
}

export async function answerWanted(id: string, listingId: string, note: string): Promise<{ ok: true; conversationId: string } | { ok: false; message: string }> {
  if (!uuidPattern.test(id) || !uuidPattern.test(listingId)) return { ok: false, message: "Choose one of your listings." };
  const result = await customerApi<{ conversation_id: string }>("POST", `/v1/classifieds/wanted/${id}/respond`, { listing_id: listingId, ...(note.trim() ? { note: note.trim().slice(0, 300) } : {}) });
  if (!result.ok) return { ok: false, message: wantedErrorText(result) };
  revalidatePath(wantedScreen, "layout");
  return { ok: true, conversationId: result.data.conversation_id };
}
