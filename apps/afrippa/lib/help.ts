"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@afrippa/ui/forms";
import type { Chat, ChatMessage, ChatState } from "@/lib/chat-types";
import { customerApi, signInPath } from "@/lib/customer";

/**
 * A trader's help desk: tickets to Afrippa's own team (`/v1/afrippa/account/support/tickets`), over the trader's session,
 * signed by this server. Questions, not money: an order's money is settled by its appeal.
 */

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = ["order", "payment", "account", "product", "technical", "other"];

function refused(result: { status: number; message: string; param: string | null }, next: string): FormState {
  if (result.status === 401) redirect(signInPath(next));
  return { error: result.message, field: result.param };
}

export async function openTicket(_state: FormState, form: FormData): Promise<FormState> {
  const subject = text(form, "subject");
  const message = text(form, "message");
  const category = categories.includes(text(form, "category")) ? text(form, "category") : "other";
  if (subject.length < 3) return { error: "Give it a short title.", field: "subject" };
  if (message.length < 3) return { error: "Tell us what you need.", field: "message" };
  const result = await customerApi<{ id: string }>("POST", "/v1/afrippa/account/support/tickets", { subject, category, message }, { idempotencyKey: text(form, "nonce") || undefined });
  if (!result.ok) return refused(result, "/help");
  revalidatePath("/help");
  redirect(`/help/${result.data.id}`);
}

export async function replyToTicket(_state: FormState, form: FormData): Promise<FormState> {
  const id = uuid.test(text(form, "id")) ? text(form, "id") : null;
  const body = text(form, "body");
  if (!id) return { error: "Choose a ticket." };
  if (!body) return { error: "Write a message.", field: "body" };
  const result = await customerApi("POST", `/v1/afrippa/account/support/tickets/${id}/messages`, { body });
  if (!result.ok) return refused(result, `/help/${id}`);
  revalidatePath(`/help/${id}`);
  return { notice: "Sent." };
}

export async function closeTicket(form: FormData): Promise<void> {
  const id = uuid.test(text(form, "id")) ? text(form, "id") : null;
  if (!id) return;
  await customerApi("POST", `/v1/afrippa/account/support/tickets/${id}/close`, {});
  revalidatePath(`/help/${id}`);
  revalidatePath("/help");
}

// Live chat with Afrippa's team


/** The trader's open chat with Afrippa, or null. */
export async function currentChat(): Promise<Chat | null> {
  const result = await customerApi<Chat | null>("GET", "/v1/afrippa/account/support/chat");
  return result.ok ? result.data : null;
}

/** New messages in the chat since `after`, for polling; null when it cannot be read. */
export async function chatSince(id: string, after: string | null): Promise<{ status: Chat["status"]; data: ChatMessage[] } | null> {
  if (!uuid.test(id) || (after !== null && !uuid.test(after))) return null;
  const result = await customerApi<{ status: Chat["status"]; data: ChatMessage[] }>("GET", `/v1/afrippa/account/support/chat/${id}/messages${after ? `?after=${after}` : ""}`);
  return result.ok ? result.data : null;
}

/** Writes to Afrippa (starting a chat if none is open): text, or a photo or PDF with an optional caption, as base64. */
export async function sendChat(_state: ChatState, form: FormData): Promise<ChatState> {
  const body = text(form, "body");
  const file = form.get("file");
  let result;
  if (file instanceof File && file.size > 0) {
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) return { error: "Send a photo (JPEG or PNG) or a PDF.", field: "file" };
    if (file.size > 4 * 1024 * 1024) return { error: "Files can be up to 4 MB.", field: "file" };
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    result = await customerApi<Chat>("POST", "/v1/afrippa/account/support/chat/attachments", { file_name: file.name.slice(0, 200) || "file", content_type: file.type, data, ...(body ? { body } : {}) });
  } else {
    if (!body) return { error: "Write a message.", field: "body" };
    result = await customerApi<Chat>("POST", "/v1/afrippa/account/support/chat/messages", { body });
  }
  if (!result.ok) return refused(result, "/help?chat=1");
  return { chat: result.data };
}

export async function endChat(id: string): Promise<Chat | null> {
  if (!uuid.test(id)) return null;
  const result = await customerApi<Chat>("POST", `/v1/afrippa/account/support/chat/${id}/close`, {});
  return result.ok ? result.data : null;
}
