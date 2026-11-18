import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { StoreHeader } from "@/components/store/layout";
import { doorChoices } from "@/components/store/account-menus";
import type { HostedStore } from "@/lib/store";

// The header: root bitocard.com's own wordmark and business links; a market's own country store (house) wears the
// same wordmark and links, just localised to its market, never a distinct name or logo; only a reseller's store
// shows its own name and logo and drops BitoCard's business call to action.
const groups: StoreNavigationGroup[] = [];
const countries: StoreCountry[] = [];
const store = (house: boolean) =>
  ({
    object: "storefront",
    name: house ? "BitoCard NG" : "Ada Digital",
    subdomain: house ? "ng" : "ada",
    branding: { logo_url: "https://cdn.example/ada-logo.png", primary_color: "#070f4c", accent_color: "#ff2382" },
    country: "NG",
    currency: "NGN",
    checkout_mode: "live",
    house,
  }) as HostedStore;
const render = (hosted: HostedStore | null) => renderToStaticMarkup(createElement(StoreHeader, { groups, countries, market: null, signedIn: false, store: hosted }));

describe("store header", () => {
  test("bitocard.com shows its own wordmark, and Sign in and Register each choose customer or reseller", () => {
    const html = render(null);
    expect(html).toContain("Bitocard home");
    expect(html).not.toContain("Ada Digital");
    expect(html).not.toContain("Start Reselling");
    expect(html).toMatch(/aria-haspopup="menu"[^>]*>.*?Sign in/);
    expect(html).toMatch(/aria-haspopup="menu"[^>]*>.*?Register/);
  });

  test("signing in and registering lead customers to this site and resellers to Seller HQ", () => {
    const choices = doorChoices({ customerSignIn: "/signin", customerSignUp: "/signup", resellerSignIn: "https://shq.bitocard.com/signin", resellerSignUp: "https://shq.bitocard.com/signup", resellerInfo: "/resellers" });
    expect(choices.signIn.map(choice => [choice.title, choice.href])).toEqual([
      ["Sign in as a customer", "/signin"],
      ["Sign in as a reseller", "https://shq.bitocard.com/signin"],
    ]);
    expect(choices.register.map(choice => [choice.title, choice.href])).toEqual([
      ["Register as a customer", "/signup"],
      ["Register as a reseller", "https://shq.bitocard.com/signup"],
    ]);
  });

  test("signed in, bitocard.com shows the account instead", () => {
    const html = renderToStaticMarkup(createElement(StoreHeader, { groups, countries, market: null, signedIn: true, store: null }));
    expect(html).toContain(">Account<");
    expect(html).not.toContain("Register");
  });

  test("a reseller's store shows its own name and logo, never BitoCard's wordmark or the reseller call to action", () => {
    const html = render(store(false));
    expect(html).toContain("Ada Digital");
    expect(html).toContain("ada-logo.png");
    expect(html).not.toContain("Bitocard home");
    expect(html).not.toContain("Start Reselling");
    expect(html).not.toContain("Register");
    expect(html).toContain('href="/signin"');
    expect(html).not.toContain("Shop globally");
  });

  test("the menu's quick links lead to the catalogue, never to BitoCard Shop", () => {
    const html = renderToStaticMarkup(createElement(StoreHeader, { groups, countries, market: "NG", signedIn: true, store: null }));
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)</g)].map(match => [match[1]!.replaceAll("&amp;", "&"), match[2]]);
    const quick = links.filter(([href]) => href!.startsWith("/catalogs/"));
    expect(quick.map(([, label]) => label)).toEqual(["RDP", "VPN"]);
    expect(html).not.toContain(">Shop<");
    expect(html).not.toContain("shop.bitocard.com");
    expect(html).not.toContain("/listings");
  });
});
describe("currency menu", () => {
  test("offers US dollars and the picker's markets' currencies, nothing else", async () => {
    const { currencyChoices } = await import("@/components/store/currency-menu");
    const markets: StoreCountry[] = [
      { code: "NG", name: "Nigeria", currency: "NGN", products: 3 },
      { code: "GH", name: "Ghana", currency: "GHS", products: 0 },
      { code: "SN", name: "Senegal", currency: "XOF", products: 0 },
      { code: "BJ", name: "Benin", currency: "XOF", products: 0 },
    ];
    const choices = currencyChoices(markets);
    expect(choices.map(item => item.code)).toEqual(["USD", "XOF", "GHS", "NGN"]);
    expect(choices.find(item => item.code === "NGN")?.symbol).toBe("₦");
    expect(currencyChoices([]).map(item => item.code)).toEqual(["USD"]);
  });
});
