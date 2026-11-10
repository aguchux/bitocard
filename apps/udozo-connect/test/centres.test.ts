// A centre's own pages on connect.udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 3): who may do what, where `/centre`
// sends a person, and the actions, which ask the API on this server with the session and never anything else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

const revalidated = vi.hoisted(() => [] as string[]);
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));

const rules = await import("@/lib/centres");
const actions = await import("@/lib/centre-actions");

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
type Sent = { method: string; url: string; body: unknown; headers: Record<string, string> };
const sent: Sent[] = [];
let reply: () => Response;

beforeEach(() => {
  sent.length = 0;
  revalidated.length = 0;
  setRequest({}, { udz_connect: "bcc_session" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  reply = () => Response.json({ object: "list", data: [] });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ method: String(init.method), url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    return reply();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("who may do what", () => {
  it("owners and managers manage; only owners handle people", () => {
    expect(["owner", "manager", "staff"].map(role => rules.canManage(role as "owner"))).toEqual([true, true, false]);
    expect(["owner", "manager", "staff"].map(role => rules.isOwner(role as "owner"))).toEqual([true, false, false]);
  });

  it("the menu marks the longest matching place, so Overview is current only on its own page", () => {
    expect(rules.currentNav(id, `/centre/${id}`)).toBe(`/centre/${id}`);
    expect(rules.currentNav(id, `/centre/${id}/staff`)).toBe(`/centre/${id}/staff`);
    expect(rules.currentNav(id, `/centre/${id}/shelves/new`)).toBe(`/centre/${id}/shelves`);
  });

  it("`/centre` opens the only centre, offers a choice of several, or goes back to the application", () => {
    expect(rules.centreHome([{ id }])).toEqual({ redirect: `/centre/${id}` });
    expect(rules.centreHome([])).toEqual({ redirect: "/application" });
    expect(rules.centreHome([{ id }, { id: other }])).toEqual({ choose: true });
  });

  it("says why a centre takes nothing new", () => {
    const at = "2026-12-27T00:00:00.000Z";
    expect(rules.pauseWords({ status: "active", paused: null, closed: null }, rules.day)).toBeNull();
    expect(rules.pauseWords({ status: "paused", paused: { by: "partner", reason: "Closed for Christmas", until: at }, closed: null }, rules.day)).toBe("Closed for Christmas, until 27 December 2026.");
    expect(rules.pauseWords({ status: "paused", paused: { by: "udozo", reason: "Checks.", until: null }, closed: null }, rules.day)).toContain("Our team will reopen it.");
    expect(rules.pauseWords({ status: "closed", paused: null, closed: { at, reason: "The office moved." } }, rules.day)).toBe("Udozo closed this centre: The office moved.");
  });

  it("links a map only for a centre with a position", () => {
    expect(rules.mapLink({ latitude: 6.6, longitude: 3.35 })).toBe("https://www.google.com/maps?q=6.6,3.35");
    expect(rules.mapLink({ latitude: null, longitude: null })).toBeNull();
  });
});

describe("the centre's actions", () => {
  it("change the centre's details with the session, a PATCH carrying no idempotency key", async () => {
    reply = () => Response.json({ object: "connect_centre", id, hours: "Every day" });
    const result = await actions.updateCentre(id, { hours: " Every day ", phone: "08031234567", capacity: "60", landmark: "" });
    expect(result.ok).toBe(true);
    expect(sent[0]).toMatchObject({ method: "PATCH", url: `https://api.udozo.test/v1/connect/centres/${id}`, body: { hours: "Every day", phone: "08031234567", capacity: 60, landmark: null } });
    expect(sent[0]!.headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(sent[0]!.headers["idempotency-key"]).toBeUndefined();
    expect(revalidated).toContain("/centre");
  });

  it("refuse a capacity that is not a whole number without asking", async () => {
    expect(await actions.updateCentre(id, { capacity: "lots" })).toMatchObject({ ok: false, param: "capacity" });
    expect(sent).toHaveLength(0);
  });

  it("pause until a day (its midnight, UTC) or until opened again, and open again", async () => {
    await actions.pauseCentre(id, "2026-12-27", "Closed for Christmas");
    await actions.pauseCentre(id, null, "");
    await actions.resumeCentre(id);
    expect(sent.map(item => [item.method, item.url.replace("https://api.udozo.test", ""), item.body])).toEqual([
      ["POST", `/v1/connect/centres/${id}/pause`, { until: "2026-12-27T00:00:00.000Z", note: "Closed for Christmas" }],
      ["POST", `/v1/connect/centres/${id}/pause`, { until: null, note: null }],
      ["POST", `/v1/connect/centres/${id}/resume`, {}],
    ]);
    expect(sent.every(item => item.headers["idempotency-key"])).toBe(true);
    expect(await actions.pauseCentre(id, "27/12/2026", null)).toMatchObject({ ok: false, param: "until" });
  });

  it("add, change and remove people, and storage places", async () => {
    await actions.addMember(id, " bola@example.com ", "staff");
    await actions.changeMemberRole(id, other, "manager");
    await actions.removeMember(id, other);
    await actions.addShelf(id, { code: " a-01 ", label: "", capacity: "20" });
    await actions.updateShelf(id, other, { active: false });
    expect(sent.map(item => [item.method, item.url.replace(`https://api.udozo.test/v1/connect/centres/${id}`, ""), item.body])).toEqual([
      ["POST", "/members", { email: "bola@example.com", role: "staff" }],
      ["PATCH", `/members/${other}`, { role: "manager" }],
      ["DELETE", `/members/${other}`, undefined],
      ["POST", "/shelves", { code: "a-01", label: null, capacity: 20 }],
      ["PATCH", `/shelves/${other}`, { active: false }],
    ]);
  });

  it("never ask about an id that is not one, nor give anyone the owner's role", async () => {
    expect(await actions.updateCentre("../admin", { hours: "x" })).toMatchObject({ ok: false, code: "centre_unknown" });
    expect(await actions.removeMember(id, "nope")).toMatchObject({ ok: false, code: "centre_unknown" });
    expect(await actions.addMember(id, "a@example.com", "owner" as "staff")).toMatchObject({ ok: false, param: "role" });
    expect(sent).toHaveLength(0);
  });

  it("say the session ended, and pass on Udozo's refusal with its field", async () => {
    reply = () => Response.json({ error: { code: "unauthenticated", message: "Sign in." } }, { status: 401 });
    expect(await actions.resumeCentre(id)).toEqual({ ok: false, message: "Your session ended. Sign in again to carry on.", code: "unauthenticated", param: null });
    reply = () => Response.json({ error: { code: "mobile_not_confirmed", message: "They must confirm their mobile number on their Udozo account first.", param: "email" } }, { status: 400 });
    expect(await actions.addMember(id, "a@example.com", "staff")).toEqual({ ok: false, message: "They must confirm their mobile number on their Udozo account first.", code: "mobile_not_confirmed", param: "email" });
    expect(revalidated).toHaveLength(0);
  });
});

describe("the counter's rules and actions", () => {
  it("says where an item stands and what comes next", () => {
    const now = Date.parse("2026-11-12T00:00:00.000Z");
    expect(rules.counterStatus({ status: "sent", ready_at: null, collect_by: null }, now)).toBe("On its way");
    expect(rules.counterStatus({ status: "at_centre", ready_at: null, collect_by: null }, now)).toBe("Received: shelve it");
    expect(rules.counterStatus({ status: "at_centre", ready_at: "x", collect_by: "2026-11-11T00:00:00.000Z" }, now)).toBe("Ready: free time to collect is over");
    expect(["paid", "at_centre", "released"].map(status => rules.counterNext({ status: status as "paid", ready_at: status === "at_centre" ? "x" : null }))).toEqual(["receive", "hand_over", null]);
  });

  it("asks the centre's own routes, the code checked here first", async () => {
    reply = () => Response.json({ object: "connect_order", id: other });
    await actions.receiveOrder(id, other, " Box fine ");
    await actions.shelveOrder(id, other, other);
    await actions.releaseOrder(id, other, "12 34 56");
    await actions.refuseCollection(id, other, " Wrong colour ");
    await actions.postUpdate(id, other, "Buyer will come tomorrow");
    expect(sent.map(item => [item.method, item.url.replace(`https://api.udozo.test/v1/connect/centres/${id}/orders/${other}`, ""), item.body])).toEqual([
      ["POST", "/receive", { note: "Box fine" }],
      ["POST", "/shelve", { shelf_id: other }],
      ["POST", "/release", { code: "123456" }],
      ["POST", "/refuse-collection", { reason: "Wrong colour" }],
      ["POST", "/updates", { body: "Buyer will come tomorrow" }],
    ]);
    sent.length = 0;
    expect(await actions.releaseOrder(id, other, "12345")).toMatchObject({ ok: false, param: "code" });
    expect(await actions.refuseOrder(id, other, "because", null)).toMatchObject({ ok: false, param: "reason" });
    expect(await actions.findOrder(id, "order 42")).toMatchObject({ ok: false, param: "number" });
    expect(sent).toHaveLength(0);
  });

  it("finds an item by its label's number, and says when none is coming here", async () => {
    reply = () => Response.json({ object: "connect_order", id: other });
    expect(await actions.findOrder(id, "SP-000042 CC-000001")).toEqual({ ok: true, data: { id: other } });
    expect(sent[0]!.url).toBe(`https://api.udozo.test/v1/connect/centres/${id}/orders/lookup?number=SP-000042`);
    reply = () => Response.json({ error: { code: "resource_missing", message: "No such order at this centre." } }, { status: 404 });
    expect(await actions.findOrder(id, "42")).toMatchObject({ ok: false, message: "No order with that number is coming to this centre." });
  });
});

describe("returns", () => {
  it("knows which returns an item can be asked for", () => {
    const base = { return: null, held_for_seller: false } as const;
    expect(rules.returnReasonsFor({ ...base, status: "at_centre", ready_at: "x" })).toEqual(["not_collected"]);
    expect(rules.returnReasonsFor({ ...base, status: "at_centre", ready_at: null })).toBeNull();
    expect(rules.returnReasonsFor({ ...base, status: "refunded", ready_at: null, held_for_seller: true })).toEqual(["refused_at_check_in", "refused_at_counter", "damaged"]);
    expect(rules.returnReasonsFor({ status: "at_centre", ready_at: "x", held_for_seller: false, return: { id: "r", number: "RT-1", reason: "not_collected", status: "requested", collect_by: null } })).toBeNull();
  });

  it("asks and hands back through the centre's own routes, the code checked here first", async () => {
    reply = () => Response.json({ object: "connect_return", id: other });
    await actions.askReturn(id, other, "not_collected", " Never came ");
    await actions.handBack(id, other, "65 43 21");
    expect(sent.map(item => [item.url.replace(`https://api.udozo.test/v1/connect/centres/${id}`, ""), item.body])).toEqual([
      [`/orders/${other}/return`, { reason: "not_collected", note: "Never came" }],
      [`/returns/${other}/hand-back`, { code: "654321" }],
    ]);
    sent.length = 0;
    expect(await actions.askReturn(id, other, "because", null)).toMatchObject({ ok: false, param: "reason" });
    expect(await actions.handBack(id, other, "123")).toMatchObject({ ok: false, param: "code" });
    expect(sent).toHaveLength(0);
  });
});

describe("stock checks and earnings", () => {
  it("shows Earnings in the menu to the owner only", () => {
    expect(rules.centreNav(id, "owner").map(item => item.label)).toContain("Earnings");
    expect(rules.centreNav(id, "staff").map(item => item.label)).not.toContain("Earnings");
    expect(rules.centreNav(id, "staff").map(item => item.label)).toContain("Stock check");
    expect(rules.checkWords({ expected: 4, missing: 0 })).toBe("All 4 there");
    expect(rules.checkWords({ expected: 4, missing: 1 })).toBe("1 of 4 missing");
  });

  it("records a check and moves earnings through the centre's own routes, checked here first", async () => {
    reply = () => Response.json({ object: "connect_stock_check", id: other });
    await actions.recordStockCheck(id, other, [other], " Box torn ");
    await actions.recordStockCheck(id, null, [], null);
    await actions.moveEarnings(id, "live", "NGN", 14000);
    expect(sent.map(item => [item.method, item.url.replace(`https://api.udozo.test/v1/connect/centres/${id}`, ""), item.body])).toEqual([
      ["POST", "/stock-checks", { shelf_id: other, found: [other], note: "Box torn" }],
      ["POST", "/stock-checks", { shelf_id: null, found: [], note: null }],
      ["POST", "/earnings/move", { mode: "live", currency: "NGN", amount: 14000 }],
    ]);
    sent.length = 0;
    expect(await actions.recordStockCheck(id, null, ["../x"], null)).toMatchObject({ ok: false });
    expect(await actions.moveEarnings(id, "live", "NGN", 0)).toMatchObject({ ok: false, param: "amount" });
    expect(sent).toHaveLength(0);
  });
});

describe("pickups", () => {
  it("hands over through the centre's own route, the code and items checked here first", async () => {
    reply = () => Response.json({ object: "connect_pickup", id: other });
    await actions.handOverPickup(id, other, " 482 910 ", [other]);
    expect(sent.map(item => [item.url.replace(`https://api.udozo.test/v1/connect/centres/${id}`, ""), item.body])).toEqual([[`/pickups/${other}/hand-over`, { code: "482910", order_ids: [other] }]]);
    sent.length = 0;
    expect(await actions.handOverPickup(id, other, "12", [other])).toMatchObject({ ok: false, param: "code" });
    expect(await actions.handOverPickup(id, other, "482910", [])).toMatchObject({ ok: false, param: "order_ids" });
    expect(sent).toHaveLength(0);
    expect(rules.centreNav(id).map(item => item.label)).toContain("Pickups");
  });
});

describe("transfers", () => {
  it("sends and checks in through the centre's own routes, checked here first", async () => {
    reply = () => Response.json({ object: "connect_transfer", id: other });
    await actions.sendTransfer(id, other, " GIG Logistics ", "");
    await actions.receiveTransfer(id, other, null);
    await actions.handOverTransfer(id, other, " 482 910 ");
    expect(sent.map(item => [item.url.replace(`https://api.udozo.test/v1/connect/centres/${id}`, ""), item.body])).toEqual([
      [`/transfers/${other}/send`, { courier: "GIG Logistics", tracking_number: null }],
      [`/transfers/${other}/receive`, { shelf_id: null }],
      [`/transfers/${other}/hand-over`, { code: "482910" }],
    ]);
    sent.length = 0;
    expect(await actions.handOverTransfer(id, other, "12345")).toMatchObject({ ok: false, param: "code" });
    expect(await actions.sendTransfer(id, other, "  ", "")).toMatchObject({ ok: false, param: "courier" });
    expect(await actions.receiveTransfer(id, "../x", null)).toMatchObject({ ok: false });
    expect(sent).toHaveLength(0);
    expect(rules.centreNav(id).map(item => item.label)).toContain("Transfers");
  });

  it("groups a centre's moves: to send, coming, here to collect, and the rest", () => {
    const row = (patch: Record<string, unknown>) => ({ id: String(Math.random()), status: "paid", from: { kind: "centre", id }, to: { id: other }, ...patch }) as never;
    const groups = rules.transferGroups(id, [row({}), row({ status: "sent", from: { kind: "centre", id: other }, to: { id } }), row({ status: "arrived", from: { kind: "warehouse", id: "wh" }, to: { id } }), row({ status: "sent" }), row({ status: "cancelled" })]);
    expect([groups.toSend.length, groups.coming.length, groups.arrived.length, groups.done.length]).toEqual([1, 1, 1, 2]);
  });
});
