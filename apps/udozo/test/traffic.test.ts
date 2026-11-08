// Where udozo.com's visitors come from (8 November 2026, the owner's request): the proxy reports each landing from
// outside to the API after the response, signed, and with Accept all keeps where it came from in `udz_src` so a new
// account is credited to it once it signs in; without consent nothing is kept.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { request, setRequest } from "./request";

const { landingOf, readSource, sourceCookieChange, sourceParamsOf, visitRequest } = await import("@/lib/traffic");
const { proxy } = await import("@/proxy");
const { keepSession } = await import("@/lib/customer");

const secret = "store-secret-0123456789-abcdefghijklmnop";
const chrome = "Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36";
const navigate = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { headers: { host: "udozo.com", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "user-agent": chrome, ...headers } });

let calls: Array<{ url: string; init: RequestInit }>;
beforeEach(() => {
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  vi.stubEnv("API_URL", "https://api.test");
  vi.stubEnv("STORE_SERVER_SECRET", secret);
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("what counts as a landing", () => {
  test("a page arriving from another site, with source tags or typed in; never moving around udozo.com, a prefetch or a file", () => {
    const of = (url: string, headers: Record<string, string> = {}) => landingOf(navigate(url, headers), "udozo.com");
    expect(of("https://udozo.com/ng/l/1-tv?fbclid=IwAR0secret&utm_source=facebook&utm_medium=cpc&utm_campaign=tv_week", { referer: "https://l.facebook.com/l.php?u=x", "sec-fetch-site": "cross-site" })).toEqual({
      path: "/ng/l/1-tv",
      params: { fbclid: "1", utm_source: "facebook", utm_medium: "cpc", utm_campaign: "tv_week" },
      referrer: "https://l.facebook.com",
      direct: false,
    });
    expect(of("https://udozo.com/", { referer: "https://www.google.com/", "sec-fetch-site": "cross-site" })?.referrer).toBe("https://www.google.com");
    expect(of("https://udozo.com/ng", { "sec-fetch-site": "none" })).toMatchObject({ direct: true, referrer: null });
    expect(of("https://udozo.com/ng/c/tvs", { referer: "https://udozo.com/ng", "sec-fetch-site": "same-origin" })).toBeNull();
    expect(of("https://udozo.com/ng/c/tvs", { referer: "https://acme.udozo.com/", "sec-fetch-site": "same-site" })).toBeNull();
    expect(of("https://udozo.com/ng", { "sec-fetch-site": "cross-site", "next-router-prefetch": "1" })).toBeNull();
    expect(of("https://udozo.com/ng", { "sec-fetch-site": "cross-site", rsc: "1" })).toBeNull();
    expect(of("https://udozo.com/auth/google/callback?code=x", { referer: "https://accounts.google.com/", "sec-fetch-site": "cross-site" })).toBeNull();
    expect(of("https://udozo.com/sitemap.xml", { "sec-fetch-site": "none" })).toBeNull();
    expect(landingOf(new NextRequest("https://udozo.com/ng", { headers: { "sec-fetch-dest": "image", "sec-fetch-site": "cross-site" } }), "udozo.com")).toBeNull();
    expect(sourceParamsOf(new URLSearchParams("q=tv&gclid=abc&utm_term=phones&page=2"))).toEqual({ gclid: "1", utm_term: "phones" });
  });

  test("the report to the API is signed over its body, with the shopper's address signed as for rate limits", () => {
    const landing = landingOf(navigate("https://udozo.com/?gclid=x", { "sec-fetch-site": "cross-site", "x-real-ip": "203.0.113.7" }), "udozo.com")!;
    const call = visitRequest(landing, navigate("https://udozo.com/", { "x-real-ip": "203.0.113.7" }), process.env, 1_800_000_000_000)!;
    expect(call.url).toBe("https://api.test/v1/traffic/visits");
    const headers = call.init.headers as Record<string, string>;
    const body = String(call.init.body);
    expect(headers["udozo-traffic-signature"]).toBe(`t=1800000000,v1=${createHmac("sha256", secret).update(`1800000000.${body}`).digest("hex")}`);
    expect(headers["bitocard-client"]).toMatch(/^t=1800000000,ip=203\.0\.113\.7,v1=[0-9a-f]{64}$/);
    expect(JSON.parse(body)).toEqual({ path: "/", params: { gclid: "1" }, referrer: null, user_agent: chrome });
    expect(visitRequest(landing, navigate("https://udozo.com/"), { API_URL: "https://api.test" })).toBeNull();
  });
});

describe("keeping where a visit came from", () => {
  const facebook = { path: "/ng/l/1-tv", params: { utm_source: "facebook" }, referrer: "https://l.facebook.com", direct: false };
  const typed = { path: "/ng", params: {}, referrer: null, direct: true };
  const all = "udz_cookie_consent=v3.all.2026-11-08";

  test("only with Accept all: the latest landing from somewhere, a typed-in one only when nothing is kept; without it, removed", () => {
    expect(sourceCookieChange(facebook, all, undefined)).toEqual({ set: JSON.stringify({ path: "/ng/l/1-tv", params: { utm_source: "facebook" }, referrer: "https://l.facebook.com" }) });
    expect(sourceCookieChange(typed, all, undefined)).toEqual({ set: JSON.stringify({ path: "/ng", params: {}, referrer: null }) });
    expect(sourceCookieChange(typed, all, JSON.stringify({ path: "/ng/l/1-tv", params: {}, referrer: "https://l.facebook.com" }))).toBeNull();
    expect(sourceCookieChange(null, all, undefined)).toBeNull();
    expect(sourceCookieChange(facebook, "udz_cookie_consent=v3.necessary.2026-11-08", undefined)).toBeNull();
    expect(sourceCookieChange(facebook, "udz_cookie_consent=v2.all.2026-11-04", '{"path":"/"}')).toEqual({ remove: true });
    expect(readSource('{"path":"/ng","params":{"utm_source":"x","evil":"y"},"referrer":5}')).toEqual({ path: "/ng", params: { utm_source: "x" }, referrer: null });
    expect(readSource("not json")).toBeNull();
  });

  test("the proxy reports the landing after the page and keeps its source only with consent", async () => {
    const waits: Promise<unknown>[] = [];
    const event = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) } as never;
    const consented = await proxy(navigate("https://udozo.com/ng/c/tvs?utm_source=facebook&utm_medium=cpc", { "sec-fetch-site": "cross-site", referer: "https://m.facebook.com/", cookie: "udz_cookie_consent=v3.all.2026-11-08" }), event);
    await Promise.all(waits);
    expect(calls.map(call => call.url)).toEqual(["https://api.test/v1/traffic/visits"]);
    expect(consented.cookies.get("udz_src")?.value).toContain('"utm_source":"facebook"');
    expect(consented.cookies.get("udz_src")).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 });

    const without = await proxy(navigate("https://udozo.com/ng?gclid=abc", { "sec-fetch-site": "cross-site" }), event);
    expect(without.cookies.get("udz_src")).toBeUndefined();
    const inside = await proxy(navigate("https://udozo.com/ng/c/tvs", { "sec-fetch-site": "same-origin", referer: "https://udozo.com/ng" }), event);
    await Promise.all(waits);
    expect(calls).toHaveLength(2);
    expect(inside.headers.get("x-middleware-next")).toBe("1");
  });

  test("signing in credits the kept source to the account, then forgets it; nothing kept, nothing sent", async () => {
    setRequest({ host: "udozo.com" }, { udz_src: JSON.stringify({ path: "/ng/l/1-tv", params: { fbclid: "1", utm_campaign: "tv_week" }, referrer: "https://l.facebook.com" }) });
    await keepSession({ token: "bcc_new" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.test/v1/store/account/attribution");
    expect((calls[0]!.init.headers as Record<string, string>)["bitocard-customer-session"]).toBe("bcc_new");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ path: "/ng/l/1-tv", params: { fbclid: "1", utm_campaign: "tv_week" }, referrer: "https://l.facebook.com" });
    expect(request.cookies.has("udz_src")).toBe(false);
    expect(request.set.find(item => item.name === "udz_customer")?.value).toBe("bcc_new");

    calls = [];
    setRequest({ host: "udozo.com" });
    await keepSession({ token: "bcc_other" });
    expect(calls).toHaveLength(0);
  });
});
