// pos.udozo.com's staff (milestone 5): staff sign in with the shop code, phone and PIN, kept in their own cookie and
// sent only as `Udozo-Pos-Session`; a staff browser's till calls go to `/v1/pos/staff`, never the owner's routes; a
// linked till signs staff in with its device token; invites, roles and devices; and the nav shows only what a role opens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const staff = await import("@/lib/staff-actions");
const actions = await import("@/lib/pos-actions");
const data = await import("@/lib/pos-data");
const { staffLinks } = await import("@/components/owner-nav");
const { ownerPermissions, weakPin, discountText, accessText, levelText } = await import("@/lib/pos");

const id = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const basket = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const listing = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const sent: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
let reply: (url: string) => Response = () => Response.json({});

const cashier = { sell: "yes", refund: "approval", till: "yes", stock_view: "yes", stock_adjust: "no", prices: "no", own_sales: "yes", all_sales: "no", cash_up: "no", export: "no", customers: "yes", transfers: "no", staff: "no", settings: "no" } as const;
const me = {
  object: "pos_staff_me",
  staff: { id, name: "Kemi Ade", first_name: "Kemi" },
  role: { id: "cashier", key: "cashier", name: "Cashier", discount_limit_bps: 500 },
  permissions: cashier,
  till_id: "t1",
  tills: ["t1"],
  device: null,
  open: true,
  wallet_payments: false,
  collections: true,
  country: "NG",
  currency: "NGN",
  account: { id: "a1", mode: "live", plan: { code: "premium", name: "Premium" }, shops: [] },
  transfer_accounts: [{ till_id: "t1", bank_name: "Wema", account_number: "991", account_name: "Shop" }],
  approvers: [{ id: "m1", name: "Chinedu Eze", role: "Manager", discount_limit_bps: null, refund: true, stock_adjust: true }],
};

beforeEach(() => {
  sent.length = 0;
  reply = () => Response.json({});
  setRequest({}, {});
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.udozo.test", "");
    sent.push({ method: init.method ?? "GET", url: path, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return reply(path);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("signing staff in", () => {
  it("signs in with the shop code, phone and PIN, keeping the session in the staff cookie only", async () => {
    reply = () => Response.json({ object: "pos_staff_session", session: { token: "ups_secret" }, staff: { name: "Kemi Ade" }, till_id: null });
    const result = await staff.staffSignIn(" ada-4821", "0803 000 0000", "4826");
    expect(result).toEqual({ ok: true, data: { name: "Kemi Ade" } });
    expect(sent[0]).toMatchObject({ method: "POST", url: "/v1/pos/staff/sign-in", body: { shop_code: "ADA-4821", phone: "0803 000 0000", pin: "4826" } });
    expect(sent[0]!.headers["bitocard-customer-session"]).toBeUndefined();
    const cookie = request.set.find(item => item.name === "udz_pos_staff")!;
    expect(cookie.value).toBe("ups_secret");
    expect(cookie.options).toMatchObject({ httpOnly: true, maxAge: 60 * 60 * 12 });
    expect(request.set.some(item => item.name === "udz_pos")).toBe(false);
  });

  it("refuses what is not a shop code or PIN before asking, and words a wrong PIN as the API does", async () => {
    expect(await staff.staffSignIn("ADA4821", "0803", "4826")).toMatchObject({ ok: false, param: "shop_code" });
    expect(await staff.staffSignIn("ADA-4821", "0803", "12a4")).toMatchObject({ ok: false, param: "pin" });
    expect(sent).toHaveLength(0);
    reply = () => Response.json({ error: { code: "invalid_credentials", message: "The shop code, phone number or PIN is not right." } }, { status: 401 });
    expect(await staff.staffSignIn("ADA-4821", "0803", "4826")).toMatchObject({ ok: false, code: "invalid_credentials", message: "The shop code, phone number or PIN is not right." });
    reply = () => Response.json({ error: { code: "pin_locked", message: "Too many wrong PINs. Try again in 15 minutes." } }, { status: 429 });
    expect(await staff.staffSignIn("ADA-4821", "0803", "4826")).toMatchObject({ code: "pin_locked" });
  });

  it("links this browser with a code, then signs in at its till with a tile and PIN", async () => {
    reply = () => Response.json({ object: "pos_device_link", token: "upd_device", device: { id: "d1", till: { name: "Till 1" } } });
    const linked = await staff.linkDevice("4f7k 29qx", "Front counter");
    expect(linked.ok).toBe(true);
    expect(sent[0]!.body).toEqual({ code: "4F7K29QX", name: "Front counter", platform: "web" });
    expect(request.set.find(item => item.name === "udz_pos_device")).toMatchObject({ value: "upd_device", options: { httpOnly: true } });
    expect(await staff.linkDevice("123", "")).toMatchObject({ ok: false, param: "code" });

    reply = () => Response.json({ session: { token: "ups_till" }, staff: { name: "Kemi Ade" }, till_id: "t1" });
    await staff.deviceSignIn(id, "4826");
    expect(sent.at(-1)).toMatchObject({ url: "/v1/pos/device/sign-in", body: { staff_id: id, pin: "4826" } });
    expect(sent.at(-1)!.headers["udozo-pos-device"]).toBe("upd_device");
    expect(request.cookies.get("udz_pos_staff")).toBe("ups_till");
  });

  it("accepts an invite with a PIN; a broken link never reaches the API", async () => {
    reply = () => Response.json({ session: { token: "ups_new" }, staff: { name: "Tunde Bakare" }, till_id: null });
    const token = `upi_${"a".repeat(43)}`;
    expect(await staff.acceptInvite(token, "2468")).toEqual({ ok: true, data: { name: "Tunde Bakare" } });
    expect(sent[0]).toMatchObject({ url: "/v1/pos/invites/accept", body: { token, pin: "2468" } });
    expect(await staff.lookupInvite("nope")).toMatchObject({ ok: false, code: "invite_invalid" });
    expect(sent).toHaveLength(1);
  });

  it("signs out to the till's tiles on a linked device, else the sign-in page", async () => {
    setRequest({}, { udz_pos_staff: "ups_x", udz_pos_device: "upd_y" });
    await expect(staff.staffSignOut()).rejects.toMatchObject({ to: "/signin/till" });
    expect(sent[0]).toMatchObject({ method: "POST", url: "/v1/pos/staff/sign-out" });
    expect(request.cookies.has("udz_pos_staff")).toBe(false);
    setRequest({}, { udz_pos_staff: "ups_x" });
    await expect(staff.staffSignOut()).rejects.toMatchObject({ to: "/signin" });
  });
});

describe("a staff browser's till", () => {
  it("sends the till's calls to the staff routes with the staff session, never the owner's", async () => {
    setRequest({}, { udz_pos_staff: "ups_kemi", udz_pos: "bcc_owner" });
    reply = () => Response.json({ object: "pos_sale", id });
    await actions.ringUp({ till_id: id, client_sale_id: basket, lines: [{ listing_id: listing, quantity: 1 }], discount: 10_000, payments: [{ method: "cash", amount: 90_000 }], expected_total: 90_000, approval: { staff_id: id, pin: "4826" } });
    expect(sent[0]).toMatchObject({ url: "/v1/pos/staff/sales", body: { approval: { staff_id: id, pin: "4826" } } });
    expect(sent[0]!.headers["udozo-pos-session"]).toBe("ups_kemi");
    expect(sent[0]!.headers["bitocard-customer-session"]).toBeUndefined();
    await actions.refundSale(id, "Wrong size", true, { staff_id: id, pin: "4826" });
    expect(sent[1]).toMatchObject({ url: `/v1/pos/staff/sales/${id}/refund`, body: { reason: "Wrong size", restock: true, approval: { staff_id: id, pin: "4826" } } });
    await actions.adjustStock(listing, "restock", 2, "Delivery", { staff_id: id, pin: "12" });
    expect(sent[2]!.body).toEqual({ kind: "restock", quantity: 2, note: "Delivery" });
  });

  it("the owner's calls stay on the owner's routes", async () => {
    setRequest({}, { udz_pos: "bcc_owner" });
    await actions.refundSale(id, "Wrong size");
    expect(sent[0]!.url).toBe(`/v1/pos/owner/sales/${id}/refund`);
    expect(sent[0]!.headers["bitocard-customer-session"]).toBe("bcc_owner");
  });

  it("reads a member of staff's view: their role, tills, transfer accounts and approvers", async () => {
    setRequest({}, { udz_pos_staff: "ups_kemi" });
    reply = () => Response.json(me);
    const view = await data.currentPos();
    expect(view).toMatchObject({ ok: true, data: { actor: "staff", name: "Kemi Ade", role: "Cashier", discountLimit: 500, tillId: "t1", transferTills: ["t1"] } });
    expect(sent[0]!.url).toBe("/v1/pos/staff");
  });

  it("manages cashiers through the staff routes as a manager, everyone through the owner's as the owner", async () => {
    setRequest({}, { udz_pos_staff: "ups_manager" });
    reply = () => Response.json({ id, first_name: "Tunde", invite: {} });
    await staff.inviteStaff({ first_name: "Tunde", last_name: "Bakare", phone: "0803", role: "cashier", all_tills: true }, "sms");
    expect(sent[0]).toMatchObject({ method: "POST", url: "/v1/pos/staff/staff", body: { first_name: "Tunde", role: "cashier", all_tills: true, send_via: "sms" } });
    setRequest({}, { udz_pos: "bcc_owner" });
    await staff.setStaffStatus(id, "remove");
    expect(sent[1]).toMatchObject({ method: "DELETE", url: `/v1/pos/owner/staff/${id}` });
    await staff.setStaffStatus(id, "suspend");
    expect(sent[2]).toMatchObject({ method: "POST", url: `/v1/pos/owner/staff/${id}/suspend` });
    expect(await staff.inviteStaff({ first_name: "A", last_name: "B", phone: "0803", role: "cashier" }, "link")).toMatchObject({ ok: false, param: "till_ids" });
  });

  it("saves roles and makes link codes on the owner's routes", async () => {
    setRequest({}, { udz_pos: "bcc_owner" });
    await staff.saveRole(null, { name: " Weekend help ", permissions: { sell: "yes", refund: "approval" }, discount_limit_bps: 200 });
    expect(sent[0]).toMatchObject({ method: "POST", url: "/v1/pos/owner/roles", body: { name: "Weekend help", permissions: { sell: "yes", refund: "approval" }, discount_limit_bps: 200 } });
    expect(await staff.saveRole(null, { name: "X", permissions: {}, discount_limit_bps: 20_000 })).toMatchObject({ ok: false, param: "discount_limit_bps" });
    await staff.makeLinkCode(id);
    expect(sent[1]).toMatchObject({ method: "POST", url: `/v1/pos/owner/tills/${id}/devices/link-code` });
  });
});

describe("words and places", () => {
  it("shows a member of staff only what their role opens", () => {
    expect(staffLinks(cashier).map(link => link.label)).toEqual(["Home", "Till", "Sales", "Customers", "Products"]);
    const accountant = { ...cashier, sell: "no", refund: "no", till: "no", own_sales: "no", all_sales: "yes", customers: "no", cash_up: "yes", export: "yes" } as const;
    expect(staffLinks(accountant).map(link => link.label)).toEqual(["Home", "Sales", "Products"]);
    expect(staffLinks({ ...cashier, staff: "cashiers" }).map(link => link.label)).toContain("Cashiers");
    expect(Object.values(ownerPermissions).every(level => level === "yes")).toBe(true);
  });

  it("words PINs, limits, levels and where someone works", () => {
    expect(["1234", "0000", "1990", "9876"].every(weakPin)).toBe(true);
    expect(weakPin("4826")).toBe(false);
    expect(discountText(null)).toBe("Any amount");
    expect(discountText(0)).toBe("No discounts");
    expect(discountText(750)).toBe("Up to 7.5%");
    expect(levelText("approval")).toBe("With approval");
    expect(accessText({ all_tills: false, tills: [{ id: "t1", name: "Till 1", shop_id: "s" }], mobile: true })).toBe("Till 1, mobile");
  });
});
