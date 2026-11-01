// Udozo's header, mobile first: one bar of the Categories menu and the search (its own row on phones, beside the lockup
// on desktops), one named link (Safe pay), and the country just left of the profile icon.
import "./request";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = { path: "/ng", params: new URLSearchParams() };
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => nav.params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/account-actions", () => ({ signOut: async () => undefined }));

const { HeaderBar } = await import("@/components/header");
const { CategoryMenu } = await import("@/components/category-menu");
const { HeaderSearch, SearchBlend } = await import("@/components/header-search");

const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN" } as never;
const customer = { id: "c1", name: "Ngozi Okafor", email: "ngozi@example.com" } as never;
const categories = [
  { slug: "vehicles", name: "Vehicles", icon: "car", children: [{ slug: "cars", name: "Cars", icon: "car" }] },
  { slug: "services", name: "Services", icon: null, children: [] },
];

describe("the header", () => {
  const html = renderToStaticMarkup(createElement(HeaderBar, { market, customer, showcase: false, categories }));

  it("blends the Categories menu and the search into one bar after the lockup", () => {
    const logo = html.indexOf('aria-label="Udozo home"');
    const menu = html.indexOf('aria-label="Categories"');
    const search = html.indexOf('aria-label="Search Udozo"');
    expect(logo).toBeLessThan(menu);
    expect(menu).toBeLessThan(search);
    // One bordered bar holds both: the search form follows the menu's drawer at once.
    expect(html).toContain('</dialog><form role="search" class="relative min-w-0 flex-1" action="/ng/search"');
    expect(html).not.toContain('aria-label="Udozo"');
  });

  it("gives the bar its own full-width row on phones and tablets, beside the lockup from desktops", () => {
    const row = html.match(/<div data-header-search="true" class="([^"]+)"/)?.[1].split(" ") ?? [];
    expect(row).toEqual(expect.arrayContaining(["order-last", "basis-full", "lg:order-none", "lg:flex-1", "lg:basis-auto"]));
  });

  it("puts the country just left of the profile icon", () => {
    const country = html.indexOf('title="Nigeria"');
    const profile = html.indexOf('aria-label="Account: Ngozi Okafor"');
    expect(country).toBeGreaterThan(-1);
    expect(country).toBeLessThan(profile);
    expect(html.slice(country, profile)).not.toMatch(/<a /);
  });

  it("has one named link, Safe pay, before the country; the profile menu holds only the account", () => {
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1]).filter(href => !href.startsWith("/ng/c/") && href !== "/ng/search");
    expect(links).toEqual(["/ng", "/safe-trade#safe-pay", "/account", "/account/messages", "/account/orders", "/account/wallet", "/account/profile", "/sell"]);
    expect(html.indexOf('href="/safe-trade#safe-pay"')).toBeLessThan(html.indexOf('title="Nigeria"'));
    expect(html).toContain("Sign out");
  });

  it("signed out, the profile icon opens Sign in on phones; desktops get a Sign in button", () => {
    const out = renderToStaticMarkup(createElement(HeaderBar, { market, customer: null, showcase: false, categories }));
    expect(out).toContain('aria-label="Account menu"');
    expect(out).toMatch(/<details class="relative">/);
    expect(out).toMatch(/lg:inline-flex[^"]*"[^>]*>Sign in</);
    expect(out).toContain('href="/signup"');
  });
});

describe("the header's search", () => {
  const props = { country: "NG", categories, prefix: "/ng/c/", allHref: "/ng/search", place: "Nigeria" };

  it("carries the page's words, area and state from the address, and focuses on an empty search page", () => {
    nav.path = "/ng/search";
    nav.params = new URLSearchParams("q=iphone&area=ikeja&state=lagos");
    const html = renderToStaticMarkup(createElement(HeaderSearch, props));
    expect(html).toContain('value="iphone"');
    expect(html).toContain('<input type="hidden" name="area" value="ikeja"/>');
    expect(html).toContain('<input type="hidden" name="state" value="lagos"/>');
    expect(html).not.toContain("autofocus");
    nav.params = new URLSearchParams();
    expect(renderToStaticMarkup(createElement(HeaderSearch, props))).toMatch(/autofocus/i);
    nav.path = "/ng";
    expect(renderToStaticMarkup(createElement(HeaderSearch, props))).not.toMatch(/autofocus/i);
  });

  it("without a country the bar's other half goes to a market: the customer's own, else choosing one", () => {
    const own = renderToStaticMarkup(createElement(SearchBlend, { ...props, country: null, prefix: "/c/", allHref: "/", place: null, continueTo: { country: "NG", name: "Nigeria" } }));
    expect(own).not.toContain('role="search"');
    expect(own).toMatch(/aria-label="Categories"[\s\S]*<\/dialog><a class="[^"]*flex-1[^"]*" href="\/ng">.*Continue to Nigeria/);
    const none = renderToStaticMarkup(createElement(SearchBlend, { ...props, country: null, prefix: "/c/", allHref: "/", place: null }));
    expect(none).toContain('href="/#countries"');
    expect(none).toContain("Choose your country");
  });

  it("the global header takes the signed-in customer to their own country", () => {
    const html = renderToStaticMarkup(createElement(HeaderBar, { market: null, customer, showcase: true, categories, continueTo: { country: "NG", name: "Nigeria" } }));
    expect(html).toContain("Continue to Nigeria");
    expect(html).toContain('href="/safe-trade#safe-pay"');
  });
});

describe("the Categories menu", () => {
  const html = renderToStaticMarkup(createElement(CategoryMenu, { categories, prefix: "/ng/c/", allHref: "/ng/search", place: "Nigeria" }));

  it("is the bar's navy left end, labelled from tablets up", () => {
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-label="Categories"[^>]*class="[^"]*rounded-l-2xl bg-navy-900 text-white[^"]*"/);
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
