// @vitest-environment jsdom
// pos.udozo.com's shifts (milestone 7, S8) and the overview's chart: opening a shift with the cash in the drawer,
// recording cash paid out, counting and closing (blind for staff without cash-up), and the chart's figures in a table.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosOverview, PosShift } from "@/lib/pos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ openShift: vi.fn(), shiftCash: vi.fn(), closeShift: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/shift-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ShiftPanel } = await import("@/components/shift-panel");
const { SalesChart } = await import("@/components/sales-chart");

HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
};

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
});

const type = (field: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = (form: HTMLFormElement) => act(async () => void form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const field = (host: ParentNode, label: string) => {
  const found = [...host.querySelectorAll("label")].find(item => item.textContent?.startsWith(label))!;
  return host.querySelector(`#${CSS.escape(found.htmlFor)}`) as HTMLInputElement;
};

const tillId = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const open = (extra: Partial<PosShift> = {}): PosShift => ({
  object: "pos_shift",
  id: "s1",
  status: "open",
  shop_id: "shop",
  till: { id: tillId, name: "Till 1" },
  currency: "NGN",
  opened_at: "2026-11-11T07:02:00Z",
  opened_by: "Blessing Musa",
  opening_float: 2_000_000,
  closed_at: null,
  closed_by: null,
  counted_cash: null,
  expected_cash: 2_500_000,
  difference: null,
  blind: false,
  totals: { sales: 3, sales_total: 1_500_000, refunds: 0, refunds_total: 0, items: 3, by_method: { cash: 500_000, card: 1_000_000 }, cash_sales: 500_000, cash_refunds: 0, paid_in: 0, paid_out: 0 },
  cash: [],
  note: null,
  ...extra,
});

describe("a till's shift", () => {
  it("opens with the cash in the drawer, typed as people write it", async () => {
    actions.openShift.mockResolvedValue({ ok: true, data: open() });
    const host = mount(createElement(ShiftPanel, { tillId, tillName: "Till 1", currency: "NGN", shift: null, canOpen: true }));
    expect(host.textContent).toContain("No shift is open at Till 1");
    type(field(host, "Cash in the drawer"), "20,000");
    await submit(host.querySelector("form")!);
    expect(actions.openShift).toHaveBeenCalledWith(tillId, 2_000_000);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("someone who may not open tills only reads that none is open", () => {
    const host = mount(createElement(ShiftPanel, { tillId, tillName: "Till 1", currency: "NGN", shift: null, canOpen: false }));
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toBe("No shift is open at Till 1.");
  });

  it("shows what it took and the cash expected; records cash paid out with why", async () => {
    actions.shiftCash.mockResolvedValue({ ok: true, data: open() });
    const host = mount(createElement(ShiftPanel, { tillId, tillName: "Till 1", currency: "NGN", shift: open(), canOpen: true }));
    expect(host.textContent).toContain("Cash expected in the drawer");
    expect(host.textContent).toContain("₦25,000");
    expect(host.textContent).toContain("Card");
    const [cashForm] = [...host.querySelectorAll("form")];
    type(field(host, "Amount"), "1,500");
    await submit(cashForm!);
    expect(actions.shiftCash).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Say why the cash went in or out.");
    type(field(host, "Why"), "Paid the cleaner");
    await submit(cashForm!);
    expect(actions.shiftCash).toHaveBeenCalledWith("s1", "out", 150_000, "Paid the cleaner");
  });

  it("closes with the count after asking; a blind count never shows what was expected", async () => {
    actions.closeShift.mockResolvedValue({ ok: true, data: open({ status: "closed", counted_cash: 2_490_000, expected_cash: null, difference: null, blind: true }) });
    const blind = open({ expected_cash: null, blind: true, totals: { ...open().totals, by_method: { card: 1_000_000 }, cash_sales: null, cash_refunds: null } });
    const host = mount(createElement(ShiftPanel, { tillId, tillName: "Till 1", currency: "NGN", shift: blind, canOpen: true }));
    expect(host.textContent).not.toContain("Cash expected");
    expect(host.textContent).not.toContain("₦5,000");
    type(field(host, "Cash counted"), "24900");
    const closeForm = [...host.querySelectorAll("form")].at(-1)!;
    await submit(closeForm);
    const dialog = document.querySelector("dialog")!;
    expect(dialog.textContent).toContain("₦24,900");
    await act(async () => [...dialog.querySelectorAll("button")].find(button => button.textContent === "Close shift")!.click());
    expect(actions.closeShift).toHaveBeenCalledWith("s1", 2_490_000, "");
    expect(host.querySelector('[role="status"]')!.textContent).toContain("The owner or a manager sees whether it balanced.");
  });

  it("the owner sees whether the count balanced", async () => {
    actions.closeShift.mockResolvedValue({ ok: true, data: open({ status: "closed", counted_cash: 2_490_000, difference: -10_000 }) });
    const host = mount(createElement(ShiftPanel, { tillId, tillName: "Till 1", currency: "NGN", shift: open(), canOpen: true }));
    type(field(host, "Cash counted"), "24900");
    await submit([...host.querySelectorAll("form")].at(-1)!);
    await act(async () => [...document.querySelector("dialog")!.querySelectorAll("button")].find(button => button.textContent === "Close shift")!.click());
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Short by ₦100");
  });
});

describe("the overview's chart", () => {
  it("draws the shop and online side by side, every figure also in a table", () => {
    const overview = {
      currency: "NGN",
      by: "hour",
      series: Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${String(hour).padStart(2, "0")}:00`, pos: hour === 13 ? 6_100_000 : 0, online: hour === 13 ? 1_000_000 : 0 })),
    } as unknown as PosOverview;
    const host = mount(createElement(SalesChart, { overview }));
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(24);
    expect(rows[13]!.textContent).toBe("13:00₦61,000₦10,000");
    expect(host.querySelector("caption")!.textContent).toBe("Sales by the hour");
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
