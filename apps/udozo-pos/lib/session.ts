import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { apiUrl } from "./site";

/**
 * The signed-in shop owner on pos.udozo.com. Their account is their ordinary Udozo account; this site keeps its
 * own session (the API's token, from udozo.com's sign-in handoff) in its own host-only, httpOnly cookie and sends it to
 * the API from the server only. Browsers never see the API or the token.
 */
export const sessionCookie = "udz_pos";
const sessionHeader = "bitocard-customer-session";
const clientHeader = "bitocard-client";
const thirtyDays = 60 * 60 * 24 * 30;

export type Customer = {
  object: "customer";
  id: string;
  email: string;
  name: string;
  first_name?: string;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  country: string | null;
  currency: string | null;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string; param: string | null };

/** The visitor's address, signed with `STORE_SERVER_SECRET`, so the API rate limits people one by one. */
export async function clientHeaders(now = Date.now()): Promise<Record<string, string>> {
  const secret = process.env.STORE_SERVER_SECRET;
  if (!secret) return {};
  const list = await headers();
  const ip = (list.get("x-real-ip") ?? list.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(ip)) return {};
  const t = Math.floor(now / 1000);
  return { [clientHeader]: `t=${t},ip=${ip},v1=${createHmac("sha256", secret).update(`${t}.${ip}`).digest("hex")}` };
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A shop's member of staff signed in at the till (milestone 5): their API session, in this site's own host-only,
 * httpOnly cookie (12 hours, as the API ends an idle session), sent as `Udozo-Pos-Session`. Never a Udozo account.
 */
export const staffCookie = "udz_pos_staff";
const staffHeader = "udozo-pos-session";
/** A till's linked device: its token (a year), sent as `Udozo-Pos-Device` for the name tiles and PIN sign-in. */
export const deviceCookie = "udz_pos_device";
const deviceHeader = "udozo-pos-device";
const twelveHours = 60 * 60 * 12;
const oneYear = 60 * 60 * 24 * 365;

/** Whose credentials a call carries: the owner's Udozo session, a member of staff's, the till's device, or none. */
export type Auth = "customer" | "staff" | "device" | "none";

/**
 * Calls a customer endpoint with this site's session and reads its JSON. Server only; never cached, never throws
 * (status 0 when the API cannot be reached). Every POST carries a fresh Idempotency-Key unless one is named.
 */
export async function customerApi<T>(method: Method, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<ApiResult<T>> {
  return callApi<T>("customer", method, path, body, options);
}

/** As `customerApi`, with a member of staff's session. */
export async function staffApi<T>(method: Method, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<ApiResult<T>> {
  return callApi<T>("staff", method, path, body, options);
}

/** As `customerApi`, with the till's device token (or none, for public calls such as signing in). */
export async function deviceApi<T>(method: Method, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<ApiResult<T>> {
  return callApi<T>("device", method, path, body, options);
}
export async function publicApi<T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
  return callApi<T>("none", method, path, body);
}

async function callApi<T>(auth: Auth, method: Method, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<ApiResult<T>> {
  if (typeof window !== "undefined") throw new Error("The API is called from the server only.");
  const jar = await cookies();
  const credential =
    auth === "customer" ? [sessionHeader, jar.get(sessionCookie)?.value] : auth === "staff" ? [staffHeader, jar.get(staffCookie)?.value] : auth === "device" ? [deviceHeader, jar.get(deviceCookie)?.value] : [null, undefined];
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(credential[0] && credential[1] ? { [credential[0]]: credential[1] } : {}),
        ...(await clientHeaders()),
        ...(method === "POST" ? { "idempotency-key": options.idempotencyKey && /^[A-Za-z0-9_-]{8,128}$/.test(options.idempotencyKey) ? options.idempotencyKey : randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: null, message: "We could not reach Udozo. Try again shortly.", param: null };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; param?: string } }) | null;
  if (res.ok) return { ok: true, data: json as T };
  return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
}

/** A file the API sends (a receipt's PDF), read whole on the server. */
export type ApiFile = { ok: true; bytes: ArrayBuffer; contentType: string; disposition: string | null } | { ok: false; status: number; message: string };

/** GETs a file with these credentials (never cached); never throws. */
export async function apiFile(auth: "customer" | "staff", path: string): Promise<ApiFile> {
  if (typeof window !== "undefined") throw new Error("The API is called from the server only.");
  const jar = await cookies();
  const [name, value] = auth === "customer" ? [sessionHeader, jar.get(sessionCookie)?.value] : [staffHeader, jar.get(staffCookie)?.value];
  if (!value) return { ok: false, status: 401, message: "Sign in again to carry on." };
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { cache: "no-store", headers: { accept: "application/pdf, application/json", [name]: value, ...(await clientHeaders()) } });
  } catch {
    return { ok: false, status: 0, message: "We could not reach Udozo. Try again shortly." };
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, status: res.status, message: json?.error?.message ?? "Something went wrong. Try again." };
  }
  return { ok: true, bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "application/pdf", disposition: res.headers.get("content-disposition") };
}

/** The signed-in customer, or null. Asked once per request. */
export const currentCustomer = cache(async (): Promise<Customer | null> => {
  if (!(await cookies()).get(sessionCookie)?.value) return null;
  const result = await customerApi<Customer>("GET", "/v1/store/account");
  return result.ok ? result.data : null;
});

/** Keeps the session the API gave (server actions and route handlers only): host-only, so no other site reads it. */
export async function keepSession(session: { token: string }) {
  (await cookies()).set(sessionCookie, session.token, { maxAge: thirtyDays, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

export async function dropSession() {
  (await cookies()).delete(sessionCookie);
}

/** Keeps a member of staff's session (server actions only). */
export async function keepStaffSession(token: string) {
  (await cookies()).set(staffCookie, token, { maxAge: twelveHours, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

export async function dropStaffSession() {
  (await cookies()).delete(staffCookie);
}

/** Keeps the till's device token once it is linked (server actions only). */
export async function keepDevice(token: string) {
  (await cookies()).set(deviceCookie, token, { maxAge: oneYear, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

export async function dropDevice() {
  (await cookies()).delete(deviceCookie);
}

/** Whether this browser is a linked till (it has a device token; the API decides whether it still counts). */
export async function hasDevice() {
  return Boolean((await cookies()).get(deviceCookie)?.value);
}
