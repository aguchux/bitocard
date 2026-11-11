// @vitest-environment jsdom
// pos.udozo.com with several shops and yearly billing (milestone 8): the shops panel (opening a second shop asks first,
// main and online choices), moving stock between shops and online, monthly or yearly on Billing, and the words for
// where stock is and what a year saves.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosAccount, PosPlan, PosProduct, PosShop } from "@/lib/pos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ addShop: vi.fn(), chooseShop: vi.fn(), moveStock: vi.fn(), changePlan: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/pos-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ShopsPanel } = await import("@/components/shops-panel");
const { MoveStock, heldAt } = await import("@/components/move-stock");
const { PlanChanger } = await import("@/components/plan-changer");
const { dueToday, levelsText, priceText, yearlySaving } = await import("@/lib/pos");

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
const choose = (field: HTMLSelectElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
const submit = (form: HTMLFormElement) => act(async () => void form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const button = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith(text))!;
const confirmDialog = (text: string) => act(async () => [...[...document.querySelectorAll("dialog")].find(item => item.open)!.querySelectorAll("button")].find(item => item.textContent === text)!.click());

const ikeja = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const lekki = "2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const tv = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const shop = (id: string, name: string, extra: Partial<PosShop> = {}): PosShop => ({ object: "pos_shop", id, name, address: null, phone: null, tin: null, shop_code: "ADA-4821", vat_bps: 0, receipt_footer: null, kind: { code: "general", name: "General", categories: [] }, tills: [], ...extra });

describe("the shops panel", () => {
  it("opens a second shop after saying the stock splits, and lets the owner choose main and online", async () => {
    actions.addShop.mockResolvedValue({ ok: true, data: {} });
    const host = mount(createElement(ShopsPanel, { shops: [shop(ikeja, "Ikeja shop", { main: true, fulfils_online: true })], limit: 10, planName: "Multi-shop" }));
    expect(host.textContent).toContain("Main shop");
    expect(host.textContent).not.toContain("Fulfils online orders");
    type(host.querySelector("input") as HTMLInputElement, "Lekki shop");
    await submit(host.querySelector("form")!);
    expect(document.querySelector("dialog")!.textContent).toContain("Everything you have now stays in Ikeja shop");
    await confirmDialog("Open the shop");
    expect(actions.addShop).toHaveBeenCalledWith("Lekki shop");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("with two shops: badges, Make main and Fulfil online orders; past the plan's limit, paused and no new shop", async () => {
    actions.chooseShop.mockResolvedValue({ ok: true, data: {} });
    const host = mount(createElement(ShopsPanel, { shops: [shop(ikeja, "Ikeja shop", { main: true, fulfils_online: true }), shop(lekki, "Lekki shop", { paused: true })], limit: 1, planName: "Premium" }));
    expect(host.textContent).toContain("Fulfils online orders");
    expect(host.textContent).toContain("Paused on Premium");
    // No form to open another shop (each shop's Close shop dialog has its own).
    expect([...host.querySelectorAll("form")].filter(form => !form.closest("dialog"))).toEqual([]);
    expect(host.textContent).toContain("Premium has one shop.");
    await act(async () => button(host, "Make main").click());
    await confirmDialog("Make it main");
    expect(actions.chooseShop).toHaveBeenCalledWith(lekki, "main");
    await act(async () => button(host, "Fulfil online orders").click());
    await confirmDialog("Fulfil from here");
    expect(actions.chooseShop).toHaveBeenCalledWith(lekki, "fulfils_online");
  });
});

describe("moving stock", () => {
  const product = { id: tv, title: "Hisense 32 inch TV", levels: { online: 2, shops: [{ shop_id: ikeja, quantity: 5 }, { shop_id: lekki, quantity: 1 }] } } as unknown as PosProduct;

  it("moves from one shop to another, never more than the place holds", async () => {
    actions.moveStock.mockResolvedValue({ ok: true, data: { number: "ST-000001", units: 3, from: { name: "Ikeja shop" }, to: { name: "Lekki shop" } } });
    const host = mount(createElement(MoveStock, { shops: [{ id: ikeja, name: "Ikeja shop" }, { id: lekki, name: "Lekki shop" }], products: [product] }));
    const [, , product1] = [...host.querySelectorAll("select")] as HTMLSelectElement[];
    choose(product1!, tv);
    expect(host.textContent).toContain("Ikeja shop has 5; Lekki shop has 1.");
    type(host.querySelector('input[inputmode="numeric"]') as HTMLInputElement, "6");
    await submit(host.querySelector("form")!);
    expect(actions.moveStock).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Ikeja shop has only 5 of “Hisense 32 inch TV”.");
    type(host.querySelector('input[inputmode="numeric"]') as HTMLInputElement, "3");
    await submit(host.querySelector("form")!);
    expect(actions.moveStock).toHaveBeenCalledWith({ from: ikeja, to: lekki, lines: [{ listing_id: tv, quantity: 3 }], note: "" });
    expect(host.querySelector('[role="status"]')!.textContent).toBe("ST-000001: 3 moved from Ikeja shop to Lekki shop.");
  });

  it("to online means no shop (null); the same place twice is refused", async () => {
    actions.moveStock.mockResolvedValue({ ok: true, data: { number: "ST-000002", units: 1, from: { name: "Lekki shop" }, to: { name: "Online" } } });
    const host = mount(createElement(MoveStock, { shops: [{ id: ikeja, name: "Ikeja shop" }, { id: lekki, name: "Lekki shop" }], products: [product] }));
    const [from, to] = [...host.querySelectorAll("select")] as HTMLSelectElement[];
    choose(from!, lekki);
    choose(to!, lekki);
    await submit(host.querySelector("form")!);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Choose two different places.");
    choose(to!, "online");
    choose([...host.querySelectorAll("select")][2] as HTMLSelectElement, tv);
    await submit(host.querySelector("form")!);
    expect(actions.moveStock).toHaveBeenCalledWith({ from: lekki, to: null, lines: [{ listing_id: tv, quantity: 1 }], note: "" });
    expect(heldAt(product, "online")).toBe(2);
  });
});

describe("monthly or yearly", () => {
  const premium: PosPlan = { object: "pos_plan", code: "premium", name: "Premium", description: null, price: { amount: 1_500_000, currency: "NGN" }, yearly_price: { amount: 15_000_000, currency: "NGN" }, available: true, paid: true, limits: { products: null, shops: 1, tills: null, staff: null }, trial_days: 0 };
  const multi: PosPlan = { ...premium, code: "multi_shop", name: "Multi-shop", price: { amount: 3_000_000, currency: "NGN" }, yearly_price: null };
  const free: PosPlan = { ...premium, code: "free", name: "Free", price: null, yearly_price: null, paid: false };
  const account = { object: "pos_account", id: "a", country: "NG", currency: "NGN", mode: "live", status: "active", plan: premium, next_plan: null, billing_interval: "month", next_interval: null, trial_ends_at: null, period_start: null, period_end: "2026-12-11T00:00:00Z", past_due_since: null, drops_to_free_at: null, lapsed_plan: null } as unknown as PosAccount;

  it("Billing: yearly shows each plan's year price and saving, Monthly only where none, and chooses with the interval", async () => {
    actions.changePlan.mockResolvedValue({ ok: true, data: account });
    const host = mount(createElement(PlanChanger, { account, plans: [free, premium, multi], addFundsUrl: "https://udozo.test/account/wallet" }));
    act(() => ([...host.querySelectorAll('[role="radio"]')].find(item => item.textContent === "Yearly") as HTMLButtonElement).click());
    expect(host.textContent).toContain("₦150,000 a year");
    expect(host.textContent).toContain("Save 17% on twelve months");
    expect(host.textContent).toContain("Monthly only");
    await act(async () => button(host, "Choose Premium").click());
    expect(document.querySelector("dialog")!.textContent).toContain("first year (₦150,000)");
    await confirmDialog("Move to Premium");
    expect(actions.changePlan).toHaveBeenCalledWith("premium", "year");
  });

  it("the words", () => {
    expect([priceText(premium, "year"), priceText(multi, "year"), priceText(free, "year")]).toEqual(["₦150,000 a year", "Monthly only", "Free"]);
    expect([yearlySaving(premium), yearlySaving(multi)]).toEqual([17, null]);
    expect([dueToday(premium, "year"), dueToday(premium), dueToday({ ...premium, trial_days: 14 }, "year")]).toEqual([15_000_000, 1_500_000, 0]);
    const product = { levels: { online: 2, shops: [{ shop_id: ikeja, quantity: 5 }] } } as unknown as PosProduct;
    expect(levelsText(product, [{ id: ikeja, name: "Ikeja shop" }, { id: lekki, name: "Lekki shop" }])).toBe("Ikeja shop 5 · Lekki shop 0 · Online 2");
    expect(levelsText({ levels: null } as unknown as PosProduct, [])).toBeNull();
  });
});
