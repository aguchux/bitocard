import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { apiUrl } from "./api";
import { storeSubdomain } from "./store";

/**
 * Store customers. The API gives a session token at sign-in; this server keeps it in its own first-party cookie and
 * sends it to the API in a header. Browsers never see the API or the token (the cookie is httpOnly).
 */
export const customerCookie = "bc_customer";
const sessionHeader = "bitocard-customer-session";
/** Names a reseller's store to the API (accounts belong to one store); none is bitocard.com. */
const storeHeader = "bitocard-store";
const thirtyDays = 60 * 60 * 24 * 30;

export type Customer = { object: "customer"; id: string; email: string; name: string; email_verified: boolean; created_at: string };

export type CustomerResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string; param: string | null };

/** Calls a customer endpoint with the signed-in customer's session. Never cached; never throws. */
export async function customerApi<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<CustomerResult<T>> {
  const token = (await cookies()).get(customerCookie)?.value;
  const store = await storeSubdomain();
  try {
    const res = await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { [sessionHeader]: token } : {}),
        ...(store ? { [storeHeader]: store } : {}),
        ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; param?: string } }) | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
  } catch {
    return { ok: false, status: 0, code: null, message: "We could not reach the store. Try again shortly.", param: null };
  }
}

/** The signed-in customer, or null. Asked once per request. */
export const currentCustomer = cache(async (): Promise<Customer | null> => {
  if (!(await cookies()).get(customerCookie)?.value) return null;
  const result = await customerApi<Customer>("GET", "/v1/store/account");
  return result.ok ? result.data : null;
});

/** Keeps the session the API gave (Server Actions only). */
export async function keepSession(session: { token: string }) {
  (await cookies()).set(customerCookie, session.token, { maxAge: thirtyDays, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

export async function dropSession() {
  (await cookies()).delete(customerCookie);
}

/** This site's own address, for payment pages to return to. */
export async function siteOrigin() {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "bitocard.com";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Only paths on this site are followed after signing in, never another site. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/account") {
  const next = typeof value === "string" ? value : "";
  // Browsers drop tabs and newlines and read "\" as "/", so "/\t/evil.com" would become "//evil.com": refuse them anywhere.
  // eslint-disable-next-line no-control-regex
  return next.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : fallback;
}
