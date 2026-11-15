// Orders > Airtime exchange: operations check sellers' transfers (Received, with the line and number to look for) and
// take buyers' purchases to send from a line that holds enough airtime.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

let tab = "sales";
let standing = { strikes: 0, strike_limit: 3, paused: false, completed_sales: 2, cleared_at: null };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams({ tab }), usePathname: () => "/orders/airtime" }));

const { default: AirtimePage } = await import("@/app/(console)/orders/airtime/page");

const slow = { timeout: 10000 };
let sent: Array<{ method: string; path: string; body: unknown }>;

const line = { object: "airtime_line", id: "l1", country: "NG", network: "mtn", number: "+2348039990001", label: "Phone A", active: true, daily_receive: 5_000_000, daily_send: 5_000_000, received_today: 200_000, sent_today: 0, balance: 400_000 };
const network = { country: "NG", network: "mtn", name: "MTN", currency: "NGN", enabled: true, sell_rate_bps: 8000, buy_rate_bps: 8800, min_amount: 10_000, max_amount: 500_000, seller_daily: 2_000_000, new_seller_daily: 500_000, established_after: 3, credit_hold_hours: 24, transfer_steps: "Dial *600*{number}*{amount}*{pin}#", pools: [{ mode: "live", available: 400_000, reserved: 100_000, cost: 320_000, bought_total: 400_000, sold_total: 0 }] };
const customer = { id: "c1", name: "Ada Obi", email: "ada@example.com" };
const sale = { object: "airtime_sale", id: "s1", number: "AS-000001", mode: "live", network: "mtn", amount: 200_000, currency: "NGN", rate_bps: 8000, payout: 160_000, from_phone: "+2348031110002", status: "sent", collector_number: line.number, transfer_steps: null, expires_at: "2026-11-15T11:00:00Z", sent_at: null, received_at: null, credit_at: null, credited_at: null, note: null, created_at: "2026-11-15T10:00:00Z", customer, seller: { strikes: 0, strike_limit: 3, paused: false, completed_sales: 2, cleared_at: null }, line: { id: "l1", number: line.number } };
const purchase = { object: "airtime_purchase", id: "p1", number: "AP-000001", mode: "live", network: "mtn", phone: "+2348051234567", amount: 100_000, currency: "NGN", rate_bps: 8800, price: 88_000, status: "paid", expires_at: "2026-11-15T11:00:00Z", delivered_at: null, refunded_at: null, note: null, created_at: "2026-11-15T10:00:00Z", cost: null, customer, line: null };

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { object: "admin", id: "a1", name: "Ngozi Eze", email: "ngozi@bitocard.com", roles: ["operations"], authenticator: true, authenticator_required: false }, step_up_until: null });
    if (url.pathname === "/v1/admin/airtime") return ok({ object: "airtime_overview", mode: "live", open: { NG: true }, networks: [network], lines: [line] });
    if (url.pathname === "/v1/admin/airtime/sales") return ok({ object: "list", data: [{ ...sale, seller: standing }] });
    if (url.pathname.endsWith("/clear")) return ok({ object: "airtime_seller_standing", customer_id: customer.id, ...standing, strikes: 0, paused: false });
    if (url.pathname === "/v1/admin/airtime/purchases") return ok({ object: "list", data: [purchase] });
    if (url.pathname.endsWith("/received")) return ok({ ...sale, status: "received" });
    if (url.pathname.endsWith("/claim")) return ok({ ...purchase, status: "delivering" });
    if (url.pathname.includes("notifications")) return ok({ object: "list", data: [], has_more: false, count: 0 });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = () =>
  render(
    <AdminProviders>
      <AdminGate>
        <AirtimePage />
      </AdminGate>
    </AdminProviders>,
  );

describe("the airtime exchange in the admin app", () => {
  test(
    "a seller's transfer is checked against the line and number, then marked received",
    slow,
    async () => {
      tab = "sales";
      page();
      const row = (await screen.findAllByText("AS-000001"))[0].closest("tr") ?? document.body;
      expect(within(row as HTMLElement).getAllByText(/\+2348031110002 → \+2348039990001/).length).toBeGreaterThan(0);
      fireEvent.click(within(row as HTMLElement).getAllByRole("button", { name: "Received" })[0]);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain("+2348039990001");
      fireEvent.click(within(dialog).getByRole("button", { name: "Mark received" }));
      await waitFor(() => expect(sent.some(call => call.method === "POST" && call.path === "/v1/admin/airtime/sales/s1/received")).toBe(true));
    },
  );

  test(
    "a purchase is taken to send from a line that holds enough",
    slow,
    async () => {
      tab = "purchases";
      page();
      const row = (await screen.findAllByText("AP-000001"))[0].closest("tr") ?? document.body;
      fireEvent.click(within(row as HTMLElement).getAllByRole("button", { name: "Send" })[0]);
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("combobox").textContent).toContain("+2348039990001");
      fireEvent.click(within(dialog).getByRole("button", { name: "Take it" }));
      await waitFor(() => expect(sent.find(call => call.path === "/v1/admin/airtime/purchases/p1/claim")?.body).toEqual({ line_id: "l1" }));
    },
  );

  test(
    "a seller paused by strikes is cleared by operations, with a reason",
    slow,
    async () => {
      tab = "sales";
      standing = { strikes: 3, strike_limit: 3, paused: true, completed_sales: 0, cleared_at: null };
      page();
      expect((await screen.findAllByText("Selling paused")).length).toBeGreaterThan(0);
      fireEvent.click(screen.getAllByRole("button", { name: "Clear strikes" })[0]);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain("3 strikes stop counting");
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "The network confirmed a delay." } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Clear strikes" }));
      await waitFor(() => expect(sent.find(call => call.path === "/v1/admin/airtime/sellers/c1/clear")?.body).toEqual({ reason: "The network confirmed a delay." }));
      standing = { strikes: 0, strike_limit: 3, paused: false, completed_sales: 2, cleared_at: null };
    },
  );
});
