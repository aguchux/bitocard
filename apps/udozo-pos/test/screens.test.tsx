// @vitest-environment jsdom
// pos.udozo.com's screens: sign-up from the shop to what is due today (blocked when the wallet is short, with Add
// funds), plan changes confirmed in words first, tills within the plan's limit, the plan cards, and app buttons that
// are never links before their store link is set.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { account, plan, plans } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ signUp: vi.fn(), changePlan: vi.fn(), updateShop: vi.fn(), addTill: vi.fn(), updateTill: vi.fn(), removeTill: vi.fn(), signOut: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/pos-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/app/billing" }));

const { SignupWizard } = await import("@/components/signup-wizard");
const { PlanChanger, changeWords } = await import("@/components/plan-changer");
const { Tills } = await import("@/components/tills");
const { PlanCards } = await import("@/components/plan-cards");
const { AppButtons } = await import("@/components/app-buttons");
const { OwnerNav } = await import("@/components/owner-nav");
const { ShopForm } = await import("@/components/shop-form");
const { PosMark, UdozoMark } = await import("@/components/site-chrome");

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

const button = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith(text));
const type = (field: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};
const fieldNamed = (host: ParentNode, text: string) => {
  const label = [...host.querySelectorAll("label")].find(item => item.textContent?.trim().startsWith(text))!;
  return host.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)!;
};
const dialogButton = (text: string) => [...document.querySelector("dialog")!.querySelectorAll("button")].find(item => item.textContent === text)!;
const submitForm = (host: ParentNode) => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

const wizard = (over: Partial<Parameters<typeof SignupWizard>[0]> = {}) =>
  mount(createElement(SignupWizard, { plans: plans(), currency: "NGN", wallet: 1_000_000, initialPlan: null, addFundsUrl: "https://udozo.test/account/wallet", name: "Ada Okafor", ...over }));

describe("sign-up", () => {
  it("asks for the shop, then the plan, then opens Free with nothing due", async () => {
    actions.signUp.mockResolvedValue({ ok: true, data: account() });
    const host = wizard();
    expect(host.textContent).toContain("Signed in as Ada Okafor");
    act(() => submitForm(host));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Give your shop's name.");
    act(() => type(fieldNamed(host, "Shop name"), "Ada's Gadget Hub"));
    act(() => type(fieldNamed(host, "VAT added"), "7.5"));
    act(() => submitForm(host));
    expect(host.textContent).toContain("Choose your plan");
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(item => item.value)).toEqual(["free", "premium", "multi_shop"]);
    act(() => button(host, "Continue")!.click());
    expect(host.textContent).toContain("Free needs no payment.");
    await act(async () => button(host, "Open my shop")!.click());
    expect(actions.signUp).toHaveBeenCalledWith("free", { name: "Ada's Gadget Hub", address: null, phone: null, tin: null, vat_bps: 750 }, 0, "month");
    expect(router.push).toHaveBeenCalledWith("/app/setup?welcome=1");
  });

  it("starts a trial with nothing taken today", async () => {
    actions.signUp.mockResolvedValue({ ok: true, data: account() });
    const host = wizard({ initialPlan: "premium" });
    act(() => type(fieldNamed(host, "Shop name"), "Ada"));
    act(() => submitForm(host));
    act(() => button(host, "Continue")!.click());
    expect(host.textContent).toContain("14 days");
    expect(host.textContent).toContain("Nothing is taken today.");
    await act(async () => button(host, "Start free trial")!.click());
    expect(actions.signUp).toHaveBeenCalledWith("premium", expect.objectContaining({ name: "Ada" }), 0, "month");
  });

  it("will not take a first month the wallet cannot cover, and links Add funds", () => {
    const host = wizard({ initialPlan: "multi_shop", wallet: 1_000_000 });
    act(() => type(fieldNamed(host, "Shop name"), "Ada"));
    act(() => submitForm(host));
    act(() => button(host, "Continue")!.click());
    expect(host.textContent).toContain("Your Udozo wallet has ₦10,000.");
    expect(host.textContent).toContain("Add ₦30,000 or more on udozo.com");
    const pay = button(host, "Pay ₦40,000 and open my shop")!;
    expect(pay.disabled).toBe(true);
    expect(host.querySelector<HTMLAnchorElement>('a[href="https://udozo.test/account/wallet"]')!.target).toBe("_blank");
  });

  it("sends the owner back to the step holding what Udozo refused", async () => {
    actions.signUp.mockResolvedValue({ ok: false, message: "Give your shop's name.", code: "parameter_missing", param: "shop.name" });
    const host = wizard();
    act(() => type(fieldNamed(host, "Shop name"), "Ada"));
    act(() => submitForm(host));
    act(() => button(host, "Continue")!.click());
    await act(async () => button(host, "Open my shop")!.click());
    expect(host.textContent).toContain("Your shop");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Give your shop's name.");
  });

  it("refuses a VAT rate that is not one", () => {
    const host = wizard();
    act(() => type(fieldNamed(host, "Shop name"), "Ada"));
    act(() => type(fieldNamed(host, "VAT added"), "75"));
    act(() => submitForm(host));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("VAT is a rate from 0% to 50%");
  });
});

describe("changing plan", () => {
  it("says what the change does before doing it, in Udozo POS's own dialog", async () => {
    actions.changePlan.mockResolvedValue({ ok: true, data: account() });
    const host = mount(createElement(PlanChanger, { account: account(), plans: plans(), addFundsUrl: "https://udozo.test/account/wallet" }));
    expect(host.textContent).toContain("Your plan");
    await act(async () => button(host, "Choose Premium")!.click());
    expect(document.querySelector("dialog")!.textContent).toContain("Premium's first month (₦15,000) is taken from your Udozo wallet now");
    await act(async () => dialogButton("Move to Premium").click());
    expect(actions.changePlan).toHaveBeenCalledWith("premium", "month");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("words every kind of change", () => {
    const premium = account({ status: "active", plan: plan("premium") });
    expect(changeWords(premium, plan("free"))).toBe("Premium runs to the end of the month you paid for, then your shop moves to Free.");
    expect(changeWords(account({ status: "active", plan: plan("multi_shop") }), plan("premium"))).toBe("Premium, paid monthly, starts when the month you paid for ends.");
    expect(changeWords(account({ status: "trial", plan: plan("premium") }), plan("multi_shop"))).toBe("Your trial carries on with Multi-shop, paid monthly once it ends.");
    expect(changeWords(account({ status: "trial", plan: plan("premium") }), plan("free"))).toMatch(/trial ends now/);
    expect(changeWords(account({ status: "past_due", plan: plan("premium") }), plan("free"))).toBe("Your shop moves to Free now.");
  });

  it("shows a change waiting for the month's end, and links Add funds when the wallet is short", async () => {
    actions.changePlan.mockResolvedValue({ ok: false, message: "Your Udozo wallet needs NGN 40000.00 for this.", code: "wallet_balance_low", param: null });
    const host = mount(createElement(PlanChanger, { account: account({ status: "active", plan: plan("premium"), next_plan: "free" }), plans: plans(), addFundsUrl: "https://udozo.test/account/wallet" }));
    expect(host.textContent).toContain("Starts when this period ends");
    await act(async () => button(host, "Choose Multi-shop")!.click());
    await act(async () => dialogButton("Move to Multi-shop").click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Add funds");
  });
});

describe("the shop's kind", () => {
  it("is chosen from Udozo's list and saved with the shop's details", async () => {
    actions.updateShop.mockResolvedValue({ ok: true, data: account() });
    const kinds = [
      { code: "general", name: "General shop", categories: [] },
      { code: "pharmacy", name: "Pharmacy or chemist", categories: ["pharmacy"] },
    ];
    const host = mount(createElement(ShopForm, { shop: account().shops[0]!, kinds }));
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map(option => option.textContent)).toEqual(["General shop", "Pharmacy or chemist"]);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "pharmacy");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => submitForm(host));
    expect(actions.updateShop).toHaveBeenCalledWith(account().shops[0]!.id, expect.objectContaining({ kind: "pharmacy" }));
  });
});

describe("tills", () => {
  it("stops adding at the plan's limit, counting every shop's tills, and keeps one till", () => {
    const tills = account().shops[0]!.tills;
    const host = mount(createElement(Tills, { shopId: "s1", tills, limit: 2, used: 2 }));
    expect(button(host, "Add till")!.disabled).toBe(true);
    expect(host.textContent).toContain("Your plan allows 2 tills. Move to a bigger plan");
    expect(button(host, "Remove till")!.disabled).toBe(true);
  });

  it("adds a till with its name", async () => {
    actions.addTill.mockResolvedValue({ ok: true, data: account() });
    const host = mount(createElement(Tills, { shopId: "s1", tills: account().shops[0]!.tills, limit: null, used: 1 }));
    act(() => type(fieldNamed(host, "New till"), "Counter 2"));
    await act(async () => submitForm(host));
    expect(actions.addTill).toHaveBeenCalledWith("s1", "Counter 2");
  });
});

describe("the public pieces", () => {
  it("prices the plans, marks Premium, and starts sign-up with the plan chosen", () => {
    const host = mount(createElement(PlanCards, { plans: plans() }));
    expect([...host.querySelectorAll("h3")].map(item => item.textContent)).toEqual(["Free", "Premium", "Multi-shop"]);
    expect(host.textContent).toContain("₦15,000 a month");
    expect(host.textContent).toContain("Most shops choose this");
    expect([...host.querySelectorAll("a")].map(item => item.getAttribute("href"))).toEqual(["/signup?plan=free", "/signup?plan=premium", "/signup?plan=multi_shop"]);
  });

  it("links an app only once its store link is set", () => {
    const host = mount(createElement(AppButtons, { apps: { object: "pos_apps", android: "https://play.google.com/store/apps/details?id=com.udozo.pos", ios: null, windows: null } }));
    const links = [...host.querySelectorAll("a")].map(item => item.getAttribute("href"));
    expect(links).toEqual(["https://play.google.com/store/apps/details?id=com.udozo.pos", "/app"]);
    expect(host.textContent!.match(/Coming soon/g)).toHaveLength(2);
  });

  it("wears udozo.com's own mark, white on the dark green and blue on light pages, never a drawn stand-in", () => {
    const dark = mount(createElement(PosMark));
    expect(dark.querySelector("img")!.getAttribute("src")).toContain("udozo-mark-light.png");
    expect(dark.textContent).toBe("Udozo POS");
    const light = mount(createElement(UdozoMark, { tone: "light" }));
    expect(light.querySelector("img")!.getAttribute("src")).toContain("udozo-mark.png");
    expect(light.querySelector("img")!.getAttribute("src")).not.toContain("light");
  });

  it("marks the owner's current place", () => {
    const host = mount(createElement(OwnerNav));
    expect(host.querySelector('[aria-current="page"]')!.textContent).toBe("Plan and billing");
  });
});
