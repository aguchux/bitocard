import type { ExchangeDeskSettings, Membership, Mode } from "@bitocard/api-client/reseller";

/** Money typed in major units ("1,250.50") as minor units, or null when it is not a valid amount. */
export const amountMinor = (value: string) => {
  const match = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(value.replace(/,/g, "").trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
};

/** A percentage with at most two decimals ("1.5") as basis points, or null. */
export const percentBps = (value: string) => (/^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : null);

/** A coin amount without trailing zeros ("0.01000000" → "0.01"). */
export const coinAmount = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value) || "0";

/** Coins typed by the reseller: up to 8 decimals, above zero. */
export const validCoin = (value: string) => /^\d{1,12}(?:\.\d{1,8})?$/.test(value) && Number(value) > 0;

/** Who may change the desk and trade: the API's `@Roles('admin', 'finance')` (owners always pass). */
export const exchangeRoles = ["admin", "finance"] as const;

/**
 * Why the desk cannot be changed now, or null when it can: BitoCard has not switched desks on for the business
 * (`exchange_not_enabled`), or a live desk needs a verified business (`exchange_unavailable`). The API decides; this
 * only explains it before anyone fills in a form.
 */
export function deskBlock(desk: ExchangeDeskSettings | undefined, mode: Mode, membership: Membership): { title: string; body: string } | null {
  if (desk && !desk.enabled) {
    return {
      title: "Your desk is not switched on yet",
      body: "BitoCard has not switched on customer exchange desks for your business. Until it does, your customers trade with BitoCard where your store offers exchange, and you cannot fund a reserve or set prices.",
    };
  }
  if (mode === "live" && membership.reseller.status !== "active") {
    return {
      title: "Verify your business first",
      body: "A live desk needs a verified business. Finish your identity check under Settings, or switch to Sandbox to try your desk with test money.",
    };
  }
  return null;
}
