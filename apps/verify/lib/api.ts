import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { KycCase, KycSession } from "@bitocard/api-client/kyc";

/**
 * The applicant's side of BitoCard Verify. The API gives a session for the case when the one-time link is exchanged;
 * this server keeps it in its own host-only, httpOnly cookie and sends it to the API in a header. The browser never
 * sees the token, and never calls the API for the applicant.
 */
export const kycCookie = "bc_kyc";
const sessionHeader = "bitocard-kyc-session";
/** The session lasts two hours on the API; the cookie never outlives it. */
export const kycCookieMaxAge = 2 * 60 * 60;

/** The BitoCard API: `API_URL`, then the public address, then production on Vercel and the local API (3001) in development. */
export function apiUrl(path: string) {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? (process.env.VERCEL ? "https://api.bitocard.com" : "http://localhost:3001");
  return `${base.replace(/\/+$/, "")}${path}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string; param: string | null };

const unreachable = { ok: false, status: 0, code: null, message: "We could not reach BitoCard. Check your connection and try again.", param: null } as const;

/** The cookie's settings: host-only (no domain), httpOnly, Strict, two hours. Secure everywhere but local development. */
export function kycCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: kycCookieMaxAge };
}

async function read<T>(res: Response): Promise<ApiResult<T>> {
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; param?: string } }) | null;
  if (res.ok && json) return { ok: true, data: json as T };
  return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
}

/**
 * Calls an applicant endpoint with the session from the cookie. Never cached; never throws. POST and PUT carry a fresh
 * Idempotency-Key. A `FormData` body is sent as multipart (the runtime sets the boundary).
 */
export async function kycApi<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<ApiResult<T>> {
  const token = (await cookies()).get(kycCookie)?.value;
  if (!token) return { ok: false, status: 401, code: "kyc_session_missing", message: "Open the link you were sent again to continue.", param: null };
  const form = body instanceof FormData;
  try {
    const res = await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        [sessionHeader]: token,
        ...(body !== undefined && !form ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { "idempotency-key": randomUUID() } : {}),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    return await read<T>(res);
  } catch {
    return unreachable;
  }
}

/** The applicant's case, or why it cannot be read (no session, an ended one, the API down). */
export function currentCase() {
  return kycApi<KycCase>("GET", "/v1/kyc/case");
}

/** The handoff token from the link exchanged for a session (public: no session header). Single use. */
export async function exchangeToken(token: string): Promise<ApiResult<KycSession>> {
  try {
    const res = await fetch(apiUrl("/v1/kyc/session"), {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ token }),
    });
    return await read<KycSession>(res);
  } catch {
    return unreachable;
  }
}
