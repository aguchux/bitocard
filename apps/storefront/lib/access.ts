import "server-only";
import { cookies } from "next/headers";
import { apiUrl } from "./api";
import { customerCookie, shopperHeader } from "./customer";

/** One delivered item on an order's page. Codes, PINs and tokens are null (`hidden`) until the customer presses Reveal. */
export type AccessDelivery = {
  kind: "gift_card" | "licence_key" | "token" | "confirmation" | "virtual_number";
  hidden: boolean;
  code: string | null;
  pin: string | null;
  serial: string | null;
  details: Record<string, string>;
};

export type AccessOrder = {
  mode: "test" | "live";
  status: "processing" | "completed" | "failed" | "refunded";
  product: { key: string; name: string; category: string; country: string; brand: string; features: string[] };
  quantity: number;
  face_value: number;
  face_currency: string;
  recipient: Partial<Record<"phone" | "account_number" | "account_name" | "current_package" | "email", string>>;
  deliveries: AccessDelivery[];
  redeem_instructions: string | null;
  revealed_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export type AccessStore = { name: string; subdomain: string | null; logo_url: string | null; primary_color: string };

/**
 * An order's page (`GET /v1/store/access/:token`): the store, and how the customer proves the order is theirs
 * (`customer`: signed in at the store; `email`: a code to the order's address; `none`: the store has the codes). The
 * order itself only once proven.
 */
export type OrderAccess = {
  object: "order_access";
  store: AccessStore;
  access: { method: "customer" | "email" | "none"; verified: boolean; email_hint: string | null };
  order: AccessOrder | null;
};

export type AccessResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string };

/** Access links are `bca_` and a long random part; anything else is not asked about. */
export const accessToken = /^bca_[A-Za-z0-9_-]{40,60}$/;
/** The pass from a confirmed emailed code: this server's cookie, only on that order's page, for its 30 minutes. */
export const passCookie = "bc_access";
export const passPath = (token: string) => `/a/${token}`;

/** Calls an order-page endpoint with the customer's proof (their store session, and the pass for this page). Never cached; never throws. */
export async function accessApi<T>(token: string, action: "" | "/reveal" | "/code" | "/verify" = "", body?: unknown): Promise<AccessResult<T>> {
  if (!accessToken.test(token)) return { ok: false, status: 404, code: "resource_missing", message: "This link is not valid." };
  const jar = await cookies();
  const session = jar.get(customerCookie)?.value;
  const pass = jar.get(passCookie)?.value;
  try {
    const res = await fetch(apiUrl(`/v1/store/access/${token}${action}`), {
      method: action ? "POST" : "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(session ? { "bitocard-customer-session": session } : {}),
        ...(pass ? { "bitocard-access-pass": pass } : {}),
        ...(await shopperHeader()),
      },
      body: body !== undefined ? JSON.stringify(body) : action ? "{}" : undefined,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, status: 0, code: null, message: "We could not reach the store. Try again shortly." };
  }
}
