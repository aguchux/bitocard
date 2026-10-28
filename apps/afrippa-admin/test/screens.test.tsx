import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const push = vi.fn();
// Hoisted by Vitest above the constants, so the order's id is written out here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push, prefetch: () => undefined }), useParams: () => ({ id: "2a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a" }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));

// Loading the app's start-up module turns Afrippa's admin realm on for every request, as in the browser.
await import("@/app/admin-product");
const { default: AppealsPage } = await import("@/app/(console)/orders/page");
const { default: OrderPage } = await import("@/app/(console)/orders/[id]/page");
const { default: ReportsPage } = await import("@/app/(console)/reports/page");

const orderId = "2a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const admin = { id: "a1", name: "Ada Okafor", email: "ada@afrippa.com", roles: ["operations"] };
const order = {
  object: "p2p_order",
  id: orderId,
  number: "ORD-000042",
  mode: "live",
  ad_id: "ad1",
  market: "NG",
  asset: "USDT",
  decimals: 6,
  currency: "NGN",
  side: null,
  status: "appealed",
  price: 165000,
  amount: "10.000000",
  fiat: 1650000,
  buyer_fee: "0.100000",
  seller_fee: "0.200000",
  received: "9.900000",
  escrow: "10.200000",
  payment_window: 15,
  pay_by: "2026-10-28T09:15:00.000Z",
  buyer: { nickname: "TraderAda" },
  seller: { nickname: "TraderBola" },
  payment_method: { kind: "bank", label: "Example Bank", currency: "NGN", hint: "•••• 1234", holder_name: "Bola Seller", details: { kind: "bank", bank_name: "Example Bank", account_number: "0123451234" } },
  payer_name: "Ada Obi",
  paid_from: { kind: "bank", label: "Ada Bank", hint: "•••• 4321", holder_name: "Ada Obi" },
  warnings: [],
  paid_at: "2026-10-28T09:05:00.000Z",
  appealed_at: "2026-10-28T10:00:00.000Z",
  appealed_by: "buyer",
  appeal_reason: "I paid but the seller has not released.",
  closed_at: null,
  cancel_reason: null,
  decision: null,
  created_at: "2026-10-28T09:00:00.000Z",
  updated_at: "2026-10-28T10:00:00.000Z",
};
const report = { object: "p2p_report", id: "r1", number: "R-000007", mode: "live", reported: "TraderZed", reason: "fake_payment", details: "Marked paid, nothing arrived.", order_id: orderId, status: "open", decided_at: null, created_at: "2026-10-27T00:00:00.000Z", reporter: "TraderAda", reporter_id: "c1", reported_id: "c2", decision_note: null };

let sent: Array<{ method: string; path: string; body: unknown }>;

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  sent = [];
  push.mockClear();
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: `${url.pathname}${url.search}`, body });
    if (url.pathname === "/v1/afrippa/admin/auth/session") return Response.json({ object: "admin_session", admin });
    if (url.pathname === "/v1/afrippa/admin/notifications/unread-count") return Response.json({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/afrippa/admin/p2p/orders") return Response.json({ object: "list", data: [order] });
    if (url.pathname === `/v1/afrippa/admin/p2p/orders/${orderId}`) return Response.json(order);
    if (url.pathname === `/v1/afrippa/admin/p2p/orders/${orderId}/messages`) return Response.json({ object: "list", open: true, data: [{ object: "p2p_order_message", id: "m1", from: "buyer", body: "Here is my receipt.", file: null, created_at: "2026-10-28T09:06:00.000Z" }] });
    if (url.pathname === `/v1/afrippa/admin/p2p/orders/${orderId}/decide`) return Response.json({ ...order, status: "released" });
    if (url.pathname === "/v1/afrippa/admin/p2p/reports") return Response.json({ object: "list", data: [report] });
    if (url.pathname === "/v1/afrippa/admin/p2p/reports/r1/decide") return Response.json({ ...report, status: "upheld" });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const slow = { timeout: 5000 };
const page = (element: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{element}</AdminGate>
    </AdminProviders>,
  );

describe("admin.afrippa.com", () => {
  test("signs in against Afrippa's own admin realm and lists the appeals, opening one", async () => {
    page(<AppealsPage />);
    // The table draws each row twice (a table, and cards on phones).
    expect((await screen.findAllByText("ORD-000042", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Appealed").length).toBeGreaterThan(0);
    expect(sent.some(call => call.path === "/v1/afrippa/admin/auth/session")).toBe(true);
    expect(sent.some(call => call.path.startsWith("/v1/admin/")), "never BitoCard's admin routes").toBe(false);
    expect(sent.find(call => call.path.startsWith("/v1/afrippa/admin/p2p/orders"))?.path).toBe("/v1/afrippa/admin/p2p/orders?mode=live&status=appealed&limit=100");
    fireEvent.click(screen.getAllByText("ORD-000042")[0]);
    expect(push).toHaveBeenCalledWith(`/orders/${orderId}`);
  });

  test("an appealed order: both sides, the seller's account, the room, and the decision with whose fault", async () => {
    page(<OrderPage />);
    expect(await screen.findByText(/I paid but the seller has not released/, {}, slow)).toBeTruthy();
    expect(screen.getByText("0123451234")).toBeTruthy();
    expect(await screen.findByText("Here is my receipt.", {}, slow)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decide the appeal" }));
    fireEvent.change(screen.getByLabelText("Whose fault"), { target: { value: "seller" } });
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "The receipt matches the account." } });
    fireEvent.click(screen.getByRole("button", { name: "Release to the buyer" }));
    await waitFor(() => expect(sent.find(call => call.path.endsWith("/decide"))?.body).toEqual({ outcome: "release", fault: "seller", note: "The receipt matches the account." }), slow);
  });

  test("reports: operations uphold or dismiss with a note", async () => {
    page(<ReportsPage />);
    expect((await screen.findAllByText("R-000007: TraderZed", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Said they paid but did not/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Uphold" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Bank statement shows nothing." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Uphold" }).at(-1)!);
    await waitFor(() => expect(sent.find(call => call.path.endsWith("/r1/decide"))?.body).toEqual({ decision: "upheld", note: "Bank statement shows nothing." }), slow);
  });
});
