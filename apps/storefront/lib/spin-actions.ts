"use server";

import { redirect } from "next/navigation";
import type { StoreSpin, StoreSpinAllowance, StoreSpinRewards } from "@bitocard/api-client/storefront";
import { customerApi } from "@/lib/customer";

/**
 * A spin's outcome for the wheel, never thrown: the win (the wheel lands on `spin.segment`), or the API's message and
 * code. Refused for today's limit or a finished allowance, it carries the allowance as it is now, so the wheel shows
 * when the customer can spin next.
 */
export type SpinResult = { ok: true; spin: StoreSpin } | { ok: false; code: string | null; message: string; allowance?: StoreSpinAllowance | null };

/**
 * Spins the wheel once. The server decides what is won and pays it into the customer's crypto wallet; the wheel only
 * shows it. `nonce` (made when the button was pressed) is the Idempotency-Key, so a repeated request spins once
 * (without a usable one, `customerApi` makes a fresh key).
 */
export async function spinWheel(nonce?: string): Promise<SpinResult> {
  const result = await customerApi<StoreSpin>("POST", "/v1/store/spins", {}, { idempotencyKey: nonce });
  if (result.ok) return { ok: true, spin: result.data };
  if (result.status === 401) redirect(`/signin?next=${encodeURIComponent("/account/crypto/spin")}`);
  if (result.code === "spin_limit_today" || result.code === "spins_finished") {
    const now = await customerApi<StoreSpinRewards>("GET", "/v1/store/spins");
    return { ok: false, code: result.code, message: result.message, allowance: now.ok ? now.data.allowance : undefined };
  }
  return { ok: false, code: result.code, message: result.message };
}
