// Reports > Posting journeys: the funnel from Sell to first results with its drops, where sellers are stuck, what
// refuses them and how reviews end; a journey's milestones and steps; and moderators' reasons when sending an ad back.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const params = { id: "p1" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => params, useSearchParams: () => new URLSearchParams(), usePathname: () => "/reports/postings" }));

await import("@/app/api-product");
const { default: ReportPage } = await import("@/app/(console)/reports/postings/page");
const { default: JourneyPage } = await import("@/app/(console)/reports/postings/[id]/page");
const { ModerateDialog } = await import("@/components/moderate-dialog");
const { menus } = await import("@/components/shell");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

const slow = { timeout: 20000 };
const milestones = { opened: "2026-11-05T09:00:00.000Z", draft: "2026-11-05T09:01:00.000Z", first_photo: "2026-11-05T09:03:00.000Z", submitted: null, review_queued: null, reviewed: null, sent_back: null, resubmitted: null, live: null, first_view: null, first_chat: null, first_call: null, first_lead: null, sold: null, ended: null };
const journey = (over: Record<string, unknown> = {}) => ({
  object: "posting_journey",
  id: "p1",
  status: "stuck",
  stage: "composing",
  stuck_at: "step_where",
  source: "header",
  country: "NG",
  device: "Chrome on Android",
  seller: { id: "c1", name: "Ngozi Adeyemi", email: "ngozi@example.com" },
  listing: { id: "l1", ref: 1201, sku: "PHN-000044", title: "Samsung Galaxy A54", status: "draft" },
  category: { id: "cat1", name: "Phones and tablets" },
  furthest_step: "details",
  milestones,
  live_via: null,
  ended_reason: null,
  review_flags: [],
  reviews: 0,
  sent_back_count: 0,
  last_reject_code: null,
  last_error: { step: "step_details", code: "step_incomplete" },
  refusals: 1,
  submit_attempts: 0,
  steps: 5,
  started_at: "2026-11-05T09:00:00.000Z",
  last_event_at: "2026-11-05T09:10:00.000Z",
  deletes_at: "2026-12-05T09:10:00.000Z",
  ...over,
});
const funnel = [
  ["opened", 50],
  ["draft", 40],
  ["step_media", 36],
  ["step_details", 30],
  ["step_where", 22],
  ["step_place", 20],
  ["step_post", 19],
  ["submitted", 18],
  ["live", 15],
  ["first_view", 14],
  ["first_contact", 6],
  ["first_lead", 6],
  ["sold", 2],
] as const;
const summary = {
  object: "posting_summary",
  days: 30,
  country: null,
  source: null,
  category: null,
  from: "2026-10-08",
  to: "2026-11-06",
  visits: { signed_in: 60, signed_out: 20 },
  totals: { started: 50, submitted: 18, live: 15, sold: 2, abandoned: 9, removed: 1, post_rate: 0.3, in_progress: 4, stuck: 11, in_review_now: 2, sent_back_now: 1, median_minutes_to_submit: 14, median_minutes_to_live: 95, median_minutes_to_first_contact: 300, average_minutes_to_submit: 20, average_minutes_to_live: 120, average_minutes_to_first_contact: 400 },
  funnel: funnel.map(([milestone, count]) => ({ milestone, count })),
  live_split: { direct: 9, after_review: 6 },
  stuck_at: [
    { milestone: "opened", count: 0 },
    { milestone: "draft", count: 3 },
    { milestone: "step_media", count: 0 },
    { milestone: "step_details", count: 5 },
    { milestone: "step_where", count: 2 },
    { milestone: "step_place", count: 0 },
    { milestone: "step_post", count: 0 },
    { milestone: "submitted", count: 1 },
    { milestone: "resubmitted", count: 1 },
  ],
  review: { queued: 9, approved: 6, sent_back: 2, removed: 1, approval_rate: 0.67, median_minutes_to_review: 45, average_minutes_to_review: 60, reasons: [{ code: "photos", count: 2 }, { code: "prohibited_item", count: 1 }], flags: [{ flag: "first_listings", count: 8 }, { flag: "price_low", count: 1 }] },
  blockers: [
    { origin: "client", step: "step_media", code: "step_incomplete", param: "photos", refusals: 9, journeys: 7 },
    { origin: "api", step: "submit", code: "photos_required", param: "photos", refusals: 3, journeys: 2 },
  ],
  daily: Array.from({ length: 30 }, (_, index) => ({ day: new Date(Date.UTC(2026, 9, 8 + index)).toISOString().slice(0, 10), visits: 3, started: 2, submitted: 1, live: 1 })),
  sources: [{ key: "header", label: null, started: 30, submitted: 12, live: 10 }, { key: "my_listings", label: null, started: 20, submitted: 6, live: 5 }],
  categories: [{ key: "cat1", label: "Phones and tablets", started: 25, submitted: 10, live: 8 }],
  devices: [{ key: "Chrome on Android", label: null, started: 40, submitted: 15, live: 12 }],
  countries: [{ key: "NG", label: null, started: 50, submitted: 18, live: 15 }],
};
let sent: Array<{ method: string; path: string; search: string; body: unknown }>;

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles: ["support"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/posting-journeys/summary") return ok(summary);
    if (url.pathname === "/v1/admin/posting-journeys") return ok({ object: "list", data: [journey()], total: 1, has_more: false });
    if (url.pathname === "/v1/admin/posting-journeys/p1")
      return ok({
        ...journey(),
        events: [
          { id: "e1", origin: "client", step: "sell_opened", outcome: "ok", code: null, param: null, device: "Chrome on Android", at: "2026-11-05T09:00:00.000Z" },
          { id: "e2", origin: "api", step: "create", outcome: "ok", code: null, param: null, device: "Chrome on Android", at: "2026-11-05T09:01:00.000Z" },
          { id: "e3", origin: "client", step: "step_media", outcome: "ok", code: null, param: null, device: "Chrome on Android", at: "2026-11-05T09:02:00.000Z" },
          { id: "e4", origin: "client", step: "step_details", outcome: "refused", code: "step_incomplete", param: "price", device: "Chrome on Android", at: "2026-11-05T09:10:00.000Z" },
        ],
      });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shown = (children: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{children}</AdminGate>
    </AdminProviders>,
  );
const onlyAdminRoutes = () => expect(sent.every(item => item.path.startsWith("/v1/admin/"))).toBe(true);

describe("Reports > Posting journeys", () => {
  test("is in the Reports menu after Sign-up journeys", () => {
    const items = menus.reports!.items;
    const at = items.findIndex(item => item.href === "/reports/postings" && item.label === "Posting journeys");
    expect(at).toBe(items.findIndex(item => item.href === "/reports/signups") + 1);
  });

  test("the funnel with its drops, where sellers are stuck, what refuses them, reviews, and the stuck journeys", async () => {
    shown(<ReportPage />);
    const list = await screen.findByRole("list", { name: "Posting funnel" }, slow);
    expect(within(list).getByText("Reached where to sell")).toBeTruthy();
    expect(list.textContent).toContain("8 stopped before this (26.7%)");
    expect(list.textContent).toContain("9 live at once · 6 after a moderator");
    expect(list.textContent).toContain("40% of live");
    expect(screen.getByRole("button", { name: /Stopped at photos/ })).toBeTruthy();
    expect(screen.getAllByText("The form asked for more").length).toBeGreaterThan(0);
    expect(screen.getByText("Usually decided within 45 min")).toBeTruthy();
    expect(screen.getAllByText("Photos").length).toBeGreaterThan(0);
    expect(screen.getByText("A new seller's first ads")).toBeTruthy();
    expect(sent.find(item => item.path === "/v1/admin/posting-journeys/summary")?.search).toBe("?days=30");
    const row = (await screen.findAllByText("Samsung Galaxy A54", {}, slow))[0]!.closest("tr")!;
    expect(row.textContent).toContain("Stuck");
    expect(row.textContent).toContain("Stopped at price and details");
    expect(sent.find(item => item.path === "/v1/admin/posting-journeys")?.search).toContain("status=stuck");

    // Choosing where sellers are stuck lists them.
    fireEvent.click(screen.getByRole("button", { name: /Stopped at photos/ }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/posting-journeys" && item.search.includes("stuck_at=step_details"))).toBe(true));
    // Filtering by where Sell was pressed.
    fireEvent.change(screen.getByLabelText("Where Sell was pressed"), { target: { value: "my_listings" } });
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/posting-journeys/summary" && item.search.includes("source=my_listings"))).toBe(true));
    onlyAdminRoutes();
  }, 30000);

  test("a journey: milestones, every step with who told it and why one was refused", async () => {
    shown(<JourneyPage />);
    const steps = await screen.findByRole("list", { name: "Steps" }, slow);
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(steps.textContent).toContain("Opened Post an ad · Form");
    expect(steps.textContent).toContain("Saved the draft · Posting");
    expect(steps.textContent).toContain("The form asked for more · price");
    expect(screen.getByText(/Stuck: stopped at price and details/)).toBeTruthy();
    const marks = screen.getByRole("list", { name: "Milestones" });
    expect(marks.textContent).toContain("First photo");
    expect(marks.textContent).toContain("Not yet");
    onlyAdminRoutes();
  }, 30000);
});

describe("moderators' reasons", () => {
  test("a reason is chosen first; the seller reads the reason's words unless a note is written; Other needs a note", async () => {
    const confirmed: Array<{ reason_code: string; note: string }> = [];
    render(<ModerateDialog title="Send this ad back?" description="The seller sees why." confirmLabel="Send back" tone="primary" onClose={() => undefined} onConfirm={async input => void confirmed.push(input)} />);
    const button = screen.getByRole("button", { name: "Send back" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "photos" } });
    expect(screen.getByText(/photos need to show the item clearly/)).toBeTruthy();
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "other" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Note for the seller"), { target: { value: "Show the screen switched on." } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(confirmed).toEqual([{ reason_code: "other", note: "Show the screen switched on." }]));
  });
});
