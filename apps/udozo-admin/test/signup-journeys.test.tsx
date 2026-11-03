import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const params = { id: "j1" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => params, useSearchParams: () => new URLSearchParams(), usePathname: () => "/reports/signups" }));

await import("@/app/api-product");
const { default: ReportPage } = await import("@/app/(console)/reports/signups/page");
const { default: JourneyPage } = await import("@/app/(console)/reports/signups/[id]/page");
const { menus } = await import("@/components/shell");

const slow = { timeout: 20000 };
const journey = (over: Record<string, unknown> = {}) => ({
  object: "signup_journey",
  id: "j1",
  surface: "udozo",
  email: "amaka@example.com",
  method: "email",
  country: "NG",
  device: "Chrome on Android",
  status: "stuck",
  stuck_at: "phone_verified",
  milestones: { email_entered: "2026-11-03T09:00:00.000Z", email_verified: "2026-11-03T09:02:00.000Z", phone_entered: "2026-11-03T09:04:00.000Z", phone_verified: null, account_created: null, signed_in: null, completed: null },
  phone_skipped: false,
  last_error: { step: "phone_verify", code: "code_invalid" },
  refusals: 2,
  steps: 5,
  started_at: "2026-11-03T09:00:00.000Z",
  last_event_at: "2026-11-03T09:06:00.000Z",
  deletes_at: "2026-12-03T09:06:00.000Z",
  ...over,
});
const summary = {
  object: "signup_summary",
  surface: "udozo",
  days: 7,
  country: null,
  from: "2026-10-28",
  to: "2026-11-03",
  visits: 40,
  totals: { started: 20, completed: 12, completion_rate: 0.6, average_minutes_to_complete: 6.5, in_progress: 1, stuck: 7 },
  funnel: [
    { milestone: "email_entered", count: 20 },
    { milestone: "email_verified", count: 17 },
    { milestone: "phone_entered", count: 15 },
    { milestone: "phone_verified", count: 13 },
    { milestone: "account_created", count: 12 },
    { milestone: "completed", count: 12 },
  ],
  stuck_at: [
    { milestone: "email_entered", count: 0 },
    { milestone: "email_verified", count: 3 },
    { milestone: "phone_entered", count: 2 },
    { milestone: "phone_verified", count: 2 },
    { milestone: "account_created", count: 0 },
    { milestone: "completed", count: 0 },
  ],
  blockers: [{ step: "phone", code: "phone_in_use", refusals: 4, journeys: 3 }],
  daily: Array.from({ length: 7 }, (_, index) => ({ day: `2026-10-${28 + index > 31 ? "0" + (28 + index - 31) : 28 + index}`.replace("2026-10-0", "2026-11-0"), visits: 5, started: 3, completed: 2 })),
  methods: [{ method: "email", started: 18, completed: 11 }, { method: "google", started: 2, completed: 1 }],
  countries: [{ country: "NG", started: 20, completed: 12 }],
  devices: [{ device: "Chrome on Android", started: 15, completed: 9 }],
};
let sent: Array<{ path: string; search: string }>;

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    sent.push({ path: url.pathname, search: url.search });
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles: ["support"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/signup-journeys/summary") return ok(summary);
    if (url.pathname === "/v1/admin/signup-journeys") return ok({ object: "list", data: [journey()], total: 1, has_more: false });
    if (url.pathname === "/v1/admin/signup-journeys/j1")
      return ok({
        ...journey(),
        account: null,
        events: [
          { id: "e1", step: "email", outcome: "ok", code: null, param: null, device: "Chrome on Android", at: "2026-11-03T09:00:00.000Z" },
          { id: "e2", step: "email_verify", outcome: "ok", code: null, param: null, device: "Chrome on Android", at: "2026-11-03T09:02:00.000Z" },
          { id: "e3", step: "phone", outcome: "ok", code: null, param: null, device: "Chrome on Android", at: "2026-11-03T09:04:00.000Z" },
          { id: "e4", step: "phone_verify", outcome: "refused", code: "code_invalid", param: "code", device: "Chrome on Android", at: "2026-11-03T09:06:00.000Z" },
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

describe("Reports > Sign-up journeys", () => {
  test("is in the Reports menu", () => {
    expect(menus.reports!.items.some(item => item.href === "/reports/signups" && item.label === "Sign-up journeys")).toBe(true);
  });

  test("the funnel with its drops, where people are stuck, what refuses them, and the stuck journeys", async () => {
    shown(<ReportPage />);
    const funnel = await screen.findByRole("list", { name: "Sign-up funnel" }, slow);
    expect(within(funnel).getByText("Opened sign-up")).toBeTruthy();
    expect(funnel.textContent).toContain("3 stopped before this (15%)");
    expect(screen.getByText("Did not confirm the emailed code")).toBeTruthy();
    expect(screen.getAllByText("Mobile already on another account").length).toBeGreaterThan(0);
    expect(sent.find(item => item.path === "/v1/admin/signup-journeys/summary")?.search).toBe("?surface=udozo&days=7");
    const row = (await screen.findAllByText("amaka@example.com", {}, slow))[0]!.closest("tr")!;
    expect(row.textContent).toContain("Stuck");
    expect(row.textContent).toContain("Did not confirm the texted code");
    expect(sent.find(item => item.path === "/v1/admin/signup-journeys")?.search).toContain("status=stuck");

    // Choosing a refusal shows the journeys it stopped.
    fireEvent.click(screen.getAllByText("Mobile already on another account")[0]!);
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/signup-journeys" && item.search.includes("code=phone_in_use"))).toBe(true));
    // Seller HQ's sign-ups are their own funnel.
    fireEvent.click(screen.getByRole("tab", { name: "Seller HQ" }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/signup-journeys/summary" && item.search.includes("surface=shq"))).toBe(true));
  }, 30000);

  test("a journey: milestones, every step with its time and why one was refused", async () => {
    shown(<JourneyPage />);
    const steps = await screen.findByRole("list", { name: "Steps" }, slow);
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(steps.textContent).toContain("Entered the texted code");
    expect(steps.textContent).toContain("Wrong code");
    expect(steps.textContent).toContain("2 min after the last");
    expect(screen.getByText(/Stuck: did not confirm the texted code/)).toBeTruthy();
    const milestones = screen.getByRole("list", { name: "Milestones" });
    expect(milestones.textContent).toContain("Mobile confirmed");
    expect(milestones.textContent).toContain("Not yet");
  }, 30000);
});
