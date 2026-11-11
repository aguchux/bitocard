// @vitest-environment jsdom
// pos.udozo.com's Payments screens (milestone 4): a till's account (asking the banks for one, with the BVN where the
// banks need it, and the sandbox's test transfer), unmatched transfers used for their sale or kept, and the till
// waiting for a transfer with the account to give the buyer.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosCollection, PosCollectionsOverview, PosTransferRequest } from "@/lib/pos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  openCollectionAccount: vi.fn(),
  closeCollectionAccount: vi.fn(),
  simulateCollection: vi.fn(),
  attachCollection: vi.fn(),
  keepCollection: vi.fn(),
  setSettlementAccount: vi.fn(),
  transferStatus: vi.fn(),
  cancelTransfer: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/pos-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { TillAccount, UnmatchedActions, SettlementAccountForm } = await import("@/components/collection-forms");
const { TransferWait } = await import("@/components/transfer-wait");

allowDialogs();
function allowDialogs() {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

const mounted: Array<() => void> = [];
function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push(() => act(() => root.unmount()));
  return host;
}
afterEach(() => {
  mounted.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

const button = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith(text))!;
const dialogButton = (text: string) => [...document.querySelector("dialog")!.querySelectorAll("button")].find(item => item.textContent === text)!;
const type = (field: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

const tillRow = (over: Partial<PosCollectionsOverview["tills"][number]> = {}): PosCollectionsOverview["tills"][number] => ({ id: "t1", name: "Counter 1", shop: { id: "s1", name: "Ada's Gadget Hub" }, collection_account: null, ...over });
const active = { object: "pos_collection_account" as const, id: "ca1", status: "active" as const, till_id: "t1", bank_name: "Sandbox Bank", account_number: "9912345678", account_name: "Ada's Gadget Hub", currency: "NGN", opened_at: "2026-11-11T09:00:00Z", closed_at: null, created_at: "2026-11-11T09:00:00Z" };

describe("a till's account", () => {
  it("asks the banks for one with the BVN where they need it", async () => {
    actions.openCollectionAccount.mockResolvedValue({ ok: true, data: active });
    const host = mount(createElement(TillAccount, { till: tillRow(), blocked: false, bvnRequired: true, sandbox: false, currency: "NGN" }));
    expect(host.textContent).toContain("Udozo passes it on and never keeps it");
    type(host.querySelector("input")!, "22345678901");
    await act(async () => button(host, "Get an account number").click());
    expect(actions.openCollectionAccount).toHaveBeenCalledWith("t1", "22345678901");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("cannot be asked for while something blocks it, and says the bank's refusal", async () => {
    const blocked = mount(createElement(TillAccount, { till: tillRow(), blocked: true, bvnRequired: false, sandbox: false, currency: "NGN" }));
    expect(button(blocked, "Get an account number").disabled).toBe(true);
    actions.openCollectionAccount.mockResolvedValue({ ok: false, message: "The bank has not answered yet. Try again in a minute.", code: "collection_account_pending", param: null });
    const host = mount(createElement(TillAccount, { till: tillRow({ id: "t2" }), blocked: false, bvnRequired: false, sandbox: false, currency: "NGN" }));
    await act(async () => button(host, "Get an account number").click());
    expect(host.querySelector("[role=alert]")!.textContent).toBe("The bank has not answered yet. Try again in a minute.");
  });

  it("shows the number to give buyers, sends a sandbox test transfer, and closes after asking", async () => {
    actions.simulateCollection.mockResolvedValue({ ok: true, data: { status: "matched", sale: { id: "x", number: "POS-000009" } } });
    actions.closeCollectionAccount.mockResolvedValue({ ok: true, data: { ...active, status: "closed" } });
    const host = mount(createElement(TillAccount, { till: tillRow({ collection_account: active }), blocked: false, bvnRequired: false, sandbox: true, currency: "NGN" }));
    expect(host.textContent).toContain("9912345678");
    type(host.querySelector("input")!, "8000");
    await act(async () => button(host, "Send").click());
    expect(actions.simulateCollection).toHaveBeenCalledWith("ca1", 800_000, "TEST PAYER");
    expect(host.textContent).toContain("It paid POS-000009 at the till.");
    await act(async () => button(host, "Close account").click());
    expect(document.querySelector("dialog")!.textContent).toContain("credited and paid to you all the same");
    await act(async () => dialogButton("Close the account").click());
    expect(actions.closeCollectionAccount).toHaveBeenCalledWith("ca1");
  });
});

describe("unmatched transfers", () => {
  const collection: PosCollection = { object: "pos_collection", id: "pc1", number: "PC-000001", status: "unmatched", mode: "live", currency: "NGN", amount: 800_000, fee: 8_000, collected: 792_000, payer_name: "BOLA ADE", till: { id: "t1", name: "Counter 1" }, sale: null, settlement: null, note: null, decided_by: null, received_at: "2026-11-11T09:00:00Z", attachable: [{ id: "pt1", number: "PT-000004", till: "Counter 1", status: "expired", created_at: "2026-11-11T08:55:00Z" }] };

  it("are used for the sale they were for after asking, or kept with what they were for", async () => {
    actions.attachCollection.mockResolvedValue({ ok: true, data: { ...collection, status: "matched" } });
    actions.keepCollection.mockResolvedValue({ ok: true, data: { ...collection, status: "kept" } });
    const host = mount(createElement(UnmatchedActions, { collection }));
    await act(async () => button(host, "Use for PT-000004").click());
    expect(document.querySelector("dialog")!.textContent).toContain("₦8,000 pays the sale asked at Counter 1");
    await act(async () => dialogButton("Make the sale").click());
    expect(actions.attachCollection).toHaveBeenCalledWith("pc1", "pt1");

    await act(async () => button(host, "Keep it").click());
    const note = document.querySelector("dialog textarea, dialog input") as HTMLInputElement;
    if (note.tagName === "TEXTAREA") {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "A deposit");
        note.dispatchEvent(new Event("input", { bubbles: true }));
      });
    } else type(note, "A deposit");
    await act(async () => dialogButton("Keep it").click());
    expect(actions.keepCollection).toHaveBeenCalledWith("pc1", "A deposit");
  });
});

describe("where collections are paid", () => {
  it("sends the owner to udozo.com to add a bank account when they have none, else saves the choice", async () => {
    const none = mount(createElement(SettlementAccountForm, { accounts: [], current: null, addUrl: "https://udozo.test/account/payouts" }));
    expect(none.querySelector("a")!.getAttribute("href")).toBe("https://udozo.test/account/payouts");
    actions.setSettlementAccount.mockResolvedValue({ ok: true, data: {} });
    const host = mount(createElement(SettlementAccountForm, { accounts: [{ id: "b1", bank_name: "Sandbox Bank", last4: "6789", account_name: "ADA OKAFOR", usable_from: "2026-11-11T09:00:00Z" }], current: null, addUrl: "https://udozo.test/account/payouts" }));
    const select = host.querySelector("select")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "b1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(actions.setSettlementAccount).toHaveBeenCalledWith("b1");
  });
});

describe("the till waiting for a transfer", () => {
  const request: PosTransferRequest = { object: "pos_transfer_request", id: "pt1", number: "PT-000004", status: "waiting", currency: "NGN", amount: 800_000, total: 1_000_000, client_sale_id: "c", pay_to: { bank_name: "Sandbox Bank", account_number: "9912345678", account_name: "Ada's Gadget Hub" }, failure: null, expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), paid_at: null, sale_id: null };

  it("shows the account and the exact amount, then hands back the sale once paid", async () => {
    vi.useFakeTimers();
    const onPaid = vi.fn();
    actions.transferStatus.mockResolvedValueOnce({ ok: true, data: { ...request, sale: null } }).mockResolvedValueOnce({ ok: true, data: { ...request, status: "paid", sale: { number: "POS-000004" } } });
    const host = mount(createElement(TransferWait, { request, onPaid, onClosed: vi.fn() }));
    expect(host.textContent).toContain("9912345678");
    expect(host.textContent).toContain("₦8,000");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(onPaid).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(onPaid).toHaveBeenCalledWith({ number: "POS-000004" });
  });

  it("says why it stopped waiting", async () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    actions.transferStatus.mockResolvedValue({ ok: true, data: { ...request, status: "expired", sale: null } });
    mount(createElement(TransferWait, { request, onPaid: vi.fn(), onClosed }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(onClosed.mock.calls[0]![0]).toMatch(/30 minutes passed/);
  });
});
