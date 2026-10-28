"use server";

import { cookies } from "next/headers";
import { type Chat, chatCookie, type ChatMessage, type ChatState } from "@/lib/chat-types";
import { customerApi } from "@/lib/customer";

/**
 * A signed-out visitor's chat with Afrippa (`/v1/afrippa/account/support/visitor-chat`, signed by this server): their
 * name, email and first message, then the token the API returns once, kept in this site's own `afr_chat` cookie
 * (host-only, httpOnly, 30 days) and sent as `BitoCard-Chat-Visitor`. The browser never sees the token.
 */

const base = "/v1/afrippa/account/support/visitor-chat";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

async function token() {
  return (await cookies()).get(chatCookie)?.value ?? null;
}

async function headers(): Promise<Record<string, string>> {
  const value = await token();
  return value ? { "bitocard-chat-visitor": value } : {};
}

/** The visitor's open chat and who they said they are (null when this browser has not chatted). */
export async function visitorChat(): Promise<{ chat: Chat | null; visitor: { name: string; email: string } | null }> {
  const result = await customerApi<{ chat: Chat | null; visitor: { name: string; email: string } | null }>("GET", base, undefined, { headers: await headers() });
  return result.ok ? { chat: result.data.chat, visitor: result.data.visitor } : { chat: null, visitor: null };
}

/** Writes to Afrippa: the first message with a name and email (starting the chat), or text or a file in it. */
export async function sendVisitorChat(_state: ChatState, form: FormData): Promise<ChatState> {
  const body = text(form, "body");
  const file = form.get("file");
  const known = await token();
  if (!known || form.get("name") !== null) {
    if (!body) return { error: "Write a message.", field: "body" };
    const result = await customerApi<{ token: string | null; chat: Chat }>("POST", base, { name: text(form, "name"), email: text(form, "email"), body }, { headers: await headers() });
    if (!result.ok) return { error: result.message, field: result.param };
    if (result.data.token) (await cookies()).set(chatCookie, result.data.token, { maxAge: 60 * 60 * 24 * 30, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
    return { chat: result.data.chat };
  }
  let result;
  if (file instanceof File && file.size > 0) {
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) return { error: "Send a photo (JPEG or PNG) or a PDF.", field: "file" };
    if (file.size > 4 * 1024 * 1024) return { error: "Files can be up to 4 MB.", field: "file" };
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    result = await customerApi<Chat>("POST", `${base}/attachments`, { file_name: file.name.slice(0, 200) || "file", content_type: file.type, data, ...(body ? { body } : {}) }, { headers: await headers() });
  } else {
    if (!body) return { error: "Write a message.", field: "body" };
    result = await customerApi<Chat>("POST", `${base}/messages`, { body }, { headers: await headers() });
  }
  if (!result.ok) return { error: result.status === 401 ? "Tell us your name and email again to carry on." : result.message, field: result.param };
  return { chat: result.data };
}

export async function visitorChatSince(id: string, after: string | null): Promise<{ status: Chat["status"]; data: ChatMessage[] } | null> {
  if (!uuid.test(id) || (after !== null && !uuid.test(after))) return null;
  const result = await customerApi<{ status: Chat["status"]; data: ChatMessage[] }>("GET", `${base}/${id}/messages${after ? `?after=${after}` : ""}`, undefined, { headers: await headers() });
  return result.ok ? result.data : null;
}

export async function endVisitorChat(id: string): Promise<Chat | null> {
  if (!uuid.test(id)) return null;
  const result = await customerApi<Chat>("POST", `${base}/${id}/close`, {}, { headers: await headers() });
  return result.ok ? result.data : null;
}
