import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { appUrl } from "@bitocard/ui/site";
import { apiUrl } from "./api";

/**
 * BitoCard customers on the Shop. They hold bitocard.com accounts; this site keeps its own session: the API's token in
 * this site's own first-party cookie (host-only, httpOnly), sent to the API in a header. Browsers never see the API or
 * the token. No store is named, so the API treats them as bitocard.com's customers.
 */
export const customerCookie = "bc_customer";
const sessionHeader = "bitocard-customer-session";
/** The shopper's address, signed (the API's `client-ip.ts`). */
const clientHeader = "bitocard-client";
const thirtyDays = 60 * 60 * 24 * 30;

export type Customer = { object: "customer"; id: string; email: string; name: string; email_verified: boolean; country: string | null; currency: string | null; created_at: string };

export type CustomerResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string; param: string | null };

/**
 * The shopper's address, signed with the secret this server shares with the API (`STORE_SERVER_SECRET`), so the API
 * rate limits signed-out shoppers one by one instead of all of them together under this server's address. The address
 * comes from the platform (`x-real-ip`, else the first `x-forwarded-for`, which Vercel sets and callers cannot).
 */
export async function shopperHeader(now = Date.now()): Promise<Record<string, string>> {
  const secret = process.env.STORE_SERVER_SECRET;
  if (!secret) return {};
  const list = await headers();
  const ip = (list.get("x-real-ip") ?? list.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(ip)) return {};
  const t = Math.floor(now / 1000);
  return { [clientHeader]: `t=${t},ip=${ip},v1=${createHmac("sha256", secret).update(`${t}.${ip}`).digest("hex")}` };
}

/** An Idempotency-Key a form may name (its nonce): letters, digits, hyphens and underscores, 8 to 128 characters. */
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Calls a customer endpoint with the signed-in customer's session. Never cached; never throws. Every POST carries a
 * fresh Idempotency-Key unless `idempotencyKey` names one (a form's nonce, so a double submit acts once).
 */
export async function customerApi<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<CustomerResult<T>> {
  const token = (await cookies()).get(customerCookie)?.value;
  try {
    const res = await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { [sessionHeader]: token } : {}),
        ...(await shopperHeader()),
        ...(method === "POST" ? { "idempotency-key": options.idempotencyKey && idempotencyKeyPattern.test(options.idempotencyKey) ? options.idempotencyKey : randomUUID() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; param?: string } }) | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
  } catch {
    return { ok: false, status: 0, code: null, message: "We could not reach BitoCard Shop. Try again shortly.", param: null };
  }
}

/** The signed-in customer, or null. Asked once per request. */
export const currentCustomer = cache(async (): Promise<Customer | null> => {
  if (!(await cookies()).get(customerCookie)?.value) return null;
  const result = await customerApi<Customer>("GET", "/v1/store/account");
  return result.ok ? result.data : null;
});

/** Keeps the session the API gave (Server Actions and route handlers only). */
export async function keepSession(session: { token: string }) {
  (await cookies()).set(customerCookie, session.token, { maxAge: thirtyDays, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

export async function dropSession() {
  (await cookies()).delete(customerCookie);
}

/** This site's own address (`SHOP_URL`, else shop.bitocard.com on Vercel, else localhost:3007), never from forwarded headers. */
export function siteOrigin() {
  return new URL(appUrl("shop")).origin;
}

/** Only paths on this site are followed after signing in, never another site. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/") {
  const next = typeof value === "string" ? value : "";
  // Browsers drop tabs and newlines and read "\" as "/", so "/\t/evil.com" would become "//evil.com": refuse them anywhere.
  return next.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : fallback;
}

/** Where a signed-out visitor goes to act, coming back to `next` afterwards. */
export function signInPath(next: string, reason?: "chat" | "phone" | "save" | "buy" | "report" | "sell") {
  return `/signin?next=${encodeURIComponent(safeNext(next))}${reason ? `&for=${reason}` : ""}`;
}
