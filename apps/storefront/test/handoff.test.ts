import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";
import { decodeSignedIn, encodeSignedIn, handoffStart, isHouseOrigin, signedInCookie, signedInDomain } from "@bitocard/ui/handoff";
import { forgetSignedIn, rememberSignedIn, signedInElsewhere } from "@/lib/handoff";
import { continueSignIn } from "@/lib/handoff-actions";
import { readHandoffHash } from "@/components/store/handoff";
import { GET } from "@/app/(store)/handoff/go/route";
import { NextRequest } from "next/server";

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];
/** What the API answers: the storefront lookups (ng is BitoCard's country store, acme a reseller's) and the handoff. */
let reply: (url: string, method: string) => Response | null;

beforeEach(() => {
  vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
  vi.stubEnv("SHOP_URL", "https://shop.bitocard.com");
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
    for (const origin of ["https://bitocard.com", "https://ng.bitocard.com", "https://shop.bitocard.com"]) expect(isHouseOrigin(origin), origin).toBe(true);
    for (const origin of ["https://evil.com", "https://acme-store.bitocard.com", "http://ng.bitocard.com", "https://ng.bitocard.com/", "https://bitocard.com.evil.com", "nope"]) expect(isHouseOrigin(origin), origin).toBe(false);
    expect(signedInDomain()).toBe(".bitocard.com");
    vi.stubEnv("STOREFRONT_URL", "http://localhost:3000");
    expect(signedInDomain()).toBeUndefined();
    expect(isHouseOrigin("http://ng.localhost:3000")).toBe(true);
  });

  test("holds a first name and a site, and refuses anything else", () => {
    const value = encodeSignedIn({ name: "  Adaeze Okafor ", origin: "https://ng.bitocard.com" });
    expect(decodeSignedIn(value)).toEqual({ name: "Adaeze", origin: "https://ng.bitocard.com" });
    expect(decodeSignedIn(encodeSignedIn({ name: "Ada", origin: "https://evil.com" }))).toBeNull();
    expect(decodeSignedIn("not base64 json")).toBeNull();
    expect(decodeSignedIn(undefined)).toBeNull();
    expect(handoffStart("https://ng.bitocard.com", "https://shop.bitocard.com", "/ng/l/100001-tv")).toBe("https://ng.bitocard.com/handoff/go?to=https%3A%2F%2Fshop.bitocard.com&next=%2Fng%2Fl%2F100001-tv");
  });

  test("set on BitoCard's sites when signing in, never on a reseller's store; offered only on another site", async () => {
    setRequest({ host: "ng.bitocard.com" });
    await rememberSignedIn({ name: "Adaeze Okafor" });
    const set = request.set.find(cookie => cookie.name === signedInCookie)!;
    expect(set.options).toMatchObject({ domain: ".bitocard.com", httpOnly: true, sameSite: "lax", path: "/" });
    expect(decodeSignedIn(set.value)).toEqual({ name: "Adaeze", origin: "https://ng.bitocard.com" });
    expect(await signedInElsewhere()).toBeNull();

    setRequest({ host: "bitocard.com" }, { [signedInCookie]: set.value });
    expect(await signedInElsewhere()).toEqual({ name: "Adaeze", origin: "https://ng.bitocard.com", host: "ng.bitocard.com" });

    setRequest({ host: "acme.bitocard.com" }, { [signedInCookie]: set.value });
    expect(await signedInElsewhere()).toBeNull();
    await rememberSignedIn({ name: "Adaeze Okafor" });
    expect(request.set).toEqual([]);
  });

  test("signing out removes it only when it names this site", async () => {
    const ng = encodeSignedIn({ name: "Ada", origin: "https://ng.bitocard.com" });
    setRequest({ host: "bitocard.com" }, { [signedInCookie]: ng });
    await forgetSignedIn();
    expect(request.set).toEqual([]);
    setRequest({ host: "ng.bitocard.com" }, { [signedInCookie]: ng });
    await forgetSignedIn();
    expect(request.set).toEqual([{ name: signedInCookie, value: "", options: expect.objectContaining({ maxAge: 0, domain: ".bitocard.com" }) }]);
  });
});

describe("/handoff/go", () => {
  const go = (query: string) => GET(new NextRequest(`https://ng.bitocard.com/handoff/go?${query}`));

  test("signed in: a code for that site, in the fragment of its /handoff", async () => {
    setRequest({ host: "ng.bitocard.com" }, { bc_customer: "bcc_session" });
    reply = (url, method) => (method === "POST" && url.endsWith("/v1/store/account/handoff") ? Response.json({ object: "customer_handoff", code: "bch_abc-DEF_123", to: "https://shop.bitocard.com" }) : null);
    const response = await go("to=https%3A%2F%2Fshop.bitocard.com&next=%2Fng%2Fl%2F100001-tv");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://shop.bitocard.com/handoff#c=bch_abc-DEF_123&n=%2Fng%2Fl%2F100001-tv");
    const asked = calls.find(call => call.method === "POST")!;
    expect(asked.body).toEqual({ to: "https://shop.bitocard.com" });
    expect(asked.headers.get("bitocard-customer-session")).toBe("bcc_session");
    expect(asked.headers.get("bitocard-store")).toBe("ng");
  });

  test("signed out: sign in here first, then on; never to a site that is not BitoCard's", async () => {
    setRequest({ host: "ng.bitocard.com" });
    const signIn = await go("to=https%3A%2F%2Fshop.bitocard.com&next=%2Fng");
    expect(signIn.headers.get("location")).toBe(`https://ng.bitocard.com/signin?next=${encodeURIComponent("/handoff/go?to=https%3A%2F%2Fshop.bitocard.com&next=%2Fng")}`);
    setRequest({ host: "ng.bitocard.com" }, { bc_customer: "bcc_session" });
    expect((await go("to=https%3A%2F%2Fevil.com&next=%2Forders")).headers.get("location")).toBe("https://ng.bitocard.com/orders");
    expect(calls.some(call => call.method === "POST")).toBe(false);
    setRequest({ host: "acme.bitocard.com" }, { bc_customer: "bcc_session" });
    expect((await GET(new NextRequest("https://acme.bitocard.com/handoff/go?to=https%3A%2F%2Fshop.bitocard.com"))).status).toBe(404);
  });
});

describe("/handoff", () => {
  test("reads the code and where to go from the fragment", () => {
    expect(readHandoffHash("#c=bch_abc&n=%2Fng%2Fl%2F1")).toEqual({ code: "bch_abc", next: "/ng/l/1" });
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
