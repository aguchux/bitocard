import { describe, expect, test } from "vitest";
import { accountSections } from "@/components/app/account-sections";
import { cryptoSections, subMenuFor, subMenus } from "@/components/app/sub-menus";

describe("desktop sub rails", () => {
  test("Crypto and Account each have one, with every item at its own address", () => {
    expect(subMenus.map(menu => menu.key)).toEqual(["crypto", "account"]);
    for (const menu of subMenus) expect(new Set(menu.items.map(item => item.href)).size).toBe(menu.items.length);
    expect(subMenus[1]!.items.map(item => item.href)).toEqual(accountSections.map(item => item.href));
  });

  test("every crypto page shows the Crypto rail, with the most specific item current", () => {
    expect(subMenuFor("/account/crypto")).toMatchObject({ menu: { key: "crypto" }, active: "/account/crypto" });
    expect(subMenuFor("/account/crypto/market?asset=USDT")?.active).toBe("/account/crypto/market");
    expect(subMenuFor("/account/crypto/trades/abc")?.active).toBe("/account/crypto/trades");
    expect(subMenuFor("/account/crypto/withdraw/confirm")?.active).toBe("/account/crypto/withdraw");
    expect(subMenuFor("/account/crypto/withdrawals/123")?.active).toBe("/account/crypto/withdraw");
    // A trade's confirmation belongs to no one place.
    expect(subMenuFor("/account/crypto/confirm")).toMatchObject({ menu: { key: "crypto" }, active: null });
    expect(cryptoSections[0]!.label).toBe("Wallets");
  });

  test("the Account rail shows on its screens only, not on the Account page or other tabs", () => {
    expect(subMenuFor("/account/profile/security")).toMatchObject({ menu: { key: "account" }, active: "/account/profile/security" });
    expect(subMenuFor("/account/verification?country=NG")?.active).toBe("/account/verification");
    expect(subMenuFor("/account/profile")).toBeNull();
    expect(subMenuFor("/account/wallet")).toBeNull();
    expect(subMenuFor("/account")).toBeNull();
    expect(subMenuFor("/account/cryptocurrency")).toBeNull();
  });
});
