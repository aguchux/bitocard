"use server";

import type { StoreAssistant, StoreChat, StoreChatMessage, StoreChatVisitor } from "@bitocard/api-client/storefront";
import { chatApi, type ChatIdentity, chatIdentity, keepVisitor } from "@/lib/chat-server";

export type ChatResult = { ok: true; chat: StoreChat | null } | { ok: false; error: string; signIn?: boolean; introduce?: boolean };
export type LoadResult = { ok: true; chat: StoreChat | null; assistant: StoreAssistant | null; identity: ChatIdentity | null; visitor: StoreChatVisitor | null } | { ok: false; error: string };
export type PollResult = { ok: true; status: StoreChat["status"]; messages: StoreChatMessage[] } | { ok: false; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const identities = new Set<ChatIdentity>(["customer", "visitor"]);
const asked = (as: unknown): ChatIdentity | null => (identities.has(as as ChatIdentity) ? (as as ChatIdentity) : null);

type Current = { chat: StoreChat | null; assistant?: StoreAssistant | null; visitor?: StoreChatVisitor | null };

/**
 * The open chat with the store: the signed-in customer's, else a returning visitor's, else nothing yet (the widget then
 * asks for a name and email). A customer whose session ended is treated as a visitor.
 */
export async function loadChat(): Promise<LoadResult> {
  if ((await chatIdentity()) === "customer") {
    const result = await chatApi<Current>("customer", "GET", "");
    if (result.ok) return { ok: true, chat: result.data.chat, assistant: result.data.assistant ?? null, identity: "customer", visitor: null };
    if (result.status !== 401) return { ok: false, error: result.message };
  }
  const result = await chatApi<Current>("visitor", "GET", "");
  if (!result.ok) return { ok: false, error: result.message };
  const visitor = result.data.visitor ?? null;
  return { ok: true, chat: result.data.chat, assistant: result.data.assistant ?? null, identity: visitor ? "visitor" : null, visitor };
}

/** A signed-out visitor starts chatting: their name, email and first message. The token the API gives is kept in `bc_chat`. */
export async function startChat(input: { name: string; email: string; body: string }): Promise<ChatResult & { visitor?: StoreChatVisitor }> {
  const name = String(input.name ?? "").trim().slice(0, 80);
  const address = String(input.email ?? "").trim().slice(0, 254);
  const body = String(input.body ?? "").trim().slice(0, 2000);
  if (!name) return { ok: false, error: "Tell us your name." };
  if (!email.test(address)) return { ok: false, error: "Enter a valid email address, so we can reply if you leave." };
  if (!body) return { ok: false, error: "Write a message first." };
  const result = await chatApi<{ token: string | null; visitor: StoreChatVisitor; chat: StoreChat }>("visitor", "POST", "", { name, email: address, body });
  if (!result.ok) return { ok: false, error: result.message };
  if (result.data.token) await keepVisitor(result.data.token);
  return { ok: true, chat: result.data.chat, visitor: result.data.visitor };
}

/** Sends a message: to the open chat, or starting one. */
export async function sendChatMessage(body: string, as: ChatIdentity = "customer"): Promise<ChatResult> {
  const who = asked(as);
  const text = String(body ?? "").trim().slice(0, 2000);
  if (!who) return { ok: false, error: "This chat was not found." };
  if (!text) return { ok: false, error: "Write a message first." };
  const result = await chatApi<StoreChat>(who, "POST", "/messages", { body: text });
  if (!result.ok) return { ok: false, error: result.message, signIn: who === "customer" && result.status === 401, introduce: who === "visitor" && result.status === 401 };
  return { ok: true, chat: result.data };
}

/** New messages since `after`, while the chat is open. */
export async function pollChat(id: string, after: string | null, as: ChatIdentity = "customer"): Promise<PollResult> {
  const who = asked(as);
  if (!who || !uuid.test(id) || (after && !uuid.test(after))) return { ok: false, error: "This chat was not found." };
  const result = await chatApi<{ status: StoreChat["status"]; data: StoreChatMessage[] }>(who, "GET", `/${id}/messages${after ? `?after=${after}` : ""}`);
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, status: result.data.status, messages: result.data.data };
}

/** Asks for a person: the assistant stops answering and the store is told. */
export async function askForPerson(id: string, as: ChatIdentity = "customer"): Promise<ChatResult> {
  const who = asked(as);
  if (!who || !uuid.test(id)) return { ok: false, error: "This chat was not found." };
  const result = await chatApi<StoreChat>(who, "POST", `/${id}/human`, {});
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, chat: result.data };
}

/** Ends the chat. */
export async function endChat(id: string, as: ChatIdentity = "customer"): Promise<ChatResult> {
  const who = asked(as);
  if (!who || !uuid.test(id)) return { ok: false, error: "This chat was not found." };
  const result = await chatApi<StoreChat>(who, "POST", `/${id}/close`, {});
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, chat: null };
}
