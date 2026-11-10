// @vitest-environment jsdom
// A centre's screens on connect.udozo.com: staff read but change nothing, the owner adds and removes people (confirmed
// in Udozo Connect's own dialog, never the browser's), storage places are added and switched off, and a holiday pause.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  updateCentre: vi.fn(),
  pauseCentre: vi.fn(),
  resumeCentre: vi.fn(),
  addMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  addShelf: vi.fn(),
  updateShelf: vi.fn(),
  findOrder: vi.fn(),
  receiveOrder: vi.fn(),
  refuseOrder: vi.fn(),
  shelveOrder: vi.fn(),
  releaseOrder: vi.fn(),
  refuseCollection: vi.fn(),
  postUpdate: vi.fn(),
  askReturn: vi.fn(),
  handBack: vi.fn(),
  recordStockCheck: vi.fn(),
  handOverPickup: vi.fn(),
  moveEarnings: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/centre-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/centre/c1/staff" }));

const { CentreStaff } = await import("@/components/centre-staff");
const { CentreShelves } = await import("@/components/centre-shelves");
const { CentreSettings } = await import("@/components/centre-settings");
const { CentreNav } = await import("@/components/centre-nav");
const { CounterOrderView, FindOrder } = await import("@/components/counter-order");
const { ReturnsList } = await import("@/components/centre-returns");
const { StockShelf } = await import("@/components/centre-stock");
const { PickupCard, FraPanel } = await import("@/components/centre-pickups");
const { EarningsCard, EarningsLines } = await import("@/components/centre-earnings");

type Centre = import("@/lib/centres").Centre;
type Member = import("@/lib/centres").Member;
type Shelf = import("@/lib/centres").Shelf;

const centre = (over: Partial<Centre> = {}): Centre => ({
  object: "connect_centre",
  id: "c1",
  number: "CC-000003",
  name: "Mama Ngozi Phones",
  status: "active",
  paused: null,
  closed: null,
  country: "NG",
  state: { id: "s1", name: "Lagos" },
  area: { id: "a1", name: "Ikeja" },
  address: "12 Allen Avenue",
  landmark: null,
  latitude: null,
  longitude: null,
  hours: "Mon to Sat, 8am to 6pm",
  phone: "08031234567",
  capacity: 40,
  photos: [],
  deposit: { amount: 5_000_000, currency: "NGN" },
  people: 2,
  shelves: 0,
  created_at: "2026-11-09T00:00:00.000Z",
  role: "owner",
  ...over,
});
const member = (over: Partial<Member>): Member => ({ object: "connect_centre_member", id: "m1", role: "owner", name: "Ngozi Eze", email: "ngozi@example.com", phone: null, since: "2026-11-09T00:00:00.000Z", ...over });
const people = [member({}), member({ id: "m2", role: "staff", name: "Bola Ade", email: "bola@example.com" })];
const shelf = (over: Partial<Shelf>): Shelf => ({ object: "connect_shelf", id: "sh1", code: "A-01", label: "Front shelf", capacity: 20, active: true, position: 0, ...over });

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
const type = (field: HTMLInputElement | HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const dialogButton = (text: string) => [...document.querySelector("dialog")!.querySelectorAll("button")].find(item => item.textContent === text)!;

describe("the centre's menu", () => {
  it("marks the page it is on", () => {
    const host = mount(createElement(CentreNav, { id: "c1" }));
    expect(host.querySelector('[aria-current="page"]')!.textContent).toBe("Staff");
    expect([...host.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(["/centre/c1", "/centre/c1/orders", "/centre/c1/returns", "/centre/c1/stock", "/centre/c1/pickups", "/centre/c1/settings", "/centre/c1/staff", "/centre/c1/shelves"]);
    const owner = mount(createElement(CentreNav, { id: "c1", role: "owner" }));
    expect([...owner.querySelectorAll("a")].map(link => link.textContent)).toContain("Earnings");
  });
});

describe("staff", () => {
  it("staff see who works there and can only leave", () => {
    const host = mount(createElement(CentreStaff, { centre: centre({ role: "staff" }), members: people, me: "BOLA@example.com" }));
    expect(host.textContent).toContain("Bola Ade (you)");
    expect(host.textContent).not.toContain("Add someone");
    expect(host.querySelector("select")).toBeNull();
    expect([...host.querySelectorAll("button")].map(item => item.textContent)).toEqual(["Leave"]);
  });

  it("the owner adds someone by their Udozo account's email and sees why a refusal happened", async () => {
    actions.addMember.mockResolvedValueOnce({ ok: false, message: "They must confirm their mobile number on their Udozo account first.", code: "mobile_not_confirmed", param: "email" });
    actions.addMember.mockResolvedValueOnce({ ok: true, data: { object: "list", data: [...people, member({ id: "m3", role: "manager", name: "Tunde Ola", email: "tunde@example.com" })] } });
    const host = mount(createElement(CentreStaff, { centre: centre(), members: people, me: "ngozi@example.com" }));
    const email = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    act(() => type(email, "tunde@example.com"));
    const role = [...host.querySelectorAll("select")].at(-1)!;
    act(() => type(role, "manager"));
    await act(async () => button(host, "Add")!.click());
    expect(actions.addMember).toHaveBeenCalledWith("c1", "tunde@example.com", "manager");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("confirm their mobile");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    await act(async () => button(host, "Add")!.click());
    expect(host.textContent).toContain("Tunde Ola");
    expect(host.querySelector('[role="status"]')!.textContent).toContain("can now sign in");
  });

  it("the owner removes someone after confirming, in the centre's own dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    actions.removeMember.mockResolvedValue({ ok: true, data: { object: "list", data: [people[0]] } });
    const host = mount(createElement(CentreStaff, { centre: centre(), members: people, me: "ngozi@example.com" }));
    expect(button(host, "Remove")).toBeTruthy();
    await act(async () => button(host, "Remove")!.click());
    expect(document.querySelector("dialog")!.textContent).toContain("Remove Bola Ade?");
    await act(async () => dialogButton("Remove").click());
    expect(actions.removeMember).toHaveBeenCalledWith("c1", "m2");
    expect(host.textContent).not.toContain("Bola Ade");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("leaving goes back to the person's centres", async () => {
    actions.removeMember.mockResolvedValue({ ok: true, data: { object: "list", data: [] } });
    const host = mount(createElement(CentreStaff, { centre: centre({ role: "manager" }), members: [people[0]!, member({ id: "m2", role: "manager", name: "Bola Ade", email: "bola@example.com" })], me: "bola@example.com" }));
    await act(async () => button(host, "Leave")!.click());
    await act(async () => dialogButton("Leave centre").click());
    expect(router.push).toHaveBeenCalledWith("/centre");
  });
});

describe("storage places", () => {
  it("managers add one and switch one off", async () => {
    actions.addShelf.mockResolvedValue({ ok: true, data: { object: "list", data: [shelf({})] } });
    actions.updateShelf.mockResolvedValue({ ok: true, data: { object: "list", data: [shelf({ active: false })] } });
    const host = mount(createElement(CentreShelves, { centre: centre({ role: "manager" }), shelves: [] }));
    expect(host.textContent).toContain("No storage places yet.");
    const code = host.querySelector<HTMLInputElement>('input[placeholder="A-01"]')!;
    act(() => type(code, "a-01"));
    await act(async () => button(host, "Add storage place")!.click());
    expect(actions.addShelf).toHaveBeenCalledWith("c1", { code: "a-01", label: null, capacity: null });
    expect(host.textContent).toContain("Front shelf");
    await act(async () => button(host, "Stop using")!.click());
    expect(actions.updateShelf).toHaveBeenCalledWith("c1", "sh1", { active: false });
    expect(host.textContent).toContain("A-01 (not in use)");
  });

  it("staff see them without changing them", () => {
    const host = mount(createElement(CentreShelves, { centre: centre({ role: "staff" }), shelves: [shelf({})] }));
    expect(host.textContent).toContain("A-01");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("the centre's details and its holiday pause", () => {
  it("staff read the details but cannot change or pause", () => {
    const host = mount(createElement(CentreSettings, { centre: centre({ role: "staff" }) }));
    expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(host.textContent).toContain("Only the centre's owner and managers can change these.");
    expect(button(host, "Pause centre")).toBeUndefined();
  });

  it("a manager saves the hours, then pauses after confirming", async () => {
    actions.updateCentre.mockResolvedValue({ ok: true, data: centre({ hours: "Every day" }) });
    actions.pauseCentre.mockResolvedValue({ ok: true, data: centre({ status: "paused" }) });
    const host = mount(createElement(CentreSettings, { centre: centre({ role: "manager" }) }));
    act(() => type(host.querySelector<HTMLInputElement>("input")!, "Every day"));
    await act(async () => button(host, "Save")!.click());
    expect(actions.updateCentre).toHaveBeenCalledWith("c1", { hours: "Every day", phone: "08031234567", capacity: "40", landmark: "" });
    expect(host.querySelector('[role="status"]')!.textContent).toBe("Saved");
    await act(async () => button(host, "Pause centre")!.click());
    expect(document.querySelector("dialog")!.textContent).toContain("stays paused until you open it again");
    await act(async () => dialogButton("Pause centre").click());
    expect(actions.pauseCentre).toHaveBeenCalledWith("c1", null, null);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("a partner's own pause can be lifted; Udozo's cannot", async () => {
    actions.resumeCentre.mockResolvedValue({ ok: true, data: centre() });
    const mine = mount(createElement(CentreSettings, { centre: centre({ status: "paused", paused: { by: "partner", reason: "Closed for Christmas", until: null } }) }));
    await act(async () => button(mine, "Open again")!.click());
    expect(actions.resumeCentre).toHaveBeenCalledWith("c1");
    const udozo = mount(createElement(CentreSettings, { centre: centre({ status: "paused", paused: { by: "udozo", reason: "Checks.", until: null } }) }));
    expect(udozo.textContent).toContain("Our team will reopen it.");
    expect(button(udozo, "Open again")).toBeUndefined();
  });
});

const counterOrder = (over: Partial<import("@/lib/centres").CounterOrder> = {}): import("@/lib/centres").CounterOrder => ({
  object: "connect_order",
  id: "o1",
  number: "SP-000042",
  status: "sent",
  listing: { id: "l1", ref: 100001, title: "Samsung 43 inch TV", cover_url: null },
  quantity: 1,
  seller: { name: "Chinedu Okafor" },
  buyer: { name: "Kemi Adeyemi" },
  courier: null,
  tracking_number: null,
  tracking_url: null,
  shelf: null,
  centre_earns: 14000,
  currency: "NGN",
  dispatch_photos: [{ id: "p1", content_type: "image/jpeg", width: 100, height: 100 }],
  events: [{ status: "shipped", note: "Dropping it off", reported_by: "seller", at: "2026-11-10T09:00:00.000Z" }],
  release_tries_left: null,
  paid_at: "2026-11-10T08:00:00.000Z",
  sent_at: "2026-11-10T09:00:00.000Z",
  handover_by: null,
  received_at: null,
  ready_at: null,
  collect_by: null,
  released_at: null,
  return: null,
  held_for_seller: false,
  buyer_owed: 0,
  seller_owed: 0,
  loss_of_care_at: null,
  ...over,
});
const shelves = [shelf({}), shelf({ id: "sh2", code: "B-02", label: null })];

describe("the counter", () => {
  it("finds an item by the number on its label", async () => {
    actions.findOrder.mockResolvedValue({ ok: true, data: { id: "o1" } });
    const host = mount(createElement(FindOrder, { centre: "c1" }));
    act(() => type(host.querySelector<HTMLInputElement>("input")!, "sp-000042"));
    await act(async () => button(host, "Find")!.click());
    expect(actions.findOrder).toHaveBeenCalledWith("c1", "sp-000042");
    expect(router.push).toHaveBeenCalledWith("/centre/c1/orders/o1");
  });

  it("checks an item in against the seller's photos, or refuses it with a reason after confirming", async () => {
    actions.receiveOrder.mockResolvedValue({ ok: true, data: counterOrder({ status: "at_centre", received_at: "2026-11-10T10:00:00.000Z" }) });
    actions.refuseOrder.mockResolvedValue({ ok: true, data: counterOrder({ status: "disputed" }) });
    const host = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder(), shelves }));
    expect(host.querySelector("img[alt='Seller’s photo 1'], img[alt^='Seller']")!.getAttribute("src")).toBe("/api/centres/c1/orders/o1/photos/p1");
    expect(host.textContent).toContain("The seller is dropping it off.");
    await act(async () => button(host, "Refuse")!.click());
    act(() => type(host.querySelector<HTMLSelectElement>("select")!, "damaged"));
    await act(async () => button(host, "Refuse item")!.click());
    await act(async () => dialogButton("Refuse item").click());
    expect(actions.refuseOrder).toHaveBeenCalledWith("c1", "o1", "damaged", "");

    const other = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder(), shelves }));
    act(() => type(other.querySelector<HTMLInputElement>("input")!, "Box in good shape"));
    await act(async () => button(other, "Received")!.click());
    expect(actions.receiveOrder).toHaveBeenCalledWith("c1", "o1", "Box in good shape");
    expect(other.textContent).toContain("Shelve it");
  });

  it("shelves it, then hands it over only after the buyer accepts it, with their code", async () => {
    actions.shelveOrder.mockResolvedValue({ ok: true, data: counterOrder({ status: "at_centre", ready_at: "2026-11-10T10:00:00.000Z", collect_by: "2026-11-13T10:00:00.000Z", shelf: { id: "sh2", code: "B-02", label: null }, release_tries_left: 5 }) });
    actions.releaseOrder.mockResolvedValue({ ok: true, data: counterOrder({ status: "released", released_at: "2026-11-11T10:00:00.000Z" }) });
    const host = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder({ status: "at_centre", received_at: "2026-11-10T10:00:00.000Z" }), shelves }));
    act(() => type(host.querySelector<HTMLSelectElement>("select")!, "sh2"));
    await act(async () => button(host, "Shelve")!.click());
    expect(actions.shelveOrder).toHaveBeenCalledWith("c1", "o1", "sh2");
    expect(host.textContent).toContain("Give the item to the buyer to inspect");
    expect(host.querySelector("input[autocomplete='one-time-code']")).toBeNull();
    await act(async () => button(host, "They accept it")!.click());
    act(() => type(host.querySelector<HTMLInputElement>("input[autocomplete='one-time-code']")!, "123456"));
    await act(async () => button(host, "Hand it over")!.click());
    expect(actions.releaseOrder).toHaveBeenCalledWith("c1", "o1", "123456");
    expect(host.textContent).toContain("Your centre earned ₦140");
  });

  it("records a buyer's refusal at the counter, after confirming", async () => {
    actions.refuseCollection.mockResolvedValue({ ok: true, data: counterOrder({ status: "disputed" }) });
    const confirmSpy = vi.spyOn(window, "confirm");
    const host = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder({ status: "at_centre", ready_at: "2026-11-10T10:00:00.000Z", shelf: { id: "sh1", code: "A-01", label: null } }), shelves }));
    await act(async () => button(host, "They refuse it")!.click());
    const box = document.querySelector("dialog textarea, dialog input") as HTMLTextAreaElement | HTMLInputElement;
    act(() => {
      const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(box, "Not the colour in the photos");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => dialogButton("Record the refusal").click());
    expect(actions.refuseCollection).toHaveBeenCalledWith("c1", "o1", "Not the colour in the photos");
    expect(host.textContent).toContain("With Udozo to decide");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("storage at the counter", () => {
  it("says the buyer's storage is owed before the hand-over, and a return in Loss of care", () => {
    const owed = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder({ status: "at_centre", ready_at: "2026-11-01T10:00:00.000Z", collect_by: "2026-11-04T10:00:00.000Z", buyer_owed: 8400, shelf: { id: "sh1", code: "A-01", label: null } }), shelves }));
    expect(owed.textContent).toContain("Storage of ₦84 is owed");
    const care = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder({ status: "refunded", held_for_seller: true, loss_of_care_at: "2026-11-09T10:00:00.000Z", return: { id: "r1", number: "RT-000001", reason: "damaged", status: "accepted", collect_by: null } }), shelves }));
    expect(care.textContent).toContain("In Loss of care since");
  });
});

describe("returns to sellers", () => {
  it("asks to return an item not collected, after confirming", async () => {
    actions.askReturn.mockResolvedValue({ ok: true, data: { id: "r1" } });
    const host = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder({ status: "at_centre", ready_at: "2026-11-01T10:00:00.000Z", shelf: { id: "sh1", code: "A-01", label: null } }), shelves }));
    expect(host.textContent).toContain("Return it to the seller");
    await act(async () => button(host, "Ask for the return")!.click());
    await act(async () => dialogButton("Ask for the return").click());
    expect(actions.askReturn).toHaveBeenCalledWith("c1", "o1", "not_collected", "");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("offers the refused reasons for an item held for its seller, and none once asked", () => {
    const held = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder({ status: "refunded", held_for_seller: true }), shelves }));
    expect([...held.querySelectorAll("option")].map(option => option.textContent)).toEqual(expect.arrayContaining(["Refused at check-in", "Refused by the buyer at the counter", "Damaged"]));
    const asked = mount(createElement(CounterOrderView, { centre: "c1", country: "NG", order: counterOrder({ status: "refunded", held_for_seller: true, return: { id: "r1", number: "RT-000001", reason: "refused_at_check_in", status: "accepted", collect_by: null } }), shelves }));
    expect(asked.textContent).toContain("Return RT-000001");
    expect(asked.textContent).toContain("Hand it back on Returns");
    expect(asked.textContent).not.toContain("Ask for the return");
  });

  it("hands an accepted return back against the seller's code", async () => {
    actions.handBack.mockResolvedValue({ ok: true, data: { id: "r1", status: "collected" } });
    const row = { object: "connect_return" as const, id: "r1", number: "RT-000001", order: { id: "o1", number: "SP-000042", title: "Samsung TV" }, centre: { id: "c1", name: "Hub" }, seller: { name: "Chinedu Okafor" }, reason: "not_collected" as const, note: null, status: "accepted" as const, answer_by: "2026-11-12T10:00:00.000Z", decided_by: "seller" as const, decided_at: "2026-11-11T10:00:00.000Z", collect_by: "2026-11-18T10:00:00.000Z", collected_at: null, return_fee: null, code_tries_left: 5, created_at: "2026-11-10T10:00:00.000Z" };
    const host = mount(createElement(ReturnsList, { centre: "c1", country: "NG", returns: [row] }));
    expect(host.textContent).toContain("Accepted: the seller collects it");
    act(() => type(host.querySelector<HTMLInputElement>("input")!, "654321"));
    await act(async () => button(host, "Hand it back")!.click());
    expect(actions.handBack).toHaveBeenCalledWith("c1", "r1", "654321");
  });
});

describe("stock checks", () => {
  const group = {
    shelf: { id: "sh1", code: "A-01", label: "By the door", active: true },
    items: [
      { order_id: "o1", number: "SP-41", title: "Samsung TV", status: "at_centre", received_at: null, missing_since: null, seen_at: null },
      { order_id: "o2", number: "SP-42", title: "Blender", status: "at_centre", received_at: null, missing_since: "2026-11-09T10:00:00.000Z", seen_at: null },
    ],
  };

  it("saves what was ticked, asking first when something is not", async () => {
    actions.recordStockCheck.mockResolvedValue({ ok: true, data: { object: "connect_stock_check", id: "k1", shelf: { id: "sh1", code: "A-01" }, checked_by: "Bola Ade", expected: 2, found: 1, missing: 1, flagged: 0, note: null, created_at: "2026-11-10T10:00:00.000Z" } });
    const confirmSpy = vi.spyOn(window, "confirm");
    const host = mount(createElement(StockShelf, { centre: "c1", country: "NG", group }));
    expect(host.textContent).toContain("A-01 · By the door");
    expect(host.textContent).toContain("Missing since");
    act(() => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => button(host, "Save the check")!.click());
    expect(document.querySelector("dialog")!.textContent).toContain("1 item is not ticked");
    await act(async () => dialogButton("Save the check").click());
    expect(actions.recordStockCheck).toHaveBeenCalledWith("c1", "sh1", ["o1"], "");
    expect(host.textContent).toContain("Saved: 1 of 2 missing.");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("earnings", () => {
  const account = { mode: "live" as const, currency: "NGN", balance: 24000, held: 10000, available: 14000 };

  it("moves what is past the hold to the owner's payouts, in kobo, after confirming", async () => {
    actions.moveEarnings.mockResolvedValue({ ok: true, data: {} });
    const host = mount(createElement(EarningsCard, { centre: "c1", account, holdDays: 15, payoutsUrl: "https://udozo.com/account/payouts" }));
    expect(host.textContent).toContain("Can move");
    expect(host.textContent).toContain("15 days after they are earned");
    const amount = host.querySelector("input") as HTMLInputElement;
    expect(amount.value).toBe("140.00");
    act(() => type(amount, "500"));
    await act(async () => button(host, "Move to my payouts")!.click());
    expect(host.textContent).toContain("You can move up to ₦140 now.");
    act(() => type(amount, "100.50"));
    await act(async () => button(host, "Move to my payouts")!.click());
    await act(async () => dialogButton("Move it").click());
    expect(actions.moveEarnings).toHaveBeenCalledWith("c1", "live", "NGN", 10050);
    expect(host.querySelector('a[href="https://udozo.com/account/payouts"]')).toBeTruthy();
  });

  it("lists what was earned and moved", () => {
    const host = mount(createElement(EarningsLines, { country: "NG", lines: [{ id: "l1", kind: "earned", description: "UdozoPay SP-41 released", amount: 14000, mode: "live", currency: "NGN", created_at: "2026-11-10T10:00:00.000Z" }] }));
    expect(host.textContent).toContain("+₦140");
  });
});

describe("pickups", () => {
  const warehouse = { id: "wh1", name: "Udozo Lagos warehouse", address: "4 Industrial Avenue", state: { id: "s1", name: "Lagos" }, hours: "9 to 5", phone: "0803" };
  const pickup = {
    object: "connect_pickup" as const,
    id: "pk1",
    number: "PU-000001",
    day: "2026-11-12",
    collector: "Tunde",
    status: "scheduled" as const,
    warehouse,
    collected_at: null,
    items: [
      { order_id: "o1", number: "SP-41", title: "Gas cooker", shelf: "A-01", status: "waiting" as const, handed_over_at: null, received_at: null },
      { order_id: "o2", number: "SP-42", title: "Kettle", shelf: "A-02", status: "waiting" as const, handed_over_at: null, received_at: null },
    ],
  };

  it("hands over what is ticked against the collector's code, after confirming what stays", async () => {
    actions.handOverPickup.mockResolvedValue({ ok: true, data: { ...pickup, status: "collected" } });
    const host = mount(createElement(PickupCard, { centre: "c1", pickup }));
    act(() => (host.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click());
    act(() => type(host.querySelector("input[inputmode=numeric]") as HTMLInputElement, "482910"));
    await act(async () => button(host, "Hand over")!.click());
    expect(document.querySelector("dialog")!.textContent).toContain("1 item stays here");
    await act(async () => dialogButton("Hand over").click());
    expect(actions.handOverPickup).toHaveBeenCalledWith("c1", "pk1", "482910", ["o1"]);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("says where abandoned items go and when Udozo comes", () => {
    const host = mount(createElement(FraPanel, { fra: { warehouse, awaiting_pickup: 2, next_pickup: { id: "pk1", number: "PU-000001", day: "2026-11-12", collector: "Tunde" } } }));
    expect(host.textContent).toContain("Udozo Lagos warehouse");
    expect(host.textContent).toContain("2 abandoned items wait");
    expect(host.textContent).toContain("with Tunde");
  });
});
