import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";
import { pathHeader } from "@/lib/path-header";
import { visitRequest } from "@/lib/visits";
import { config, proxy } from "@/proxy";

const secret = "store-server-secret-for-the-tests-0123456789";
const shopper = { "x-real-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 Safari" };

describe("proxy", () => {
  test("passes the account page asked for to the layout, overriding anything the caller sent", () => {
    const response = proxy(new NextRequest("https://acme.bitocard.com/account/orders/abc?x=1", { headers: { [pathHeader]: "//evil.com" } }));
    expect(response.headers.get(`x-middleware-request-${pathHeader}`)).toBe("/account/orders/abc?x=1");
  });

  test("leaves other pages’ headers alone", () => {
    // BitoCard Shop's old tab (/shop) is no longer part of the account app.
    for (const path of ["/catalogs", "/shop", "/shop/orders/abc", "/accounts"]) {
      const response = proxy(new NextRequest(`https://acme.bitocard.com${path}`, { headers: { [pathHeader]: "//evil.com" } }));
      expect(response.headers.get(`x-middleware-request-${pathHeader}`)).toBeNull();
    }
  });

  test("runs on pages, never on files, _next or prefetches", () => {
    const [rule] = config.matcher;
    const source = new RegExp(`^${rule.source}$`);
    for (const path of ["/", "/catalogs/gift_cards", "/account/orders/abc", "/p/gift_cards:US:amazon:usd", "/p/esim:WW:global:1.5gb-7d"]) expect(source.test(path)).toBe(true);
    for (const path of ["/_next/static/chunk.js", "/flags/ng.svg", "/brand-cards/amazon.webp", "/push-sw.js", "/favicon.ico"]) expect(source.test(path)).toBe(false);
    expect(rule.missing).toContainEqual({ type: "header", key: "next-router-prefetch" });
  });

  test("counts a reseller store’s page after the response, never BitoCard’s own", () => {
    vi.stubEnv("STORE_SERVER_SECRET", secret);
    const waitUntil = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    proxy(new NextRequest("https://acme.bitocard.com/catalogs", { headers: shopper }), { waitUntil } as never);
    proxy(new NextRequest("https://bitocard.com/catalogs", { headers: shopper }), { waitUntil } as never);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("visitRequest", () => {
  const request = (url: string, headers: Record<string, string> = shopper, method = "GET") => ({ method, headers: new Headers(headers), nextUrl: new URL(url) });
  const env = { STORE_SERVER_SECRET: secret, API_URL: "https://api.example.test" };

  test("signs the shopper’s address and sends the host and browser, nothing else", () => {
    const visit = visitRequest(request("https://acme.bitocard.com/catalogs", { ...shopper, host: "Acme.BitoCard.com:443" }), env, 1_800_000_000_000);
    expect(visit?.url).toBe("https://api.example.test/v1/store/visits");
    expect(JSON.parse(visit!.init.body)).toEqual({ host: "acme.bitocard.com", user_agent: "Mozilla/5.0 Safari" });
    expect(visit!.init.headers["bitocard-client"]).toMatch(/^t=1800000000,ip=203\.0\.113\.7,v1=[0-9a-f]{64}$/);
  });

  test("a store’s own domain counts; BitoCard’s hosts, previews, other methods, no address or no secret do not", () => {
    expect(visitRequest(request("https://adashop.com/", { ...shopper, host: "adashop.com" }), env)).not.toBeNull();
    for (const host of ["bitocard.com", "www.bitocard.com", "localhost:3000", "bitocard-storefront-git-x.vercel.app"]) expect(visitRequest(request(`https://${host}/`, { ...shopper, host }), env)).toBeNull();
    expect(visitRequest(request("https://acme.bitocard.com/preview?token=x", { ...shopper, host: "acme.bitocard.com" }), env)).toBeNull();
    expect(visitRequest(request("https://acme.bitocard.com/", { ...shopper, host: "acme.bitocard.com" }, "POST"), env)).toBeNull();
    expect(visitRequest(request("https://acme.bitocard.com/", { host: "acme.bitocard.com", "user-agent": "x" }), env)).toBeNull();
    expect(visitRequest(request("https://acme.bitocard.com/", { ...shopper, host: "acme.bitocard.com" }), {})).toBeNull();
  });
});
