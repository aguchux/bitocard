// Udozo's header, mobile first: one bar of the Categories menu and the search (its own row on phones, beside the lockup
// on desktops), the Get help menu (Safe pay, FAQs, Resell on Udozo, Contact us), and the country just left of the profile icon.
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

  it("has the Get help menu before the country, its open places as links; the profile menu holds only the account", () => {
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1]).filter(href => !href.startsWith("/ng/c/") && href !== "/ng/search" && href !== "/ng/areas");
    expect(links).toEqual(["/ng", "/safe-trade#safe-pay", "/help/faqs", "/start-here", "/help/contact", "/account", "/account/messages", "/account/orders", "/account/wallet", "/account/profile", "/sell?from=header"]);
    expect(html.indexOf('aria-label="Get help"')).toBeLessThan(html.indexOf('href="/safe-trade#safe-pay"'));
    expect(html.indexOf('href="/help/contact"')).toBeLessThan(html.indexOf('title="Nigeria"'));
    expect(html).toContain("Sign out");
  });

  it("the profile button is the icon alone, with no Account text beside it", () => {
    const summary = html.match(/<summary[^>]*aria-label="Account: Ngozi Okafor"[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "";
    expect(summary).toContain(">NO</span>");
    expect(summary).not.toContain("Account");
    expect(summary).not.toContain("<svg");
  });

  it("signed out, the profile icon opens Sign in on phones; desktops get a Sign in button", () => {
    const out = renderToStaticMarkup(createElement(HeaderBar, { market, customer: null, showcase: false, categories }));
    expect(out).toContain('aria-label="Account menu"');
    expect(out).toMatch(/<details class="sm:relative">/);
    expect(out).toMatch(/lg:inline-flex[^"]*"[^>]*>Sign in</);
    expect(out).toContain('href="/signup"');
  });

  it("never widens a phone's page: the bar takes its row's width and every menu opens against the header's edge", () => {
    // The search's row shrinks to the screen (its field asking for no width of its own), whatever it holds.
    expect(html).toMatch(/data-header-search="true" class="order-last min-w-0 basis-full/);
    expect(html).toMatch(/<input type="search"[^>]*class="w-0 min-w-0 flex-1/);
    // Help, country and account menus: positioned from tablets up, against the header (16px in) on phones.
    expect(html.match(/<details class="sm:relative">/g)).toHaveLength(2);
    for (const label of ["Get help", "Account"]) expect(html).toMatch(new RegExp(`<nav aria-label="${label}" class="[^"]*absolute right-4 `));
    // The Get help pointer joins the menu to its button only where the menu hangs from it.
    expect(html).toMatch(/<span class="absolute -top-1\.5 [^"]*hidden [^"]*sm:block"/);
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

  it("ends the bar with Near me, choosing the area: back to the same search from the search page", () => {
    nav.path = "/ng";
    nav.params = new URLSearchParams();
    const home = renderToStaticMarkup(createElement(HeaderSearch, props));
    expect(home).toMatch(/<\/form><a aria-label="Near me: choose your area" class="[^"]*rounded-r-2xl[^"]*" href="\/ng\/areas">.*Near me<\/span><\/a><\/div>$/);
    // On phones the pin alone (the words from tablets up), so the field keeps its room; the label still names it.
    expect(home).toMatch(/class="flex w-12 shrink-0 [^"]*sm:w-auto sm:px-3"/);
    expect(home).toContain('<span class="hidden sm:inline">Near me</span>');
    nav.path = "/ng/search";
    nav.params = new URLSearchParams("q=iphone&state=lagos");
    const search = renderToStaticMarkup(createElement(HeaderSearch, props));
    expect(search).toContain(`href="/ng/areas?next=${encodeURIComponent("/ng/search?q=iphone")}"`.replaceAll("&", "&amp;"));
    expect(search).toContain('aria-label="Near me: change your area"');
    nav.path = "/ng";
    nav.params = new URLSearchParams();
  });

  it("without a country the bar's other half goes to a market: the customer's own, else choosing one", () => {
    const own = renderToStaticMarkup(createElement(SearchBlend, { ...props, country: null, prefix: "/c/", allHref: "/", place: null, continueTo: { country: "NG", name: "Nigeria" } }));
    expect(own).not.toContain('role="search"');
    // Going on chooses that country (remembered for the home page), as the country menu does.
    expect(own).toMatch(/aria-label="Categories"[\s\S]*<\/dialog><a href="\/market\/ng" rel="nofollow" class="[^"]*flex-1[^"]*">.*Continue to Nigeria/);
    const none = renderToStaticMarkup(createElement(SearchBlend, { ...props, country: null, prefix: "/c/", allHref: "/", place: null }));
    // It opens the header's country menu (the link's target without script).
    expect(none).toContain('href="#country-menu"');
    expect(none).toContain("Choose your country");
  });

  it("the global header takes the signed-in customer to their own country", () => {
    const html = renderToStaticMarkup(createElement(HeaderBar, { market: null, customer, showcase: true, categories, continueTo: { country: "NG", name: "Nigeria" } }));
    expect(html).toContain("Continue to Nigeria");
    expect(html).toContain('href="/safe-trade#safe-pay"');
  });
});

describe("the country menu", () => {
  const countries = [
    { country: "NG", name: "Nigeria", listings: 1200 },
    { country: "GH", name: "Ghana", listings: 1 },
  ];

  it("from the second market, a dropdown of every market just left of the profile icon, the current one ticked", () => {
    const html = renderToStaticMarkup(createElement(HeaderBar, { market, customer, showcase: true, categories, countries }));
    const menu = html.indexOf('<details id="country-menu"');
    expect(menu).toBeGreaterThan(html.indexOf('href="/safe-trade#safe-pay"'));
    expect(menu).toBeLessThan(html.indexOf('aria-label="Account: Ngozi Okafor"'));
    expect(html).toContain('aria-label="Country: Nigeria. Change"');
    const list = html.slice(html.indexOf('<nav aria-label="Countries"'));
    // Each choice goes through /market/<choice>, which remembers it.
    expect(list).toMatch(/<a href="\/market\/ng" rel="nofollow" aria-current="page" class="[^"]*">/);
    expect(list).toContain('href="/market/gh"');
    expect(list).toContain("1,200 listings");
    expect(list).toContain("1 listing<");
    expect(list).toMatch(/href="\/market\/all"[^>]*>.*All countries/);
  });

  it("on the global page it is the globe, with All countries current", () => {
    const html = renderToStaticMarkup(createElement(HeaderBar, { market: null, customer: null, showcase: true, categories, countries }));
    expect(html).toContain('aria-label="Choose your country"');
    expect(html).toMatch(/<a href="\/market\/all" rel="nofollow" aria-current="page"/);
  });

  it("with one market open there is nothing to switch to: just its flag", () => {
    const html = renderToStaticMarkup(createElement(HeaderBar, { market, customer, showcase: false, categories, countries: countries.slice(0, 1) }));
    expect(html).not.toContain('id="country-menu"');
    expect(html).toContain('title="Nigeria"');
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
