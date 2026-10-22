"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { StorePublicSpinClaim, StorePublicSpinResult, StorePublicSpinRewards, StoreSpin, StoreSpinAllowance, StoreSpinExchange, StoreSpinExchangePreview, StoreSpinRewards } from "@bitocard/api-client/storefront";
import { apiUrl } from "@/lib/api";
import { customerApi, shopperHeader } from "@/lib/customer";
import { currentMarket } from "@/lib/market";
import { storeSubdomain } from "@/lib/store";

/** An Idempotency-Key a form may name (its nonce): letters, digits, hyphens and underscores, 8 to 128 characters. */
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * A spin's outcome for the wheel, never thrown: the win (the wheel lands on `spin.segment`), or the API's message and
 * code. Refused for today's limit or a finished allowance, it carries the allowance as it is now, so the wheel shows
 * when the customer can spin next.
 */
export type SpinResult = { ok: true; spin: StoreSpin } | { ok: false; code: string | null; message: string; allowance?: StoreSpinAllowance | null };

/** Where a signed-out customer comes back to: Home, with the wheel open. */
const spinPage = "/account?spin=1";
const publicSpinCookie = "bc_public_spin";
const publicClaimHeader = "bitocard-spin-claim";
const thirtyDays = 60 * 60 * 24 * 30;
const publicCookieOptions = { path: "/", sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production", ...(process.env.NODE_ENV === "production" ? { domain: ".bitocard.com" } : {}) };

/**
 * `nonce` (made when the button was pressed) is the Idempotency-Key for a POST, so a repeated request spins once;
 * without a usable one a fresh key is made here, as `customerApi` does for signed-in requests.
 */
async function publicSpinApi<T>(method: "GET" | "POST", path: string, body?: unknown, nonce?: string): Promise<{ ok: true; data: T } | { ok: false; code: string | null; message: string }> {
  const jar = await cookies();
  const token = jar.get(publicSpinCookie)?.value;
  const store = await storeSubdomain();
  try {
    const response = await fetch(apiUrl(path), {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { [publicClaimHeader]: token } : {}),
        ...(store ? { "bitocard-store": store } : {}),
        ...(await shopperHeader()),
        ...(method === "POST" ? { "idempotency-key": nonce && idempotencyKeyPattern.test(nonce) ? nonce : randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data: json as T };
    return { ok: false, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, code: null, message: "We could not reach the store. Try again shortly." };
  }
}

/** The visitor wheel for the current market. No claim is created until the first spin. */
export async function publicSpinRewards(): Promise<StorePublicSpinRewards | null> {
  const [country, store] = await Promise.all([currentMarket(), storeSubdomain()]);
  if ((!country || country === "global") && !store) return null;
  const result = await publicSpinApi<StorePublicSpinRewards>("GET", `/v1/store/spins/public${country && country !== "global" ? `?country=${encodeURIComponent(country)}` : ""}`);
  return result.ok ? result.data : null;
}

/**
 * Spins once as a visitor and stores only the API's opaque claim token in an HttpOnly cookie. `nonce` is the
 * Idempotency-Key (made when the button was pressed), so a repeated request spins once.
 */
export async function spinPublicWheel(nonce?: string): Promise<SpinResult> {
  const [country, store] = await Promise.all([currentMarket(), storeSubdomain()]);
  if ((!country || country === "global") && !store) return { ok: false, code: "country_required", message: "Choose your country before you spin." };
  const result = await publicSpinApi<StorePublicSpinResult & { token?: string }>("POST", "/v1/store/spins/public", country && country !== "global" ? { country } : {}, nonce);
  if (!result.ok) return result;
  if (result.data.token) (await cookies()).set(publicSpinCookie, result.data.token, { ...publicCookieOptions, maxAge: thirtyDays });
  return { ok: true, spin: result.data.spin };
}

/** Saved visitor wins, checked by the API against this signed-in account. */
export async function pendingPublicSpinClaim(): Promise<StorePublicSpinClaim | null> {
  const token = (await cookies()).get(publicSpinCookie)?.value;
  if (!token) return null;
  const result = await customerApi<StorePublicSpinClaim>("GET", "/v1/store/spins/public-claim", undefined, { headers: { [publicClaimHeader]: token } });
  return result.ok ? result.data : null;
}

export async function claimPublicSpin(currency: string): Promise<ExchangeResult<StorePublicSpinClaim>> {
  const jar = await cookies();
  const token = jar.get(publicSpinCookie)?.value;
  if (!token) return { ok: false, code: "claim_invalid", message: "There is no visitor win to claim." };
  const result = await customerApi<StorePublicSpinClaim>("POST", "/v1/store/spins/public-claim", { currency }, { headers: { [publicClaimHeader]: token } });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  jar.set(publicSpinCookie, "", { ...publicCookieOptions, maxAge: 0 });
  revalidatePath("/account", "layout");
  return { ok: true, data: result.data };
}

export async function dismissPublicSpinClaim() {
  (await cookies()).set(publicSpinCookie, "", { ...publicCookieOptions, maxAge: 0 });
}

/**
 * Spins the wheel once. The server decides what is won and credits it to the customer's spin rewards; the wheel only
 * shows it. `nonce` (made when the button was pressed) is the Idempotency-Key, so a repeated request spins once
 * (without a usable one, `customerApi` makes a fresh key).
 */
export async function spinWheel(nonce?: string): Promise<SpinResult> {
  const result = await customerApi<StoreSpin>("POST", "/v1/store/spins", {}, { idempotencyKey: nonce });
  if (result.ok) return { ok: true, spin: result.data };
  if (result.status === 401) redirect(`/signin?next=${encodeURIComponent(spinPage)}`);
  if (result.code === "spin_limit_today" || result.code === "spins_finished") {
    const now = await customerApi<StoreSpinRewards>("GET", "/v1/store/spins");
    return { ok: false, code: result.code, message: result.message, allowance: now.ok ? now.data.allowance : undefined };
  }
  return { ok: false, code: result.code, message: result.message };
}

/** The rewards and wins as they are now (after an exchange), or null. */
export async function spinRewards(): Promise<StoreSpinRewards | null> {
  const result = await customerApi<StoreSpinRewards>("GET", "/v1/store/spins");
  return result.ok ? result.data : null;
}

export type ExchangeResult<T> = { ok: true; data: T } | { ok: false; code: string | null; message: string };

/** What the customer's rewards are worth in a wallet's currency now (nothing is moved). */
export async function previewExchange(currency: string): Promise<ExchangeResult<StoreSpinExchangePreview>> {
  const result = await customerApi<StoreSpinExchangePreview>("POST", "/v1/store/spins/exchange", { currency, preview: true });
  if (result.ok) return { ok: true, data: result.data };
  if (result.status === 401) redirect(`/signin?next=${encodeURIComponent(spinPage)}`);
  return { ok: false, code: result.code, message: result.message };
}

/**
 * Moves every reward into the store wallet in `currency`, refused if it would now pay less than the preview showed
 * (`rate_changed`). `nonce` is the Idempotency-Key, so a repeated press exchanges once.
 */
export async function exchangeRewards(currency: string, expected: number, nonce?: string): Promise<ExchangeResult<StoreSpinExchange>> {
  const result = await customerApi<StoreSpinExchange>("POST", "/v1/store/spins/exchange", { currency, expected_amount: expected }, { idempotencyKey: nonce });
  if (result.ok) return { ok: true, data: result.data };
  if (result.status === 401) redirect(`/signin?next=${encodeURIComponent(spinPage)}`);
  return { ok: false, code: result.code, message: result.message };
}
