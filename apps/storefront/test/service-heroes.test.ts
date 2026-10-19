import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isServiceHero, ServiceHero, serviceHeroKinds } from "@/components/store/service-heroes";

// The VPN shop's and RDP shop's heroes: each kind draws its headline in the theme's colours, its drawing hidden from
// screen readers, and the hero kinds of other templates are left to VariantHero.
const section = { id: "h1", type: "hero", span: { lg: 12, md: 6 }, hidden: false, title: "Your desktop,", accent: "in the cloud.", subtitle: "Reach it from any device.", search: false, categoryChips: false, data: { featured: [] } } as never;

describe("service heroes", () => {
  it("knows its six kinds and nothing else", () => {
    expect(serviceHeroKinds).toEqual(["shield", "devices", "tunnel", "desktop", "rack", "blueprint"]);
    expect(serviceHeroKinds.every(isServiceHero)).toBe(true);
    for (const other of ["search", "gradient", "story", "spotlight"]) expect(isServiceHero(other)).toBe(false);
  });

  it.each(serviceHeroKinds)("%s draws the headline, its subtitle and a hidden drawing in the theme's colours", kind => {
    const html = renderToStaticMarkup(createElement(ServiceHero, { kind, section, id: "hero-h1", frame: "rounded-3xl", inner: "px-6" }));
    expect(html).toContain('aria-labelledby="hero-h1"');
    expect(html).toMatch(/<h1 id="hero-h1"[^>]*>Your desktop, <span[^>]*>in the cloud\.<\/span><\/h1>/);
    expect(html).toContain("Reach it from any device.");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("var(--st-");
  });
});
