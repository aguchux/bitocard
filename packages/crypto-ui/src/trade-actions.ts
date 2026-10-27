import { randomUUID } from "node:crypto";
import type { StoreP2pAd, StoreP2pProfile, StoreP2pTrade } from "@bitocard/api-client/storefront";
import type { FormState, NonceFormState } from "./forms";

/** An app's call to the customer API with the signed-in customer's session (never throws). */
export type CustomerCall = <T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  options?: { idempotencyKey?: string },
) => Promise<{ ok: true; data: T } | { ok: false; status: number; code: string | null; message: string; param: string | null }>;

/** Where an app's trading pages are: the confirmation, a trade's receipt, My ads, and what to refresh after a change. */
export type TradePaths = {
  confirm: string;
  trade: (id: string) => string;
  ads: string;
  /** Signing in first, coming back to `next`. */
  signIn: (next: string) => string;
  /** Pages (layouts) to refresh after a trade, an ad or a nickname changes. */
  refresh: string[];
};

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Fiat typed by people ("1,650.50") in minor units, or null when it is not a positive amount. */
export function toMinor(value: string) {
  const amount = Math.round(Number(value.replace(/[,\s]/g, "")) * 100);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** A crypto amount as typed ("0.5", "1,000"), or null. The API checks its decimal places. */
export function cryptoAmount(value: string) {
  const amount = value.replace(/[,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 ? amount : null;
}

const fresh = (state: FormState): NonceFormState => ({ ...state, nonce: randomUUID() });

/**
 * The trading actions' work, shared by the storefront's Crypto tab and BitoCard Crypto: each app's own server actions
 * (its `"use server"` file) call these with its customer API (its session) and its pages, and `redirect` and
 * `revalidatePath` from `next/navigation` and `next/cache` (passed in, so this module stays plain).
 */
export function tradeActions(deps: { api: CustomerCall; paths: TradePaths; redirect: (url: string) => never; revalidate: (path: string, type: "layout" | "page") => void }) {
  const { api, paths, redirect } = deps;
  const refresh = () => paths.refresh.forEach(path => deps.revalidate(path, "layout"));
  const signInFirst = (status: number, next: string) => {
    if (status === 401) redirect(paths.signIn(next));
  };
  return {
    /** Takes an ad from the market: the amount typed, then the confirmation. */
    async takeAd(form: FormData): Promise<FormState> {
      const fiat = toMinor(text(form, "fiat"));
      if (!fiat) return { error: "Enter an amount.", field: "fiat" };
      return redirect(`${paths.confirm}?${new URLSearchParams({ ad: text(form, "ad_id"), price: text(form, "price"), fiat: String(fiat) })}`);
    },

    /** The trade the customer confirmed: settled at once from their wallets, then its receipt. */
    async confirmTrade(form: FormData): Promise<NonceFormState> {
      // The fee rate the customer was shown: a changed fee is refused, like a changed price.
      const feeBps = text(form, "fee_bps");
      const body = { ad_id: text(form, "ad_id"), price: Number(text(form, "price")), ...(feeBps ? { fee_bps: Number(feeBps) } : {}), fiat: Number(text(form, "fiat")) };
      const result = await api<StoreP2pTrade>("POST", "/v1/store/p2p/trades", body, { idempotencyKey: text(form, "nonce") || undefined });
      if (!result.ok) {
        signInFirst(result.status, paths.confirm);
        if (result.code === "insufficient_funds") return fresh({ error: result.message, field: "funds" });
        return fresh({ error: result.message });
      }
      refresh();
      return redirect(paths.trade(result.data.id));
    },

    /** Posts an ad: price and limits in the market's currency, the amount in the coin, in the market chosen. */
    async postAd(form: FormData): Promise<FormState> {
      const price = toMinor(text(form, "price"));
      const min = toMinor(text(form, "min_fiat"));
      const max = toMinor(text(form, "max_fiat"));
      const amount = cryptoAmount(text(form, "amount"));
      if (!price) return { error: "Enter your price.", field: "price" };
      if (!amount) return { error: "Enter how much to trade.", field: "amount" };
      if (!min) return { error: "Enter the smallest trade you take.", field: "min_fiat" };
      if (!max) return { error: "Enter the largest trade you take.", field: "max_fiat" };
      const result = await api<StoreP2pAd>("POST", "/v1/store/p2p/ads", {
        side: text(form, "side") === "buy" ? "buy" : "sell",
        asset: text(form, "asset"),
        ...(text(form, "currency") ? { currency: text(form, "currency") } : {}),
        ...(/^[A-Z]{2}$/.test(text(form, "market")) ? { market: text(form, "market") } : {}),
        price,
        amount,
        min_fiat: min,
        max_fiat: max,
        terms: text(form, "terms") || undefined,
      });
      if (!result.ok) {
        signInFirst(result.status, paths.ads);
        return { error: result.message, field: result.param };
      }
      refresh();
      return redirect(`${paths.ads}?posted=1`);
    },

    /** Pauses, resumes or closes one of the customer's ads (closing gives back what it locks). */
    async changeAd(form: FormData): Promise<FormState> {
      const id = encodeURIComponent(text(form, "id"));
      const op = text(form, "op");
      const result = op === "cancel" ? await api("POST", `/v1/store/p2p/ads/${id}/cancel`) : await api("PATCH", `/v1/store/p2p/ads/${id}`, { status: op === "resume" ? "active" : "paused" });
      if (!result.ok) {
        signInFirst(result.status, paths.ads);
        return { error: result.message };
      }
      refresh();
      return {};
    },

    /** Changes an ad's price (a buy ad locks more, or gives back what it no longer needs). */
    async repriceAd(form: FormData): Promise<FormState> {
      const price = toMinor(text(form, "price"));
      if (!price) return { error: "Enter your new price.", field: "price" };
      const result = await api("PATCH", `/v1/store/p2p/ads/${encodeURIComponent(text(form, "id"))}`, { price });
      if (!result.ok) return { error: result.message, field: "price" };
      refresh();
      return { notice: "Price updated." };
    },

    /** Chooses the nickname others see on the market, once. */
    async chooseNickname(form: FormData): Promise<FormState> {
      const result = await api<StoreP2pProfile>("PUT", "/v1/store/p2p/profile", { nickname: text(form, "nickname") });
      if (!result.ok) return { error: result.message, field: "nickname" };
      refresh();
      return { notice: `You trade as ${result.data.nickname}.` };
    },

    /** The crypto declaration (not a US or UK citizen or resident), made once per version before trading. */
    async declare(form: FormData): Promise<void> {
      if (form.get("confirm") !== "yes") return;
      await api("POST", "/v1/store/crypto/declaration", { version: text(form, "version") });
      refresh();
    },
  };
}
