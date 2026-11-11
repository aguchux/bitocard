// pos.udozo.com: receipts (milestone 6). The actions check what they send before calling Udozo, as the owner or the
// member of staff at the till; the PDF route reads the file with the session of whoever is there and never caches it;
// and the helpers word what was sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/lib/receipt-actions");
const { receiptAmount, sendText, shortName } = await import("@/lib/pos");
const { GET } = await import("@/app/app/sales/[id]/pdf/route");

const sale = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const code = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const sent: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
let reply: (url: string) => Response = () => Response.json({});

beforeEach(() => {
  sent.length = 0;
  reply = () => Response.json({ object: "pos_receipt_send", id: "s1", kind: "receipt", via: "whatsapp", to: "+234 803 ••• 4417", status: "sending", template: false, error: null, by: "Ada Okafor", created_at: "2026-11-11T10:00:00Z" });
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

describe("receipt actions", () => {
  it("send to WhatsApp and email, as the owner, with only what Udozo takes", async () => {
    expect((await actions.sendReceiptWhatsapp(sale, { phone: "0803 111 4417", kind: "invoice", save: true })).ok).toBe(true);
    expect(sent[0]).toMatchObject({ method: "POST", url: `/v1/pos/owner/sales/${sale}/receipt/whatsapp`, body: { phone: "08031114417", kind: "invoice", save_to_customer: true } });
    expect((await actions.sendReceiptEmail(sale, { email: " buyer@example.com ", attach: "both" })).ok).toBe(true);
    expect(sent[1]).toMatchObject({ url: `/v1/pos/owner/sales/${sale}/receipt/email`, body: { email: "buyer@example.com", attach: "both" } });
    expect(sent[1]!.body).not.toHaveProperty("save_to_customer");
  });

  it("refuse what Udozo would refuse, without asking it", async () => {
    expect(await actions.sendReceiptWhatsapp(sale, { phone: "call me" })).toMatchObject({ ok: false, param: "phone" });
    expect(await actions.sendReceiptEmail(sale, { email: "nope" })).toMatchObject({ ok: false, param: "email" });
    expect(await actions.showReceiptCode("not-a-sale")).toMatchObject({ ok: false });
    expect(await actions.receiptCodeStatus(sale, "nope")).toMatchObject({ ok: false });
    expect(sent).toHaveLength(0);
  });

  it("a member of staff at the till uses the staff routes", async () => {
    setRequest({}, { udz_pos: "bcc_owner", udz_pos_staff: "ups_cashier" });
    reply = () => Response.json({ object: "pos_receipt_code", id: code, kind: "receipt", purpose: "screen", expires_at: "2026-11-11T10:10:00Z", used_at: null, delivered_to: null, text: "RECEIPT POS-000001-K7M2Q9XA", whatsapp_url: "https://wa.me/2348000000000?text=x" });
    const shown = await actions.showReceiptCode(sale, "receipt");
    expect(shown.ok && shown.data.text).toBe("RECEIPT POS-000001-K7M2Q9XA");
    expect(sent[0]).toMatchObject({ url: `/v1/pos/staff/sales/${sale}/receipt-codes`, body: { kind: "receipt" } });
    expect(sent[0]!.headers["udozo-pos-session"]).toBe("ups_cashier");
    await actions.receiptCodeStatus(sale, code);
    expect(sent[1]).toMatchObject({ method: "GET", url: `/v1/pos/staff/sales/${sale}/receipt-codes/${code}` });
  });

  it("say Udozo's refusal in its words", async () => {
    reply = () => Response.json({ error: { type: "rate_limit_error", code: "receipt_send_limit", message: "This sale's receipt has been sent 10 times today." } }, { status: 429 });
    expect(await actions.sendReceiptEmail(sale, { email: "buyer@example.com" })).toEqual({ ok: false, message: "This sale's receipt has been sent 10 times today.", code: "receipt_send_limit", param: null });
  });
});

describe("the PDF route", () => {
  it("reads the PDF with the session at the till and never caches it", async () => {
    reply = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="Receipt-POS-000001.pdf"' } });
    const res = await GET(new Request(`https://pos.udozo.com/app/sales/${sale}/pdf?width=58&gift=1&download=1&kind=bogus`), { params: Promise.resolve({ id: sale }) });
    expect(res.status).toBe(200);
    expect(sent[0]!.url).toBe(`/v1/pos/owner/sales/${sale}/receipt.pdf?width=58&gift=true`);
    expect(sent[0]!.headers["bitocard-customer-session"]).toBe("bcc_owner");
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Receipt-POS-000001.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x25);
  });

  it("passes on a refusal and never asks for a malformed sale", async () => {
    reply = () => Response.json({ error: { message: "There is no such sale on your Udozo POS account." } }, { status: 404 });
    expect((await GET(new Request(`https://pos.udozo.com/app/sales/${sale}/pdf?kind=invoice`), { params: Promise.resolve({ id: sale }) })).status).toBe(404);
    expect(sent[0]!.url).toBe(`/v1/pos/owner/sales/${sale}/receipt.pdf?kind=invoice`);
    expect((await GET(new Request("https://pos.udozo.com/app/sales/x/pdf"), { params: Promise.resolve({ id: "../x" }) })).status).toBe(404);
    expect(sent).toHaveLength(1);
  });
});

describe("receipt words", () => {
  it("what was sent, cashiers and amounts", () => {
    const send = { object: "pos_receipt_send" as const, id: "s", kind: "receipt" as const, via: "whatsapp" as const, to: "+234 803 ••• 4417", status: "delivered" as const, template: false, error: null, by: null, created_at: "" };
    expect(sendText(send)).toBe("Receipt on WhatsApp to +234 803 ••• 4417, delivered");
    expect(sendText({ ...send, template: true, status: "sent" })).toBe("Receipt on WhatsApp to +234 803 ••• 4417, they tap Get receipt to have it");
    expect(sendText({ ...send, via: "email", kind: "both", to: "b***@example.com", status: "sent" })).toBe("Receipt and invoice by email to b***@example.com, sent");
    expect(sendText({ ...send, via: "qr", status: "failed", error: "WhatsApp could not deliver it." })).toBe("Receipt on WhatsApp (scanned) to +234 803 ••• 4417, not sent: WhatsApp could not deliver it.");
    expect([shortName("Blessing Musa"), shortName("Kemi")]).toEqual(["Blessing M.", "Kemi"]);
    expect(receiptAmount(3_870_000)).toBe("38,700.00");
  });
});
