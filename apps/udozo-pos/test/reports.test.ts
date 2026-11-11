// pos.udozo.com: shifts and reports (milestone 7). The shift actions check what they send before calling Udozo, as the
// owner or the member of staff at the till; the report file route passes on only what Udozo takes; and the helpers word
// changes, counts and cash typed at the till.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/lib/shift-actions");
const { changeText, comparedWith, differenceText, readCash } = await import("@/lib/pos");
const { GET } = await import("@/app/app/reports/file/route");

const till = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const shift = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const shop = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const sent: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
let reply: (url: string) => Response = () => Response.json({});

beforeEach(() => {
  sent.length = 0;
  reply = () => Response.json({ object: "pos_shift", id: shift, status: "open" });
  setRequest({}, { udz_pos: "bcc_owner" });
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

describe("shift actions", () => {
  it("open, record cash and close, as the owner", async () => {
    expect((await actions.openShift(till, 2_000_000, " Morning ")).ok).toBe(true);
    expect(sent[0]).toMatchObject({ method: "POST", url: "/v1/pos/owner/shifts", body: { till_id: till, opening_float: 2_000_000, note: "Morning" } });
    expect((await actions.shiftCash(shift, "out", 150_000, " Paid the cleaner ")).ok).toBe(true);
    expect(sent[1]).toMatchObject({ url: `/v1/pos/owner/shifts/${shift}/cash`, body: { kind: "out", amount: 150_000, reason: "Paid the cleaner" } });
    expect((await actions.closeShift(shift, 2_090_000)).ok).toBe(true);
    expect(sent[2]).toMatchObject({ url: `/v1/pos/owner/shifts/${shift}/close`, body: { counted: 2_090_000 } });
  });

  it("a member of staff uses the staff routes", async () => {
    setRequest({}, { udz_pos: "bcc_owner", udz_pos_staff: "ups_cashier" });
    await actions.openShift(till, 0);
    expect(sent[0]!.url).toBe("/v1/pos/staff/shifts");
    expect(sent[0]!.headers["udozo-pos-session"]).toBe("ups_cashier");
  });

  it("refuse what Udozo would refuse, without asking it", async () => {
    expect(await actions.openShift("nope", 0)).toMatchObject({ ok: false, param: "till_id" });
    expect(await actions.openShift(till, -1)).toMatchObject({ ok: false, param: "opening_float" });
    expect(await actions.shiftCash(shift, "out", 0, "x")).toMatchObject({ ok: false, param: "amount" });
    expect(await actions.shiftCash(shift, "out", 100, " ")).toMatchObject({ ok: false, param: "reason" });
    expect(await actions.closeShift(shift, 1.5)).toMatchObject({ ok: false, param: "counted" });
    expect(sent).toHaveLength(0);
  });

  it("say Udozo's refusal in its words", async () => {
    reply = () => Response.json({ error: { type: "conflict_error", code: "shift_open", message: "Till 1 already has a shift open.", param: "till_id" } }, { status: 409 });
    expect(await actions.openShift(till, 0)).toEqual({ ok: false, message: "Till 1 already has a shift open.", code: "shift_open", param: "till_id" });
  });
});

describe("the report file route", () => {
  it("passes on a CSV as a download and never caches it", async () => {
    reply = () => new Response("Date,Sale\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="sales-2026-11-01-to-2026-11-11.csv"' } });
    const res = await GET(new Request(`https://pos.udozo.com/app/reports/file?kind=lines_csv&from=2026-11-01&to=2026-11-11&shop=${shop}&date=junk`));
    expect(sent[0]!.url).toBe(`/v1/pos/owner/reports/sales.csv?from=2026-11-01&to=2026-11-11&shop=${shop}&detail=lines`);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="sales-2026-11-01-to-2026-11-11.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(await res.text()).toBe("Date,Sale\r\n");
  });

  it("shows the end of day PDF in the browser; an unknown kind asks for nothing", async () => {
    reply = () => new Response(new Uint8Array([0x25, 0x50]), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="End-of-day-2026-11-11.pdf"' } });
    const res = await GET(new Request("https://pos.udozo.com/app/reports/file?kind=day_pdf&date=2026-11-11"));
    expect(sent[0]!.url).toBe("/v1/pos/owner/reports/day.pdf?date=2026-11-11");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="End-of-day-2026-11-11.pdf"');
    expect((await GET(new Request("https://pos.udozo.com/app/reports/file?kind=../../admin"))).status).toBe(404);
    expect(sent).toHaveLength(1);
  });

  it("passes on Udozo's refusal (an accountant's role, a range too long)", async () => {
    reply = () => Response.json({ error: { message: "Choose at most 366 days." } }, { status: 400 });
    const res = await GET(new Request("https://pos.udozo.com/app/reports/file?kind=summary_pdf&from=2024-01-01&to=2026-01-01"));
    expect([res.status, await res.text()]).toEqual([400, "Choose at most 366 days."]);
  });
});

describe("report words", () => {
  it("changes, counts and cash typed at the till", () => {
    expect(changeText(12, "last Tuesday, same time")).toBe("▲ 12% up on last Tuesday, same time");
    expect(changeText(-3, "the 7 days before")).toBe("▼ 3% down on the 7 days before");
    expect(changeText(null, "the 7 days before")).toBe("Nothing to compare with the 7 days before");
    expect(comparedWith("today", "Tuesday")).toBe("last Tuesday, same time");
    expect([differenceText(0, "NGN"), differenceText(-10_000, "NGN"), differenceText(5_050, "NGN"), differenceText(null, "NGN")]).toEqual(["Balanced", "Short by ₦100", "Over by ₦50.50", null]);
    expect([readCash("20,000"), readCash("₦ 1500.5"), readCash("abc"), readCash("-5"), readCash("")]).toEqual([2_000_000, 150_050, null, null, null]);
  });
});
