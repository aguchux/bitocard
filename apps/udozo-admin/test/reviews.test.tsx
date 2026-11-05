// Reviews: Marketplace > Reviews lists the reported and held ones (tabs with counts, market, and the seller or
// reviewer a seller's page links with); each review shows its words, earlier versions, the purchase, the conversation
// and the reports, with Remove, Restore, Close the conversation, Remove reply and Uphold or Dismiss for operations
// only; a seller's page blocks or unblocks reviewing; Limits and words saves the review settings. Udozo's routes only.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

let routeId = "rv_1";
let query = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => ({ id: routeId }),
  useSearchParams: () => query,
  usePathname: () => "/classifieds/reviews",
}));

await import("@/app/api-product");
const { default: ListPage } = await import("@/app/(console)/classifieds/reviews/page");
const { default: DetailPage } = await import("@/app/(console)/classifieds/reviews/[id]/page");
const { default: SellerPage } = await import("@/app/(console)/classifieds/sellers/[id]/page");
const { default: RulesPage } = await import("@/app/(console)/classifieds/rules/page");

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
let status: string;
let blockedUntil: string | null;
let settings: Record<string, unknown>;

const review = (overrides: Record<string, unknown> = {}) => ({
  object: "classified_admin_review",
  id: "rv_1",
  status,
  held_reason: null,
  removed_reason: null,
  rating: "negative",
  aspects: { described: "down" },
  body: "The battery was weaker than described.",
  country: "NG",
  source: "buy_order",
  product: { key: "bm:apple:iphone13", label: "Apple iPhone 13" },
  listing: { id: "lst_1", title: "iPhone 13, 128GB", path: "/ng/l/100004-iphone-13-128gb" },
  reviewer: { id: "cus_2", name: "Bola Ade" },
  seller: { id: "cus_1", name: "Ada Obi" },
  edits: 1,
  edited_after_reply: true,
  locked: false,
  post_count: 1,
  created_at: "2026-11-03T10:00:00.000Z",
  updated_at: "2026-11-04T10:00:00.000Z",
  ...overrides,
});

const detail = () => ({
  ...review(),
  versions: [{ rating: "neutral", aspects: {}, body: "It was fine at first.", at: "2026-11-04T10:00:00.000Z" }],
  purchase: { source: "buy_order", order: null, buy_order: { id: "bo_1", number: "BO-000123" }, completed_at: "2026-11-02T10:00:00.000Z" },
  posts: [
    { id: "pst_1", role: "seller", name: "Ada O.", avatar_url: null, stance: null, reply_to: null, body: "Sorry, bring it back and I will check it.", removed: false, edited: false, created_at: "2026-11-03T12:00:00.000Z", author: { id: "cus_1", name: "Ada Obi" }, status: "published", removed_reason: null },
  ],
  reports: [
    { id: "rpt_1", post_id: null, reason: "threat_or_extortion", details: "Said they would keep it unless I refund", status: "open", note: null, reporter: { id: "cus_1", name: "Ada Obi", email: "ada@example.com" }, decided_at: null, created_at: "2026-11-04T11:00:00.000Z" },
  ],
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
  reviews_blocked_until: blockedUntil,
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
  routeId = "rv_1";
  query = new URLSearchParams();
  status = "published";
  blockedUntil = null;
  settings = { object: "classified_market_settings", country: "NG", listing_days: 30, monthly_listing_limit: 50, first_listings_reviewed: 3, min_photos: 1, max_photos: 10, username_min_listings: 5, buy_request_hours: 48, buy_meet_days: 7, buy_open_per_buyer: 10, buy_requests_per_day: 20, reviews_neutral: false, review_window_days: 30, review_min_shown: 3 };
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const ok = (value: unknown, code = 200) => Response.json(value, { status: code });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }, { code: "GH", name: "Ghana" }] });
    if (url.pathname === "/v1/admin/classifieds/reviews") return ok({ object: "list", counts: { reported: 1, held: 2 }, data: [{ ...review(), open_reports: 1, threat: true }], total: 1 });
    if (url.pathname === "/v1/admin/classifieds/reviews/rv_1") return ok(detail());
    if (url.pathname === "/v1/admin/classifieds/reviews/rv_1/remove" && input.method === "POST") {
      status = "removed";
      return ok(detail());
    }
    if (url.pathname.startsWith("/v1/admin/classifieds/review-posts/") || url.pathname.startsWith("/v1/admin/classifieds/review-reports/")) return ok(detail());
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1") return ok(seller());
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/reviews-block" && input.method === "POST") {
      blockedUntil = (body as { blocked: boolean }).blocked ? "2099-12-01T00:00:00.000Z" : null;
      return ok({ reviews_blocked_until: blockedUntil });
    }
    if (url.pathname === "/v1/admin/classifieds/listings") return ok({ object: "list", data: [], has_more: false, total: 0 });
    if (url.pathname === "/v1/admin/classifieds/market-settings/NG") {
      if (input.method === "PUT") settings = { ...settings, ...(body as object) };
      return ok(settings);
    }
    if (url.pathname === "/v1/admin/classifieds/words") return ok({ object: "list", data: [] });
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
const listCalls = () => sent.filter(item => item.method === "GET" && item.path === "/v1/admin/classifieds/reviews").map(item => new URLSearchParams(item.search));
const posts = () => sent.filter(item => item.method === "POST");
const onlyAdminRoutes = () => expect(sent.every(item => item.path.startsWith("/v1/admin/") && !item.path.startsWith("/v1/afrippa"))).toBe(true);

describe("the reviews list", () => {
  test("opens on the reported ones, flags a threat, and switches tab and market", long, async () => {
    show(<ListPage />);
    expect((await screen.findAllByText("Apple iPhone 13", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Threat reported").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Apple iPhone 13" }).every(link => link.getAttribute("href") === "/classifieds/reviews/rv_1")).toBe(true);
    expect(listCalls()[0].get("tab")).toBe("reported");
    fireEvent.click(screen.getByRole("tab", { name: /Held/ }));
    await waitFor(() => expect(listCalls().some(params => params.get("tab") === "held")).toBe(true), slow);
    await screen.findByRole("option", { name: "Ghana" }, slow);
    fireEvent.change(screen.getByLabelText("Market"), { target: { value: "GH" } });
    await waitFor(() => expect(listCalls().some(params => params.get("tab") === "held" && params.get("country") === "GH")).toBe(true), slow);
    onlyAdminRoutes();
  });

  test("a seller's link shows every review about them", slow, async () => {
    query = new URLSearchParams("seller=cus_1");
    show(<ListPage />);
    expect(await screen.findByText(/Showing only reviews about this seller/, {}, slow)).toBeTruthy();
    await waitFor(() => expect(listCalls().some(params => params.get("seller") === "cus_1" && params.get("tab") === "all")).toBe(true), slow);
  });
});

describe("a review", () => {
  test("shows the words, the earlier version, the purchase, the conversation and the report; operations act with a reason", long, async () => {
    show(<DetailPage />);
    expect(await screen.findByText("The battery was weaker than described.", {}, slow)).toBeTruthy();
    expect(screen.getByText("It was fine at first.")).toBeTruthy();
    expect(screen.getByText(/after the seller replied/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Buy order BO-000123" }).getAttribute("href")).toBe("/classifieds/buy-orders/bo_1");
    expect(screen.getByText("Sorry, bring it back and I will check it.")).toBeTruthy();
    expect(screen.getByText("Threat or extortion")).toBeTruthy();
    expect(new URL((screen.getByRole("link", { name: "Open it on udozo.com" }) as HTMLAnchorElement).href).pathname).toBe("/ng/l/100004-iphone-13-128gb");

    fireEvent.click(screen.getByRole("button", { name: "Uphold" }));
    let dialog = within(await screen.findByRole("dialog", {}, slow));
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Asked for a refund to change it" } });
    fireEvent.click(dialog.getByRole("button", { name: "Uphold" }));
    await waitFor(() => expect(posts().some(item => item.path.endsWith("/review-reports/rpt_1/decide"))).toBe(true), slow);
    expect(posts().at(-1)).toMatchObject({ body: { decision: "upheld", note: "Asked for a refund to change it" } });

    fireEvent.click(screen.getByRole("button", { name: "Remove reply" }));
    dialog = within(await screen.findByRole("dialog", {}, slow));
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Shares a phone number" } });
    fireEvent.click(dialog.getByRole("button", { name: "Remove reply" }));
    await waitFor(() => expect(posts().some(item => item.path === "/v1/admin/classifieds/review-posts/pst_1/remove")).toBe(true), slow);

    fireEvent.click(screen.getByRole("button", { name: "Remove review" }));
    dialog = within(await screen.findByRole("dialog", {}, slow));
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Used to pressure the seller" } });
    fireEvent.click(dialog.getByRole("button", { name: "Remove review" }));
    await waitFor(() => expect(posts().some(item => item.path === "/v1/admin/classifieds/reviews/rv_1/remove")).toBe(true), slow);
    expect(posts().at(-1)).toMatchObject({ body: { reason: "Used to pressure the seller" } });
    expect(await screen.findByRole("button", { name: "Restore" }, slow)).toBeTruthy();
    onlyAdminRoutes();
  });

  test("support reads it but sees no actions", slow, async () => {
    roles = ["support"];
    show(<DetailPage />);
    expect(await screen.findByText("The battery was weaker than described.", {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Uphold" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove reply" })).toBeNull();
  });
});

describe("a seller's reviews", () => {
  test("links their reviews both ways and operations block reviewing for 180 days by default, then unblock", long, async () => {
    routeId = "cus_1";
    show(<SellerPage />);
    expect(await screen.findByText("Can write reviews", {}, slow)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reviews about them" }).getAttribute("href")).toBe("/classifieds/reviews?seller=cus_1");
    expect(screen.getByRole("link", { name: "Reviews they wrote" }).getAttribute("href")).toBe("/classifieds/reviews?reviewer=cus_1");
    fireEvent.click(screen.getByRole("button", { name: "Block reviewing" }));
    let dialog = within(await screen.findByRole("dialog", {}, slow));
    expect((dialog.getByLabelText("Days to block") as HTMLInputElement).value).toBe("180");
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Wrote reviews for a friend" } });
    fireEvent.click(dialog.getByRole("button", { name: "Block reviewing" }));
    await waitFor(() => expect(posts().some(item => item.path.endsWith("/reviews-block"))).toBe(true), slow);
    expect(posts().at(-1)).toMatchObject({ body: { blocked: true, reason: "Wrote reviews for a friend", days: 180 } });
    expect(await screen.findByText(/Blocked from reviewing until/, {}, slow)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unblock reviewing" }));
    dialog = within(await screen.findByRole("dialog", {}, slow));
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Appeal accepted" } });
    fireEvent.click(dialog.getByRole("button", { name: "Unblock" }));
    await waitFor(() => expect(posts().at(-1)).toMatchObject({ body: { blocked: false, reason: "Appeal accepted" } }), slow);
    expect(await screen.findByText("Can write reviews", {}, slow)).toBeTruthy();
    onlyAdminRoutes();
  });
});

describe("review settings on Limits and words", () => {
  test("shows them and saves only what changed, Neutral included", long, async () => {
    show(<RulesPage />);
    const window = (await screen.findByLabelText("Days to review a purchase", {}, slow)) as HTMLInputElement;
    expect(window.value).toBe("30");
    expect((screen.getByLabelText("Reviews before the positive share shows") as HTMLInputElement).value).toBe("3");
    const neutral = screen.getByLabelText(/Offer Neutral in reviews/) as HTMLInputElement;
    expect(neutral.checked).toBe(false);
    fireEvent.change(window, { target: { value: "181" } });
    expect(screen.getByText("Days to review a purchase: a whole number from 1 to 180.")).toBeTruthy();
    fireEvent.change(window, { target: { value: "14" } });
    fireEvent.click(neutral);
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    expect(await screen.findByText(/Saved\./, {}, slow)).toBeTruthy();
    expect(sent.filter(item => item.method === "PUT")).toEqual([{ method: "PUT", path: "/v1/admin/classifieds/market-settings/NG", search: "", body: { review_window_days: 14, reviews_neutral: true } }]);
    onlyAdminRoutes();
  });
});
