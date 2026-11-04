// Personalised discovery on udozo.com (docs/UDOZO_PERSONALISATION_PLAN.md): the visit's event queue, the visitor's ID
// kept only with Accept all, the same-origin routes passing events and reads to Udozo's API with the session or
// visitor ID, the home page's personal rows, People also viewed, the search box's recent and popular searches,
// Account > Privacy and the merge after signing in.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ForYou, ForYouRow } from "@bitocard/api-client/discovery";
import type { ClassifiedHome, HomeCard } from "@bitocard/api-client/home";
import { request, setRequest } from "./request";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { EventQueue, beacon, flushDelayMs } = await import("@/lib/discovery-client");
const { cleanBatch, cleanEvent, countryFromPath, homeSource, newVisitorId, railSource, searchFilters, visitorCookie, visitorPattern } = await import("@/lib/discovery");
const { readFilters } = await import("@/lib/search");
const visitorRoute = await import("@/app/api/discovery/visitor/route");
const eventsRoute = await import("@/app/api/events/route");
const forYouRoute = await import("@/app/api/for-you/route");
const searchesRoute = await import("@/app/api/searches/route");
const { mergeVisitorHistory } = await import("@/lib/discovery-server");
const privacy = await import("@/lib/discovery-actions");
const { PersonalRow, PersonalRail, loadForYou } = await import("@/components/discovery/personal-rail");
const { HomeRows } = await import("@/components/home/home-sections");
const { ListingGrid } = await import("@/components/listing-card");
const { BeforeTyping } = await import("@/components/search-bar");
const { clickEvent, positionOf } = await import("@/components/discovery/tracker");
const { readDepth } = await import("@/components/listing-view");
const { PrivacyControls } = await import("@/components/account/privacy-controls");

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const render = (element: React.ReactElement) => renderToStaticMarkup(element);
type Call = [string, RequestInit & { headers?: Record<string, string> }];
const visitor = `v_${"a".repeat(32)}`;
const at = new Date("2026-11-04T10:00:00Z");

const card = (ref: number): HomeCard => ({
  object: "classified_listing_card",
  id: `l${ref}`,
  ref,
  title: `Item ${ref}`,
  slug: "item",
  country: "NG",
  url: `https://udozo.com/ng/l/${ref}-item`,
  price: { kind: "fixed", amount: 1_000_000, currency: "NGN" },
  condition: "used",
  category: null,
  area: { slug: "ikeja", name: "Ikeja", state: { slug: "lagos", name: "Lagos" } },
  cover: null,
  photo_count: 1,
  has_video: false,
  highlights: [],
  delivery: "none",
  seller: { name: "Ada O.", badges: [] },
  published_at: "2026-11-01T10:00:00Z",
});

/** A request from this site's own page, or another site's. */
const from = (url: string, init: { method?: string; body?: string; site?: string } = {}) =>
  new NextRequest(url, { method: init.method ?? "GET", body: init.body, headers: { "sec-fetch-site": init.site ?? "same-origin" } });

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("STORE_SERVER_SECRET", "s".repeat(40));
  setRequest({ "x-real-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 Test" });
  revalidatePath.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the visit's event queue", () => {
  const queue = (options: { allowed?: boolean; country?: string | null } = {}) => {
    const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
    let timer: (() => void) | null = null;
    const q = new EventQueue({
      allowed: () => options.allowed ?? true,
      country: () => (options.country === undefined ? "NG" : options.country),
      send: (path, body) => sent.push({ path, body: JSON.parse(body) }),
      setTimer: run => (timer = run),
      clearTimer: () => (timer = null),
      now: () => at,
      session: "visit_123456",
    });
    return { q, sent, fire: () => timer?.() };
  };

  test("batches events a few seconds after the last, stamped with their time and the visit's ID", () => {
    const { q, sent, fire } = queue();
    q.track({ kind: "view", listing: 100001 });
    q.track({ kind: "search", query: "iphone", results: 12 });
    expect(sent).toHaveLength(0);
    expect(flushDelayMs).toBe(5000);
    fire();
    expect(sent).toEqual([{ path: "/api/events", body: { country: "NG", session: "visit_123456", events: [{ kind: "view", listing: 100001, at: at.toISOString() }, { kind: "search", query: "iphone", results: 12, at: at.toISOString() }] } }]);
  });

  test("sends at once when 50 are waiting or the page is closing, never more than 50 a call", () => {
    const { q, sent } = queue();
    for (let ref = 1; ref <= 50; ref++) q.track({ kind: "impression", listing: ref, source: "search" });
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body.events as unknown[]).length).toBe(50);
    q.track({ kind: "engaged", listing: 7, seconds: 30 }, { now: true });
    expect(sent).toHaveLength(2);
  });

  test("records nothing without consent or a session, and nothing off a market's pages", () => {
    const none = queue({ allowed: false });
    none.q.track({ kind: "view", listing: 1 }, { now: true });
    none.q.flush();
    expect(none.sent).toHaveLength(0);
    const nowhere = queue({ country: null });
    nowhere.q.track({ kind: "view", listing: 1 }, { now: true });
    expect(nowhere.sent).toHaveLength(0);
  });

  test("Not interested can be taken back until it is committed; the page closing sends it", () => {
    const { q, sent } = queue();
    q.trackLater({ kind: "not_interested", listing: 5, source: "for_you" }).cancel();
    q.flush();
    expect(sent).toHaveLength(0);
    q.trackLater({ kind: "not_interested", listing: 6, source: "search" });
    expect(q.pending).toBe(1);
    q.flush();
    expect(sent[0]!.body.events).toEqual([{ kind: "not_interested", listing: 6, source: "search", at: at.toISOString() }]);
  });

  test("goes as a plain-text beacon, else a fetch that outlives the page", () => {
    const sendBeacon = vi.fn<(path: string, data: Blob) => boolean>(() => true);
    vi.stubGlobal("navigator", { sendBeacon });
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    beacon("/api/events", '{"a":1}');
    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon.mock.calls[0]![1].type).toBe("text/plain;charset=utf-8");
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    beacon("/api/events", '{"a":1}');
    expect(fetcher).toHaveBeenCalledWith("/api/events", expect.objectContaining({ method: "POST", keepalive: true }));
  });
});

describe("what an event may say", () => {
  test("only browser kinds, about a listing where they must be, numbers held to their ranges", () => {
    expect(cleanEvent({ kind: "save", listing: 1 })).toBeNull();
    expect(cleanEvent({ kind: "view" })).toBeNull();
    expect(cleanEvent({ kind: "engaged", listing: 9, seconds: 5000, photos: -2, depth: 140, extra: "x" })).toEqual({ kind: "engaged", listing: 9, seconds: 600, photos: 0, depth: 100 });
    expect(cleanEvent({ kind: "rail_click", listing: 3, source: "home:ab12cd34", position: 900 })).toEqual({ kind: "rail_click", listing: 3, source: "home:ab12cd34", position: 500 });
    expect(cleanEvent({ kind: "rail_click", listing: 3, source: "javascript:alert(1)" })).toEqual({ kind: "rail_click", listing: 3 });
    expect(cleanEvent({ kind: "search", query: "x".repeat(300), filters: { category: "phones", condition: ["used"], bad: { a: 1 }, "No Way": "x" } })).toEqual({ kind: "search", query: "x".repeat(100), filters: { category: "phones", condition: ["used"] } });
  });

  test("a batch needs a market, a visit ID and something to send; at most 50", () => {
    expect(cleanBatch({ country: "ng", session: "visit_123456", events: [{ kind: "view", listing: 1 }] })).toEqual({ country: "NG", session: "visit_123456", events: [{ kind: "view", listing: 1 }] });
    expect(cleanBatch({ country: "NGA", session: "visit_123456", events: [{ kind: "view", listing: 1 }] })).toBeNull();
    expect(cleanBatch({ country: "NG", session: "short", events: [{ kind: "view", listing: 1 }] })).toBeNull();
    expect(cleanBatch({ country: "NG", session: "visit_123456", events: [{ kind: "nope" }] })).toBeNull();
    const many = cleanBatch({ country: "NG", session: "visit_123456", events: Array.from({ length: 80 }, (_, i) => ({ kind: "view", listing: i + 1 })) });
    expect(many!.events).toHaveLength(50);
  });

  test("visitor IDs, the page's market, sources and a search's filters", () => {
    const id = newVisitorId();
    expect(id).toMatch(visitorPattern);
    expect(newVisitorId()).not.toBe(id);
    expect(countryFromPath("/ng/l/100001-tv")).toBe("NG");
    for (const path of ["/", "/account", "/legal/privacy", "/NG/x"]) expect(countryFromPath(path)).toBeNull();
    expect(homeSource("ab12cd34")).toBe("home:ab12cd34");
    expect(homeSource("x".repeat(60)).length).toBe(37);
    expect(railSource("for_you", false)).toBe("for_you_holdout");
    expect(railSource("for_you", true)).toBe("for_you");
    expect(railSource("recent", false)).toBe("recent");
    const filters = readFilters({ q: "iphone", min: "100000", condition: "used", f: "storage:128..256", state: "lagos" });
    expect(searchFilters(filters, { slug: "mobile-phones" })).toEqual({ category: "mobile-phones", state: "lagos", min: "100000", condition: ["used"], f: ["storage:128..256"] });
  });

  test("clicks are told by the card's list and place; the reading depth is a percentage", () => {
    type Fake = { attrs: Record<string, string>; parent?: Fake; children?: Fake[] };
    const el = (fake: Fake): Element =>
      ({
        getAttribute: (name: string) => fake.attrs[name] ?? null,
        hasAttribute: (name: string) => name in fake.attrs,
        closest: (selector: string) => {
          for (let node: Fake | undefined = fake; node; node = node.parent) {
            if (selector === "[data-listing-ref]" && "data-listing-ref" in node.attrs) return el(node);
            if (selector === "[data-discovery-source]" && "data-discovery-source" in node.attrs) return el(node);
            if (selector === '[aria-hidden="true"]' && node.attrs["aria-hidden"] === "true") return el(node);
          }
          return null;
        },
        querySelectorAll: () => (fake.children ?? []).map(el),
      }) as unknown as Element;
    const list: Fake = { attrs: { "data-discovery-source": "search" }, children: [] };
    const first: Fake = { attrs: { "data-listing-ref": "11", "data-position": "24" }, parent: list };
    const second: Fake = { attrs: { "data-listing-ref": "12" }, parent: list };
    list.children = [first, second];
    const image: Fake = { attrs: {}, parent: second };
    expect(clickEvent(el({ attrs: {}, parent: first }))).toEqual({ kind: "result_click", listing: 11, source: "search", position: 24 });
    expect(positionOf(el(first), el(list))).toBe(24);
    list.attrs["data-discovery-source"] = "for_you";
    expect(clickEvent(el(image))).toMatchObject({ kind: "rail_click", listing: 12, source: "for_you" });
    expect(clickEvent(el({ attrs: {} }))).toBeNull();
    expect(readDepth(0, 800, 3200)).toBe(25);
    expect(readDepth(5000, 800, 3200)).toBe(100);
    expect(readDepth(0, 800, 0)).toBe(0);
  });
});

describe("the visitor's ID, only with Accept all", () => {
  test("is set host-only, httpOnly, for 12 months once they chose Accept all, and only from this site's pages", async () => {
    setRequest({ "x-real-ip": "203.0.113.7" }, { udz_cookie_consent: "v2.all.2026-11-04" });
    expect((await visitorRoute.POST(from("https://udozo.com/api/discovery/visitor", { method: "POST" }))).status).toBe(204);
    const set = request.set.find(item => item.name === visitorCookie)!;
    expect(set.value).toMatch(visitorPattern);
    expect(set.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 });
    expect(set.options).not.toHaveProperty("domain");
    // One already there is kept.
    request.set = [];
    await visitorRoute.POST(from("https://udozo.com/api/discovery/visitor", { method: "POST" }));
    expect(request.set).toHaveLength(0);
  });

  test("is never set with Necessary only, an older choice, no choice or from another site", async () => {
    for (const cookies of [{ udz_cookie_consent: "v2.necessary.2026-11-04" }, { udz_cookie_consent: "v1.all.2026-11-01" }, {}] as Array<Record<string, string>>) {
      setRequest({}, cookies);
      await visitorRoute.POST(from("https://udozo.com/api/discovery/visitor", { method: "POST" }));
      expect(request.set).toHaveLength(0);
    }
    setRequest({}, { udz_cookie_consent: "v2.all.2026-11-04" });
    await visitorRoute.POST(from("https://udozo.com/api/discovery/visitor", { method: "POST", site: "cross-site" }));
    expect(request.set).toHaveLength(0);
  });

  test("Necessary only removes it, and what was kept under it, asked as the visitor alone", async () => {
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    setRequest({ "x-real-ip": "203.0.113.7" }, { [visitorCookie]: visitor, udz_customer: "bcc_session" });
    await visitorRoute.DELETE(from("https://udozo.com/api/discovery/visitor", { method: "DELETE" }));
    const [url, init] = fetcher.mock.calls[0] as unknown as Call;
    expect(url).toBe("http://api.test/v1/classifieds/history");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({ "udozo-visitor": visitor });
    expect(init.headers).not.toHaveProperty("bitocard-customer-session");
    expect(request.set).toContainEqual({ name: visitorCookie, value: "", options: { maxAge: 0 } });
  });

  test("the tracker follows the cookie choice, on udozo.com only, and the consent version asks everyone again", () => {
    const tracker = read("../components/discovery/tracker.tsx");
    expect(tracker).toContain('choice === "all" && !state.current.visitor && !state.current.signedIn');
    expect(tracker).toContain('choice !== "all" && state.current.visitor');
    expect(tracker).toContain("consentChangedEvent");
    expect(read("../app/layout.tsx")).toContain("{onStore ? null : <DiscoveryTracker");
    expect(read("../lib/cookie-consent.ts")).toContain("export const consentVersion = 2;");
  });
});

describe("the routes to Udozo's API", () => {
  const batch = JSON.stringify({ country: "NG", session: "visit_123456", events: [{ kind: "view", listing: 100001 }] });

  test("events go with the visitor's ID and the signed address, as plain text from this site's pages", async () => {
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    setRequest({ "x-real-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 Test" }, { [visitorCookie]: visitor });
    expect((await eventsRoute.POST(from("https://udozo.com/api/events", { method: "POST", body: batch }))).status).toBe(204);
    const [url, init] = fetcher.mock.calls[0] as unknown as Call;
    expect(url).toBe("http://api.test/v1/classifieds/events");
    expect(JSON.parse(String(init.body))).toEqual(JSON.parse(batch));
    expect(init.headers).toMatchObject({ "udozo-visitor": visitor, "user-agent": "Mozilla/5.0 Test" });
    expect(init.headers!["bitocard-client"]).toMatch(/^t=\d+,ip=203\.0\.113\.7,v1=[0-9a-f]{64}$/);
  });

  test("signed in, the session says who it is (never the visitor's ID too)", async () => {
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    setRequest({}, { udz_customer: "bcc_session", [visitorCookie]: visitor });
    await eventsRoute.POST(from("https://udozo.com/api/events", { method: "POST", body: batch }));
    const [, init] = fetcher.mock.calls[0] as unknown as Call;
    expect(init.headers).toMatchObject({ "bitocard-customer-session": "bcc_session" });
    expect(init.headers).not.toHaveProperty("udozo-visitor");
  });

  test("nothing is passed on for nobody, from another site, or for a malformed batch", async () => {
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    setRequest({}, {});
    await eventsRoute.POST(from("https://udozo.com/api/events", { method: "POST", body: batch }));
    setRequest({}, { [visitorCookie]: visitor });
    await eventsRoute.POST(from("https://udozo.com/api/events", { method: "POST", body: batch, site: "cross-site" }));
    await eventsRoute.POST(from("https://udozo.com/api/events", { method: "POST", body: "{not json" }));
    setRequest({}, { [visitorCookie]: "v_forged" });
    await eventsRoute.POST(from("https://udozo.com/api/events", { method: "POST", body: batch }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("For you is read for whoever looks, never cached; refused from other sites; empty when the API cannot answer", async () => {
    const answer: ForYou = { object: "for_you", personalised: true, rows: [{ kind: "for_you", title: "For you", href: null, items: [card(1)] }] };
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => Response.json(answer));
    vi.stubGlobal("fetch", fetcher);
    setRequest({}, { [visitorCookie]: visitor });
    const res = await forYouRoute.GET(from("https://udozo.com/api/for-you?country=ng&kinds=for_you,recent,bogus&limit=99"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual(answer);
    const [url, init] = fetcher.mock.calls[0] as unknown as Call;
    expect(url).toBe("http://api.test/v1/classifieds/for-you?country=NG&kinds=for_you,recent&limit=24");
    expect(init.headers).toMatchObject({ "udozo-visitor": visitor });
    expect((await forYouRoute.GET(from("https://udozo.com/api/for-you?country=NG", { site: "cross-site" }))).status).toBe(403);
    fetcher.mockImplementation(async () => new Response("down", { status: 503 }));
    expect(await (await forYouRoute.GET(from("https://udozo.com/api/for-you?country=NG"))).json()).toEqual({ object: "for_you", personalised: false, rows: [] });
  });

  test("the search box's recent searches (the person's) and popular ones (the market's); one can be removed", async () => {
    const fetcher = vi.fn(async (url: string) =>
      Response.json(url.includes("/recent") ? { object: "list", data: [{ query: "iphone 13" }, { query: "generator" }] } : { object: "list", data: [{ query: "iphone 13" }, { query: "toyota corolla" }] }),
    );
    vi.stubGlobal("fetch", fetcher);
    setRequest({}, { udz_customer: "bcc_session" });
    const res = await searchesRoute.GET(from("https://udozo.com/api/searches?country=ng"));
    expect(await res.json()).toEqual({ recent: ["iphone 13", "generator"], popular: ["iphone 13", "toyota corolla"] });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(["http://api.test/v1/classifieds/search/recent?country=NG", "http://api.test/v1/classifieds/search/popular?country=NG"]));
    // Nobody to remember: only the popular ones are asked for.
    fetcher.mockClear();
    setRequest({}, {});
    expect((await (await searchesRoute.GET(from("https://udozo.com/api/searches?country=NG"))).json()).recent).toEqual([]);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["http://api.test/v1/classifieds/search/popular?country=NG"]);
    setRequest({}, { udz_customer: "bcc_session" });
    fetcher.mockClear();
    await searchesRoute.DELETE(from("https://udozo.com/api/searches?country=NG&q=iphone%2013", { method: "DELETE" }));
    expect(fetcher.mock.calls[0]![0]).toBe("http://api.test/v1/classifieds/history/searches?q=iphone%2013");
  });

  test("signing in folds the visitor's history into the account; without a visitor ID nothing is asked", async () => {
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    setRequest({}, { [visitorCookie]: visitor });
    await mergeVisitorHistory({ token: "bcc_new" });
    const [url, init] = fetcher.mock.calls[0] as unknown as Call;
    expect(url).toBe("http://api.test/v1/classifieds/history/merge");
    expect(JSON.parse(String(init.body))).toEqual({ visitor });
    expect(init.headers).toMatchObject({ "bitocard-customer-session": "bcc_new" });
    expect(request.cookies.get(visitorCookie)).toBe(visitor);
    fetcher.mockClear();
    setRequest({}, {});
    await mergeVisitorHistory({ token: "bcc_new" });
    expect(fetcher).not.toHaveBeenCalled();
    for (const path of ["../lib/account-actions.ts", "../app/auth/google/callback/route.ts"]) expect(read(path), path).toContain("await mergeVisitorHistory(result.data.session);");
  });
});

describe("what people see", () => {
  const row = (kind: ForYouRow["kind"], items = [card(1), card(2)], extra: Partial<ForYouRow> = {}): ForYouRow => ({ kind, title: kind === "searched" ? 'Because you searched "iphone"' : "For you", href: null, items, ...extra });

  test("a personal row draws its cards, marked with where clicks came from; For you cards have Not interested", () => {
    const html = render(createElement(PersonalRow, { id: "home-p1", title: "Picked for you", row: row("for_you"), personalised: true, limit: 12, itemClass: "w-40" }));
    expect(html).toContain('data-discovery-source="for_you"');
    expect(html).toContain("Picked for you");
    expect(html).toContain('data-listing-ref="1"');
    expect(html).toContain('data-position="1"');
    expect(html).toContain('aria-label="More options for this listing"');
    // The holdout's popular order is told apart.
    expect(render(createElement(PersonalRow, { id: "p", title: "", row: row("for_you"), personalised: false, limit: 12, itemClass: "w-40" }))).toContain('data-discovery-source="for_you_holdout"');
    const searched = render(createElement(PersonalRow, { id: "p", title: "Admin title", row: row("searched", [card(3)], { href: "/ng/search?q=iphone" }), personalised: true, limit: 1, itemClass: "w-40" }));
    expect(searched).toContain("Because you searched &quot;iphone&quot;");
    expect(searched).toContain('href="/ng/search?q=iphone"');
    expect(searched).not.toContain("More options");
    expect(render(createElement(PersonalRow, { id: "p", title: "", row: row("recent", []), personalised: true, limit: 12, itemClass: "w-40" }))).toBe("");
  });

  test("the home page holds a personal row's place and fills it after loading (nothing drawn before); rows mark their clicks", () => {
    const home = {
      object: "classified_home",
      page: "NG",
      name: "Nigeria",
      scope: "country",
      layout: "marketplace",
      look: { hero: "navy", cards: "standard", corners: "soft", density: "comfortable" },
      source: "published",
      version: 1,
      sections: [],
      rows: [
        {
          id: "r1abc",
          hidden: false,
          title: "",
          subtitle: "",
          viewAll: null,
          view_all_href: null,
          background: "none",
          image: null,
          width: "contained",
          spacing: "normal",
          blocks: [{ id: "b1", type: "personal_rail", span: { lg: 12, md: 6 }, hidden: false, title: "For you", kind: "for_you", limit: 12, data: { kind: "for_you" } }],
        },
      ],
    } as unknown as ClassifiedHome;
    const html = render(createElement(HomeRows, { home, rows: home.rows! }));
    expect(html).toContain('data-discovery-source="home:r1abc"');
    expect(html).not.toContain("For you");
    expect(render(createElement(PersonalRail, { id: "p", country: "NG", kind: "recent", title: "", limit: 8, itemClass: "w-40" }))).toBe("");
  });

  test("rows asking at the same moment share one read", async () => {
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => Response.json({ object: "for_you", personalised: true, rows: [row("for_you"), row("recent")] } satisfies ForYou));
    const [a, b] = await Promise.all([loadForYou("NG", "for_you", 12, fetcher as unknown as typeof fetch), loadForYou("NG", "recent", 8, fetcher as unknown as typeof fetch)]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/for-you?country=NG&kinds=for_you%2Crecent&limit=12");
    expect(a?.rows).toHaveLength(2);
    expect(b).toBe(a);
    const failed = vi.fn(async () => new Response("down", { status: 503 }));
    expect(await loadForYou("GH", "for_you", 12, failed as unknown as typeof fetch)).toBeNull();
  });

  test("the listing page shows People also viewed above the similar listings, each list marked", () => {
    const page = read("../app/[cc]/l/[listing]/page.tsx");
    expect(page).toContain("/also-viewed?limit=8");
    expect(page.indexOf("People also viewed")).toBeLessThan(page.indexOf('id="similar"'));
    expect(page).toContain('source="also_viewed"');
    expect(page).toContain('source="similar"');
    expect(render(createElement(ListingGrid, { cards: [card(4) as never], source: "also_viewed" }))).toContain('data-discovery-source="also_viewed"');
  });

  test("results record the search and mark every result with its place and a Not interested menu", () => {
    const results = read("../components/results.tsx");
    expect(results).toContain('data-discovery-source="search"');
    expect(results).toContain("<SearchEvent");
    expect(results).toContain('<NotInterested key={row.id} listing={row.ref} source="search">');
    expect(read("../components/listing-actions.tsx")).toContain('track({ kind: "share", listing: listing.ref })');
    expect(read("../components/gallery.tsx")).toContain("photoOpened(shown)");
  });

  test("the empty search box offers recent searches with remove, then popular ones", () => {
    const remove = vi.fn();
    const html = render(createElement(BeforeTyping, { id: "s", recent: ["iphone 13"], popular: ["toyota corolla"], onSearch: () => undefined, onRemove: remove }));
    expect(html).toContain("Recent searches");
    expect(html).toContain('aria-label="Remove iphone 13 from your recent searches"');
    expect(html).toContain("Popular searches");
    expect(html).toContain("toyota corolla");
    expect(render(createElement(BeforeTyping, { id: "s", recent: [], popular: ["generator"], onSearch: () => undefined, onRemove: remove }))).not.toContain("Recent searches");
  });
});

describe("Account > Privacy", () => {
  test("shows the switch, what is remembered with remove, and Clear my history", () => {
    const html = render(
      createElement(PrivacyControls, {
        personalisation: true,
        history: { listings: [{ ...card(7), viewed_at: "2026-11-03T09:00:00Z" }], searches: [{ query: "generator", searched_at: "2026-11-02T09:00:00Z" }] },
      }),
    );
    expect(html).toContain('role="switch" aria-checked="true"');
    expect(html).toContain("Personalise what I see");
    expect(html).toContain('aria-label="Remove Item 7 from Recently viewed"');
    expect(html).toContain('aria-label="Remove generator from Recent searches"');
    expect(html).toContain("Clear my history");
    expect(html).toContain('href="/ng/l/7-item"');
    expect(read("../components/account/privacy-controls.tsx")).toContain("useConfirm()");
    expect(read("../app/(account)/account/profile/page.tsx")).toContain('href="/account/privacy"');
  });

  test("its actions ask Udozo's API as the customer, then read the page again", async () => {
    const fetcher = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    setRequest({}, { udz_customer: "bcc_session" });
    expect(await privacy.setPersonalisation(false)).toEqual({ ok: true });
    expect(await privacy.removeViewed(7)).toEqual({ ok: true });
    expect(await privacy.removeSearch(" generator ")).toEqual({ ok: true });
    expect(await privacy.clearHistory()).toEqual({ ok: true });
    const calls = (fetcher.mock.calls as unknown as Call[]).map(([url, init]) => `${init.method} ${url.replace("http://api.test", "")}`);
    expect(calls).toEqual(["PUT /v1/classifieds/me/personalisation", "DELETE /v1/classifieds/history/listings/7", "DELETE /v1/classifieds/history/searches?q=generator", "DELETE /v1/classifieds/history"]);
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as Call)[1].body))).toEqual({ enabled: false });
    expect(revalidatePath).toHaveBeenCalledWith("/account/privacy");
    // Bad input never reaches the API; a refusal says why.
    fetcher.mockClear();
    expect((await privacy.removeViewed(-1)).ok).toBe(false);
    expect((await privacy.removeSearch("   ")).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockImplementation(async () => Response.json({ error: { code: "x", message: "Not now." } }, { status: 409 }));
    expect(await privacy.clearHistory()).toEqual({ ok: false, message: "Not now." });
  });
});
