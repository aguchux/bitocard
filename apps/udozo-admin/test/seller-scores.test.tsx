// Anjio's scores: a seller's admin page shows each metric with its sample, what buyers see, flags, tips and the
// summary with its model and cost; operations recompute, hide (with why) and write the summary again; support reads only.
// Reports > Seller ratings shows the spread by band and the summaries' cost. Always on Udozo's own admin routes.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const query = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => ({ id: "cus_1" }),
  useSearchParams: () => query,
  usePathname: () => "/classifieds/sellers/cus_1",
}));

await import("@/app/api-product");
const { default: SellerPage } = await import("@/app/(console)/classifieds/sellers/[id]/page");
const { default: ReportPage } = await import("@/app/(console)/reports/ratings/page");

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

let roles: string[];
let sent: Array<{ method: string; path: string; search: string; body: unknown }>;
let hidden: { at: string; reason: string } | null;

const seller = () => ({
  object: "classified_seller",
  id: "cus_1",
  name: "Ada Obi",
  email: "ada@example.com",
  country: "NG",
  member_since: "2026-01-01T00:00:00.000Z",
  phone_confirmed: true,
  avatar_url: null,
  handle: "k3x9q2m7pa",
  username: null,
  buy_orders_paused_until: null,
  buy_orders_paused_reason: null,
  reviews_blocked_until: null,
  suspended: false,
  suspended_reason: null,
  suspended_at: null,
  listings: { active: 6, pending_review: 0, sold: 1, removed: 0, total: 7 },
  open_reports: 0,
  safe_pay_sales: 0,
  safe_pay: { strikes: 0, strike_limit: 3, limited: false, cancelled_after_accepting: 0, not_handed_over: 0, disputes_lost: 0, cleared_at: null, bought: 0 },
  reports: [],
});

const scores = () => ({
  object: "classified_admin_seller_scores",
  seller_id: "cus_1",
  country: "NG",
  computed_at: "2026-11-05T02:17:00.000Z",
  overall: 78,
  band: "very_good",
  metrics: [
    { key: "response", score: 92, n: 6, minimum: 5, median_ms: 1200000 },
    { key: "reliability", score: null, n: 1, minimum: 3 },
  ],
  tips: ["1 of your 6 chats waited over a day for a first reply."],
  flags: ["3 reviews or ratings from accounts under 30 days old."],
  public_view: { new_seller: false, response: "Usually replies within an hour", attention: null, band: "very_good", band_label: "Very good", highlights: [] },
  summary: { text: "Usually replies within an hour.", provider: "anthropic", model: "claude-haiku-5-5", tokens: { input: 100, output: 20 }, cost_usd: 0.0002, written_at: "2026-11-05T02:20:00.000Z", hidden, reported: { at: "2026-11-05T09:00:00.000Z", details: "I sell fridges too" } },
});

beforeEach(() => {
  roles = ["operations"];
  sent = [];
  hidden = null;
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }] });
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/scores") return ok(scores());
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/scores/summary/hide" && input.method === "POST") {
      hidden = { at: "2026-11-05T10:00:00.000Z", reason: (body as { reason: string }).reason };
      return ok(scores());
    }
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/scores/recompute" && input.method === "POST") return ok(scores());
    if (url.pathname === "/v1/admin/classifieds/scores/report")
      return ok({
        object: "classified_seller_scores_report",
        sellers: 4,
        bands: [
          { band: "excellent", label: "Excellent", count: 1 },
          { band: "good", label: "Good", count: 1 },
          { band: null, label: "Not enough to rate yet", count: 2 },
        ],
        summaries: { written: 2, hidden: 1, reported: 1, this_month: { count: 3, cost_usd: 0.12 } },
        moderation: { reviews: { total: 20, held: { count: 2, pct: 10 }, removed: { count: 1, pct: 5 }, reported: { count: 3, pct: 15 } }, ratings: { total: 10, flagged: { count: 1, pct: 10 }, excluded: { count: 0, pct: 0 } } },
      });
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1") return ok(seller());
    if (url.pathname === "/v1/admin/classifieds/listings") return ok({ object: "list", data: [], has_more: false, total: 0 });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (page: ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{page}</AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const long = { timeout: 30000 };
const onlyAdminRoutes = () => expect(sent.every(item => item.path.startsWith("/v1/admin/") && !item.path.startsWith("/v1/afrippa"))).toBe(true);

describe("Anjio's scores on a seller's page", () => {
  test("each metric with its sample, what buyers see, flags and the summary; operations recompute and hide it with why", long, async () => {
    show(<SellerPage />);
    expect(await screen.findByText("Very good (78 of 100)", {}, slow)).toBeTruthy();
    expect(screen.getByText("92 (6)")).toBeTruthy();
    expect(screen.getByText("— (1 of 3)")).toBeTruthy();
    expect(screen.getByText(/Buyers see: Usually replies within an hour · Very good seller/)).toBeTruthy();
    expect(screen.getByText("3 reviews or ratings from accounts under 30 days old.")).toBeTruthy();
    expect(screen.getByText("Usually replies within an hour.")).toBeTruthy();
    expect(screen.getByText("Reported by the seller")).toBeTruthy();
    expect(screen.getByText(/claude-haiku-5-5 · US\$0\.0002/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    let dialog = within(await screen.findByRole("dialog", {}, slow));
    fireEvent.click(dialog.getByRole("button", { name: "Recompute" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path.endsWith("/scores/recompute"))).toBe(true), slow);

    fireEvent.click(await screen.findByRole("button", { name: "Hide summary" }, slow));
    dialog = within(await screen.findByRole("dialog", {}, slow));
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "The seller says it is wrong" } });
    fireEvent.click(dialog.getByRole("button", { name: "Hide summary" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path.endsWith("/summary/hide"))).toBe(true), slow);
    expect(sent.filter(item => item.method === "POST").at(-1)?.body).toEqual({ reason: "The seller says it is wrong" });
    expect(await screen.findByRole("button", { name: "Unhide summary" }, slow)).toBeTruthy();
    onlyAdminRoutes();
  });

  test("support reads the scores but cannot act", slow, async () => {
    roles = ["support"];
    show(<SellerPage />);
    expect(await screen.findByText("Very good (78 of 100)", {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recompute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide summary" })).toBeNull();
  });
});

describe("Reports > Seller ratings", () => {
  test("the spread by band and the summaries' cost", slow, async () => {
    show(<ReportPage />);
    expect(await screen.findByText("Not enough to rate yet", {}, slow)).toBeTruthy();
    expect(screen.getByText("2 (50%)")).toBeTruthy();
    expect(screen.getByText("3 · US$0.12")).toBeTruthy();
    expect(screen.getByText("Reviews held for a moderator")).toBeTruthy();
    expect(screen.getByText("2 of 20 (10%)")).toBeTruthy();
    onlyAdminRoutes();
  });
});
