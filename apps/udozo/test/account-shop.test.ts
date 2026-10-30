import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopOrder } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { bpsText, featureValue, fromMinor, listingActions, listingChannelTags, listingMeta, localPhotoUrl, orderActions, orderNext, orderSteps, resaleSums, toggleList, toMinor, wrapSelection } = await import("@/lib/shop");
const { accountPlaces, currentPlace } = await import("@/lib/account-places");
const { accountCounts, listingHref, marketOf } = await import("@/lib/account");
const actions = await import("@/lib/shop-actions");
const { forwardPhoto } = await import("@/lib/shop-files");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const listing = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const order = "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c";
const nigeria = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 12, safe_pay: true, install_prompt: false };

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("selling through resellers", () => {
  test("what a supplier receives and the most a reseller may sell at, rounded as the API rounds", () => {
    expect(resaleSums(10_000_000, 1000, 3000)).toEqual({ net: 9_000_000, top: 13_000_000 });
    expect(resaleSums(999, 1050, 1550)).toEqual({ net: 999 - 104, top: 999 + 154 });
    expect(resaleSums(null, 1000, 3000)).toBeNull();
    expect([bpsText(1000), bpsText(1250), bpsText(50)]).toEqual(["10%", "12.5%", "0.5%"]);
  });

  test("My listings tags where a listing is sold and how many are left", () => {
    const base = { on_shop: true, resale: { enabled: false, discount_bps: null, markup_max_bps: null, paused: false }, stock: 1, status: "active" as const };
    expect(listingChannelTags(base)).toEqual([]);
    expect(listingChannelTags({ ...base, resale: { ...base.resale, enabled: true }, stock: 3 })).toEqual(["Resellers", "3 left"]);
    expect(listingChannelTags({ ...base, on_shop: false, resale: { ...base.resale, enabled: true } })).toEqual(["Resellers only"]);
    expect(listingChannelTags({ ...base, resale: { ...base.resale, enabled: true, paused: true }, stock: 2, status: "sold" })).toEqual(["Resellers paused"]);
  });
});

describe("amounts and the description's toolbar", () => {
  test("prices typed in naira become kobo; anything else is refused", () => {
    expect(toMinor("520,000")).toBe(52_000_000);
    expect(toMinor(" 1500.5 ")).toBe(150_050);
    for (const bad of ["", "0", "-5", "1.234", "5e3", "₦500", "12345678901234"]) expect(toMinor(bad), bad).toBeNull();
    expect(fromMinor(52_000_000)).toBe("520,000");
    expect(fromMinor(150_050)).toBe("1,500.50");
    expect(fromMinor(null)).toBe("");
  });

  test("bold and italic wrap the selection (or a placeholder); lists toggle every line touched", () => {
    expect(wrapSelection("Clean phone", 6, 11, "**")).toEqual({ text: "Clean **phone**", start: 8, end: 13 });
    expect(wrapSelection("Clean ", 6, 6, "*").text).toBe("Clean *text*");
    const listed = toggleList("Box\nCable\nCharger", 1, 8, "ul");
    expect(listed.text).toBe("- Box\n- Cable\nCharger");
    expect(toggleList(listed.text, 0, listed.end, "ul").text).toBe("Box\nCable\nCharger");
    expect(toggleList("- Box\n- Cable", 0, 12, "ol").text).toBe("1. Box\n2. Cable");
  });

  test("feature values in the type the registry stores", () => {
    expect(featureValue({ data_type: "number", choices: [] }, "1,024")).toBe(1024);
    expect(featureValue({ data_type: "number", choices: [] }, "lots")).toBeNull();
    expect(featureValue({ data_type: "boolean", choices: [] }, true)).toBe(true);
    expect(featureValue({ data_type: "boolean", choices: [] }, "")).toBe(false);
    expect(featureValue({ data_type: "choice", choices: ["Black", "Blue"] }, "Blue")).toBe("Blue");
    expect(featureValue({ data_type: "choice", choices: ["Black", "Blue"] }, "Pink")).toBeNull();
    expect(featureValue({ data_type: "text", choices: [] }, "  Apple ")).toBe("Apple");
    expect(featureValue({ data_type: "text", choices: [] }, "   ")).toBeNull();
  });

  test("private photos are read through this site, never straight from the API", () => {
    expect(localPhotoUrl(`/v1/classifieds/conversations/${listing}/photos/${order}`)).toBe(`/api/account/chats/${listing}/photos/${order}`);
    expect(localPhotoUrl(`/v1/classifieds/orders/${order}/dispute/photos/${listing}`)).toBe(`/api/account/orders/${order}/dispute/photos/${listing}`);
    expect(localPhotoUrl(`/v1/classifieds/orders/${order}/dispatch-photos/${listing}`)).toBe(`/api/account/orders/${order}/dispatch-photos/${listing}`);
    expect(localPhotoUrl(`/v1/store/resale/orders/${order}/dispatch-photos/${listing}`)).toBe(`/api/purchases/${order}/dispatch-photos/${listing}`);
    expect(localPhotoUrl("https://evil.example/x.jpg")).toBeNull();
    expect(localPhotoUrl(`/v1/classifieds/conversations/../photos/${order}`)).toBeNull();
  });
});

describe("listings and orders", () => {
  test("each listing state offers what the API allows", () => {
    expect(listingActions({ status: "draft", url: null })).toEqual(["edit", "delete"]);
    expect(listingActions({ status: "active", url: "https://shop.bitocard.com/ng/l/100001-tv" })).toEqual(["edit", "sold", "view", "delete"]);
    expect(listingActions({ status: "expired", url: null })).toEqual(["renew", "delete"]);
    expect(listingActions({ status: "removed", url: null })).toEqual([]);
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(listingMeta({ status: "active", views: 96, leads: 1, expires_at: "2026-11-21T12:00:00Z", updated_at: "", photos: [] }, now)).toBe("96 views · 1 lead · expires in 27 days");
    expect(listingMeta({ status: "draft", views: 0, leads: 0, expires_at: null, updated_at: "", photos: [{ id: "a", url: "", width: 1, height: 1, status: "ready" }] }, now)).toBe("1 photo · not posted yet");
  });

  const make = (patch: Partial<ShopOrder>): ShopOrder =>
    ({
      object: "classified_order",
      id: order,
      number: "SP-100001",
      role: "buyer",
      status: "requested",
      listing: { id: listing, ref: 100001, title: "TV", slug: "tv", cover_url: null },
      with: { name: "Kemi A." },
      fulfilment: "meet_up",
      currency: "NGN",
      price: 100,
      refund: null,
      delivery_address: null,
      tracking_note: null,
      deadlines: { accept_by: "2026-10-26T10:00:00Z", pay_by: null, handover_by: null, confirm_by: null },
      timeline: { requested_at: "2026-10-25T10:00:00Z", accepted_at: null, paid_at: null, sent_at: null, released_at: null, refunded_at: null, closed_at: null },
      ended_by: null,
      end_reason: null,
      ...patch,
    }) as ShopOrder;

  test("what each side can do, by state and hand-over", () => {
    expect(orderActions(make({}))).toEqual(["cancel"]);
    expect(orderActions(make({ role: "seller" }))).toEqual(["accept", "decline"]);
    expect(orderActions(make({ status: "awaiting_payment" }))).toEqual(["pay", "cancel"]);
    expect(orderActions(make({ status: "paid" }))).toEqual(["release_code", "cancel", "dispute"]);
    expect(orderActions(make({ status: "paid", role: "seller" }))).toEqual(["enter_code", "cancel"]);
    expect(orderActions(make({ status: "paid", fulfilment: "delivery", role: "seller" }))).toEqual(["sent", "cancel"]);
    expect(orderActions(make({ status: "sent", fulfilment: "delivery" }))).toEqual(["received", "dispute"]);
    expect(orderActions(make({ status: "sent", fulfilment: "delivery", role: "seller" }))).toEqual(["shipment"]);
    expect(orderActions(make({ status: "sent", fulfilment: "delivery", role: "seller", shipment: { courier: "GIG", tracking_number: "1", tracking_url: null, delivered_at: "x", events: [], dispatch_photos: [] } }))).toEqual([]);
    // A resale order starts paid and locked: the supplier answers, the buyer may cancel.
    expect(orderActions(make({ status: "locked", kind: "resale" }))).toEqual(["cancel"]);
    expect(orderActions(make({ status: "locked", kind: "resale", role: "seller" }))).toEqual(["accept", "decline"]);
    for (const status of ["released", "refunded", "disputed", "cancelled"] as const) expect(orderActions(make({ status }))).toEqual([]);
  });

  test("the next step is said from the reader's side, and progress marks where the order is", () => {
    expect(orderNext(make({ status: "paid" }))).toBe("Meet Kemi A., check it, then give your release code.");
    expect(orderNext(make({ status: "paid", role: "seller" }))).toBe("Meet Kemi A. and enter their release code.");
    expect(orderNext(make({ status: "refunded" }))).toBe("Refunded to your wallet.");
    const steps = orderSteps(make({ status: "awaiting_payment", timeline: { requested_at: "a", locked_at: null, accepted_at: "b", paid_at: null, sent_at: null, released_at: null, refunded_at: null, closed_at: null } }));
    expect(steps.map(step => step.state)).toEqual(["done", "done", "now", "later", "later"]);
    expect(orderSteps(make({ status: "cancelled" })).map(step => step.state)).toEqual(["done", "later", "later", "later", "later"]);
    expect(orderSteps(make({ fulfilment: "delivery" })).map(step => step.title)).toEqual(["Requested", "Accepted by Kemi A.", "Paid: Udozo is holding it", "Shipped", "Delivered", "Released to the seller"]);
    const resale = make({ kind: "resale", role: "seller", status: "locked", store: { id: "s", name: "Gadget Hub", subdomain: "gadgets", logo_url: null }, timeline: { requested_at: "a", locked_at: "a", accepted_at: null, paid_at: null, sent_at: null, released_at: null, refunded_at: null, closed_at: null } });
    expect(orderSteps(resale).map(step => [step.title, step.state])).toEqual([
      ["Bought on Gadget Hub", "done"],
      ["You accepted: Udozo is holding it", "now"],
      ["Met and checked", "later"],
      ["Paid to you", "later"],
    ]);
    expect(orderNext(resale)).toMatch(/^Paid and waiting: accept or decline by /);
  });
});

describe("the account's places", () => {
  const none = { unread: 0, resellers: { count: 0, waiting: 0 } };

  test("listings, messages, orders, favourites, the wallet, Safe pay, payouts and the profile; Messages badged with its unread count", () => {
    const places = accountPlaces({ ...none, unread: 3 });
    expect(places.map(place => place.label)).toEqual(["My listings", "Messages", "Orders", "Favourites", "Wallet", "Safe pay", "Payouts", "Profile"]);
    expect(places.find(place => place.label === "Messages")?.badge).toBe(3);
    expect(places.map(place => place.href)).toEqual(["/account", "/account/messages", "/account/orders", "/account/favourites", "/account/wallet", "/account/safe-pay", "/account/payouts", "/account/profile"]);
  });

  test("the current place follows the address: a listing, a chat or an order keeps its place; /account only for itself", () => {
    const places = accountPlaces(none);
    expect(currentPlace(places, "/account")).toBe("/account");
    expect(currentPlace(places, `/account/listings/${listing}`)).toBe("/account");
    expect(currentPlace(places, `/account/messages/${listing}`)).toBe("/account/messages");
    expect(currentPlace(places, `/account/orders/${order}?x=1`)).toBe("/account/orders");
    expect(currentPlace(places, "/account/wallet/transactions")).toBe("/account/wallet");
    expect(currentPlace(places, "/account/verification")).toBe("/account/profile");
    expect(currentPlace(places, "/sell")).toBeNull();
    expect(currentPlace(places, "/account-other")).toBeNull();
  });

  test("My Resellers shows once resellers carry the supplier's listings, badged with what waits there", () => {
    expect(accountPlaces(none).map(place => place.label)).not.toContain("My Resellers");
    const places = accountPlaces({ unread: 0, resellers: { count: 2, waiting: 3 } });
    expect(places.map(place => place.label)).toEqual(["My listings", "Messages", "Orders", "Favourites", "My Resellers", "Wallet", "Safe pay", "Payouts", "Profile"]);
    expect(places.find(place => place.label === "My Resellers")?.badge).toBe(3);
    expect(currentPlace(places, `/account/resellers/${listing}`)).toBe("/account/resellers");
  });
});

describe("the seller's links and market", () => {
  test("a listing's public page is its path on this site; only listing addresses are followed", () => {
    expect(listingHref("https://udozo.com/ng/l/100001-lg-55-tv")).toBe("/ng/l/100001-lg-55-tv");
    expect(listingHref("https://evil.example/ng/l/100001-tv?x=1")).toBe("/ng/l/100001-tv");
    expect(listingHref("https://udozo.com/admin")).toBeNull();
    expect(listingHref(null)).toBeNull();
  });

  test("the seller's market is their own fixed country, where Udozo is open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ object: "list", data: [nigeria], showcase: false })));
    expect(await marketOf({ country: "NG" })).toMatchObject({ country: "NG", currency: "NGN" });
    expect(await marketOf({ country: "GH" })).toBeNull();
    expect(await marketOf({ country: null })).toBeNull();
    expect(await marketOf(null)).toBeNull();
  });

  test("the badges come from the unread counts; nothing to show while the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ unread: 4, resellers: 2, resellers_waiting: 1 })));
    expect(await accountCounts()).toEqual({ unread: 4, resellers: { count: 2, waiting: 1 } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await accountCounts()).toEqual({ unread: 0, resellers: { count: 0, waiting: 0 } });
  });
});

describe("Shop actions", () => {
  test("listing fields: the price typed in naira is sent in kobo, blanks clear, and bad prices never leave", async () => {
    const fetch = vi.fn(async () => reply({ object: "classified_listing", id: listing }));
    vi.stubGlobal("fetch", fetch);
    expect((await actions.updateListing(listing, { title: " LG 55 inch TV ", price: "250,000", description: "", features: [{ key: "brand", value: "LG" }, { key: "size", value: null }] })).ok).toBe(true);
    const [call] = fetch.mock.calls as unknown as Call[];
    expect([call[0], call[1].method]).toEqual([`http://api.test/v1/classifieds/listings/${listing}`, "PATCH"]);
    expect(JSON.parse(String(call[1].body))).toEqual({ title: "LG 55 inch TV", price: 25_000_000, description: null, features: [{ key: "brand", value: "LG" }] });
    expect(call[1].headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(await actions.updateListing(listing, { price: "lots" })).toMatchObject({ ok: false, param: "price" });
    expect(await actions.updateListing("../admin", { title: "x" })).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("where it is sold, its resale terms and stock go to the API as given (B2B reselling)", async () => {
    const fetch = vi.fn(async () => reply({ object: "classified_listing", id: listing }));
    vi.stubGlobal("fetch", fetch);
    await actions.updateListing(listing, { on_shop: false, resale: true, resale_discount_bps: 1000, resale_markup_max_bps: 3000, stock: 4 });
    const [call] = fetch.mock.calls as unknown as Call[];
    expect(JSON.parse(String(call[1].body))).toEqual({ on_shop: false, resale: true, resale_discount_bps: 1000, resale_markup_max_bps: 3000, stock: 4 });
  });

  test("delivery charges go in minor units (empty is free), with pickup; a charge that is not an amount stays here", async () => {
    const fetch = vi.fn(async () => reply({ object: "classified_listing", id: listing }));
    vi.stubGlobal("fetch", fetch);
    await actions.updateListing(listing, { delivery: "nationwide", delivery_fee_state: "2,000", delivery_fee_nationwide: "", pickup: false });
    const [call] = fetch.mock.calls as unknown as Call[];
    expect(JSON.parse(String(call[1].body))).toEqual({ delivery: "nationwide", delivery_fee_state: 200000, delivery_fee_nationwide: 0, pickup: false });
    expect(await actions.updateListing(listing, { delivery_fee_state: "a lot" })).toMatchObject({ ok: false, param: "delivery_fee_state" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("the video link points at the API itself; an ended session asks to sign in again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ object: "classified_video_upload", listing_id: listing, path: `/v1/classifieds/video-uploads/bcv_up_x`, expires_at: "" })));
    expect(await actions.videoUploadUrl(listing)).toEqual({ ok: true, data: { url: "http://api.test/v1/classifieds/video-uploads/bcv_up_x" } });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "not_authenticated", message: "Sign in." } }, 401)));
    expect(await actions.videoUploadUrl(listing)).toMatchObject({ ok: false, signIn: true, message: "Sign in again to carry on." });
  });

  test("order steps carry only their own fields; the release code is six digits", async () => {
    const fetch = vi.fn(async () => reply({ object: "classified_order", id: order }));
    vi.stubGlobal("fetch", fetch);
    // Shipping names the courier and tracking number; neither missing is sent.
    expect(await actions.orderStep(order, "sent", { tracking_number: "GIG1" })).toMatchObject({ ok: false, param: "courier" });
    expect(await actions.orderStep(order, "sent", { courier: "GIG Logistics" })).toMatchObject({ ok: false, param: "tracking_number" });
    await actions.orderStep(order, "sent", { courier: " GIG Logistics ", tracking_number: " GIG1 ", tracking_note: " Waybill ", reason: "ignored" });
    await actions.orderStep(order, "pay", { nonce: "pay-nonce-1234" });
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => [call[0], JSON.parse(String(call[1].body))])).toEqual([
      [`http://api.test/v1/classifieds/orders/${order}/sent`, { courier: "GIG Logistics", tracking_number: "GIG1", tracking_note: "Waybill" }],
      [`http://api.test/v1/classifieds/orders/${order}/pay`, {}],
    ]);
    expect(calls[1]![1].headers["idempotency-key"]).toBe("pay-nonce-1234");
    expect(revalidatePath).toHaveBeenCalledWith(`/account/orders/${order}`);
    expect(await actions.enterReleaseCode(order, "12345")).toMatchObject({ ok: false, param: "code" });
    expect(await actions.orderStep(order, "release" as never)).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("disputes need a few words; offers are typed in naira", async () => {
    const fetch = vi.fn(async () => reply({ object: "classified_message", id: "m1" }));
    vi.stubGlobal("fetch", fetch);
    expect(await actions.openDispute(order, "damaged", "bad")).toMatchObject({ ok: false, param: "details" });
    await actions.makeOffer(order, "490,000");
    expect(JSON.parse(String((fetch.mock.calls as unknown as Call[])[0]![1].body))).toEqual({ price: 49_000_000 });
    expect(await actions.makeOffer(order, "cheap")).toMatchObject({ ok: false });
  });
});

describe("the shop assistant for sellers", () => {
  test("offered where the country's assistant helps sellers, never otherwise", async () => {
    const { sellerAssistant: shopAssistant } = await import("@/lib/account");
    const fetch = vi.fn(async (url: string) => reply({ object: "shop_assistant", assistant: url.includes("country=NG") ? { name: "Anjio", roles: ["browse", "sell"] } : url.includes("country=GH") ? { name: "Kofi", roles: ["browse"] } : null, languages: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await shopAssistant("NG")).toEqual({ name: "Anjio" });
    expect(await shopAssistant("GH")).toBeNull();
    expect(await shopAssistant("KE")).toBeNull();
    expect((fetch.mock.calls as unknown as Call[])[0]![0]).toBe("http://api.test/v1/classifieds/assistant?country=NG&surface=sell");
  });

  test("suggestions name the listing or the chat they are for; nothing leaves without one", async () => {
    const fetch = vi.fn(async () => reply({ object: "assistant_suggestion", kind: "draft", message_id: "m1", suggestion: null }));
    vi.stubGlobal("fetch", fetch);
    await actions.assistantSuggestion("draft", { listingId: listing });
    await actions.assistantSuggestion("reply", { conversationId: order });
    expect((fetch.mock.calls as unknown as Call[]).map(call => [call[0], JSON.parse(String(call[1].body))])).toEqual([
      ["http://api.test/v1/classifieds/assistant/suggestions", { kind: "draft", listing_id: listing }],
      ["http://api.test/v1/classifieds/assistant/suggestions", { kind: "reply", conversation_id: order }],
    ]);
    expect(await actions.assistantSuggestion("price", {})).toMatchObject({ ok: false });
    expect(await actions.assistantSuggestion("reply", { listingId: listing })).toMatchObject({ ok: false });
    expect(await actions.assistantSuggestion("improve", { listingId: "../x" })).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("the Udozo terms: read, then accepted by the version shown; anything else never leaves", async () => {
    const status = { object: "classified_terms", version: "2026-10-25", path: "/documents/shop-terms", accepted: false, accepted_at: null, previous_version: null };
    const fetch = vi.fn(async () => reply(status));
    vi.stubGlobal("fetch", fetch);
    expect(await actions.shopTerms()).toMatchObject({ version: "2026-10-25", accepted: false });
    expect(await actions.acceptShopTerms("2026-10-25")).toMatchObject({ ok: true });
    expect(await actions.acceptShopTerms("latest")).toMatchObject({ ok: false });
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => [call[0], call[1].method])).toEqual([
      ["http://api.test/v1/classifieds/terms", "GET"],
      ["http://api.test/v1/classifieds/terms/accept", "POST"],
    ]);
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ version: "2026-10-25" });
    expect(calls[1][1].headers["bitocard-customer-session"]).toBe("bcc_session");
  });
});

describe("photos through this site", () => {
  const form = (fields: Record<string, Blob | string>) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return body;
  };

  test("only this site's pages may send them; the file goes on with the session", async () => {
    const fetch = vi.fn(async () => reply({ object: "classified_media", id: "p1" }, 201));
    vi.stubGlobal("fetch", fetch);
    const elsewhere = new Request("https://ng.bitocard.com/api/account/listings/x/photos", { method: "POST", headers: { "sec-fetch-site": "cross-site" }, body: form({ file: new Blob(["x"], { type: "image/jpeg" }) }) });
    expect((await forwardPhoto(elsewhere, `/v1/classifieds/listings/${listing}/photos`)).status).toBe(403);
    const ours = new Request("https://ng.bitocard.com/api/account/listings/x/photos", { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: form({ file: new Blob(["jpeg"], { type: "image/jpeg" }), body: "caption" }) });
    const res = await forwardPhoto(ours, `/v1/classifieds/listings/${listing}/photos`);
    expect(res.status).toBe(201);
    const [call] = fetch.mock.calls as unknown as Call[];
    expect(call[0]).toBe(`http://api.test/v1/classifieds/listings/${listing}/photos`);
    expect(call[1].headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(call[1].headers["content-type"]).toBeUndefined();
    const sent = call[1].body as FormData;
    expect(sent.get("file")).toBeInstanceOf(Blob);
    expect(sent.has("caption"), "a listing photo carries no caption").toBe(false);
  });

  test("chat photos keep their caption; a dispute message may be words alone", async () => {
    const fetch = vi.fn(async () => reply({ id: "m1" }));
    vi.stubGlobal("fetch", fetch);
    const send = (fields: Record<string, Blob | string>) => new Request("https://ng.bitocard.com/api/x", { method: "POST", body: form(fields) });
    await forwardPhoto(send({ file: new Blob(["jpeg"], { type: "image/jpeg" }), body: "The scratch" }), `/v1/classifieds/conversations/${listing}/photos`, { caption: true });
    await forwardPhoto(send({ body: "It does not start" }), `/v1/classifieds/orders/${order}/dispute/messages`, { caption: true });
    expect((await forwardPhoto(send({ body: "No photo" }), `/v1/classifieds/conversations/${listing}/photos`, { caption: true })).status).toBe(400);
    const calls = fetch.mock.calls as unknown as Call[];
    expect((calls[0]![1].body as FormData).get("caption")).toBe("The scratch");
    expect((calls[1]![1].body as FormData).get("body")).toBe("It does not start");
    expect(calls).toHaveLength(2);
  });
});

describe("private photos read back", () => {
  test("theirs comes back unchanged and never cached; signed out or not theirs is not found; an unreachable API is a 502", async () => {
    const { servePhoto } = await import("@/lib/shop-files");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("jpeg-bytes", { status: 200, headers: { "content-type": "image/jpeg" } })));
    const ok = await servePhoto(`/v1/classifieds/conversations/${listing}/photos/${order}`);
    expect([ok.status, ok.headers.get("content-type"), ok.headers.get("cache-control"), await ok.text()]).toEqual([200, "image/jpeg", "no-store, private", "jpeg-bytes"]);
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    for (const status of [401, 403, 404]) {
      vi.stubGlobal("fetch", vi.fn(async () => reply({ error: {} }, status)));
      expect((await servePhoto(`/v1/classifieds/conversations/${listing}/photos/${order}`)).status).toBe(404);
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect((await servePhoto(`/v1/classifieds/conversations/${listing}/photos/${order}`)).status).toBe(502);
  });
});
