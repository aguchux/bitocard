// Udozo POS milestone 9 on pos.udozo.com: the offline till's rules (when it may sell, provisional numbers, what is
// free, checking a sale and the upload), the service worker, the device's sync and upload routes, and the actions for
// closing a shop, stock in transit, shop prices and offline sales to look at.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const rules = await import("@/lib/offline-rules");
const { offlineWorker } = await import("@/lib/offline-worker");
const actions = await import("@/lib/pos-actions");
const { flagText, transferStatusText } = await import("@/lib/pos");

const shop = { id: "s", name: "Ikeja shop", address: null, phone: null, tin: null, email: null, shop_code: "IKE-1234", vat_bps: 0, receipt_footer: null, receipt_qr: true, bank: null, paused: false, closed: false };
const limits = { hours: 72, sales: 500, warn_hours: 48 };
const hour = 3_600_000;
const now = Date.parse("2026-11-11T12:00:00Z");
const meta = { synced_at: null, next_number: 1, offline_sales: 0 };

describe("when the till may sell offline", () => {
  const synced = (hoursAgo: number) => ({ limits, shop, synced_at: new Date(now - hoursAgo * hour).toISOString() });

  it("never without a copy, a closed or paused shop, past 72 hours or 500 sales; warns from 48 hours", () => {
    expect(rules.offlineState(null, meta, now)).toMatchObject({ canSell: false });
    expect(rules.offlineState({ ...synced(1), shop: { ...shop, closed: true } }, meta, now)).toMatchObject({ canSell: false, reason: "Ikeja shop is closed." });
    expect(rules.offlineState({ ...synced(1), shop: { ...shop, paused: true } }, meta, now)).toMatchObject({ canSell: false });
    expect(rules.offlineState(synced(1), meta, now)).toEqual({ canSell: true, warn: null });
    expect(rules.offlineState(synced(50), meta, now)).toMatchObject({ canSell: true, warn: expect.stringContaining("Offline for 50 hours") });
    expect(rules.offlineState(synced(72), meta, now)).toMatchObject({ canSell: false, reason: expect.stringContaining("72 hours") });
    expect(rules.offlineState(synced(1), { ...meta, offline_sales: 500 }, now)).toMatchObject({ canSell: false, reason: expect.stringContaining("500 sales") });
  });

  it("numbers sales after the till (T2-0042) and counts what this till sold since the copy", () => {
    expect(rules.provisionalNumber("Till 2", 42)).toBe("T2-0042");
    expect(rules.provisionalNumber("Front counter", 7)).toBe("T1-0007");
    const sold = rules.soldSince([
      { status: "waiting", lines: [{ listing_id: "a", title: "A", quantity: 2, unit_price: 100 }] },
      { status: "uploaded", lines: [{ listing_id: "a", title: "A", quantity: 5, unit_price: 100 }] },
    ]);
    expect(rules.freeNow({ id: "a", available: 3 }, sold)).toBe(1);
    expect(rules.freeNow({ id: "a", available: 1 }, sold)).toBe(0);
  });
});

describe("a sale made offline", () => {
  const base = { client_sale_id: "0b0e7b4a-1111-4222-8333-444455556666", client_number: "T1-0001", now: new Date(now), staff: { id: "p", name: "Bola Ade" }, lines: [{ listing_id: "a", title: "Radio", quantity: 2, unit_price: 10_000 }], discount: 0, vat_bps: 750 };

  it("adds up as Udozo does, takes recorded payments only and gives change", () => {
    const made = rules.makeSale({ ...base, payments: [{ method: "cash", amount: 21_500, tendered: 25_000, reference: null }] });
    expect(made).toMatchObject({ ok: true, sale: { subtotal: 20_000, vat: 1_500, total: 21_500, change: 3_500, status: "waiting" } });
    expect(rules.makeSale({ ...base, payments: [{ method: "cash", amount: 20_000, tendered: null, reference: null }] })).toMatchObject({ ok: false, message: expect.stringContaining("do not cover") });
    expect(rules.makeSale({ ...base, payments: [{ method: "credit" as never, amount: 21_500, tendered: null, reference: null }] })).toMatchObject({ ok: false });
    expect(rules.makeSale({ ...base, lines: [], payments: [] })).toMatchObject({ ok: false });
  });

  it("is uploaded as it was made and marked with Udozo's answer", () => {
    const made = rules.makeSale({ ...base, payments: [{ method: "card", amount: 21_500, tendered: null, reference: "A1" }] });
    if (!made.ok) throw new Error("not made");
    expect(rules.uploadEntry(made.sale)).toEqual({ kind: "sale", client_sale_id: base.client_sale_id, client_number: "T1-0001", client_created_at: "2026-11-11T12:00:00.000Z", staff_id: "p", lines: [{ listing_id: "a", quantity: 2, unit_price: 10_000 }], vat_bps: 750, payments: [{ method: "card", amount: 21_500, reference: "A1" }], total: 21_500 });
    expect(rules.afterUpload(made.sale, { client_id: base.client_sale_id, status: "applied", sale: { number: "POS-000009", flags: [] } })).toMatchObject({ status: "uploaded", number: "POS-000009" });
    expect(rules.afterUpload(made.sale, { client_id: base.client_sale_id, status: "applied", sale: { number: "POS-000010", flags: [{ code: "oversold" }] } }).status).toBe("flagged");
    expect(rules.afterUpload(made.sale, { client_id: base.client_sale_id, status: "rejected", error: { code: "totals_mismatch", message: "No." } })).toMatchObject({ status: "failed", error: "No." });
    expect(rules.expired({ status: "uploaded", created_at: new Date(now - 31 * 24 * hour).toISOString() }, now)).toBe(true);
    expect(rules.expired({ status: "waiting", created_at: new Date(now - 31 * 24 * hour).toISOString() }, now)).toBe(false);
  });
});

describe("shifts, refunds, stock and approvals offline", () => {
  const person = (id: string, permissions: Record<string, "yes" | "approval" | "no">, limit: number | null = 500) => ({ id, name: id, first_name: id, initials: "XX", role: { id: null, name: "Role", discount_limit_bps: limit }, permissions });
  const sale = (id: string, at: string, payments = [{ method: "cash" as const, amount: 1_000, tendered: null, reference: null }], status: "waiting" | "uploaded" | "failed" = "waiting") => ({ client_sale_id: id, client_number: "T1-0001", created_at: at, staff_id: "p", staff_name: "P", approved_by_staff_id: null, lines: [{ listing_id: "a", title: "A", quantity: 1, unit_price: 1_000 }], discount: 0, vat_bps: 0, subtotal: 1_000, vat: 0, total: 1_000, change: 0, payments, status, number: null, error: null });

  it("uploads sales and steps in the order they happened", () => {
    const opened = rules.newEntry("shift_open", "Shift opened", { client_id: "e1", staff_id: "p", at: "2026-11-11T08:00:00Z", opening_float: 500 }, new Date("2026-11-11T08:00:00Z"));
    expect(opened).toMatchObject({ client_id: "e1", kind: "shift_open", status: "waiting", entry: { kind: "shift_open", client_id: "e1", opening_float: 500 } });
    const rows = rules.pendingUpload([sale("s2", "2026-11-11T09:00:00Z"), sale("s0", "2026-11-11T07:00:00Z", undefined, "uploaded")], [opened]);
    expect(rows.map(row => row.id)).toEqual(["e1", "s2"]);
    expect(rules.afterEntryUpload(opened, { client_id: "e1", status: "rejected", error: { code: "shift_open", message: "Open already." } })).toMatchObject({ status: "failed", error: "Open already." });
  });

  it("works out the drawer's cash and who may approve what", () => {
    const shift = { id: null, client_id: "e1", opened_at: "2026-11-11T08:00:00Z", opened_by: "P", opening_float: 5_000, cash: [{ kind: "out" as const, amount: 500 }] };
    expect(rules.expectedCash(shift, [sale("s1", "2026-11-11T09:00:00Z"), sale("s0", "2026-11-11T07:00:00Z")], 200)).toBe(5_300);
    const staff = [person("cashier", { sell: "yes", refund: "approval" }), person("manager", { sell: "yes", refund: "yes", stock_adjust: "yes" }, null), person("away", { sell: "yes", refund: "yes" }, null)];
    const checks = new Set(["cashier", "manager"]);
    expect(rules.approversFor(staff, checks, { kind: "refund" }, "cashier").map(p => p.id)).toEqual(["manager"]);
    expect(rules.approversFor(staff, checks, { kind: "discount", bps: 2_000 }, "manager").map(p => p.id)).toEqual([]);
    expect(rules.approversFor(staff, checks, { kind: "oversell" }, "cashier").map(p => p.id)).toEqual(["manager"]);
    expect(rules.shareBps(1, 3)).toBe(3_334);
    expect(rules.mayRunShift(staff[0]!)).toBe(false);
    expect(rules.countsBlind(person("x", { till: "yes" }))).toBe(true);
  });

  it("lists what may be refunded offline, never twice nor paid through Udozo", () => {
    const recent = [
      { id: "r1", client_sale_id: "c1", number: "POS-000001", client_number: null, created_at: "2026-11-10T10:00:00Z", sold_by: "P", total: 2_000, lines: [], payments: [{ method: "card", amount: 2_000 }], refundable_offline: true },
      { id: "r2", client_sale_id: "c2", number: "POS-000002", client_number: null, created_at: "2026-11-10T11:00:00Z", sold_by: "P", total: 2_000, lines: [], payments: [{ method: "udozo_wallet", amount: 2_000 }], refundable_offline: false },
    ];
    expect(rules.refundables([sale("s1", "2026-11-11T09:00:00Z")], recent, new Set()).map(row => row.client_sale_id)).toEqual(["s1", "c1"]);
    expect(rules.refundables([sale("s1", "2026-11-11T09:00:00Z")], recent, new Set(["s1"])).map(row => row.client_sale_id)).toEqual(["c1"]);
  });

  it("sends receipts asked for with the sale, and names the device in an exported file", () => {
    const made = rules.makeSale({ client_sale_id: "s", client_number: "T1-0001", now: new Date(now), staff: { id: "p", name: "P" }, lines: [{ listing_id: "a", title: "A", quantity: 1, unit_price: 1_000 }], discount: 0, vat_bps: 0, payments: [{ method: "card", amount: 1_000, tendered: null, reference: null }], receipt: { whatsapp: "08031234567", email: null } });
    if (!made.ok) throw new Error("not made");
    expect(rules.uploadEntry(made.sale).receipt).toEqual({ whatsapp: "08031234567", email: null });
    expect(JSON.parse(rules.exportPayload("dev", [{ kind: "sale" }], new Date(now)))).toEqual({ object: "pos_offline_export", device_id: "dev", made_at: "2026-11-11T12:00:00.000Z", entries: [{ kind: "sale" }] });
  });
});

describe("the service worker", () => {
  it("keeps the offline till and sends pages that cannot load to it, caching nothing private", () => {
    const worker = offlineWorker("abc123");
    expect(worker).toContain('"/udozo-mark-light.png"');
    expect(worker).toContain("SHELL.includes(url.pathname)");
    expect(worker).toContain('const CACHE = "udozo-pos-abc123"');
    expect(worker).toContain('"/offline"');
    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain('url.pathname.startsWith("/_next/static/")');
    expect(worker).not.toContain("/api/");
  });
});

describe("words", () => {
  it("say what a flag means and where a transfer stands", () => {
    expect(flagText({ code: "oversold", listing_id: "a", title: "Radio", short: 2 }, "NGN")).toBe("2 more “Radio” sold than there was: restock or count the shelf.");
    expect(flagText({ code: "price_changed", listing_id: "a", title: "Radio", sold_at: 10_000, price: 12_000 }, "NGN")).toBe("“Radio” sold at ₦100; it is now ₦120.");
    expect(flagText({ code: "staff_not_on_till", staff: "Bola Ade" }, "NGN")).toBe("Sold by Bola Ade, who does not work at this till.");
    expect(flagText({ code: "discount_over_limit", staff: "Bola Ade", bps: 2500 }, "NGN")).toContain("25% discount");
    expect(flagText({ code: "refund_unapproved", staff: "Bola Ade" }, "NGN")).toContain("without a manager's PIN");
    expect(transferStatusText({ status: "in_transit" })).toBe("On its way");
    expect(transferStatusText({ status: "received", received_lines: [{ listing_id: "a", sent: 4, received: 3, lost: 1 }] })).toBe("Received, 1 lost on the way");
    expect(transferStatusText({ status: "cancelled", received_by: "Ada" })).toBe("Taken back by Ada");
  });
});

describe("routes and actions", () => {
  const sent: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
  const listing = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
  const shopId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv("API_URL", "https://api.udozo.test");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      sent.push({ method: init.method ?? "GET", url: url.replace("https://api.udozo.test", ""), headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ object: "ok", results: [] });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("the device's copy and upload go to Udozo with its token, only from this site's pages", async () => {
    setRequest({}, { udz_pos_device: "upd_device" });
    const { GET } = await import("@/app/api/offline/copy/route");
    const { POST } = await import("@/app/api/offline/upload/route");
    expect((await GET(new Request("https://pos.udozo.com/api/offline/copy", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect((await GET(new Request("https://pos.udozo.com/api/offline/copy", { headers: { "sec-fetch-site": "same-origin" } }))).status).toBe(200);
    expect(sent[0]).toMatchObject({ method: "GET", url: "/v1/pos/device/sync", headers: expect.objectContaining({ "udozo-pos-device": "upd_device" }) });
    expect((await POST(new Request("https://pos.udozo.com/api/offline/upload", { method: "POST", body: JSON.stringify({ entries: [] }) }))).status).toBe(400);
    const entry = { kind: "sale", client_sale_id: listing };
    expect((await POST(new Request("https://pos.udozo.com/api/offline/upload", { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: JSON.stringify({ entries: [entry] }) }))).status).toBe(200);
    expect(sent[1]).toMatchObject({ method: "POST", url: "/v1/pos/device/upload", body: { entries: [entry] } });
    const { PUT } = await import("@/app/api/offline/key/route");
    const key = { kty: "EC", crv: "P-256", x: "x", y: "y" };
    expect((await PUT(new Request("https://pos.udozo.com/api/offline/key", { method: "PUT", headers: { "sec-fetch-site": "cross-site" }, body: JSON.stringify({ public_key: key }) }))).status).toBe(403);
    expect((await PUT(new Request("https://pos.udozo.com/api/offline/key", { method: "PUT", body: JSON.stringify({ public_key: key }) }))).status).toBe(200);
    expect(sent[2]).toMatchObject({ method: "PUT", url: "/v1/pos/device/key", body: { public_key: key } });
  });

  it("the owner's actions send what Udozo takes", async () => {
    setRequest({}, { udz_pos: "bcc_owner" });
    await actions.moveStock({ from: shopId, to: listing, lines: [{ listing_id: listing, quantity: 2 }], inTransit: true });
    expect(sent.at(-1)).toMatchObject({ url: "/v1/pos/owner/stock-transfers", body: { in_transit: true } });
    await actions.moveStock({ from: shopId, to: null, lines: [{ listing_id: listing, quantity: 2 }], inTransit: true });
    expect(sent.at(-1)!.body).not.toHaveProperty("in_transit");
    await actions.receiveStock(listing, [{ listing_id: listing, quantity: 1 }], "One cracked");
    expect(sent.at(-1)).toMatchObject({ url: `/v1/pos/owner/stock-transfers/${listing}/receive`, body: { lines: [{ listing_id: listing, quantity: 1 }], note: "One cracked" } });
    await actions.takeBackStock(listing);
    expect(sent.at(-1)!.url).toBe(`/v1/pos/owner/stock-transfers/${listing}/cancel`);
    await actions.closeShop(shopId, null);
    expect(sent.at(-1)).toMatchObject({ url: `/v1/pos/owner/shops/${shopId}/close`, body: { move_to_shop_id: null } });
    await actions.setShopPrice(listing, shopId, 120_000);
    expect(sent.at(-1)).toMatchObject({ method: "PUT", url: `/v1/pos/owner/products/${listing}/prices`, body: { shop_id: shopId, price: 120_000 } });
    expect((await actions.setShopPrice(listing, shopId, 0)).ok).toBe(false);
    await actions.resolveFlags(listing);
    expect(sent.at(-1)!.url).toBe(`/v1/pos/owner/sales/${listing}/flags/resolve`);
    await actions.decideHeld(listing, "accept");
    expect(sent.at(-1)!.url).toBe(`/v1/pos/owner/offline/held/${listing}/accept`);
    await actions.importOfflineFile(JSON.stringify({ payload: "{}", signature: "c2ln" }));
    expect(sent.at(-1)).toMatchObject({ method: "POST", url: "/v1/pos/owner/offline/import", body: { payload: "{}", signature: "c2ln" } });
    const sentBefore = sent.length;
    expect((await actions.importOfflineFile("not json")).ok).toBe(false);
    expect(sent.length).toBe(sentBefore);
    const before = sent.length;
    expect((await actions.closeShop("nope", null)).ok).toBe(false);
    expect(sent.length).toBe(before);
  });
});
