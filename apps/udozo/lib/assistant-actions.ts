"use server";

import type { ShopAssistantMessage, ShopAssistantProfile, ShopAssistantSurface, ShopAssistantThread } from "@bitocard/api-client/classifieds";
import type { ActionResult } from "@/lib/listing-actions";
import { assistantApi, keepVisitor } from "./assistant";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const language = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const refused = (message: string): ActionResult<never> => ({ ok: false, message, code: "parameter_invalid", signIn: false });

function answer<T>(result: Awaited<ReturnType<typeof assistantApi<T>>>): ActionResult<T> {
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.message, code: result.code, signIn: result.status === 401 };
}

/** The assistant for a country in another language (the panel's language menu). */
export async function assistantIn(country: string, lang: string): Promise<ActionResult<ShopAssistantProfile>> {
  if (!/^[a-z]{2}$/i.test(country) || !language.test(lang)) return refused("Choose a language.");
  return answer(await assistantApi<ShopAssistantProfile>("GET", `/v1/classifieds/assistant?country=${country.toUpperCase()}&language=${lang}`));
}

/** Starts a conversation (a visitor's first keeps the token the API gives, in this site's cookie). */
export async function startConversation(country: string, lang: string | null, surface: ShopAssistantSurface, listingId?: string): Promise<ActionResult<ShopAssistantThread>> {
  if (!/^[a-z]{2}$/i.test(country)) return refused("No such country.");
  if (listingId && !uuid.test(listingId)) return refused("No such listing.");
  const result = await assistantApi<ShopAssistantThread>("POST", "/v1/classifieds/assistant/threads", { country: country.toUpperCase(), surface, ...(lang && language.test(lang) ? { language: lang } : {}), ...(listingId ? { listing_id: listingId } : {}) });
  if (result.ok) await keepVisitor(result.data.visitor_token);
  if (result.ok) delete result.data.visitor_token;
  return answer(result);
}

export async function rateAnswer(messageId: string, rating: "up" | "down"): Promise<ActionResult<ShopAssistantMessage>> {
  if (!uuid.test(messageId)) return refused("No such answer.");
  return answer(await assistantApi<ShopAssistantMessage>("POST", `/v1/classifieds/assistant/messages/${messageId}/rating`, { rating }));
}

export async function reportAnswer(messageId: string, reason: string): Promise<ActionResult<ShopAssistantMessage>> {
  if (!uuid.test(messageId)) return refused("No such answer.");
  if (reason.trim().length < 3) return refused("Say what was wrong, in a few words.");
  return answer(await assistantApi<ShopAssistantMessage>("POST", `/v1/classifieds/assistant/messages/${messageId}/report`, { reason: reason.trim().slice(0, 500) }));
}

/** Talk to a person: a support chat with BitoCard, opened with the conversation (signed in). */
export async function talkToPerson(threadId: string): Promise<ActionResult<{ chat_id: string }>> {
  if (!uuid.test(threadId)) return refused("No such conversation.");
  return answer(await assistantApi<{ chat_id: string }>("POST", `/v1/classifieds/assistant/threads/${threadId}/human`, {}));
}
