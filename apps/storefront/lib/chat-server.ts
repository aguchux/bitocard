import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { apiUrl } from "./api";
import { customerCookie, shopperHeader } from "./customer";
import { storeSubdomain } from "./store";

/**
 * The store's chat, as whoever is asking: a signed-in customer (their session) or a signed-out visitor who gave their
 * name and email (the token the API gave them, kept in this server's own `bc_chat` cookie, httpOnly, for this store's
 * address only). Browsers never see the API, the session or the token.
 */
export const visitorCookie = "bc_chat";
export type ChatIdentity = "customer" | "visitor";
const thirtyDays = 60 * 60 * 24 * 30;

/** The API's chat routes for each kind of requester. */
export const chatBase: Record<ChatIdentity, string> = { customer: "/v1/store/support/chat", visitor: "/v1/store/support/visitor-chat" };

/** Who asks by default: the signed-in customer, else a visitor who chatted before, else nobody yet. */
export async function chatIdentity(): Promise<ChatIdentity | null> {
  const jar = await cookies();
  if (jar.get(customerCookie)?.value) return "customer";
  if (jar.get(visitorCookie)?.value) return "visitor";
  return null;
}

/** Keeps a visitor's token (Server Actions only). */
export async function keepVisitor(token: string) {
  (await cookies()).set(visitorCookie, token, { maxAge: thirtyDays, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

/** A request to the chat API as `as`, with the store and the shopper's signed address. Never throws: null when unreachable. */
export async function chatFetch(as: ChatIdentity, method: "GET" | "POST", path: string, body?: unknown | FormData): Promise<Response | null> {
  const jar = await cookies();
  const store = await storeSubdomain();
  const credential = as === "customer" ? jar.get(customerCookie)?.value : jar.get(visitorCookie)?.value;
  const form = body instanceof FormData;
  try {
    return await fetch(apiUrl(`${chatBase[as]}${path}`), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body !== undefined && !form ? { "content-type": "application/json" } : {}),
        ...(credential ? { [as === "customer" ? "bitocard-customer-session" : "bitocard-chat-visitor"]: credential } : {}),
        ...(store ? { "bitocard-store": store } : {}),
        ...(await shopperHeader()),
        ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export type ChatApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string };

/** `chatFetch` read as JSON: the data, or the API's error message. */
export async function chatApi<T>(as: ChatIdentity, method: "GET" | "POST", path: string, body?: unknown | FormData): Promise<ChatApiResult<T>> {
  const res = await chatFetch(as, method, path, body);
  if (!res) return { ok: false, status: 0, code: null, message: "We could not reach the store. Try again shortly." };
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (res.ok) return { ok: true, data: json as T };
  return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again." };
}
