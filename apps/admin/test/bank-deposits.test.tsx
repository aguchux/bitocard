// Orders > Bank deposits: finance credits what arrived (the amount the customer asked by default, changeable), or
// rejects with a reason the customer sees.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams({ status: "sent" }), usePathname: () => "/orders/bank-deposits" }));

const { default: BankDepositsPage } = await import("@/app/(console)/orders/bank-deposits/page");

const slow = { timeout: 10000 };
let sent: Array<{ method: string; path: string; body: unknown }>;
let roles = ["finance"];

const deposit = {
  object: "bank_deposit",
  id: "d1",
  number: "BD-000001",
  mode: "live",
  status: "sent",
  country: "NG",
  currency: "NGN",
  amount: 500_000,
  credited_amount: null,
  reference: "BCK7M2Q9XA",
  account: { bank_name: "Zenith Bank", account_name: "De-Golojan Technologies Ltd", account_number: "1012345678", details: null },
  method: "transfer",
  sender_name: "Ada Obi",
  note: "From GTBank",
  decision_note: null,
  external_reference: null,
  expires_at: "2026-11-18T10:00:00Z",
  sent_at: "2026-11-15T10:30:00Z",
  decided_at: null,
  created_at: "2026-11-15T10:00:00Z",
  customer: { id: "c1", name: "Ada Obi", email: "ada@example.com", store: "BitoCard" },
  decided_by: null,
};

beforeAll(() => {
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
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { object: "admin", id: "a1", name: "Ngozi Eze", email: "ngozi@bitocard.com", roles, authenticator: true, authenticator_required: false }, step_up_until: "2099-01-01T00:00:00Z" });
    if (url.pathname === "/v1/admin/bank-deposits") return ok({ object: "list", data: [deposit] });
    if (url.pathname.endsWith("/credit")) return ok({ ...deposit, status: "credited", credited_amount: (body as { amount: number }).amount });
    if (url.pathname.endsWith("/reject")) return ok({ ...deposit, status: "rejected", decision_note: (body as { reason: string }).reason });
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
        <BankDepositsPage />
      </AdminGate>
    </AdminProviders>,
  );

describe("bank deposits in the admin app", () => {
  test(
    "finance credits what arrived, which may be less than asked",
    slow,
    async () => {
      roles = ["finance"];
      page();
      const row = (await screen.findAllByText("BCK7M2Q9XA"))[0].closest("tr") ?? document.body;
      expect((row as HTMLElement).textContent).toContain("Transfer from Ada Obi");
      fireEvent.click(within(row as HTMLElement).getAllByRole("button", { name: "Credit" })[0]);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain("Zenith Bank 1012345678");
      const amount = within(dialog).getByLabelText(/Amount that arrived/);
      // A money field with the naira sign, opening at what the customer asked for.
      expect((amount as HTMLInputElement).value).toBe("5,000");
      expect(amount.parentElement?.textContent).toContain("₦");
      fireEvent.change(amount, { target: { value: "4,500" } });
      fireEvent.change(within(dialog).getByLabelText(/Bank's reference/), { target: { value: "ZEN-77812" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /^Credit .*4,500/ }));
      await waitFor(() => expect(sent.find(call => call.path === "/v1/admin/bank-deposits/d1/credit")?.body).toEqual({ amount: 450_000, external_reference: "ZEN-77812" }));
    },
  );

  test(
    "operations reject with a reason, and cannot credit",
    slow,
    async () => {
      roles = ["operations"];
      page();
      const row = (await screen.findAllByText("BCK7M2Q9XA"))[0].closest("tr") ?? document.body;
      expect(within(row as HTMLElement).queryByRole("button", { name: "Credit" })).toBeNull();
      fireEvent.click(within(row as HTMLElement).getAllByRole("button", { name: "Reject" })[0]);
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "No deposit with this reference arrived." } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
      await waitFor(() => expect(sent.find(call => call.path === "/v1/admin/bank-deposits/d1/reject")?.body).toEqual({ reason: "No deposit with this reference arrived." }));
    },
  );
});
