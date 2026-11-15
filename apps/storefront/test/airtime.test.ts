// The airtime exchange on bitocard.com (docs/BITOCARD_AIRTIME_EXCHANGE_PLAN.md): the Mobile catalogue's four tiles,
// the pool everyone sees, and selling and buying (the price first, then paying exactly it).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StoreAirtimePool } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { MobileActions } = await import("@/components/app/mobile-actions");
const { HomeActions } = await import("@/components/app/home-actions");
const { AirtimePoolBoard } = await import("@/components/app/airtime/pool-board");
const { buyAirtime, startAirtimeSale } = await import("@/lib/airtime-actions");
const { BuyAirtimeForm, SellAirtimeForm, SendFromWarning } = await import("@/components/app/airtime/trade-forms");
const PhoneNumbers = (await import("@/components/store/phone-numbers")).PhoneNumbers;
const { buyerPays, chosenNetwork, nairaToMinor, sellerGets, timeLeft } = await import("@/lib/airtime-rules");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (call: Call) => JSON.parse(String(call[1].body));

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const network = (key: string, name: string, open: boolean, available = 0) => ({
  object: "airtime_network" as const,
  network: key,
  name,
  open,
  sell_rate_bps: 8000,
  buy_rate_bps: 8800,
  min_amount: 10_000,
  max_amount: 500_000,
  available,
  bought_total: 900_000,
  sold_total: 300_000,
  bought_24h: 200_000,
  sold_24h: 100_000,
});

const pool: StoreAirtimePool = {
  object: "airtime_pool",
  country: "NG",
  currency: "NGN",
  mode: "live",
  open: true,
  networks: [network("mtn", "MTN", true, 600_000), network("airtel", "Airtel", true, 5_000), network("9mobile", "9mobile", false)],
  totals: { available: 605_000, bought_total: 2_700_000, sold_total: 900_000, bought_24h: 600_000, sold_24h: 300_000 },
  updated_at: "2026-11-15T10:00:00.000Z",
};

describe("the Mobile catalogue's tiles", () => {
  test("airtime and data always; the exchange's two only as Soon until it is open", () => {
    const closed = renderToStaticMarkup(createElement(MobileActions, { exchangeOpen: false }));
    for (const label of ["Buy airtime", "Buy data", "Sell unused airtime", "Buy unused airtime"]) expect(closed).toContain(label);
    expect(closed).toContain('href="/account/topup"');
    expect(closed).toContain('href="/account/topup?kind=data"');
    expect(closed).not.toContain("/account/airtime");
    expect(closed.match(/Soon/g)).toHaveLength(2);

    const open = renderToStaticMarkup(createElement(MobileActions, { exchangeOpen: true }));
    expect(open).toContain('href="/account/airtime/sell"');
    expect(open).toContain('href="/account/airtime/buy"');
    expect(open).toContain('href="/account/airtime"');
    expect(open).not.toContain("Soon");
  });
});

describe("Home's airtime and data", () => {
  test("six equal actions, gift cards then airtime and data: three across on desktops, one sliding row on phones", () => {
    const closed = renderToStaticMarkup(createElement(HomeActions, { giftCards: undefined, sellOpen: false, topUpOpen: true, exchangeOpen: false }));
    expect(closed.match(/<li /g)).toHaveLength(6);
    expect(closed).toContain("lg:grid-cols-3");
    expect(closed).toContain("snap-x");
    for (const title of ["Buy airtime", "Buy data", "Sell unused airtime", "Buy unused airtime"]) expect(closed).toContain(title);
    expect(closed).toContain('href="/account/topup"');
    expect(closed).toContain('href="/account/topup?kind=data"');
    expect(closed).not.toContain('href="/account/airtime/sell"');
    expect(closed.match(/Soon/g)?.length).toBe(4);
    const open = renderToStaticMarkup(createElement(HomeActions, { giftCards: undefined, sellOpen: false, topUpOpen: true, exchangeOpen: true }));
    expect(open).toContain('href="/account/airtime/sell"');
    expect(open).toContain('href="/account/airtime/buy"');
    expect(open.match(/Soon/g)?.length).toBe(2);
  });
});

describe("the pool everyone sees", () => {
  test("each network's available amount, its last day and rates; buying only where enough is held", () => {
    const html = renderToStaticMarkup(createElement(AirtimePoolBoard, { pool, signedIn: true }));
    expect(html).toContain("₦6,050");
    expect(html).toContain("₦6,000");
    expect(html).toContain("80%");
    expect(html).toContain("88%");
    expect(html).toContain('href="/account/airtime/buy?network=mtn"');
    expect(html).not.toContain('href="/account/airtime/buy?network=airtel"');
    expect(html).toContain('href="/account/airtime/sell?network=airtel"');
    expect(html).not.toContain("network=9mobile");
    expect(html).toContain("Not open yet");
  });

  test("signed out, Sell and Buy go through sign-in first", () => {
    const html = renderToStaticMarkup(createElement(AirtimePoolBoard, { pool, signedIn: false }));
    expect(html).toContain(`href="/signin?next=${encodeURIComponent("/account/airtime/buy?network=mtn")}"`);
  });
});

describe("rules shared with the API", () => {
  test("sellers' share rounds down, buyers' price rounds up; naira typed in whole units", () => {
    expect(sellerGets(100_050, 8000)).toBe(80_040);
    expect(buyerPays(100_001, 8800)).toBe(88_001);
    expect([nairaToMinor("2,000"), nairaToMinor("₦500"), nairaToMinor("12.5"), nairaToMinor("")]).toEqual([200_000, 50_000, null, null]);
    expect(chosenNetwork(pool.networks, "airtel")?.network).toBe("airtel");
    expect(chosenNetwork(pool.networks, "nope")?.network).toBe("mtn");
    const now = Date.parse("2026-11-15T10:00:00Z");
    expect([timeLeft("2026-11-15T10:23:00Z", now), timeLeft("2026-11-15T09:59:00Z", now)]).toEqual(["23 minutes left", null]);
  });
});

describe("selling and buying", () => {
  test("a sale starts with the network and amount in kobo, then opens its page", async () => {
    const fetch = vi.fn(async () => reply({ object: "airtime_sale", id: "4f6a1c2e-1111-4222-8333-444455556666" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(startAirtimeSale({}, form({ network: "mtn", amount: "2,000" }))).rejects.toThrow("redirect:/account/airtime/sales/4f6a1c2e-1111-4222-8333-444455556666");
    const call = (fetch.mock.calls as unknown as Call[])[0];
    expect(call[0]).toBe("http://api.test/v1/store/airtime/sales");
    expect(bodyOf(call)).toEqual({ network: "mtn", amount: 200_000 });
    expect(await startAirtimeSale({}, form({ network: "mtn", amount: "20.5" }))).toEqual({ error: "Enter a whole amount in naira.", field: "amount" });
  });

  test("a sale names the confirmed number it is sent from", async () => {
    const fetch = vi.fn(async () => reply({ object: "airtime_sale", id: "4f6a1c2e-1111-4222-8333-444455556666" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(startAirtimeSale({}, form({ network: "mtn", amount: "1000", from_phone: "+2348031110009" }))).rejects.toThrow("redirect:");
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0])).toEqual({ network: "mtn", amount: 100_000, from_phone: "+2348031110009" });
  });

  test("buying asks the price first, then pays exactly that price", async () => {
    const quote = { object: "airtime_purchase_quote", network: "mtn", amount: 100_000, currency: "NGN", rate_bps: 8800, price: 88_000, phone: "+2348051234567", available: 600_000 };
    const fetch = vi.fn(async (_url: string, init: RequestInit) => (JSON.parse(String(init.body)).preview ? reply(quote) : reply({ object: "airtime_purchase", id: "9a6a1c2e-1111-4222-8333-444455556666" }, 201)));
    vi.stubGlobal("fetch", fetch);
    const first = await buyAirtime({}, form({ network: "mtn", amount: "1000", phone: "08051234567" }));
    expect(first.quote?.price).toBe(88_000);
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0])).toEqual({ network: "mtn", amount: 100_000, phone: "08051234567", preview: true });

    await expect(buyAirtime(first, form({ network: "mtn", amount: "1000", phone: "08051234567", expected: "88000" }))).rejects.toThrow("redirect:/account/airtime/purchases/9a6a1c2e-1111-4222-8333-444455556666");
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[1])).toEqual({ network: "mtn", amount: 100_000, phone: "08051234567", expected_price: 88_000 });
  });

  test("a changed price is shown without blaming a field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { type: "conflict_error", code: "price_changed", message: "The price changed. Check it and try again.", param: "expected_price" } }, 409)));
    expect(await buyAirtime({}, form({ network: "mtn", amount: "1000", phone: "08051234567", expected: "88000" }))).toEqual({ error: "The price changed. Check it and try again.", field: null });
  });
});

describe("confirmed numbers only", () => {
  const networks = [{ network: "mtn", name: "MTN", currency: "NGN", open: true, sell_rate_bps: 8000, buy_rate_bps: 8800, min_amount: 10_000, max_amount: 500_000, available: 600_000, bought_24h: 0, sold_24h: 0, bought_total: 0, sold_total: 0 }] as unknown as StoreAirtimePool["networks"];

  test("selling offers the customer's confirmed numbers and warns that airtime from any other is lost", () => {
    const html = renderToStaticMarkup(createElement(SellAirtimeForm, { networks, initial: "mtn", phones: ["+2348031110001", "+2348031110002"], currency: "NGN" }));
    expect(html).toContain("The number you send it from");
    expect(html).toContain("+2348031110002");
    expect(html).toContain('name="from_phone" value="+2348031110001"');
    expect(html).toContain("It is not refunded, it is lost, and it cannot be claimed.");
  });

  test("without a confirmed number, neither selling nor buying starts", () => {
    for (const component of [SellAirtimeForm, BuyAirtimeForm]) {
      const html = renderToStaticMarkup(createElement(component as typeof BuyAirtimeForm, { networks, initial: "mtn", phones: [], currency: "NGN", balance: 0 }));
      expect(html).toContain("Confirm my number");
      expect(html).not.toContain("See the price");
    }
  });

  test("buying sends only to one of the buyer's confirmed numbers", () => {
    const html = renderToStaticMarkup(createElement(BuyAirtimeForm, { networks, initial: "mtn", phones: ["+2348051234567"], currency: "NGN", balance: 0 }));
    expect(html).toContain('name="phone" value="+2348051234567"');
    expect(html).not.toContain('type="tel"');
  });

  test("a paused seller cannot start a sale; a new seller sees their lower limit; strikes are shown", () => {
    const seller = { object: "airtime_seller" as const, completed_sales: 0, strikes: 0, strike_limit: 3, paused: false, strikes_expire_at: null, sold_today: 0, networks: [{ network: "mtn", new_seller: true, established_after: 3, daily_limit: 500_000, seller_daily: 2_000_000 }] };
    const paused = renderToStaticMarkup(createElement(SellAirtimeForm, { networks, initial: "mtn", phones: ["+2348031110001"], currency: "NGN", seller: { ...seller, strikes: 3, paused: true } }));
    expect(paused).toContain("Selling airtime is paused on your account");
    expect(paused).not.toContain("Get the number to send to");
    const fresh = renderToStaticMarkup(createElement(SellAirtimeForm, { networks, initial: "mtn", phones: ["+2348031110001"], currency: "NGN", seller }));
    expect(fresh).toContain("As a new seller you can sell up to ₦5,000");
    expect(fresh).toContain("until 3 of your sales are complete");
    const struck = renderToStaticMarkup(createElement(SellAirtimeForm, { networks, initial: "mtn", phones: ["+2348031110001"], currency: "NGN", seller: { ...seller, strikes: 1 } }));
    expect(struck).toContain("You have 1 of 3 strikes");
  });

  test("the warning names the number to send from", () => {
    expect(renderToStaticMarkup(createElement(SendFromWarning, { phone: "+2348031110001" }))).toContain("Send only from +2348031110001");
  });

  test("the profile lists up to five numbers, the default marked, the others to make default or remove", () => {
    const phones = {
      object: "list" as const,
      limit: 5,
      default: "+2348031230001",
      unconfirmed: null,
      data: [
        { object: "customer_phone" as const, phone: "+2348031230001", default: true, verified_at: "2026-11-15T10:00:00Z" },
        { object: "customer_phone" as const, phone: "+2348031230002", default: false, verified_at: "2026-11-15T10:00:00Z" },
      ],
    };
    const html = renderToStaticMarkup(createElement(PhoneNumbers, { phones, country: "NG", available: true }));
    expect(html).toContain("2 of 5");
    expect(html).toContain("Default");
    expect(html).toContain("Make default");
    expect(html).toContain("Add another number");
    const full = renderToStaticMarkup(createElement(PhoneNumbers, { phones: { ...phones, data: Array.from({ length: 5 }, (_, i) => ({ ...phones.data[1], phone: `+234803123000${i}`, default: i === 0 })) }, country: "NG", available: true }));
    expect(full).not.toContain("Add another number");
    expect(full).toContain("the most allowed");
  });
});
