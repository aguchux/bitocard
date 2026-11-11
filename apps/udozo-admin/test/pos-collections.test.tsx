import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

// admin.udozo.com > POS: Udozo collection accounts (milestone 4). An account's tills' accounts and settlements, holding
// them (finance or operations) and releasing (finance); every transfer with its fee; and the fee per market (finance).
const params: Record<string, string> = { id: "acc1" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/pos/collections",
}));

await import("@/app/api-product");
const { PosCollectionsCard, feeWords, settlementWords } = await import("@/components/pos-collections");
const { default: CollectionsPage } = await import("@/app/(console)/pos/collections/page");

const slow = { timeout: 10000 };
let roles: string[];
let held: { at: string; reason: string; by: string } | null;
let sent: Array<{ method: string; path: string; search: string; body: unknown }>;

const settlement = (over: Record<string, unknown> = {}) => ({ object: "pos_settlement", id: "ps1", number: "PS-000001", day: "2026-11-12", mode: "live", currency: "NGN", collections: 2, gross: 2_100_000, fees: 25_000, amount: 2_075_000, status: "paying", kept_reason: null, bank_account: { bank_name: "GTBank", last4: "6789" }, payout: { id: "po1", status: "processing", completed_at: null }, created_at: "2026-11-12T08:25:00.000Z", ...over });
const collection = (over: Record<string, unknown> = {}) => ({ object: "pos_collection", id: "pc1", number: "PC-000001", status: "matched", mode: "live", currency: "NGN", amount: 800_000, fee: 8_000, collected: 792_000, payer_name: "BOLA ADE", till: { id: "t1", name: "Counter 1" }, sale: { id: "s1", number: "POS-000004" }, settlement: null, note: null, decided_by: null, received_at: "2026-11-11T09:00:00.000Z", account: { id: "acc1", shop: "Ada's Gadget Hub" }, ...over });

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  sent = [];
  roles = ["finance"];
  held = null;
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const ok = (value: unknown) => Response.json(value);
    const path = url.pathname;
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ade Bello", email: "ade@udozo.com", roles }, step_up_until: new Date(Date.now() + 300_000).toISOString() });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/pos/accounts/acc1/collections")
      return ok({
        object: "pos_account_collections",
        currency: "NGN",
        collected: 792_000,
        unmatched: 1,
        held,
        accounts: [{ id: "ca1", status: "active", till: "Counter 1", bank_name: "Wema Bank", account_number: "9912345678", account_name: "Ada's Gadget Hub", attempts: 1, last_error: null, opened_at: "2026-11-10T09:00:00.000Z", closed_at: null, created_at: "2026-11-10T09:00:00.000Z" }],
        settlements: [settlement(), settlement({ id: "ps2", number: "PS-000002", status: "kept", kept_reason: "The smallest payout is NGN 15,000.00.", payout: null, bank_account: null })],
      });
    if (path === "/v1/admin/pos/accounts/acc1/settlements/hold") {
      held = { at: "2026-11-12T10:00:00.000Z", reason: (body as { reason: string }).reason, by: "Ade Bello" };
      return ok({});
    }
    if (path === "/v1/admin/pos/accounts/acc1/settlements/release") {
      held = null;
      return ok({});
    }
    if (path === "/v1/admin/pos/collections") {
      const status = url.searchParams.get("status");
      const data = [collection(), collection({ id: "pc2", number: "PC-000002", status: "unmatched", sale: null, payer_name: null })].filter(item => !status || item.status === status);
      return ok({ object: "list", total: data.length, has_more: false, totals: [{ currency: "NGN", mode: "live", amount: 1_600_000, fees: 16_000 }], data });
    }
    if (path === "/v1/admin/pos/market-settings") return ok({ object: "list", data: [{ country: "NG", name: "Nigeria", currency: "NGN", collection_fee_bps: 100, collection_fee_min: 5_000, collection_fee_cap: 50_000 }] });
    if (path === "/v1/admin/pos/market-settings/NG") return ok({ object: "list", data: [] });
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
const openDialog = () => within(document.querySelector<HTMLElement>("dialog[open]")!);
const lastSent = (suffix: string) => sent.filter(item => item.method !== "GET" && item.path.endsWith(suffix)).at(-1);

describe("POS collections in admin", () => {
  test("an account shows its tills' accounts and settlements, and finance holds then releases them", async () => {
    shown(<PosCollectionsCard account="acc1" />);
    expect(await screen.findByText(/Counter 1 · Wema Bank 9912345678/, {}, slow)).toBeTruthy();
    expect(screen.getByText(/collected, not yet settled · 1 not matched to a sale/)).toBeTruthy();
    expect(screen.getByText("On its way to their bank")).toBeTruthy();
    expect(screen.getByText("Kept in their Udozo payouts: The smallest payout is NGN 15,000.00.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hold settlements" }));
    fireEvent.change(openDialog().getByLabelText("Reason"), { target: { value: "Checking a dispute" } });
    fireEvent.click(openDialog().getByRole("button", { name: "Hold settlements" }));
    await waitFor(() => expect(lastSent("/settlements/hold")!.body).toEqual({ reason: "Checking a dispute" }));
    expect(await screen.findByText("Settlements held", {}, slow)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Release the hold" }));
    fireEvent.change(openDialog().getByLabelText("Reason"), { target: { value: "Dispute closed" } });
    fireEvent.click(openDialog().getByRole("button", { name: "Release the hold" }));
    await waitFor(() => expect(lastSent("/settlements/release")!.body).toEqual({ reason: "Dispute closed" }));
  });

  test("operations may hold but only finance releases; support only reads", async () => {
    roles = ["operations"];
    held = { at: "2026-11-12T10:00:00.000Z", reason: "Checking", by: "Ade Bello" };
    shown(<PosCollectionsCard account="acc1" />);
    await screen.findByText("Settlements held", {}, slow);
    expect(screen.queryByRole("button", { name: "Release the hold" })).toBeNull();
    cleanup();
    roles = ["support"];
    held = null;
    shown(<PosCollectionsCard account="acc1" />);
    await screen.findByText(/Wema Bank/, {}, slow);
    expect(screen.queryByRole("button", { name: "Hold settlements" })).toBeNull();
  });

  test("lists every transfer, filtered, and finance changes a market's fee", async () => {
    shown(<CollectionsPage />);
    expect(await screen.findByText("NGN 8,000.00 from BOLA ADE", {}, slow)).toBeTruthy();
    expect(screen.getAllByText("Not matched").length).toBe(2);
    expect(screen.getAllByRole("link", { name: "Ada's Gadget Hub" })[0]!.getAttribute("href")).toBe("/pos/accounts/acc1");
    fireEvent.click(screen.getByRole("button", { name: "Not matched", pressed: false }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/pos/collections" && item.search.includes("status=unmatched"))).toBe(true));

    expect(await screen.findByText("1% (at least NGN 50.00, at most NGN 500.00) on top of the gateway's fee", {}, slow)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(openDialog().getByLabelText("Margin (%)"), { target: { value: "1.5" } });
    fireEvent.change(openDialog().getByLabelText("At most (NGN)"), { target: { value: "" } });
    fireEvent.click(openDialog().getByRole("button", { name: "Save the fee" }));
    await waitFor(() => expect(lastSent("/market-settings/NG")).toBeTruthy());
    expect(lastSent("/market-settings/NG")!.body).toEqual({ collection_fee_bps: 150, collection_fee_min: 5_000, collection_fee_cap: null });
  });

  test("words settlements and fees", () => {
    expect(settlementWords({ status: "paying", kept_reason: null, payout: { id: "p", status: "paid", completed_at: null } })).toBe("Paid to their bank");
    expect(settlementWords({ status: "paying", kept_reason: null, payout: { id: "p", status: "failed", completed_at: null } })).toMatch(/Refused by the bank/);
    expect(feeWords({ country: "GH", name: "Ghana", currency: "GHS", collection_fee_bps: 0, collection_fee_min: 0, collection_fee_cap: null })).toBe("0% on top of the gateway's fee");
  });
});
