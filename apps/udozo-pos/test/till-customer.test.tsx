// @vitest-environment jsdom
// pos.udozo.com's till: choosing the sale's customer (optional; needed to sell on credit), found as the cashier types
// or added there with a name and mobile, the shop's own record with no Udozo account.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosCustomerBrief } from "@/lib/pos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ findCustomers: vi.fn(), saveCustomer: vi.fn() }));
vi.mock("@/lib/pos-actions", () => actions);

const { TillCustomer } = await import("@/components/till-customer");

const bola: PosCustomerBrief = { object: "pos_customer", id: "pc1", number: "C-000001", name: "Bola Ade", phone: "+2348031234567", email: null, udozo: false, owed: 250_000, credit_limit: null, sales_count: 3, spent: 900_000, last_sale_at: null };

const mounted: Array<() => void> = [];
function mount(props: Partial<Parameters<typeof TillCustomer>[0]> = {}) {
  const onChange = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const draw = (over: Partial<Parameters<typeof TillCustomer>[0]> = {}) => act(() => root.render(createElement(TillCustomer, { customer: null, onChange, disabled: false, currency: "NGN", ...props, ...over })));
  draw();
  mounted.push(() => act(() => root.unmount()));
  return { host, onChange, draw };
}
afterEach(() => {
  mounted.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

const button = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith(text))!;
const type = (field: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("the sale's customer", () => {
  it("finds one as the cashier types and chooses it", async () => {
    vi.useFakeTimers();
    actions.findCustomers.mockResolvedValue({ ok: true, data: [bola] });
    const { host, onChange } = mount();
    act(() => button(host, "+ Customer").click());
    type(host.querySelector("input")!, "bola");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(actions.findCustomers).toHaveBeenLastCalledWith("bola");
    expect(host.textContent).toContain("+2348031234567");
    act(() => button(host, "Bola Ade").click());
    expect(onChange).toHaveBeenCalledWith(bola);
  });

  it("adds a new one with their name and mobile, and shows Udozo's refusal in words", async () => {
    actions.findCustomers.mockResolvedValue({ ok: true, data: [] });
    actions.saveCustomer.mockResolvedValueOnce({ ok: false, message: "Another customer has this mobile number.", code: "customer_phone_taken", param: "phone" }).mockResolvedValueOnce({ ok: true, data: bola });
    const { host, onChange } = mount();
    act(() => button(host, "+ Customer").click());
    act(() => button(host, "Add a new customer").click());
    const [name, phone] = [...host.querySelectorAll("input")];
    type(name!, "Bola Ade");
    type(phone!, "08031234567");
    await act(async () => button(host, "Add and choose").click());
    expect(actions.saveCustomer).toHaveBeenLastCalledWith(null, { name: "Bola Ade", phone: "08031234567" });
    expect(host.querySelector("[role=alert]")!.textContent).toBe("Another customer has this mobile number.");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => button(host, "Add and choose").click());
    expect(onChange).toHaveBeenCalledWith(bola);
  });

  it("shows the chosen one with what they owe, removed until the sale is paid", () => {
    const { host, onChange, draw } = mount({ customer: { ...bola, udozo: true } });
    expect(host.textContent).toContain("Bola Ade· Udozo");
    expect(host.textContent).toContain("Owes ₦2,500");
    act(() => button(host, "Remove").click());
    expect(onChange).toHaveBeenCalledWith(null);
    draw({ disabled: true });
    expect(host.querySelector("button")).toBeNull();
  });
});
