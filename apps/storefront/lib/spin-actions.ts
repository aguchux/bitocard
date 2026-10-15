"use server";

import { redirect } from "next/navigation";
import type { StoreSpin, StoreSpinAllowance, StoreSpinExchange, StoreSpinExchangePreview, StoreSpinRewards } from "@bitocard/api-client/storefront";
import { customerApi } from "@/lib/customer";

/**
 * A spin's outcome for the wheel, never thrown: the win (the wheel lands on `spin.segment`), or the API's message and
 * code. Refused for today's limit or a finished allowance, it carries the allowance as it is now, so the wheel shows
 * when the customer can spin next.
 */
export type SpinResult = { ok: true; spin: StoreSpin } | { ok: false; code: string | null; message: string; allowance?: StoreSpinAllowance | null };

/** Where a signed-out customer comes back to: Home, with the wheel open. */
const spinPage = "/account?spin=1";

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
