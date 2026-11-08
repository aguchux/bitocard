import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { apiUrl } from "./api";
import { siteOrigin } from "./site";
import { storeHeader } from "./store-host";
import { readSource, sourceCookie } from "./traffic";

export { siteOrigin };

/**
 * Udozo's customers on udozo.com. Their accounts are Udozo's own (one account works on udozo.com and every reseller
 * store); this site keeps its own session: the API's token in this site's own first-party cookie (host-only, httpOnly),
 * sent to the API in a header. Browsers never see the API or the token. No store is named, so the API treats them as
 * udozo.com's own customers.
 */
export const customerCookie = "udz_customer";
const sessionHeader = "bitocard-customer-session";
/** The shopper's address, signed (the API's `client-ip.ts`). */
const clientHeader = "bitocard-client";
/** The visitor's browser (the API names the device from it for sign-up journeys). */
const agentHeader = "bitocard-client-agent";
const thirtyDays = 60 * 60 * 24 * 30;

export type Customer = {
  object: "customer";
  id: string;
  email: string;
  /** The first and last name joined. */
  name: string;
  /** First and last name apart, as on the customer's ID. */
  first_name: string;
  /** Null for an older account whose name was one word, until they add it. */
  last_name: string | null;
  /** False until an older account (whose whole name was split) checks the two on their profile. */
  name_confirmed: boolean;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  phone_verification_available: boolean;
  /** The customer chose to confirm their mobile later: nothing waits for it. Missing on older API versions. */
  phone_deferred?: boolean;
  country: string | null;
  currency: string | null;
  /** Where they live (an area of their country, apart from where their listings are), their date of birth and sex. Missing on older API versions. */
  area_id?: string | null;
  birth_date?: string | null;
  sex?: "female" | "male" | "unspecified" | null;
  /** Whether what they look at shapes what udozo.com shows them (Account > Privacy). Missing on older API versions. */
  personalisation?: boolean;
  /** Their profile photo, or null for their initials. Missing on older API versions. */
  avatar_url?: string | null;
  /** Their profile cover across their seller page, or null for Udozo's own banner. Missing on older API versions. */
  banner_url?: string | null;
  /** Their username (Udozo): their seller page's address once chosen. Missing on older API versions. */
  username?: string | null;
  /** Their seller page's random handle (Udozo), to know them on their own page. Missing on older API versions. */
  seller_handle?: string | null;
  created_at: string;
};

/**
 * Still to do before using the account: the emailed code; for a Google sign-up, its name and country; then the mobile
 * number's texted code (where the country can text: Udozo's API refuses everything else until then, `profile_incomplete`
 * or `phone_not_verified`), unless the customer chose to confirm it later.
 */
export const confirmationPending = (customer: Pick<Customer, "email_verified" | "phone_verified" | "phone_verification_available" | "country"> & { phone_deferred?: boolean }) =>
  !customer.email_verified || !customer.country || (customer.phone_verification_available && !customer.phone_verified && !customer.phone_deferred);

/** A mobile the customer chose to confirm later: the account's pages remind them. */
export const mobileToConfirm = (customer: Pick<Customer, "phone_verified" | "phone_verification_available"> & { phone_deferred?: boolean }) =>
  customer.phone_verification_available && !customer.phone_verified && Boolean(customer.phone_deferred);

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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Options = { idempotencyKey?: string; headers?: Record<string, string> };

/**
 * A request to a customer endpoint with the signed-in customer's session and the shopper's signed address, as it came
 * back (for files, which are not JSON). Never cached; null when the API cannot be reached. Every POST carries a fresh
 * Idempotency-Key unless `idempotencyKey` names one (a form's nonce, so a double submit acts once). A `FormData` body
 * is sent as multipart, anything else as JSON.
 */
export async function customerFetch(method: Method, path: string, body?: unknown, options: Options = {}): Promise<Response | null> {
  const token = (await cookies()).get(customerCookie)?.value;
  // On a reseller's store (the proxy named it), the API is told which: its Udozo account works there as on udozo.com.
  const list = await headers();
  const store = list.get(storeHeader);
  // The visitor's browser, so Udozo's sign-up journeys can say which devices people get stuck on (never stored as is).
  const agent = list.get("user-agent")?.slice(0, 500);
  const form = body instanceof FormData;
  try {
    return await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body !== undefined && !form ? { "content-type": "application/json" } : {}),
        ...(token ? { [sessionHeader]: token } : {}),
        ...(store ? { "bitocard-store": store } : {}),
        ...(agent ? { [agentHeader]: agent } : {}),
        ...(await shopperHeader()),
        ...(method === "POST" ? { "idempotency-key": options.idempotencyKey && idempotencyKeyPattern.test(options.idempotencyKey) ? options.idempotencyKey : randomUUID() } : {}),
        ...options.headers,
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

/** Calls a customer endpoint (see `customerFetch`) and reads its JSON. Never throws. */
export async function customerApi<T>(method: Method, path: string, body?: unknown, options: Options = {}): Promise<CustomerResult<T>> {
  const res = await customerFetch(method, path, body, options);
  if (!res) return { ok: false, status: 0, code: null, message: "We could not reach Udozo. Try again shortly.", param: null };
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; param?: string } }) | null;
  if (res.ok) return { ok: true, data: json as T };
  return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
}

/** The signed-in customer, or null. Asked once per request. */
export const currentCustomer = cache(async (): Promise<Customer | null> => {
  if (!(await cookies()).get(customerCookie)?.value) return null;
  const result = await customerApi<Customer>("GET", "/v1/store/account");
  return result.ok ? result.data : null;
});

/** Keeps the session the API gave (Server Actions and route handlers only): host-only, so no other site ever reads it. */
export async function keepSession(session: { token: string }) {
  const jar = await cookies();
  jar.set(customerCookie, session.token, { maxAge: thirtyDays, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  await creditSource(jar, session.token);
}

/**
 * Traffic sources: where the visit that led here came from, kept in `udz_src` only with Accept all, credited to the
 * account (the API credits only an account made in the last day, once), then forgotten. Never fails signing in.
 */
async function creditSource(jar: Awaited<ReturnType<typeof cookies>>, token: string) {
  const kept = readSource(jar.get(sourceCookie)?.value);
  if (!kept) return;
  jar.delete(sourceCookie);
  try {
    await fetch(apiUrl("/v1/store/account/attribution"), {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json", [sessionHeader]: token },
      body: JSON.stringify(kept),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Not credited: signing in goes on.
  }
}

export async function dropSession() {
  (await cookies()).delete(customerCookie);
}

/** Only paths on this site are followed after signing in, never another site. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/") {
  const next = typeof value === "string" ? value : "";
  // Browsers drop tabs and newlines and read "\" as "/", so "/\t/evil.com" would become "//evil.com": refuse them anywhere.
  return next.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : fallback;
}

/** Where a signed-out visitor goes to act, coming back to `next` afterwards. */
export function signInPath(next: string, reason?: "chat" | "phone" | "call" | "save" | "buy" | "report" | "sell") {
  return `/signin?next=${encodeURIComponent(safeNext(next))}${reason ? `&for=${reason}` : ""}`;
}
