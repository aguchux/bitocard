// A category page's header on udozo.com (8 November 2026, the owner's request): the top category's banner, its name
// and listings over the banner's left side, and its spotlight image on a circle; a subcategory shows its top
// category's banner with its own icon in the circle; without pictures, Udozo's drawn banner and the icon. Below it,
// the subcategories as pills with icons, the one shown marked.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { CategoryHero, SubcategoryPills } = await import("@/components/category-hero");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const top = { slug: "phones-tablets", name: "Phones and tablets", icon: "smartphone", banner_url: "https://cdn.test/banner.webp", spotlight_url: "https://cdn.test/spot.png" };
const draw = (props: Parameters<typeof CategoryHero>[0]) => renderToStaticMarkup(createElement(CategoryHero, props));

describe("the category header", () => {
  it("a top category: its banner, name, listings and spotlight image (decoration only)", () => {
    const html = draw({ category: top, top, place: "Nigeria", listings: 1234 });
    expect(html).toContain('<h1 id="category-name"');
    expect(html).toContain("Phones and tablets</h1>");
    expect(html).toContain("1,234 listings in Nigeria");
    expect(html).toContain('src="https://cdn.test/banner.webp" alt=""');
    expect(html).toContain('src="https://cdn.test/spot.png" alt=""');
    expect(html, "the spotlight image sits on the banner with no white circle behind it").not.toContain("bg-white");
  });

  it("a subcategory: its top category's banner and name above, never the spotlight image", () => {
    const html = draw({ category: { slug: "tablets", name: "Tablets", icon: "tablet" }, top, place: "Nigeria", listings: 1, eyebrow: "Phones and tablets" });
    expect(html).toContain("https://cdn.test/banner.webp");
    expect(html).not.toContain("https://cdn.test/spot.png");
    expect(html).toContain("1 listing in Nigeria");
    expect(html).toContain(">Phones and tablets</p>");
  });

  it("without pictures, Udozo's drawn banner; while listings cannot be counted, where it is for sale", () => {
    const html = draw({ category: { slug: top.slug, name: top.name, icon: top.icon }, top: { ...top, banner_url: null, spotlight_url: null }, place: "Ghana", listings: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("For sale in Ghana");
  });

  it("subcategory pills link each, the one shown marked", () => {
    const items = [
      { slug: "mobile-phones", name: "Mobile phones", icon: "smartphone" },
      { slug: "tablets", name: "Tablets", icon: "tablet" },
    ];
    const html = renderToStaticMarkup(createElement(SubcategoryPills, { country: "ng", items, current: "tablets" }));
    expect(html).toContain('href="/ng/c/mobile-phones"');
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/ng\/c\/tablets"/);
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(SubcategoryPills, { country: "ng", items: [] }))).toBe("");
  });

  it("both category pages draw it", () => {
    expect(read("../app/[cc]/c/[category]/page.tsx")).toContain("<CategoryHero ");
    expect(read("../app/(global)/c/[category]/page.tsx")).toContain("<CategoryHero ");
  });
});
