// @vitest-environment jsdom
// pos.udozo.com's staff screens (milestone 5): a linked till's name tiles and PIN, the invite page (read from the
// link's fragment, refusing easy PINs), a manager's approval at the till, inviting staff and what the invite says to
// do next, and the role matrix.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosDeviceInfo, PosRoles, PosStaffMember } from "@/lib/pos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const staff = vi.hoisted(() => ({
  staffSignIn: vi.fn(),
  deviceSignIn: vi.fn(),
  linkDevice: vi.fn(),
  deviceGone: vi.fn(),
  lookupInvite: vi.fn(),
  acceptInvite: vi.fn(),
  inviteStaff: vi.fn(),
  updateStaff: vi.fn(),
  resendInvite: vi.fn(),
  setStaffStatus: vi.fn(),
  saveRole: vi.fn(),
  deleteRole: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/staff-actions", () => staff);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { TillTiles, AcceptInviteForm } = await import("@/components/staff-auth");
const { ApprovalBox } = await import("@/components/approval-box");
const { InviteStaff, StaffTable, RolesMatrix } = await import("@/components/staff-manager");

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

const button = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith(text))!;
const type = (field: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
const labelled = (host: ParentNode, text: string) => [...host.querySelectorAll("label")].find(label => label.textContent?.startsWith(text))!;
const field = (host: ParentNode, text: string) => (labelled(host, text).querySelector("input") ?? document.getElementById(labelled(host, text).htmlFor)) as HTMLInputElement;
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));

const device: PosDeviceInfo = {
  object: "pos_device",
  id: "d1",
  name: "Front counter",
  shop: { id: "s1", name: "Ada's Gadget Hub", shop_code: "ADA-4821" },
  till: { id: "t1", name: "Till 1" },
  staff: [
    { id: "k1", name: "Kemi Ade", first_name: "Kemi", initials: "KA", role: "Cashier", locked: false },
    { id: "e1", name: "Emeka Nwosu", first_name: "Emeka", initials: "EN", role: "Cashier", locked: true },
  ],
};

describe("a linked till", () => {
  it("asks who is selling, then signs them in as their PIN's fourth digit goes in", async () => {
    staff.deviceSignIn.mockResolvedValue({ ok: true, data: { name: "Kemi Ade" } });
    const host = mount(createElement(TillTiles, { device }));
    expect(host.textContent).toContain("Who’s selling?");
    expect(host.textContent).toContain("Shop code ADA-4821");
    expect(button(host, "EN").disabled).toBe(true);
    await act(async () => button(host, "KA").click());
    expect(host.textContent).toContain("Signing in as Kemi Ade");
    for (const digit of ["4", "8", "2", "6"]) await act(async () => button(host, digit).click());
    await settle();
    expect(staff.deviceSignIn).toHaveBeenCalledWith("k1", "4826");
    expect(router.push).toHaveBeenCalledWith("/app/till");
  });

  it("clears the PIN and says why when it is wrong", async () => {
    staff.deviceSignIn.mockResolvedValue({ ok: false, message: "The shop code, phone number or PIN is not right.", code: "invalid_credentials", param: null });
    const host = mount(createElement(TillTiles, { device }));
    await act(async () => button(host, "KA").click());
    type(host.querySelector('input[type="password"]')!, "1357");
    await settle();
    expect(host.querySelector("[role=alert]")!.textContent).toBe("The shop code, phone number or PIN is not right.");
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  });
});

describe("the invite page", () => {
  it("reads the token from the link, shows the role, refuses an easy PIN and joins", async () => {
    window.history.replaceState(null, "", `/invite#t=upi_${"a".repeat(43)}`);
    staff.lookupInvite.mockResolvedValue({ ok: true, data: { object: "pos_invite", first_name: "Kemi", shop: { name: "Ada's Gadget Hub", shop_code: "ADA-4821" }, role: { name: "Cashier", allows: ["Make sales and take payments", "Give discounts up to 5%"] }, tills: ["Till 1", "Till 2"], invited_by: "Ada Okafor", reset: false, expires_at: "2026-11-13T10:00:00Z" } });
    staff.acceptInvite.mockResolvedValue({ ok: true, data: { name: "Kemi Ade" } });
    const host = mount(createElement(AcceptInviteForm));
    await settle();
    expect(window.location.hash).toBe("");
    expect(staff.lookupInvite).toHaveBeenCalledWith(`upi_${"a".repeat(43)}`);
    expect(host.textContent).toContain("Hi Kemi, you’re invited to sell at Ada's Gadget Hub");
    expect(host.textContent).toContain("Give discounts up to 5%");
    const pins = host.querySelectorAll<HTMLInputElement>('input[type="password"]');
    type(pins[0]!, "1234");
    expect(host.textContent).toContain("That PIN is easy to guess");
    type(pins[1]!, "1234");
    await act(async () => button(host, "Join the shop").click());
    expect(host.querySelector("[role=alert]")!.textContent).toMatch(/harder to guess/);
    expect(staff.acceptInvite).not.toHaveBeenCalled();
    type(pins[0]!, "2468");
    type(pins[1]!, "2486");
    await act(async () => button(host, "Join the shop").click());
    expect(host.querySelector("[role=alert]")!.textContent).toBe("The two PINs are not the same.");
    type(pins[1]!, "2468");
    await act(async () => button(host, "Join the shop").click());
    expect(staff.acceptInvite).toHaveBeenCalledWith(`upi_${"a".repeat(43)}`, "2468");
    expect(router.push).toHaveBeenCalledWith("/app");
  });

  it("says so when the link is broken", async () => {
    window.history.replaceState(null, "", "/invite");
    const host = mount(createElement(AcceptInviteForm));
    await settle();
    expect(host.querySelector("[role=alert]")!.textContent).toMatch(/not complete/);
    expect(staff.lookupInvite).not.toHaveBeenCalled();
  });
});

describe("a manager's approval", () => {
  const approvers = [
    { id: "m1", name: "Chinedu Eze", role: "Manager", discount_limit_bps: null, refund: true, stock_adjust: true },
    { id: "s1", name: "Ngozi Obi", role: "Stock keeper", discount_limit_bps: 0, refund: false, stock_adjust: true },
  ];
  it("offers only who may approve this, and sends their choice and PIN", async () => {
    const onApprove = vi.fn();
    const host = mount(createElement(ApprovalBox, { approvers, what: "refund", reason: "A refund needs a manager's approval.", pending: false, onApprove, onCancel: vi.fn() }));
    expect([...host.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Chinedu Eze · Manager"]);
    type(host.querySelector('input[type="password"]')!, "4826");
    await act(async () => button(host, "Approve").click());
    expect(onApprove).toHaveBeenCalledWith({ staff_id: "m1", pin: "4826" });
  });

  it("says when nobody here may approve", () => {
    const host = mount(createElement(ApprovalBox, { approvers: [approvers[1]!], what: "discount", reason: "A bigger discount needs a manager.", pending: false, onApprove: vi.fn(), onCancel: vi.fn() }));
    expect(host.textContent).toContain("Nobody who works at this till may approve it");
  });
});

const member = (over: Partial<PosStaffMember> = {}): PosStaffMember => ({
  object: "pos_staff",
  id: "k1",
  first_name: "Kemi",
  last_name: "Ade",
  name: "Kemi Ade",
  initials: "KA",
  phone: "+2348030000000",
  phone_hint: "+234 •••• 000",
  email: null,
  role: { id: "cashier", key: "cashier", name: "Cashier" },
  all_tills: false,
  tills: [{ id: "t1", name: "Till 1", shop_id: "s1" }],
  mobile: false,
  status: "active",
  pin_set: true,
  locked_until: null,
  last_active_at: null,
  invited_by: "Ada Okafor",
  created_at: "2026-11-11T09:00:00Z",
  ...over,
});
const roles = [{ id: "cashier", name: "Cashier", description: "Sells, takes payments and prints receipts." }, { id: "manager", name: "Manager", description: null }];
const tills = [{ id: "t1", name: "Till 1", shop: "Ada's" }, { id: "t2", name: "Till 2", shop: "Ada's" }];

describe("managing staff", () => {
  it("invites someone and then says how to send it, with WhatsApp and the shop code", async () => {
    staff.inviteStaff.mockResolvedValue({ ok: true, data: { ...member({ status: "invited" }), invite: { url: "https://pos.udozo.com/invite#t=upi_x", expires_at: "", sent_via: "whatsapp", sent: false, message: "", whatsapp_url: "https://wa.me/2348030000000?text=hi", shop_code: "ADA-4821" } } });
    const host = mount(createElement(InviteStaff, { roles, tills }));
    await act(async () => button(host, "Invite staff").click());
    const dialog = document.querySelector("dialog")!;
    type(field(dialog, "First name"), "Kemi");
    type(field(dialog, "Last name"), "Ade");
    type(field(dialog, "Phone number"), "0803 000 0000");
    await act(async () => [...dialog.querySelectorAll("label")].find(label => label.textContent?.endsWith("Till 2"))!.querySelector("input")!.click());
    await act(async () => dialog.querySelector("form")!.requestSubmit());
    expect(staff.inviteStaff).toHaveBeenCalledWith(expect.objectContaining({ first_name: "Kemi", last_name: "Ade", phone: "0803 000 0000", role: "cashier", all_tills: false, till_ids: ["t2"] }), "whatsapp");
    expect(host.textContent).toContain("Invite ready for Kemi");
    expect(host.textContent).toContain("ADA-4821");
    expect([...host.querySelectorAll("a")].find(link => link.textContent === "Send on WhatsApp")!.getAttribute("href")).toBe("https://wa.me/2348030000000?text=hi");
  });

  it("lists each member with role, tills and status, and suspends after asking", async () => {
    staff.setStaffStatus.mockResolvedValue({ ok: true, data: member({ status: "suspended" }) });
    const host = mount(createElement(StaffTable, { staff: [member(), member({ id: "t", name: "Tunde Bakare", initials: "TB", status: "invited", pin_set: false })], roles, tills }));
    expect(host.textContent).toContain("Till 1");
    expect(host.textContent).toContain("Invite pending");
    expect(button(host, "Resend")).toBeTruthy();
    await act(async () => button(host, "Suspend").click());
    const confirmBox = document.querySelector("dialog[open]")!;
    expect(confirmBox.textContent).toContain("signed out of every till at once");
    await act(async () => [...confirmBox.querySelectorAll("button")].find(item => item.textContent === "Suspend")!.click());
    await settle();
    expect(staff.setStaffStatus).toHaveBeenCalledWith("k1", "suspend");
  });

  it("draws the role matrix with the owner first and the Udozo account owner-only", () => {
    const set = { sell: "yes", refund: "approval", till: "yes", stock_view: "yes", stock_adjust: "no", prices: "no", own_sales: "yes", all_sales: "no", cash_up: "no", export: "no", customers: "yes", transfers: "no", staff: "no", settings: "no" } as const;
    const data: PosRoles = {
      object: "list",
      permissions: [{ group: "Selling", items: [{ key: "sell", label: "Make sales and take payments" }, { key: "refund", label: "Refund or void a sale" }] }],
      data: [{ object: "pos_role", id: "cashier", key: "cashier", name: "Cashier", description: null, system: true, permissions: set, discount_limit_bps: 500, staff: 3 }],
    };
    const host = mount(createElement(RolesMatrix, { roles: data }));
    const headers = [...host.querySelectorAll("thead th")].map(cell => cell.textContent);
    expect(headers).toEqual(["Permission", "Owner", "Cashier"]);
    expect(host.textContent).toContain("With approval");
    expect(host.textContent).toContain("Up to 5%");
    expect(host.textContent).toContain("Udozo account: listings, wallet, payouts, plan");
  });
});
