import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";
import { decodeSignedIn, encodeSignedIn, handoffStart, isHouseOrigin, readHandoffHash, signedInCookie, signedInDomain } from "@bitocard/ui/handoff";
import { forgetSignedIn, rememberSignedIn, signedInElsewhere } from "@/lib/handoff";
import { continueSignIn } from "@/lib/handoff-actions";
import { GET } from "@/app/(store)/handoff/go/route";
import { NextRequest } from "next/server";

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];
/** What the API answers: the storefront lookups (ng is BitoCard's country store, acme a reseller's) and the handoff. */
let reply: (url: string, method: string) => Response | null;

beforeEach(() => {
  vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
  calls = [];
  reply = () => null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    const custom = reply(url, method);
    if (custom) return custom;
    if (url.includes("/v1/storefronts/ng")) return Response.json({ object: "storefront", subdomain: "ng", name: "BitoCard Nigeria", house: true });
    if (url.includes("/v1/storefronts/acme")) return Response.json({ object: "storefront", subdomain: "acme", name: "Acme", house: false });
    return Response.json({ error: { code: "resource_missing", message: "No such thing." } }, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the signed-in cookie", () => {
  test("names only BitoCard's own sites, on the parent domain", () => {
    expect(isHouseOrigin("https://bitocard.com")).toBe(true);
    // BitoCard Shop and crypto have left BitoCard (Udozo and Afrippa keep accounts of their own); the country stores are retired.
    for (const origin of ["https://evil.com", "https://acme-store.bitocard.com", "https://ng.bitocard.com", "https://gh.bitocard.com", "https://bitocard.com/", "https://bitocard.com.evil.com", "https://crypto.bitocard.com", "https://shop.bitocard.com", "nope"]) expect(isHouseOrigin(origin), origin).toBe(false);
    expect(signedInDomain()).toBe(".bitocard.com");
    vi.stubEnv("STOREFRONT_URL", "http://localhost:3000");
    expect(signedInDomain()).toBeUndefined();
    expect([isHouseOrigin("http://localhost:3000"), isHouseOrigin("http://ng.localhost:3000")]).toEqual([true, false]);
  });

  test("holds a first name and a site, and refuses anything else", () => {
    const value = encodeSignedIn({ name: "  Adaeze Okafor ", origin: "https://bitocard.com" });
    expect(decodeSignedIn(value)).toEqual({ name: "Adaeze", origin: "https://bitocard.com" });
    expect(decodeSignedIn(encodeSignedIn({ name: "Ada", origin: "https://ng.bitocard.com" }))).toBeNull();
    expect(decodeSignedIn(encodeSignedIn({ name: "Ada", origin: "https://evil.com" }))).toBeNull();
    expect(decodeSignedIn("not base64 json")).toBeNull();
    expect(decodeSignedIn(undefined)).toBeNull();
    expect(handoffStart("https://ng.bitocard.com", "https://bitocard.com", "/account/orders")).toBe("https://ng.bitocard.com/handoff/go?to=https%3A%2F%2Fbitocard.com&next=%2Faccount%2Forders");
  });

  test("set on bitocard.com when signing in, never on a reseller's store; never offered on the site it names", async () => {
    setRequest({ host: "bitocard.com" });
    await rememberSignedIn({ name: "Adaeze Okafor" });
    const set = request.set.find(cookie => cookie.name === signedInCookie)!;
    expect(set.options).toMatchObject({ domain: ".bitocard.com", httpOnly: true, sameSite: "lax", path: "/" });
    expect(decodeSignedIn(set.value)).toEqual({ name: "Adaeze", origin: "https://bitocard.com" });
    expect(await signedInElsewhere()).toBeNull();

    setRequest({ host: "acme.bitocard.com" }, { [signedInCookie]: set.value });
    expect(await signedInElsewhere()).toBeNull();
    await rememberSignedIn({ name: "Adaeze Okafor" });
    expect(request.set).toEqual([]);
  });

  test("signing out removes it only when it names this site", async () => {
    const root = encodeSignedIn({ name: "Ada", origin: "https://bitocard.com" });
    setRequest({ host: "acme.bitocard.com" }, { [signedInCookie]: root });
    await forgetSignedIn();
    expect(request.set).toEqual([]);
    setRequest({ host: "bitocard.com" }, { [signedInCookie]: root });
    await forgetSignedIn();
    expect(request.set).toEqual([{ name: signedInCookie, value: "", options: expect.objectContaining({ maxAge: 0, domain: ".bitocard.com" }) }]);
  });
});

describe("/handoff/go", () => {
  const go = (query: string) => GET(new NextRequest(`https://bitocard.com/handoff/go?${query}`));

  test("bitocard.com is the only BitoCard site now: no code is ever made, the shopper just goes on", async () => {
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
    for (const to of ["https://bitocard.com", "https://ng.bitocard.com", "https://shop.bitocard.com", "https://evil.com"]) {
      const response = await go(`to=${encodeURIComponent(to)}&next=%2Faccount%2Forders`);
      expect(response.status, to).toBe(303);
      expect(response.headers.get("location"), to).toBe("https://bitocard.com/account/orders");
    }
    expect(calls.some(call => call.method === "POST")).toBe(false);
    setRequest({ host: "acme.bitocard.com" }, { bc_customer: "bcc_session" });
    expect((await GET(new NextRequest("https://acme.bitocard.com/handoff/go?to=https%3A%2F%2Fbitocard.com"))).status).toBe(404);
  });
});

describe("/handoff", () => {
  test("reads the code and where to go from the fragment", () => {
    expect(readHandoffHash("#c=bch_abc&n=%2Faccount%2Forders")).toEqual({ code: "bch_abc", next: "/account/orders" });
    expect(readHandoffHash("")).toEqual({ code: "", next: "/" });
  });

  test("exchanges the code naming this site, keeps the session and remembers who signed in", async () => {
    setRequest({ host: "bitocard.com" });
    reply = (url, method) =>
      method === "POST" && url.endsWith("/handoff/exchange")
        ? Response.json({ customer: { object: "customer", id: "c1", name: "Adaeze Okafor", email_verified: true }, session: { token: "bcc_new" } })
        : null;
    expect(await continueSignIn("bch_abcdefghijklmnopqrstuvwxyz", "/account")).toEqual({ ok: true, next: "/account" });
    expect(calls.find(call => call.method === "POST")?.body).toEqual({ code: "bch_abcdefghijklmnopqrstuvwxyz", origin: "https://bitocard.com" });
    expect(request.cookies.get("bc_customer")).toBe("bcc_new");
    expect(decodeSignedIn(request.cookies.get(signedInCookie))).toEqual({ name: "Adaeze", origin: "https://bitocard.com" });
    expect(await continueSignIn("not-a-code", "/")).toEqual({ ok: false, unreachable: false });
    expect(await continueSignIn("bch_abcdefghijklmnopqrstuvwxyz", "//evil.com")).toEqual({ ok: true, next: "/" });
  });
});
