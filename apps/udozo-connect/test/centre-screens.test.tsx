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
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/centre-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/centre/c1/staff" }));

const { CentreStaff } = await import("@/components/centre-staff");
const { CentreShelves } = await import("@/components/centre-shelves");
const { CentreSettings } = await import("@/components/centre-settings");
const { CentreNav } = await import("@/components/centre-nav");

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
    expect([...host.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(["/centre/c1", "/centre/c1/settings", "/centre/c1/staff", "/centre/c1/shelves"]);
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
