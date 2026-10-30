import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { StoreHeader } from "@/components/store/layout";
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
  test("bitocard.com shows its own wordmark and the reseller call to action", () => {
    const html = render(null);
    expect(html).toContain("Bitocard home");
    expect(html).not.toContain("Ada Digital");
    expect(html).toContain("Start Reselling");
  });

  test("a market's own country store wears BitoCard's own wordmark, never its own name or logo, and keeps the reseller call to action", () => {
    const html = render(store(true));
    expect(html).toContain("Bitocard home");
    expect(html).not.toContain("BitoCard NG");
    expect(html).not.toContain("ada-logo.png");
    expect(html).toContain("Start Reselling");
    expect(html).toContain("Shop globally");
  });

  test("a reseller's store shows its own name and logo, never BitoCard's wordmark or the reseller call to action", () => {
    const html = render(store(false));
    expect(html).toContain("Ada Digital");
    expect(html).toContain("ada-logo.png");
    expect(html).not.toContain("Bitocard home");
    expect(html).not.toContain("Start Reselling");
    expect(html).not.toContain("Shop globally");
  });

  test("the menu's quick links lead to the catalogue, never to BitoCard Shop", () => {
    const html = renderToStaticMarkup(createElement(StoreHeader, { groups, countries, market: "NG", signedIn: true, store: null }));
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)</g)].map(match => [match[1]!.replaceAll("&amp;", "&"), match[2]]);
    const quick = links.filter(([href]) => href!.startsWith("/catalogs/"));
    expect(quick.map(([, label]) => label)).toEqual(["Virtual numbers", "RDP", "VPN"]);
    expect(html).not.toContain(">Shop<");
    expect(html).not.toContain("shop.bitocard.com");
    expect(html).not.toContain("/listings");
  });
});