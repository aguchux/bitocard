// Udozo's header, mobile first: the Categories menu beside the lockup, the country just left of the profile icon, and the
// named links in the profile menu below desktop width (so the bar keeps room on phones).
import "./request";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/ng", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/account-actions", () => ({ signOut: async () => undefined }));

const { HeaderBar } = await import("@/components/header");
const { CategoryMenu } = await import("@/components/category-menu");

const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN" } as never;
const customer = { id: "c1", name: "Ngozi Okafor", email: "ngozi@example.com" } as never;
const categories = [
  { slug: "vehicles", name: "Vehicles", icon: "car", children: [{ slug: "cars", name: "Cars", icon: "car" }] },
  { slug: "services", name: "Services", icon: null, children: [] },
];

describe("the header", () => {
  const html = renderToStaticMarkup(createElement(HeaderBar, { market, customer, showcase: false, categories }));

  it("puts the Categories menu right of the lockup, before the named links", () => {
    expect(html.indexOf('aria-label="Udozo home"')).toBeLessThan(html.indexOf('aria-label="Categories"'));
    expect(html.indexOf('aria-label="Categories"')).toBeLessThan(html.indexOf('aria-label="Udozo"'));
    // The links leave Categories to its menu.
    expect(html).not.toContain('href="/ng#categories"');
  });

  it("puts the country just left of the profile icon", () => {
    const country = html.indexOf('title="Nigeria"');
    const profile = html.indexOf('aria-label="Account: Ngozi Okafor"');
    expect(country).toBeGreaterThan(-1);
    expect(country).toBeLessThan(profile);
    expect(html.slice(country, profile)).not.toMatch(/<a /);
  });

  it("keeps the named links in the profile menu below desktop width, with the account's places", () => {
    const menu = html.slice(html.indexOf('aria-label="Account"'));
    expect(menu).toContain('href="/account/wallet"');
    expect(menu).toContain('href="/ng/areas"');
    expect(menu).toContain("Sign out");
  });

  it("signed out, the profile icon opens Sign in on phones; desktops get a Sign in button", () => {
    const out = renderToStaticMarkup(createElement(HeaderBar, { market, customer: null, showcase: false, categories }));
    expect(out).toContain('aria-label="Account menu"');
    expect(out).toMatch(/<details class="relative xl:hidden"/);
    expect(out).toMatch(/xl:inline-flex[^"]*"[^>]*>Sign in</);
  });
});

describe("the Categories menu", () => {
  const html = renderToStaticMarkup(createElement(CategoryMenu, { categories, prefix: "/ng/c/", allHref: "/ng/search", place: "Nigeria" }));

  it("is a clear bordered menu button, labelled on tablets up", () => {
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-label="Categories"[^>]*class="[^"]*border-2[^"]*"/);
    expect(html).toContain('<span class="hidden text-[15px] font-bold sm:inline">Categories</span>');
  });

  it("lists every top category, with its subcategories behind a toggle", () => {
    expect(html).toContain('href="/ng/c/vehicles"');
    expect(html).toContain('href="/ng/c/services"');
    expect(html).toContain('href="/ng/c/cars"');
    expect(html).toContain("All Vehicles");
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-label="Show Vehicles subcategories"/);
    expect(html).toMatch(/<ul id="[^"]+-vehicles" hidden=""/);
    // No toggle where there is nothing under it.
    expect(html).not.toContain("Show Services subcategories");
    expect(html).toContain('href="/ng/search"');
  });

  it("says so when the categories could not be loaded", () => {
    const empty = renderToStaticMarkup(createElement(CategoryMenu, { categories: [], prefix: "/c/", allHref: "/", place: null }));
    expect(empty).toContain("Categories could not be loaded just now.");
  });
});
