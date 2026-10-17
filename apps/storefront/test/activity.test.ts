import { describe, expect, test } from "vitest";
import type { StoreCryptoTransaction } from "@bitocard/api-client/storefront";
import { activityCursor, activityHref, activityShow, cryptoMoves, recentItems, recentLimit, recentWindowMs } from "@/lib/activity";

const now = Date.parse("2026-10-17T05:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
const move = (id: string, hours: number, balance: StoreCryptoTransaction["balance"] = "available"): StoreCryptoTransaction => ({
  object: "crypto_transaction",
  id,
  type: "crypto_deposit",
  balance,
  description: "Deposit",
  asset: "USDT",
  amount: "1.00",
  trade_id: null,
  ad_id: null,
  created_at: hoursAgo(hours),
});

describe("the wallet page's recent activity", () => {
  test("only the last 24 hours, newest first, a few at most", () => {
    expect(recentWindowMs).toBe(86_400_000);
    expect(recentLimit).toBe(5);
    const items = [move("a", 0.1), move("b", 3), move("c", 23.9), move("d", 24.1), move("e", 48)];
    expect(recentItems(items, now).map(item => item.id)).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: 9 }, (_, i) => move(`m${i}`, i));
    expect(recentItems(many, now).map(item => item.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(recentItems(many, now, 2)).toHaveLength(2);
    expect(recentItems([{ created_at: "not a date" }], now)).toEqual([]);
  });

  test("coin activity leaves out lock moves (an ad's lock shows once, as it leaves)", () => {
    expect(cryptoMoves([move("a", 1), move("b", 1, "locked"), move("c", 1, "frozen"), move("d", 1, "withdrawing")]).map(item => item.id)).toEqual(["a"]);
  });
});

describe("the activity screen's address", () => {
  const id = "0d1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";

  test("money by default, crypto when asked, with the cursor for older pages", () => {
    expect(activityShow(undefined)).toBe("money");
    expect(activityShow("crypto")).toBe("crypto");
    expect(activityShow("anything")).toBe("money");
    expect(activityHref("money")).toBe("/account/wallet/activity");
    expect(activityHref("crypto")).toBe("/account/wallet/activity?show=crypto");
    expect(activityHref("crypto", id)).toBe(`/account/wallet/activity?show=crypto&after=${id}`);
    expect(activityHref("money", id)).toBe(`/account/wallet/activity?after=${id}`);
  });

  test("only an ID is passed on as the cursor", () => {
    expect(activityCursor(id)).toBe(id);
    expect(activityCursor(undefined)).toBeNull();
    expect(activityCursor("x&limit=100")).toBeNull();
  });
});
