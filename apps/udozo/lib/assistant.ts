import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { ShopAssistantProfile } from "@bitocard/api-client/classifieds";
import { apiUrl } from "./api";
import { customerCookie, type CustomerResult, shopperHeader } from "./customer";

/**
 * The shop assistant (Anjio) for this site's visitors. A signed-in customer is known by their session; a visitor by the
 * token the API gave their first conversation, kept in this site's own cookie (host-only, httpOnly, 30 days, as long as
 * conversations are kept). Browsers never call the API: the server actions and the streaming route handler do.
 */
export const assistantCookie = "bc_assistant";
const visitorHeader = "bitocard-assistant-visitor";
const visitorPattern = /^bav_[A-Za-z0-9_-]{43}$/;
const thirtyDays = 60 * 60 * 24 * 30;

/** The headers every assistant call carries: the session or the visitor's token, and the shopper's signed address. */
export async function assistantHeaders(): Promise<Record<string, string>> {
  const jar = await cookies();
  const session = jar.get(customerCookie)?.value;
  const visitor = jar.get(assistantCookie)?.value;
  return {
    ...(session ? { "bitocard-customer-session": session } : visitor && visitorPattern.test(visitor) ? { [visitorHeader]: visitor } : {}),
    ...(await shopperHeader()),
  };
}

/** Keeps a visitor's token (Server Actions only). */
export async function keepVisitor(token: string | undefined) {
  if (!token || !visitorPattern.test(token)) return;
  (await cookies()).set(assistantCookie, token, { maxAge: thirtyDays, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

/** Calls the assistant API. Never cached; never throws. */
export async function assistantApi<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<CustomerResult<T>> {
  try {
    const res = await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(await assistantHeaders()), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; param?: string } }) | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
  } catch {
    return { ok: false, status: 0, code: null, message: "The assistant can’t answer right now. Search still works.", param: null };
  }
}

/** The assistant serving a country (and language), or null where none answers. */
export async function assistantFor(country: string, language?: string): Promise<ShopAssistantProfile | null> {
  const result = await assistantApi<ShopAssistantProfile>("GET", `/v1/classifieds/assistant?country=${country.toUpperCase()}${language ? `&language=${encodeURIComponent(language)}` : ""}`);
  return result.ok && result.data.assistant ? result.data : null;
}
