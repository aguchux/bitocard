import { describe, expect, test } from "vitest";
import { accountSections } from "@/components/app/account-sections";
import { subMenuFor, subMenusFor, type SubMenuContext } from "@/components/app/sub-menus";
import { appTabs } from "@/components/app/tabs";

const context: SubMenuContext = {
  groups: [
    { key: "gift-cards", label: "Gift cards" },
    { key: "mobile", label: "Mobile" },
  ],
  currency: "NGN",
};
const active = (path: string, search = "", ctx = context) => subMenuFor(path, search, ctx)?.active;

describe("desktop sub rails", () => {
  test("every tab but Home has one, in tab order, with every item at its own address", () => {
    const menus = subMenusFor(context);
    expect(menus.map(menu => menu.key)).toEqual(["catalog", "orders", "wallet", "account"]);
    expect(menus.map(menu => menu.href)).toEqual(appTabs.filter(tab => tab.href !== "/account").map(tab => tab.href));
    for (const menu of menus) expect(new Set(menu.items.map(item => item.href)).size).toBe(menu.items.length);
    expect(menus[3]!.items.map(item => item.href)).toEqual(accountSections.map(item => item.href));
  });

  test("Catalog lists everything, then each group on sale, picked by ?group=", () => {
    expect(subMenusFor(context)[0]!.items.map(item => item.label)).toEqual(["All products", "Gift cards", "Mobile"]);
    expect(subMenuFor("/account/catalog", "", context)).toMatchObject({ menu: { key: "catalog" }, active: "/account/catalog" });
    expect(active("/account/catalog", "?group=mobile")).toBe("/account/catalog?group=mobile");
    expect(active("/account/catalog", "group=mobile&brand=mtn")).toBe("/account/catalog?group=mobile");
    // A search, a brand or a group no longer on sale: All products.
    expect(active("/account/catalog", "q=steam")).toBe("/account/catalog");
    expect(active("/account/catalog", "group=bills")).toBe("/account/catalog");
    // A product page shows the rail with nothing current.
    expect(subMenuFor("/account/p/gift_cards:US:amazon:usd", "", context)).toMatchObject({ menu: { key: "catalog" }, active: null });
  });

  test("Orders lists its filters and the disputes", () => {
    expect(active("/account/orders")).toBe("/account/orders");
    expect(active("/account/orders", "show=delivered")).toBe("/account/orders?show=delivered");
    expect(active("/account/orders", "show=delivered&after=chk_1")).toBe("/account/orders?show=delivered");
    expect(active("/account/orders", "show=nonsense")).toBe("/account/orders");
    expect(subMenuFor("/account/orders/chk_123", "", context)).toMatchObject({ menu: { key: "orders" }, active: null });
    expect(active("/account/disputes")).toBe("/account/disputes");
    expect(active("/account/disputes/dsp_1")).toBe("/account/disputes");
    expect(active("/account/disputes/new", "checkout=chk_1")).toBe("/account/disputes");
  });

  test("Wallet lists the country's wallet, US dollars and the transactions (crypto has left BitoCard)", () => {
    expect(subMenusFor(context)[2]!.items.map(item => item.label)).toEqual(["NGN wallet", "US dollars", "Transactions"]);
    // The Transactions screen has its own item, whatever its list or page; the wallets are not current there.
    expect(active("/account/wallet/transactions")).toBe("/account/wallet/transactions");
    expect(active("/account/wallet/transactions", "show=crypto&after=x")).toBe("/account/wallet/transactions");
    expect(active("/account/wallet")).toBe("/account/wallet");
    expect(active("/account/wallet", "wallet=usd")).toBe("/account/wallet?wallet=USD");
    expect(active("/account/wallet", "wallet=NGN")).toBe("/account/wallet");
    // A dollar country has one money wallet; an account without a country its default.
    expect(subMenusFor({ ...context, currency: "USD" })[2]!.items.map(item => item.label)).toEqual(["US dollars", "Transactions"]);
    expect(active("/account/wallet", "wallet=USD", { ...context, currency: "USD" })).toBe("/account/wallet");
    expect(subMenusFor({ ...context, currency: null })[2]!.items.map(item => item.label)).toEqual(["Your wallet", "Transactions"]);
  });

  test("crypto has no rail: its old addresses are no tab's place", () => {
    expect(subMenuFor("/account/crypto")).toBeNull();
    expect(subMenuFor("/account/crypto/wallets")).toBeNull();
  });

  test("the Account rail shows on its screens only; Home and the Account page have none", () => {
    expect(subMenuFor("/account/profile/security")).toMatchObject({ menu: { key: "account" }, active: "/account/profile/security" });
    expect(subMenuFor("/account/verification?country=NG")?.active).toBe("/account/verification");
    expect(subMenuFor("/account/profile")).toBeNull();
    expect(subMenuFor("/account")).toBeNull();
    expect(subMenuFor("/account/cryptocurrency")).toBeNull();
    expect(subMenuFor("/account/walletx")).toBeNull();
  });
});
