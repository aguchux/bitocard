import { describe, expect, test } from "vitest";
import type { StoreDesign } from "@bitocard/api-client/storefront";
import { prefillFrom, quickBuyHref, quickBuyNeeds } from "@/lib/quick-buy";
import { quickLinksFor } from "@/lib/quick-links";
import { densityGap, storeShell, storeThemeVars } from "@/lib/store-theme";

const colors = { primary: "#065f46", accent: "#f59e0b", background: "#f4faf7", surface: "#ffffff", ink: "#062a20", muted: "#4b6b60", heroFrom: "#064e3b", heroTo: "#0f766e", heroInk: "#ffffff" };
const light: StoreDesign = { template: "all_in_one", variant: "classic", theme: "emerald", style: { mode: "light", hero: "search", corners: "round", cards: "raised", font: "sans", density: "comfortable" }, colors };
const dark: StoreDesign = {
  template: "vpn_shop",
  variant: "night_tunnel",
  theme: "matrix",
  style: { mode: "dark", hero: "terminal", corners: "sharp", cards: "flat", font: "mono", density: "compact" },
  colors: { primary: "#22c55e", accent: "#ef4444", background: "#05070a", surface: "#0d1117", ink: "#e6edf3", muted: "#8b949e", heroFrom: "#05070a", heroTo: "#0d1117", heroInk: "#e6edf3" },
};

describe("store theme", () => {
  test("re-points the pink scale to the primary, navy to the ink and the page to the background", () => {
    const vars = storeThemeVars(light);
    expect(vars["--color-brand-500"]).toBe("#065f46");
    expect(vars["--color-brand-50"]).toBe("color-mix(in srgb, #065f46 8%, #ffffff)");
    expect(vars["--color-navy-900"]).toBe("#062a20");
    expect(vars["--color-page"]).toBe("#f4faf7");
    expect(vars["--st-hero-from"]).toBe("#064e3b");
    // Light stores keep white surfaces, round corners and the usual shadows and type.
    expect(vars["--color-white"]).toBeUndefined();
    expect(vars["--radius-xl"]).toBeUndefined();
    expect(vars["--font-sans"]).toBeUndefined();
  });

  test("dark variants turn white and the slate scale into the theme's surfaces and text; the variant's corners, cards and type follow", () => {
    const vars = storeThemeVars(dark);
    expect(vars["--color-white"]).toBe("#0d1117");
    expect(vars["--color-slate-900"]).toBe("#e6edf3");
    expect(vars["--color-slate-500"]).toBe("#8b949e");
    expect(vars["--color-brand-600"]).toBe("color-mix(in srgb, #22c55e 88%, white)");
    expect(vars["--radius-xl"]).toBe("4px");
    expect(vars["--font-sans"]).toContain("monospace");
  });

  test("the shell's attributes, and nothing for bitocard.com", () => {
    expect(storeShell(undefined)).toEqual({});
    const shell = storeShell(dark);
    expect(shell["data-mode"]).toBe("dark");
    expect(shell["data-variant"]).toBe("night_tunnel");
    expect(shell["data-cards"]).toBe("flat");
    expect((shell.style as Record<string, string>).fontFamily).toContain("monospace");
    expect((shell.style as Record<string, string>)["--color-page"]).toBe("#05070a");
    expect(densityGap.airy).toContain("gap-12");
  });
});

describe("quick buy", () => {
  test("asks for the right number and an amount only for any-amount products", () => {
    expect(quickBuyNeeds("airtime", { denomination_type: "range" })).toEqual({ numberLabel: "Mobile number", numberMode: "tel", amount: true });
    expect(quickBuyNeeds("data", { denomination_type: "fixed" }).amount).toBe(false);
    expect(quickBuyNeeds("bills", { denomination_type: "range" }).numberLabel).toBe("Meter number");
    expect(quickBuyNeeds("pay_tv", { denomination_type: "fixed" })).toMatchObject({ numberLabel: "Smartcard or IUC number", numberMode: "numeric" });
  });

  test("opens the product with the number and amount, and the buy form reads them back cleaned", () => {
    expect(quickBuyHref("airtime:NG:mtn:topup", { number: " 0803 123 4567 ", amount: "500" })).toBe("/p/airtime%3ANG%3Amtn%3Atopup?number=0803+123+4567&amount=500");
    expect(quickBuyHref("data:NG:mtn:1gb", { number: "", amount: "" })).toBe("/p/data%3ANG%3Amtn%3A1gb");
    expect(prefillFrom("?number=0803+123+4567&amount=500")).toEqual({ number: "0803 123 4567", amount: "500" });
    expect(prefillFrom("?number=<script>&amount=1e9")).toEqual({ number: "", amount: "" });
  });
});

describe("quick links", () => {
  const group = (category: string, on_sale: boolean) => ({ key: category, label: category, on_sale, brands: [], categories: [{ object: "store_category" as const, category: category as never, label: category, group: null, icon_url: null, image_url: null, products: on_sale ? 1 : 0, on_sale }] });
  test("bitocard.com shows every quick link; a reseller's store only what it sells ", () => {
    expect(quickLinksFor([], null)).toEqual(["/catalogs/virtual_numbers", "/catalogs/rdp", "/catalogs/vpn"]);
    expect(quickLinksFor([group("gift_cards", true)], "gift_cards")).toEqual([]);
    expect(quickLinksFor([group("virtual_numbers", true), group("rdp", false), group("vpn", true), group("virtual_cards", true)], "all_in_one")).toEqual(["/catalogs/virtual_numbers", "/catalogs/vpn"]);
    // A Resale shop (Udozo's now) sells nothing of BitoCard's catalogue: no quick links, never its listings.
    expect(quickLinksFor([], "resale_shop")).toEqual([]);
  });
});
