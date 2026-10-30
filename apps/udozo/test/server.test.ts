import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { request, setRequest } from "./request";
import { customerApi, safeNext, shopperHeader, signInPath, siteOrigin } from "@/lib/customer";
import { handoffTarget } from "@/lib/handoff";
import { continueSignIn } from "@/lib/handoff-actions";
import { acceptShopTerms, answerOffer, loadChat, makeOffer, requestSafePay, saveListing, shopTerms, showPhone, startChat } from "@/lib/listing-actions";
import { apiUrl, marketFor } from "@/lib/api";
import { GET as handoffGo } from "@/app/(global)/handoff/go/route";
import { listingGone, proxy } from "@/proxy";

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];
let reply: (url: string, method: string) => Response | null;
const listing = "6f1c2e8a-1b2c-4d3e-8f90-1234567890ab";

beforeEach(() => {
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  vi.stubEnv("API_URL", "https://api.test");
  setRequest({ host: "udozo.com" });
  calls = [];
  reply = () => null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url, method) ?? Response.json({ error: { code: "resource_missing", message: "No such thing." } }, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the customer's session", () => {
  test("sent to the API as a header from this site's own cookie; no store is named, so it is udozo.com's own account", async () => {
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_token" });
    reply = () => Response.json({ object: "customer", id: "c1" });
    expect((await customerApi("POST", "/v1/classifieds/favourites", { listing_id: listing })).ok).toBe(true);
    const call = calls[0]!;
    expect(call.headers.get("bitocard-customer-session")).toBe("bcc_token");
    expect(call.headers.get("bitocard-store")).toBeNull();
    expect(call.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.url).toBe("https://api.test/v1/classifieds/favourites");
  });

  test("an unreachable API is an answer, never a throw", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await customerApi("GET", "/v1/store/account")).toMatchObject({ ok: false, status: 0 });
  });

  test("shoppers' addresses are signed for rate limits; only this site's paths are followed after signing in", async () => {
    vi.stubEnv("STORE_SERVER_SECRET", "s".repeat(40));
    setRequest({ "x-real-ip": "102.89.1.2" });
    expect((await shopperHeader(1_700_000_000_000))["bitocard-client"]).toMatch(/^t=1700000000,ip=102\.89\.1\.2,v1=[0-9a-f]{64}$/);
    setRequest({ "x-real-ip": "not an ip" });
    expect(await shopperHeader()).toEqual({});
    expect(safeNext("/ng/l/1-tv")).toBe("/ng/l/1-tv");
    for (const bad of ["//evil.com", "https://evil.com", "/\t/evil.com", "/\\evil.com"]) expect(safeNext(bad), bad).toBe("/");
    expect(signInPath("/ng/l/1-tv", "chat")).toBe("/signin?next=%2Fng%2Fl%2F1-tv&for=chat");
    expect(siteOrigin()).toBe("https://udozo.com");
    vi.stubEnv("UDOZO_URL", "");
    vi.stubEnv("VERCEL", "1");
    expect(siteOrigin(), "udozo.com in production").toBe("https://udozo.com");
  });

  test("only open markets, by lower-case codes", async () => {
    reply = url => (url.endsWith("/v1/classifieds/markets") ? Response.json({ object: "list", data: [{ object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 3, safe_pay: false, install_prompt: false }], showcase: false }) : null);
    expect((await marketFor("ng"))?.name).toBe("Nigeria");
    expect(await marketFor("NG")).toBeNull();
    expect(await marketFor("gh")).toBeNull();
  });
});

describe("Udozo's API", () => {
  test("production calls api.udozo.com; API_URL and the public address override it; locally the API on 3001", () => {
    vi.stubEnv("API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    delete process.env.API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.stubEnv("VERCEL", "1");
    expect(apiUrl("/v1/theme")).toBe("https://api.udozo.com/v1/theme");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.staging.test/");
    expect(apiUrl("/v1/theme")).toBe("https://api.staging.test/v1/theme");
    vi.stubEnv("API_URL", "http://localhost:4001");
    expect(apiUrl("/v1/theme")).toBe("http://localhost:4001/v1/theme");
  });
});

describe("the sign-in handoff to Udozo's stores", () => {
  test("only an https origin (http for localhost), never this site, a path or credentials", () => {
    const self = "https://udozo.com";
    expect(handoffTarget("https://acme.udozo.com", self)).toBe("https://acme.udozo.com");
    expect(handoffTarget("https://shop.acme.ng", self)).toBe("https://shop.acme.ng");
    expect(handoffTarget("http://acme.localhost:3007", self)).toBe("http://acme.localhost:3007");
    for (const bad of ["http://acme.udozo.com", "https://udozo.com", "https://acme.udozo.com/x", "https://a:b@acme.udozo.com", "javascript:alert(1)", "nope"]) expect(handoffTarget(bad, self), bad).toBeNull();
  });

  test("/handoff/go: a code for that store in its fragment; signed out, sign in here first; never to another site", async () => {
    setRequest({}, { udz_customer: "bcc_session" });
    // The API hands customers only to Udozo's own stores.
    reply = (url, method) =>
      method === "POST" && url.endsWith("/v1/store/account/handoff")
        ? (calls.at(-1)!.body as { to: string }).to === "https://acme.udozo.com"
          ? Response.json({ code: "bch_abc", to: "https://acme.udozo.com" })
          : Response.json({ error: { code: "parameter_invalid", message: "Not a Udozo site." } }, { status: 400 })
        : null;
    const go = (query: string) => handoffGo(new NextRequest(`https://udozo.com/handoff/go?${query}`));
    const response = await go("to=https%3A%2F%2Facme.udozo.com&next=%2Flistings");
    expect([response.status, response.headers.get("location")]).toEqual([303, "https://acme.udozo.com/handoff#c=bch_abc&n=%2Flistings"]);
    expect(calls.find(call => call.method === "POST")?.body).toEqual({ to: "https://acme.udozo.com" });
    // A target the API refuses (not a Udozo store) leaves the customer here, never there.
    expect((await go("to=https%3A%2F%2Fevil.com&next=%2Fng")).headers.get("location")).toBe("https://udozo.com/ng");
    expect((await go("to=javascript%3Aalert(1)&next=%2Fng")).headers.get("location")).toBe("https://udozo.com/ng");
    setRequest({});
    expect((await go("to=https%3A%2F%2Facme.udozo.com&next=%2Flistings")).headers.get("location")).toBe(`https://udozo.com/signin?next=${encodeURIComponent("/handoff/go?to=https%3A%2F%2Facme.udozo.com&next=%2Flistings")}`);
  });

  test("the code udozo.com sent is exchanged here, naming this site, for this site's own udz_customer session", async () => {
    reply = (url, method) =>
      method === "POST" && url.endsWith("/handoff/exchange") ? Response.json({ customer: { object: "customer", id: "c1", name: "Adaeze Okafor", email_verified: false }, session: { token: "bcc_new" } }) : null;
    expect(await continueSignIn("bch_abcdefghijklmnopqrstuvwxyz", "/ng/l/1-tv")).toEqual({ ok: true, next: "/verify?next=%2Fng%2Fl%2F1-tv" });
    expect(calls[0]!.body).toEqual({ code: "bch_abcdefghijklmnopqrstuvwxyz", origin: "https://udozo.com" });
    expect(request.cookies.get("udz_customer")).toBe("bcc_new");
    expect(request.set.find(cookie => cookie.name === "udz_customer")?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    expect(request.set.find(cookie => cookie.name === "udz_customer")?.options?.domain).toBeUndefined();
    expect(request.set.map(cookie => cookie.name)).not.toContain("bc_signed_in");
    expect(await continueSignIn("nope", "/")).toEqual({ ok: false, unreachable: false });
  });
});

describe("listing actions", () => {
  test("each calls its endpoint, refusing malformed ids before asking", async () => {
    reply = (url, method) => (method === "POST" || method === "DELETE" ? (method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ object: "ok", phone: "+2348031234567" })) : null);
    expect(await saveListing(listing, true)).toEqual({ ok: true, data: { favourite: true } });
    expect(await saveListing(listing, false)).toEqual({ ok: true, data: { favourite: false } });
    expect((await showPhone(listing)).ok).toBe(true);
    expect(calls.map(call => `${call.method} ${call.url.replace("https://api.test", "")}`)).toEqual([
      "POST /v1/classifieds/favourites",
      `DELETE /v1/classifieds/favourites/${listing}`,
      `POST /v1/classifieds/listings/${listing}/phone`,
    ]);
    expect(await showPhone("../admin")).toMatchObject({ ok: false });
    expect(await answerOffer(listing, "delete" as "accept")).toMatchObject({ ok: false });
    expect(await loadChat(listing, "x")).toMatchObject({ ok: false });
    expect(calls).toHaveLength(3);
  });

  test("offers in kobo from what was typed; the form's nonce is the idempotency key; an ended session asks to sign in", async () => {
    reply = () => Response.json({ object: "classified_message" }, { status: 201 });
    await makeOffer(listing, "450,000", "nonce-123456");
    expect(calls[0]!.body).toEqual({ price: 45000000 });
    expect(calls[0]!.headers.get("idempotency-key")).toBe("nonce-123456");
    expect(await makeOffer(listing, "lots")).toMatchObject({ ok: false });
    await startChat(listing, "Is it still available?");
    expect(calls[1]!.body).toEqual({ listing_id: listing, body: "Is it still available?" });
    reply = () => Response.json({ error: { code: "authentication_required", message: "Sign in." } }, { status: 401 });
    expect(await startChat(listing, "Hello")).toMatchObject({ ok: false, signIn: true });
  });

  test("a Safe pay request: the delivery address only for deliveries", async () => {
    reply = () => Response.json({ object: "classified_order" }, { status: 201 });
    await requestSafePay({ listingId: listing, fulfilment: "meet_up", address: "ignored" });
    await requestSafePay({ listingId: listing, offerId: listing, fulfilment: "delivery", address: " 12 Allen Avenue, Ikeja " });
    // Within the seller's state: its id decides the delivery charge (only for deliveries).
    await requestSafePay({ listingId: listing, fulfilment: "delivery", address: "12 Allen Avenue, Ikeja", stateId: listing });
    await requestSafePay({ listingId: listing, fulfilment: "meet_up", stateId: listing });
    expect(calls.map(call => call.body)).toEqual([
      { listing_id: listing, fulfilment: "meet_up" },
      { listing_id: listing, offer_id: listing, fulfilment: "delivery", delivery_address: "12 Allen Avenue, Ikeja" },
      { listing_id: listing, fulfilment: "delivery", delivery_address: "12 Allen Avenue, Ikeja", delivery_state_id: listing },
      { listing_id: listing, fulfilment: "meet_up" },
    ]);
    expect(await requestSafePay({ listingId: listing, fulfilment: "delivery", stateId: "../x" })).toMatchObject({ ok: false });
  });

  test("Udozo's terms: read, then accepted by the version shown; a refused request says why", async () => {
    reply = url => (url.endsWith("/orders") ? Response.json({ error: { code: "terms_not_accepted", message: "Accept the Udozo terms.", param: "terms" } }, { status: 409 }) : Response.json({ object: "classified_terms", version: "2026-10-25", path: "/documents/shop-terms", accepted: false, accepted_at: null, previous_version: null }));
    expect(await requestSafePay({ listingId: listing, fulfilment: "meet_up" })).toMatchObject({ ok: false, code: "terms_not_accepted" });
    expect(await shopTerms()).toMatchObject({ version: "2026-10-25" });
    expect(await acceptShopTerms("2026-10-25")).toMatchObject({ ok: true });
    expect(await acceptShopTerms("any")).toMatchObject({ ok: false });
    expect(calls.map(call => `${call.method} ${call.url.replace("https://api.test", "")}`)).toEqual(["POST /v1/classifieds/orders", "GET /v1/classifieds/terms", "POST /v1/classifieds/terms/accept"]);
    expect(calls[2]!.body).toEqual({ version: "2026-10-25" });
  });
});

describe("gone listings", () => {
  test("answer 410 once the API says so; live, unknown or unreachable ones go on to the page", async () => {
    reply = url => (url.includes("/listings/100001?") ? new Response("{}", { status: 410 }) : url.includes("/listings/100002?") ? Response.json({}) : null);
    const gone = await proxy(new NextRequest("https://udozo.com/ng/l/100001-old-tv"));
    expect(gone.status).toBe(410);
    expect(gone.headers.get("x-robots-tag")).toBe("noindex");
    expect(await gone.text()).toContain("no longer on Udozo");
    expect((await proxy(new NextRequest("https://udozo.com/ng/l/100002-tv"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(new NextRequest("https://udozo.com/ng/l/100001/buy"))).headers.get("x-middleware-next")).toBe("1");
    const asked = calls.length;
    expect(await listingGone("ng", "100001")).toBe(true);
    expect(calls.length).toBe(asked); // remembered for a minute
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await listingGone("ng", "100003")).toBe(false);
  });
});
