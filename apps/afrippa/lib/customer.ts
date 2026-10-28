import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { appUrl } from "@bitocard/ui/site";
import { apiUrl } from "./api";
import { deviceCookie, deviceHeader, validDeviceId } from "./device";
import { signatureFor, visitorHeader } from "./signing";

/**
 * Afrippa's traders. They hold Afrippa accounts (customers of Afrippa's own store, unrelated to bitocard.com's); this
 * site keeps the API's session token in its own first-party cookie (host-only, httpOnly) and sends it in a header on
 * every signed request. Browsers never see the API, the token or the signing secret.
 */
export const sessionCookie = "afr_session";
const sessionHeader = "bitocard-customer-session";
const thirtyDays = 60 * 60 * 24 * 30;

/** What this session still has to do before it is signed in: set two-step up, or enter its code. */
export type TwoStepState = { object: "two_step_state"; pending: boolean; setup_required: boolean; method: "authenticator" | "email" | "sms" | null; method_not_allowed: boolean };

export type Trader = {
  object: "customer";
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
  country: string | null;
  currency: string | null;
  phone: string | null;
  phone_verified: boolean;
  created_at: string;
  two_step: TwoStepState;
};

export type CustomerResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string; param: string | null };

/** An Idempotency-Key a form may name (its nonce): letters, digits, hyphens and underscores, 8 to 128 characters. */
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Calls an Afrippa route as the signed-in trader (or signed out), signed by this server. Never cached; never throws.
 * Every POST carries a fresh Idempotency-Key unless `idempotencyKey` names one (a form's nonce, so a double submit acts
 * once).
 */
/** This browser's device ID (from the proxy's cookie) for the API's device checks, or nothing. */
async function deviceHeaders(): Promise<Record<string, string>> {
  const id = (await cookies()).get(deviceCookie)?.value;
  return validDeviceId(id) ? { [deviceHeader]: id } : {};
}

export async function customerApi<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, options: { idempotencyKey?: string; headers?: Record<string, string> } = {}): Promise<CustomerResult<T>> {
  const token = (await cookies()).get(sessionCookie)?.value;
  const raw = body !== undefined ? JSON.stringify(body) : undefined;
  try {
    const res = await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(raw !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { [sessionHeader]: token } : {}),
        ...signatureFor(method, path, raw),
        ...(await visitorHeader()),
        ...(await deviceHeaders()),
        ...options.headers,
        ...(method === "POST" ? { "idempotency-key": options.idempotencyKey && idempotencyKeyPattern.test(options.idempotencyKey) ? options.idempotencyKey : randomUUID() } : {}),
      },
      body: raw,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; param?: string } }) | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
  } catch {
    return { ok: false, status: 0, code: null, message: "We could not reach Afrippa. Try again shortly.", param: null };
  }
}

/** A signed GET for a signed-out visitor's chat file, with their chat token; null when the API cannot be reached. */
export async function visitorFile(path: string, chatToken: string): Promise<Response | null> {
  try {
    return await fetch(apiUrl(path), { cache: "no-store", headers: { "bitocard-chat-visitor": chatToken, ...signatureFor("GET", path), ...(await visitorHeader()) } });
  } catch {
    return null;
  }
}

/**
 * A signed GET as the signed-in trader whose answer is passed on as it is (a file from an order room), or null when the
 * API cannot be reached. Never cached.
 */
export async function customerFile(path: string): Promise<Response | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  try {
    return await fetch(apiUrl(path), { cache: "no-store", headers: { [sessionHeader]: token, ...signatureFor("GET", path), ...(await visitorHeader()) } });
  } catch {
    return null;
  }
}

/** The trader this browser has a session for, signed in or still finishing two-step, or null. Asked once per request. */
export const currentSession = cache(async (): Promise<Trader | null> => {
  if (!(await cookies()).get(sessionCookie)?.value) return null;
  const result = await customerApi<Trader>("GET", "/v1/afrippa/account");
  return result.ok ? result.data : null;
});

/** The signed-in trader (two-step finished), or null. */
export const currentCustomer = cache(async (): Promise<Trader | null> => {
  const trader = await currentSession();
  return trader && !trader.two_step.pending ? trader : null;
});

/** Keeps the session the API gave (Server Actions and route handlers only). */
export async function keepSession(session: { token: string }) {
  (await cookies()).set(sessionCookie, session.token, { maxAge: thirtyDays, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

export async function dropSession() {
  (await cookies()).delete(sessionCookie);
}

/** This site's own address (`AFRIPPA_URL`, else afrippa.com on Vercel, else localhost:3008), never from forwarded headers. */
export function siteOrigin() {
  return new URL(appUrl("afrippa")).origin;
}

/** Only paths on this site are followed after signing in, never another site. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/") {
  const next = typeof value === "string" ? value : "";
  // Browsers drop tabs and newlines and read "\" as "/", so "/\t/evil.com" would become "//evil.com": refuse them anywhere.
  return next.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : fallback;
}

/** Where a signed-out visitor goes to act, coming back to `next` afterwards. */
export function signInPath(next: string, reason?: "trade" | "post") {
  return `/signin?next=${encodeURIComponent(safeNext(next))}${reason ? `&for=${reason}` : ""}`;
}

/** Where a session goes next: confirming its email, then two-step, then `next`. */
export function nextStep(trader: Pick<Trader, "email_verified" | "two_step">, next: string) {
  if (!trader.email_verified) return `/verify?next=${encodeURIComponent(next)}`;
  if (trader.two_step.pending) return `/two-step?next=${encodeURIComponent(next)}`;
  return next;
}
