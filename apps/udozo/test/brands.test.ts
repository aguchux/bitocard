// @vitest-environment jsdom
// Udozo's brand registry on udozo.com: the listing form's brand field (the category's brands with their logos at once,
// those matching what is typed, and a brand as typed when it is not listed), the filters' row of brand logos with
// their counts, each brand's logo or initials, and the logos bundled with the site.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brandInitials, brandTint, type ShopBrand, type ShopCategory, type ShopSearch } from "@bitocard/api-client/classifieds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const brand = (name: string, extra: Partial<ShopBrand> = {}): ShopBrand => ({ object: "classified_brand", slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, logo_url: null, color: null, ...extra });
const catalogue = [brand("Samsung", { logo_url: "https://udozo.com/brand-logos/samsung.svg", color: "#1428A0" }), brand("Apple", { logo_url: "https://udozo.com/brand-logos/apple.svg" }), brand("Tecno")];
const searchBrands = vi.fn(async (q: string, category?: string | null) => ({ ok: true as const, data: q && category !== undefined ? catalogue.filter(item => item.name.toLowerCase().startsWith(q.toLowerCase())) : catalogue }));
vi.mock("@/lib/shop-actions", () => ({ searchBrands: (q: string, category: string | null) => searchBrands(q, category) }));

const { BrandField, brandMatchKey } = await import("@/components/account/brand-field");
const { BrandLogo } = await import("@/components/brand-logo");
const { Results } = await import("@/components/results");
const { readFilters } = await import("@/lib/search");
const { filtersByBrand } = await import("@/lib/brands");

const mounted: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  mounted.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  searchBrands.mockClear();
});

function Field({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState("");
  return createElement(BrandField, {
    value,
    categoryId: "8b7e5d1c-0000-4000-8000-000000000001",
    label: "Brand",
    onChange: (next: string) => {
      setValue(next);
      onValue(next);
    },
  });
}

async function mount(onValue = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Field, { onValue })));
  mounted.push(() => act(() => root.unmount()));
  return { input: host.querySelector("input")!, onValue };
}
const settle = async () => act(async () => void (await vi.runAllTimersAsync()));
const type = (input: HTMLInputElement, text: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("the listing form's brand field", () => {
  it("opens with the category's brands and their logos, and picks one", async () => {
    const { input, onValue } = await mount();
    act(() => input.focus());
    await settle();
    expect(searchBrands).toHaveBeenCalledWith("", "8b7e5d1c-0000-4000-8000-000000000001");
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map(option => option.querySelector(".truncate")?.textContent)).toEqual(["Samsung", "Apple", "Tecno"]);
    expect(options[0].querySelector("img")?.getAttribute("src")).toBe("https://udozo.com/brand-logos/samsung.svg");
    act(() => (options[1] as HTMLElement).click());
    expect(onValue).toHaveBeenLastCalledWith("Apple");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    // The chosen brand's logo shows in the field.
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://udozo.com/brand-logos/apple.svg");
  });

  it("finds brands as the seller types, and keeps a brand that is not listed as typed", async () => {
    const { input, onValue } = await mount();
    act(() => input.focus());
    type(input, "sa");
    await settle();
    expect(searchBrands).toHaveBeenLastCalledWith("sa", expect.any(String));
    expect([...document.querySelectorAll('[role="option"]')].map(option => option.textContent?.replace(/^S(?=Samsung)/, ""))).toEqual(["Samsung", "Use “sa”Not in the list yet: we will look at adding it."]);
    // Arrow down and Enter choose.
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-0$/);
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onValue).toHaveBeenLastCalledWith("Samsung");
    type(input, "Zenphone");
    await settle();
    const fresh = [...document.querySelectorAll('[role="option"]')].at(-1) as HTMLElement;
    expect(fresh.textContent).toContain("Use “Zenphone”");
    act(() => fresh.click());
    expect(onValue).toHaveBeenLastCalledWith("Zenphone");
  });

  it("matches brands as the API does", () => {
    expect(brandMatchKey("Mercedes Benz")).toBe(brandMatchKey("mercedes-benz"));
    expect(brandMatchKey("Lancôme")).toBe("lancome");
  });
});

describe("a brand's logo", () => {
  it("is its logo on a white tile, else its initials on its colour (or one of Udozo's, always the same)", () => {
    expect(renderToStaticMarkup(createElement(BrandLogo, { brand: catalogue[0] }))).toContain('src="https://udozo.com/brand-logos/samsung.svg"');
    const initials = renderToStaticMarkup(createElement(BrandLogo, { brand: brand("Mercedes-Benz") }));
    expect(initials).toContain(">MB<");
    expect(initials).toContain(`background:${brandTint({ slug: "mercedes-benz", color: null })}`);
    expect(brandInitials("Tecno")).toBe("T");
    expect(brandInitials("LG")).toBe("LG");
    expect(brandTint({ slug: "x", color: "#FF0000" })).toBe("#FF0000");
  });
});

describe("the brand filter", () => {
  const phones = { object: "classified_category", id: "c1", slug: "mobile-phones", name: "Mobile phones", icon: "smartphone", b2b: false, safety_checklist: [], features: [{ object: "classified_feature", key: "brand", name: "Brand", icon: "tag", data_type: "text", unit: null, choices: [], default_value: null, placeholder: "e.g. Samsung", min: null, max: null, synonyms: [], filterable: true, filter: true }] } as ShopCategory;
  const result = { object: "list", data: [], total: 0, tiers: null, sort: "newest" } as unknown as ShopSearch;

  it("is a row of brand logos with their listings, most first and the chosen ones first, the rest under More brands", () => {
    const many = [brand("Tecno", { listings: 3 }), brand("Samsung", { listings: 9, logo_url: "https://udozo.com/brand-logos/samsung.svg" }), ...Array.from({ length: 14 }, (_, n) => brand(`Brand ${n}`, { listings: 0 }))];
    const filters = readFilters({ "f.brand": "Brand 13" });
    expect(filters.features).toEqual(["brand:Brand 13"]);
    const html = renderToStaticMarkup(createElement(Results, { result, filters, path: "/ng/c/mobile-phones", category: phones, brands: many, place: { country: "Nigeria" }, currency: "NGN" }));
    const page = Object.assign(document.createElement("div"), { innerHTML: html });
    const chips = [...page.querySelectorAll<HTMLInputElement>('input[name="f.brand"]')];
    expect(chips.slice(0, 3).map(chip => chip.value)).toEqual(["Brand 13", "Samsung", "Tecno"]);
    expect(chips.filter(chip => chip.checked).map(chip => chip.value)).toEqual(["Brand 13"]);
    expect(html).toContain(">More brands (4)</summary>");
    expect(html).toContain('src="https://udozo.com/brand-logos/samsung.svg"');
    expect(html).toContain(">9</span>");
    // No box to type the brand where the logos are shown.
    expect(html).not.toMatch(/Brand<input /);
  });

  it("falls back to a box to type it without the registry's brands, and only where the category filters by brand", () => {
    const html = renderToStaticMarkup(createElement(Results, { result, filters: readFilters({}), path: "/ng/c/mobile-phones", category: phones, place: { country: "Nigeria" }, currency: "NGN" }));
    expect(html).toMatch(/Brand<input [^>]*name="f\.brand"/);
    expect(filtersByBrand(phones)).toBe(true);
    expect(filtersByBrand({ ...phones, features: [] }, [phones])).toBe(true);
    expect(filtersByBrand({ ...phones, features: [] })).toBe(false);
  });
});

describe("the bundled logos", () => {
  it("are exactly the brands listed for them, each a plain coloured mark", () => {
    const map = JSON.parse(readFileSync(join(process.cwd(), "scripts/brand-logos.json"), "utf8")) as Record<string, { icon: string; hex: string }>;
    const files = readdirSync(join(process.cwd(), "public/brand-logos"));
    expect(files.sort()).toEqual(Object.keys(map).map(slug => `${slug}.svg`).sort());
    for (const file of files) {
      const svg = readFileSync(join(process.cwd(), "public/brand-logos", file), "utf8");
      expect(svg).toMatch(/^<svg fill="#[0-9A-F]{6}" /);
      expect(svg).not.toMatch(/<script|on[a-z]+=|href=/i);
    }
  });
});
