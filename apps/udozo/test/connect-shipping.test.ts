// Shipping a listing through Udozo Connect on udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 4): what Post an ad offers
// and saves, the line buyers read on the listing page, and the shipping in its structured data.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopListingPage, ShopMyListing } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";
import type { ConnectCentre } from "@/lib/connect-centres";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { centresWithin, connectChoiceOf, connectLine, connectStateOptions, connectStatesField, connectSummary } = await import("@/lib/connect-shipping");
const { listingJsonLd } = await import("@/lib/seo");
const actions = await import("@/lib/shop-actions");

const lagos = { id: "s-lagos", name: "Lagos", slug: "lagos" };
const fct = { id: "s-fct", name: "Abuja (FCT)", slug: "abuja" };
const kano = { id: "s-kano", name: "Kano", slug: "kano" };
const centre = (id: string, state: typeof lagos): ConnectCentre => ({ object: "connect_centre", id, number: "CC-000001", name: id, state, area: { id: `${id}-a`, name: "Area", slug: "area" }, address: "1 Road", landmark: null, latitude: null, longitude: null, hours: "8am to 6pm", phone: "0803", photo: null });
const centres = [centre("ikeja", lagos), centre("allen", lagos), centre("wuse", fct)];
const saved = { connect: { enabled: true, states: [{ state: lagos, shipping: 150000 }, { state: kano, shipping: 0 }], all_centres: false, centres: [{ id: "ikeja", number: "CC-000001", name: "Ikeja", state_id: lagos.id, active: true }] } } as unknown as ShopMyListing;

describe("Post an ad's choice", () => {
  test("reads a saved listing's states, charges as typed, and chosen centres", () => {
    expect(connectChoiceOf(saved)).toEqual({ enabled: true, charges: { "s-lagos": "1,500", "s-kano": "" }, all: false, centres: ["ikeja"] });
    expect(connectChoiceOf(null)).toEqual({ enabled: false, charges: {}, all: true, centres: [] });
  });

  test("offers the states with an open centre, and keeps a ticked one without any so it can be unticked", () => {
    expect(connectStateOptions(centres, saved).map(option => [option.name, option.centres.length])).toEqual([["Abuja (FCT)", 1], ["Kano", 0], ["Lagos", 2]]);
  });

  test("unticking a state lets its chosen centres go; the summary counts the states", () => {
    const options = connectStateOptions(centres, null);
    expect(centresWithin({ enabled: true, charges: { "s-fct": "" }, all: false, centres: ["ikeja", "wuse"] }, options)).toEqual(["wuse"]);
    expect(connectStatesField({ enabled: true, charges: { "s-lagos": "1,500" }, all: true, centres: [] })).toEqual([{ state_id: "s-lagos", shipping: "1,500" }]);
    expect(connectSummary({ enabled: true, charges: { a: "", b: "" }, all: true, centres: [] })).toBe("Ships through Udozo Connect to 2 states");
    expect(connectSummary({ enabled: true, charges: {}, all: true, centres: [] })).toBe("Ships through Udozo Connect: choose the states");
    expect(connectSummary({ enabled: false, charges: { a: "" }, all: true, centres: [] })).toBeNull();
  });
});

describe("saving it", () => {
  beforeEach(() => {
    vi.stubEnv("API_URL", "http://api.test");
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("charges go in minor units (empty is free); a charge that is not an amount stays here, naming its state", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "classified_listing", id: "l1" })));
    vi.stubGlobal("fetch", fetch);
    const id = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
    await actions.updateListing(id, { connect: true, connect_states: [{ state_id: "s-lagos", shipping: "1,500" }, { state_id: "s-fct", shipping: "" }], connect_centres: null });
    const [call] = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(call![1].body))).toEqual({ connect: true, connect_states: [{ state_id: "s-lagos", shipping: 150000 }, { state_id: "s-fct", shipping: 0 }], connect_centres: null });
    expect(await actions.updateListing(id, { connect_states: [{ state_id: "s-lagos", shipping: "a lot" }] })).toMatchObject({ ok: false, param: "connect_states[0].shipping" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("what buyers read", () => {
  test("the states it ships to, one charge said once or each state's own", () => {
    expect(connectLine(null, "NGN")).toBeNull();
    expect(connectLine({ states: [] }, "NGN")).toBeNull();
    expect(connectLine({ states: [{ ...lagos, shipping: 150000, centres: 2 }, { ...fct, shipping: 150000, centres: 1 }] }, "NGN")).toEqual({ title: "Ship to a Udozo Connect Centre", body: "Lagos, Abuja (FCT): ₦1,500." });
    expect(connectLine({ states: [{ ...lagos, shipping: 0, centres: 2 }, { ...fct, shipping: 250000, centres: 1 }] }, "NGN")?.body).toBe("Lagos free shipping · Abuja (FCT) ₦2,500");
  });

  test("its structured data says where it ships and what it costs", () => {
    const page = {
      ref: 100001,
      slug: "tv",
      status: "active",
      title: "Samsung TV",
      description: null,
      price: { kind: "fixed", amount: 25000000, currency: "NGN" },
      condition: null,
      category: { name: "TVs", parent: null },
      area: { name: "Ikeja", state: { name: "Lagos" } },
      features: [],
      photos: [],
      seller: { name: "Chinedu O." },
      in_stock: true,
      reserved: false,
      connect: { states: [{ ...lagos, shipping: 150000, centres: 2 }] },
    } as unknown as ShopListingPage;
    const offer = (listingJsonLd(page, "https://udozo.com", "ng") as { offers: { shippingDetails: unknown } }).offers;
    expect(offer.shippingDetails).toEqual([
      { "@type": "OfferShippingDetails", shippingRate: { "@type": "MonetaryAmount", value: "1500.00", currency: "NGN" }, shippingDestination: { "@type": "DefinedRegion", addressCountry: "NG", addressRegion: "Lagos" } },
    ]);
    expect("shippingDetails" in (listingJsonLd({ ...page, connect: null }, "https://udozo.com", "ng") as { offers: object }).offers).toBe(false);
  });
});
