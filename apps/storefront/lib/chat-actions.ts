"use server";

import type { StoreAssistant, StoreChat, StoreChatMessage } from "@bitocard/api-client/storefront";
import { customerApi } from "@/lib/customer";

export type ChatResult = { ok: true; chat: StoreChat | null; assistant?: StoreAssistant | null } | { ok: false; error: string; signIn?: boolean };
export type PollResult = { ok: true; status: StoreChat["status"]; messages: StoreChatMessage[] } | { ok: false; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The customer's open chat with their store, or null. */
export async function loadChat(): Promise<ChatResult> {
  const result = await customerApi<{ chat: StoreChat | null; assistant?: StoreAssistant | null }>("GET", "/v1/store/support/chat");
  if (!result.ok) return { ok: false, error: result.message, signIn: result.status === 401 };
  return { ok: true, chat: result.data.chat, assistant: result.data.assistant ?? null };
}

/** Sends a message: to the open chat, or starting one. */
export async function sendChatMessage(body: string): Promise<ChatResult> {
  const text = String(body ?? "").trim().slice(0, 2000);
  if (!text) return { ok: false, error: "Write a message first." };
  const result = await customerApi<StoreChat>("POST", "/v1/store/support/chat/messages", { body: text });
  if (!result.ok) return { ok: false, error: result.message, signIn: result.status === 401 };
  return { ok: true, chat: result.data };
}

/** New messages since `after`, while the chat is open. */
export async function pollChat(id: string, after: string | null): Promise<PollResult> {
  if (!uuid.test(id) || (after && !uuid.test(after))) return { ok: false, error: "This chat was not found." };
  const result = await customerApi<{ status: StoreChat["status"]; data: StoreChatMessage[] }>("GET", `/v1/store/support/chat/${id}/messages${after ? `?after=${after}` : ""}`);
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, status: result.data.status, messages: result.data.data };
}

/** The customer asks for a person: the assistant stops answering and the store is told. */
export async function askForPerson(id: string): Promise<ChatResult> {
  if (!uuid.test(id)) return { ok: false, error: "This chat was not found." };
  const result = await customerApi<StoreChat>("POST", `/v1/store/support/chat/${id}/human`, {});
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, chat: result.data };
}

/** The customer ends the chat. */
export async function endChat(id: string): Promise<ChatResult> {
  if (!uuid.test(id)) return { ok: false, error: "This chat was not found." };
  const result = await customerApi<StoreChat>("POST", `/v1/store/support/chat/${id}/close`, {});
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, chat: null };
}
