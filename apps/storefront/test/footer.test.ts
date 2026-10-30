import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { StoreFooter } from "@/components/store/layout";
import { type HostedStore, storeCredit } from "@/lib/store";

// The footer: one All categories button (the categories only inside its full-screen dialog), help and the legal
// documents on one line; bitocard.com's business links; nothing of BitoCard's own business on a reseller's store, and
// BitoCard's name left out on a white-label store.
const group = (key: string, label: string, onSale: boolean) =>
  ({ key, label, on_sale: onSale, brands: [], categories: [{ object: "store_category", category: key, label, group: key, icon_url: null, image_url: null, products: onSale ? 3 : 0, on_sale: onSale }] }) as unknown as StoreNavigationGroup;
const groups = [group("gift_cards", "Gift cards", true), group("rdp", "RDP", false)];
const store = (whiteLabel: boolean, house = false) =>
  ({ object: "storefront", name: house ? "BitoCard NG" : "Ada Digital", subdomain: house ? "ng" : "ada", branding: { logo_url: null, primary_color: "#070f4c", accent_color: "#ff2382" }, country: "NG", currency: "NGN", checkout_mode: "live", white_label: whiteLabel, house }) as HostedStore;
const render = (hosted: HostedStore | null) => renderToStaticMarkup(createElement(StoreFooter, { groups, store: hosted }));
const outsideDialog = (html: string) => html.replace(/<dialog[\s\S]*<\/dialog>/, "");

describe("store footer", () => {
  test("categories are never listed in the footer itself: one button opens them all", () => {
    const html = render(null);
    expect(html).toContain("All categories");
    expect(outsideDialog(html)).not.toContain("/catalogs/gift_cards");
    expect(html).toMatch(/<dialog[^>]*>[\s\S]*\/catalogs\/gift_cards[\s\S]*Soon[\s\S]*<\/dialog>/);
  });

  test("bitocard.com shows its business links and credit", () => {
    const html = render(null);
    for (const text of ["Open a reseller store", "Reseller sign in", "Reseller terms", "A Golojan Ltd venture"]) expect(html).toContain(text);
    // BitoCard Shop has left BitoCard (docs/UDOZO_SPINOFF_PLAN.md): its terms are never linked.
    expect(html).not.toContain("/documents/shop-terms");
  });

  test("a reseller's store shows nothing of BitoCard's own business, only what it sells, and who sells it", () => {
    const html = render(store(false));
    for (const text of ["Open a reseller store", "Reseller sign in", "Reseller terms", "/resellers", "Golojan", "/documents/shop-terms"]) expect(html).not.toContain(text);
    expect(html).toContain("Ada Digital · Sold and delivered by BitoCard");
    expect(html).not.toContain("/catalogs/rdp");
    for (const text of ["Privacy", "Terms", "Cookies"]) expect(html).toContain(text);
  });

  test("a white-label store leaves BitoCard's name out", () => {
    const html = render(store(true));
    expect(html).not.toMatch(/BitoCard|Bitocard/);
    expect(storeCredit(store(true), "x")).toBeNull();
    expect(storeCredit(null, "A Golojan Ltd venture")).toBe("A Golojan Ltd venture");
  });

  test("a market's own country store is BitoCard's own, just localised: BitoCard's business links and credit, never a distinct name", () => {
    const html = render(store(false, true));
    expect(html).not.toContain("BitoCard NG");
    for (const text of ["Open a reseller store", "Reseller sign in", "Reseller terms", "A Golojan Ltd venture"]) expect(html).toContain(text);
    expect(html).not.toContain("Sold and delivered by BitoCard");
    expect(storeCredit(store(false, true), "A Golojan Ltd venture")).toBe("A Golojan Ltd venture");
    // Only sells what the market has on sale, like a reseller's store, unlike root which shows every group with "Soon".
    expect(html).not.toContain("/catalogs/rdp");
  });
});
