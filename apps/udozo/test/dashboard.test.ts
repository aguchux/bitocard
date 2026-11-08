// The account dashboard (8 November 2026, the owner's request): /account shows the customer's figures against the
// period before, a chart of each figure day by day (with every day as a table), their best listings and Udozo's message
// board; My listings is /account/listings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountDashboard } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("not-found"); }, usePathname: () => "/account", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const { boardLink, changeText, chartPoints, niceMax, periodOf } = await import("@/lib/dashboard");
const { default: Dashboard } = await import("@/app/(account)/account/page");
const { ActivityChart } = await import("@/components/account/activity-chart");

const customer = { object: "customer", id: "c9", email: "ada@example.com", name: "Ada Obi", first_name: "Ada", last_name: "Obi", name_confirmed: true, email_verified: true, phone: "+2348031234567", phone_verified: true, phone_verification_available: true, country: "NG", currency: "NGN", created_at: "2026-11-01T00:00:00Z" };
const series = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"].map((day, index) => ({ day, views: index * 2, leads: index === 6 ? 1 : 0, chats: 0, saves: 0, sales: 0 }));
const dashboard: AccountDashboard = {
  object: "account_dashboard",
  country: "NG",
  days: 7,
  since: "2026-11-02",
  until: "2026-11-08",
  listings: { active: 2, in_review: 0, drafts: 1, needs_changes: 1, sold: 0, expired: 0, views: 120, leads: 4 },
  totals: { views: { value: 42, previous: 20, change_pct: 110 }, leads: { value: 1, previous: 2, change_pct: -50 }, chats: { value: 2, previous: 0, change_pct: null }, saves: { value: 0, previous: 0, change_pct: null }, sales: { value: 1, previous: 1, change_pct: 0 } },
  sales_value: [{ currency: "NGN", amount: 24000000 }],
  response_rate: 50,
  purchases: 0,
  reviews: null,
  series,
  top_listings: [{ id: "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d", title: "Hisense 50 inch TV", status: "active", views: 15, leads: 2 }],
  board: [
    { object: "board_post", id: "p1", title: "Safe pay in Lagos", body: "Pay through Udozo.\nThe seller is paid once you have it.", tone: "tip", href: "/safe-trade", link_label: "How it works", pinned: true, posted_at: "2026-11-07T10:00:00Z" },
    { object: "board_post", id: "p2", title: "Partner offer", body: "Delivery at half price.", tone: "news", href: "https://partner.example.com/offer", link_label: null, pinned: false, posted_at: "2026-11-06T10:00:00Z" },
  ],
};

let calls: string[];
let shownBanners: string[];
let answer: () => Response;
beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
  calls = [];
  shownBanners = [];
  answer = () => Response.json(dashboard);
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url.includes("/v1/store/account")) return Response.json(customer);
    if (url.includes("/v1/classifieds/markets")) return Response.json({ object: "list", data: [{ object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 3 }], showcase: false });
    if (url.includes("/v1/classifieds/me/dashboard")) return answer();
    if (url.includes("/v1/classifieds/banners")) {
      const position = new URL(url).searchParams.get("position")!;
      return Response.json({ object: "list", position, data: shownBanners.includes(position) ? [{ object: "banner", id: `b-${position}`, image_url: `https://cdn.udozo.test/${position}.png`, href: "/ng/c/tvs", alt: `Banner ${position}` }] : [] });
    }
    return Response.json({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the dashboard's helpers", () => {
  test("periods, changes in words, a tidy scale and safe links", () => {
    expect([periodOf("7"), periodOf("90"), periodOf("14"), periodOf(undefined)]).toEqual([7, 90, 30, 30]);
    expect(changeText({ value: 42, previous: 20, change_pct: 110 })).toEqual({ text: "Up 110%", trend: "up" });
    expect(changeText({ value: 1, previous: 2, change_pct: -50 })).toEqual({ text: "Down 50%", trend: "down" });
    expect(changeText({ value: 2, previous: 0, change_pct: null }).text).toBe("New this period");
    expect(changeText({ value: 0, previous: 0, change_pct: null }).text).toBe("None yet");
    expect([niceMax(0), niceMax(7), niceMax(42), niceMax(130), niceMax(1000)]).toEqual([4, 10, 50, 200, 1000]);
    const { max, points } = chartPoints([0, 5, 10], 100, 50);
    expect(max).toBe(10);
    expect(points.map(point => [point.x, point.y])).toEqual([[0, 50], [50, 25], [100, 0]]);
    expect(boardLink("/sell")).toEqual({ href: "/sell", external: false });
    expect(boardLink("https://partner.example.com")).toEqual({ href: "https://partner.example.com", external: true });
    for (const bad of ["//evil.example", "javascript:alert(1)", "http://plain.example", null]) expect(boardLink(bad)).toBeNull();
  });
});

describe("the dashboard page", () => {
  test("asks for the period, shows each figure with its change in words, the board, best listings and listings at a glance", async () => {
    const html = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({ days: "7" }) }));
    expect(calls.some(url => url.endsWith("/v1/classifieds/me/dashboard?days=7"))).toBe(true);
    expect(html).toContain("Dashboard");
    expect(html).toMatch(/aria-current="page"[^>]*>7 days/);
    for (const words of ["Up 110%", "Down 50%", "New this period", "Same as before", "vs 20 before"]) expect(html).toContain(words);
    // The message board: pinned first, its kind in words, the body's lines kept, links only to safe places.
    expect(html).toContain("Message board");
    expect(html.indexOf("Safe pay in Lagos")).toBeLessThan(html.indexOf("Partner offer"));
    expect(html).toContain("Pinned");
    expect(html).toContain("Pay through Udozo.\nThe seller is paid once you have it.");
    expect(html).toContain('href="/safe-trade"');
    expect(html).toMatch(/href="https:\/\/partner\.example\.com\/offer" target="_blank" rel="noopener noreferrer"/);
    expect(html).toContain('href="/account/listings/0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d"');
    expect(html).toContain('href="/account/listings?status=draft"');
    expect(html).toContain("1 listing needs changes");
    expect(html).toContain("₦240,000");
    expect(html).toContain("50%");
  });

  test("banners Udozo's team placed show in the three dashboard places, for the customer's market; none, nothing", async () => {
    shownBanners = ["dashboard_top", "dashboard_side", "dashboard_main"];
    const html = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
    for (const position of shownBanners) {
      expect(calls.some(url => url.includes(`/v1/classifieds/banners?position=${position}&country=NG`))).toBe(true);
      expect(html).toContain(`data-banner="b-${position}"`);
    }
    // The top strip sits between the title and Post an ad; the side one after the board; the main one after the chart.
    expect(html.indexOf('data-banner="b-dashboard_top"')).toBeLessThan(html.indexOf("Your figures"));
    expect(html.indexOf("Message board")).toBeLessThan(html.indexOf('data-banner="b-dashboard_side"'));
    expect(html.indexOf("See every day as a table")).toBeLessThan(html.indexOf('data-banner="b-dashboard_main"'));
    expect(html.indexOf('data-banner="b-dashboard_main"')).toBeLessThan(html.indexOf("Your most viewed listings"));
    expect(html).toContain(">Ad<");
    shownBanners = [];
    expect(renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }))).not.toContain("data-banner=");
  });

  test("says so when the dashboard cannot be read, and sends people signed out to sign in", async () => {
    answer = () => new Response(JSON.stringify({ error: { type: "api_error", code: "api_error", message: "x" } }), { status: 500 });
    expect(renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }))).toContain("could not be loaded");
    expect(calls.some(url => url.endsWith("/v1/classifieds/me/dashboard?days=30"))).toBe(true);
    setRequest({ host: "udozo.com" });
    await expect(Dashboard({ searchParams: Promise.resolve({}) })).rejects.toThrow(/redirect:\/signin/);
  });

  test("the chart: one figure at a time, a line and an area, and every day in a table", () => {
    const html = renderToStaticMarkup(createElement(ActivityChart, { series }));
    expect(html).toContain("Views each day");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Views/);
    expect(html).toContain('role="img"');
    expect((html.match(/<path /g) ?? []).length).toBe(2);
    expect(html).toContain("See every day as a table");
    expect((html.match(/<tr class="border-t/g) ?? []).length).toBe(7);
    expect(html).toContain("42 views in all");
  });
});
