// Private ratings: Marketplace > Private ratings lists safety concerns first (with the count), then every rating, by
// market and by the seller or buyer a seller's page links with; operations leave a rating out of the seller's summary
// (with why) or put it back; a seller's page shows the summary as it stands, the latest ratings and both lists' links.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

let routeId = "cus_1";
let query = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => ({ id: routeId }),
  useSearchParams: () => query,
  usePathname: () => "/classifieds/ratings",
}));

await import("@/app/api-product");
const { default: RatingsPage } = await import("@/app/(console)/classifieds/ratings/page");
const { default: SellerPage } = await import("@/app/(console)/classifieds/sellers/[id]/page");

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
let excluded: { at: string; reason: string } | null;

const rating = () => ({
  object: "classified_admin_interaction_rating",
  id: "ir_1",
  channel: "chat",
  country: "NG",
  responsiveness: 2,
  helpfulness: 3,
  courtesy: 4,
  tags: ["pushy", "pay_outside"],
  comment: "Asked me to send the money first",
  flagged: true,
  excluded,
  rater: { id: "cus_2", name: "Bola Ade", email: "bola@example.com" },
  seller: { id: "cus_1", name: "Ada Obi", email: "ada@example.com" },
  listing: { id: "lst_1", title: "iPhone 13, 128GB", path: "/ng/l/100004-iphone-13-128gb" },
  created_at: "2026-11-04T10:00:00.000Z",
  updated_at: "2026-11-04T10:00:00.000Z",
});

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

beforeEach(() => {
  roles = ["operations"];
  sent = [];
  routeId = "cus_1";
  query = new URLSearchParams();
  excluded = null;
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }, { code: "GH", name: "Ghana" }] });
    if (url.pathname === "/v1/admin/classifieds/interaction-ratings") return ok({ object: "list", counts: { flagged: 1 }, data: [rating()], total: 1 });
    if (url.pathname === "/v1/admin/classifieds/interaction-ratings/ir_1/exclude" && input.method === "POST") {
      excluded = { at: "2026-11-05T10:00:00.000Z", reason: (body as { reason: string }).reason };
      return ok(rating());
    }
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/ratings")
      return ok({ object: "classified_admin_interaction_summary", seller_id: "cus_1", minimum: 5, shown_to_seller: false, excluded: 0, count: 1, scores: { responsiveness: 2, helpfulness: 3, courtesy: 4 }, tags: [{ tag: "pushy", count: 1 }], data: [rating()] });
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
const listCalls = () => sent.filter(item => item.method === "GET" && item.path === "/v1/admin/classifieds/interaction-ratings").map(item => new URLSearchParams(item.search));
const onlyAdminRoutes = () => expect(sent.every(item => item.path.startsWith("/v1/admin/") && !item.path.startsWith("/v1/afrippa"))).toBe(true);

describe("private ratings", () => {
  test("open on safety concerns with who rated whom and the note; operations leave one out with why", long, async () => {
    show(<RatingsPage />);
    expect(await screen.findByText("Asked me to send the money first", {}, slow)).toBeTruthy();
    expect(screen.getByText("Safety concern")).toBeTruthy();
    expect(screen.getByText("Asked me to pay outside Udozo")).toBeTruthy();
    expect(screen.getByText(/bola@example\.com/)).toBeTruthy();
    expect(listCalls()[0].get("flagged")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    await waitFor(() => expect(listCalls().some(params => params.get("flagged") === null)).toBe(true), slow);

    fireEvent.click(await screen.findByRole("button", { name: "Leave it out of the summary" }, slow));
    const dialog = within(await screen.findByRole("dialog", {}, slow));
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "A rival seller's account" } });
    fireEvent.click(dialog.getByRole("button", { name: "Leave it out" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path.endsWith("/ir_1/exclude"))).toBe(true), slow);
    expect(sent.find(item => item.method === "POST")?.body).toEqual({ reason: "A rival seller's account" });
    expect(await screen.findByRole("button", { name: "Put it back in the summary" }, slow)).toBeTruthy();
    onlyAdminRoutes();
  });

  test("a seller's link shows every rating about them; support reads but cannot leave one out", slow, async () => {
    roles = ["support"];
    query = new URLSearchParams("seller=cus_1");
    show(<RatingsPage />);
    expect(await screen.findByText(/Showing only ratings about this seller/, {}, slow)).toBeTruthy();
    await waitFor(() => expect(listCalls().some(params => params.get("seller") === "cus_1" && params.get("flagged") === null)).toBe(true), slow);
    expect(await screen.findByText("Asked me to send the money first", {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave it out of the summary" })).toBeNull();
  });

  test("the seller's page: the summary as it stands, whether they see it, and both lists", long, async () => {
    show(<SellerPage />);
    expect(await screen.findByText("Not yet: from 5", {}, slow)).toBeTruthy();
    expect(screen.getByText("2.0 of 5")).toBeTruthy();
    expect(screen.getByText("Pushy (1)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All ratings about them" }).getAttribute("href")).toBe("/classifieds/ratings?seller=cus_1");
    expect(screen.getByRole("link", { name: "Ratings they gave" }).getAttribute("href")).toBe("/classifieds/ratings?rater=cus_1");
    onlyAdminRoutes();
  });
});
