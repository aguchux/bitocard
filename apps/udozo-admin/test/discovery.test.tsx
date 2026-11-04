// Reports > Discovery: the totals, top searches and those that found nothing, clicks by source in words, For you
// against its comparison group, and whether personalisation is on, all from Udozo's own admin route.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/reports/discovery" }));

await import("@/app/api-product");
const { default: DiscoveryPage } = await import("@/app/(console)/reports/discovery/page");
const { menus } = await import("@/components/shell");

const slow = { timeout: 20000 };
const summary = (over: Record<string, unknown> = {}) => ({
  object: "discovery_summary",
  country: null,
  days: 7,
  from: "2026-10-29",
  to: "2026-11-04",
  enabled: true,
  totals: { subjects: 1240, events: 18750, searches: 3200, zero_result_searches: 160, zero_result_rate: 0.051 },
  top_queries: [{ query: "iphone 13", searches: 410, subjects: 260 }],
  zero_result_queries: [{ query: "keke napep spare", searches: 37, subjects: 21 }],
  sources: [
    { source: "search", impressions: 52000, clicks: 2600, contacts: 140, click_rate: 0.05 },
    { source: "home:r7", impressions: 9000, clicks: 270, contacts: 12, click_rate: 0.03 },
    { source: "for_you_holdout", impressions: 1000, clicks: 20, contacts: 1, click_rate: 0.02 },
    { source: "also_viewed", impressions: 4000, clicks: 160, contacts: 9, click_rate: 0.04 },
  ],
  for_you: [
    { group: "personalised", subjects: 900, impressions: 9000, clicks: 405, click_rate: 0.045, contacts_per_subject: 0.31 },
    { group: "holdout", subjects: 100, impressions: 1000, clicks: 20, click_rate: 0.02, contacts_per_subject: 0.12 },
  ],
  daily: Array.from({ length: 7 }, (_, index) => ({ day: `2026-11-0${index + 1}`, events: 2600, searches: 450, subjects: 300 })),
  kinds: [
    { kind: "view", events: 9000 },
    { kind: "search", events: 3200 },
    { kind: "chat", events: 210 },
  ],
  ...over,
});
let sent: Array<{ path: string; search: string }>;
let answer: ReturnType<typeof summary>;

beforeEach(() => {
  sent = [];
  answer = summary();
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    sent.push({ path: url.pathname, search: url.search });
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles: ["support"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ object: "country", code: "NG", name: "Nigeria", currency: "NGN" }, { object: "country", code: "GH", name: "Ghana", currency: "GHS" }] });
    if (url.pathname === "/v1/admin/classifieds/discovery") return ok({ ...answer, country: url.searchParams.get("country"), days: Number(url.searchParams.get("days")) });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shown = () =>
  render(
    <AdminProviders>
      <AdminGate>
        <DiscoveryPage />
      </AdminGate>
    </AdminProviders>,
  );

describe("Reports > Discovery", () => {
  test("is in the Reports menu", () => {
    expect(menus.reports!.items.some(item => item.href === "/reports/discovery" && item.label === "Discovery")).toBe(true);
  });

  test("the totals, searches, clicks by source in words and For you against the comparison group", async () => {
    shown();
    expect(await screen.findByText("Personalisation is on for every country.", {}, slow)).toBeTruthy();
    expect(screen.getByText("1,240")).toBeTruthy();
    expect(screen.getByText("18,750")).toBeTruthy();
    expect(screen.getByText("5.1%")).toBeTruthy();
    expect(screen.getByText("160 searches with no results")).toBeTruthy();

    // DataTable also draws phone cards: read the tables.
    const top = screen.getByRole("table", { name: "Top searches" });
    expect(within(top).getByText("iphone 13")).toBeTruthy();
    expect(within(top).getByText("410")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Searches with no results" })).getByText("keke napep spare")).toBeTruthy();

    const sources = screen.getByRole("table", { name: "Clicks by source" });
    expect(within(sources).getByText("Search results")).toBeTruthy();
    expect(within(sources).getByText("Home row")).toBeTruthy();
    expect(within(sources).getByText("For you (comparison group)")).toBeTruthy();
    expect(within(sources).getByText("People also viewed")).toBeTruthy();
    expect(within(sources).getByText("2,600")).toBeTruthy();

    const groups = screen.getByRole("table", { name: "For you, personalised and comparison group" });
    const personalised = within(groups).getByText("Personalised").closest("tr")!;
    expect(personalised.textContent).toContain("4.5%");
    expect(personalised.textContent).toContain("0.31");
    const holdout = within(groups).getByText("Comparison group").closest("tr")!;
    expect(holdout.textContent).toContain("2%");
    expect(holdout.textContent).toContain("0.12");

    const kinds = screen.getByRole("list", { name: "Events by kind" });
    expect(kinds.textContent).toContain("Listing opened");
    expect(kinds.textContent).toContain("Chat started");

    expect(sent.find(item => item.path === "/v1/admin/classifieds/discovery")?.search).toBe("?days=7");
    // Only Udozo's own routes, never BitoCard's reports.
    expect(sent.some(item => item.path.startsWith("/v1/admin/reports") || item.path.startsWith("/v1/afrippa"))).toBe(false);
  }, 30000);

  test("a market and a period chosen; off there, it says so and links to the switches", async () => {
    answer = summary({ enabled: false, for_you: [] });
    shown();
    await screen.findByText(/Personalisation is off for every country/, {}, slow);
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "GH" } });
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "30" } });
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/classifieds/discovery" && item.search === "?country=GH&days=30")).toBe(true));
    expect(await screen.findByText("Personalisation is off for Ghana", {}, slow)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings › Feature switches" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByText("For you has not been shown in this period.")).toBeTruthy();
  }, 30000);
});
