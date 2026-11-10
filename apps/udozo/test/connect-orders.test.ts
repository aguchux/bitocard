// Udozo Connect orders on udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 5): asking to collect at a centre, what each side
// does next and the order's steps, the seller dropping it off, and the parcel's label (never the buyer's details).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopOrder } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { orderActions, orderNext, orderSteps } = await import("@/lib/shop");
const { labelFor } = await import("@/lib/connect-label");
const { requestSafePay } = await import("@/lib/listing-actions");
const { acceptReturn, payStorage, orderStep, returnCode } = await import("@/lib/shop-actions");

const id = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const centre = { id, number: "CC-000001", name: "Ikeja Parcel Hub", address: "12 Allen Avenue", landmark: null, area: "Ikeja", state: "Lagos", hours: "Mon to Sat, 8am to 6pm", phone: "08031234567" };
const make = (patch: Partial<ShopOrder>): ShopOrder =>
  ({
    object: "classified_order",
    id,
    number: "SP-100001",
    role: "buyer",
    status: "paid",
    listing: { id, ref: 100001, title: "Samsung TV", slug: "tv", cover_url: null },
    with: { name: "Kemi A." },
    fulfilment: "connect",
    quantity: 1,
    currency: "NGN",
    price: 100,
    refund: null,
    delivery_address: null,
    tracking_note: null,
    connect: { centre, connect_fee: 20000, received_at: null, ready_at: null, collect_by: null },
    deadlines: { accept_by: "2026-10-26T10:00:00Z", pay_by: null, handover_by: "2026-10-30T10:00:00Z", confirm_by: null },
    timeline: { requested_at: "2026-10-25T10:00:00Z", accepted_at: "2026-10-25T11:00:00Z", paid_at: "2026-10-25T12:00:00Z", sent_at: null, released_at: null, refunded_at: null, closed_at: null },
    ended_by: null,
    end_reason: null,
    ...patch,
  }) as ShopOrder;

describe("a Connect order's steps", () => {
  test("the buyer keeps their release code for the counter; nobody confirms it at home", () => {
    expect(orderActions(make({}))).toEqual(["release_code", "cancel", "dispute"]);
    expect(orderActions(make({ role: "seller" }))).toEqual(["sent", "cancel"]);
    expect(orderActions(make({ status: "sent" }))).toEqual(["release_code", "dispute"]);
    expect(orderActions(make({ status: "sent", role: "seller" }))).toEqual([]);
    expect(orderActions(make({ status: "at_centre" }))).toEqual(["release_code", "dispute"]);
  });

  test("says what comes next, by the centre's name", () => {
    expect(orderNext(make({ role: "seller" }))).toMatch(/^Photograph it and the sealed parcel, get it to Ikeja Parcel Hub by .+ and mark it sent\.$/);
    expect(orderNext(make({ status: "sent" }))).toBe("On its way to Ikeja Parcel Hub. We will tell you when it is ready.");
    const ready = make({ status: "at_centre", connect: { centre, received_at: "2026-10-27T10:00:00Z", ready_at: "2026-10-27T11:00:00Z", collect_by: "2026-10-30T11:00:00Z" } });
    expect(orderNext(ready)).toMatch(/^Ready at Ikeja Parcel Hub\. Inspect it at the counter, then give your release code; free to collect until /);
  });

  test("its progress goes through the centre", () => {
    const steps = orderSteps(make({ status: "at_centre", timeline: { ...make({}).timeline!, sent_at: "2026-10-26T10:00:00Z" }, connect: { centre, received_at: "2026-10-27T10:00:00Z", ready_at: null, collect_by: null } }));
    expect(steps.map(step => [step.title, step.state])).toEqual([
      ["Requested", "done"],
      ["Accepted by Kemi A.", "done"],
      ["Paid: Udozo is holding it", "done"],
      ["Sent to Ikeja Parcel Hub", "done"],
      ["Received at the centre", "done"],
      ["Ready to collect", "now"],
      ["Inspected and collected", "later"],
      ["Released to the seller", "later"],
    ]);
  });
});

describe("the parcel's label", () => {
  test("the order number, its QR code and the centre for the seller, never the buyer's details", () => {
    const label = labelFor(make({ role: "seller", buyer_details: { name: "Kemi Adeyemi", phone: "+2348030000000", email: "kemi@example.com", address: "1 Secret Road" } } as Partial<ShopOrder>));
    expect(label).toMatchObject({ qr: "SP-100001 CC-000001", number: "SP-100001", centre: { name: "Ikeja Parcel Hub", address: "12 Allen Avenue, Ikeja, Lagos" }, item: "Samsung TV" });
    expect(JSON.stringify(label)).not.toMatch(/Kemi|Secret|kemi@|2348030000000/);
    expect(labelFor(make({}))).toBeNull();
    expect(labelFor(make({ role: "seller", status: "at_centre" }))).toBeNull();
    expect(labelFor(make({ role: "seller", fulfilment: "delivery", connect: null }))).toBeNull();
  });
});

describe("asking and sending", () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("API_URL", "http://api.test");
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ path: new URL(url).pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ object: "classified_order", id }, { status: 201 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("a Connect request names its centre, and is never sent without one", async () => {
    await requestSafePay({ listingId: id, fulfilment: "connect", centreId: id, address: "ignored" });
    expect(calls[0]).toEqual({ path: "/v1/classifieds/orders", body: { listing_id: id, fulfilment: "connect", connect_centre_id: id } });
    expect(await requestSafePay({ listingId: id, fulfilment: "connect" })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
  });

  test("the seller accepts a centre's return and reads their return code", async () => {
    await acceptReturn(id);
    await returnCode(id);
    expect(calls.map(call => call.path)).toEqual([`/v1/classifieds/orders/${id}/return/accept`, `/v1/classifieds/orders/${id}/return-code`]);
    expect(await acceptReturn("../x")).toMatchObject({ ok: false });
  });

  test("the buyer pays the storage owed before collecting", async () => {
    await payStorage(id);
    expect(calls).toEqual([{ path: `/v1/classifieds/orders/${id}/storage/pay`, body: {} }]);
    expect(await payStorage("nope")).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
  });

  test("the seller drops it off at the centre with no courier, or names one", async () => {
    await orderStep(id, "sent", { dropOff: true, tracking_note: " At the counter by noon " });
    await orderStep(id, "sent", { courier: "GIG Logistics", tracking_number: "GIG123" });
    expect(calls.map(call => call.body)).toEqual([{ tracking_note: "At the counter by noon" }, { courier: "GIG Logistics", tracking_number: "GIG123" }]);
  });
});
