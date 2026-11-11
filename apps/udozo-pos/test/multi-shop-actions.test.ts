// pos.udozo.com's actions for several shops and yearly billing (milestone 8): what each sends Udozo, and what is
// refused before asking.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const actions = await import("@/lib/pos-actions");

const ikeja = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const lekki = "2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const tv = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const sent: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];

beforeEach(() => {
  sent.length = 0;
  setRequest({}, { udz_pos: "bcc_owner" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    sent.push({ method: init.method ?? "GET", url: url.replace("https://api.udozo.test", ""), headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ object: "ok" });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("several shops", () => {
  it("opens a shop, chooses main and online, and moves stock", async () => {
    await actions.addShop(" Lekki shop ");
    await actions.chooseShop(lekki, "main");
    await actions.chooseShop(lekki, "fulfils_online");
    await actions.moveStock({ from: ikeja, to: null, lines: [{ listing_id: tv, quantity: 2 }], note: " Weekend " });
    expect(sent.map(call => [call.method, call.url, call.body])).toEqual([
      ["POST", "/v1/pos/owner/shops", { name: "Lekki shop" }],
      ["PATCH", `/v1/pos/owner/shops/${lekki}`, { main: true }],
      ["PATCH", `/v1/pos/owner/shops/${lekki}`, { fulfils_online: true }],
      ["POST", "/v1/pos/owner/stock-transfers", { from_shop_id: ikeja, to_shop_id: null, lines: [{ listing_id: tv, quantity: 2 }], note: "Weekend" }],
    ]);
  });

  it("a stock keeper moves stock through the staff routes; a change of stock names its shop", async () => {
    setRequest({}, { udz_pos_staff: "ups_keeper" });
    await actions.moveStock({ from: lekki, to: ikeja, lines: [{ listing_id: tv, quantity: 1 }] });
    await actions.adjustStock(tv, "count", 4, "", null, lekki);
    expect(sent.map(call => [call.url, call.headers["udozo-pos-session"]])).toEqual([
      ["/v1/pos/staff/stock-transfers", "ups_keeper"],
      [`/v1/pos/staff/stock/${tv}`, "ups_keeper"],
    ]);
    expect(sent[1]!.body).toEqual({ kind: "count", quantity: 4, shop_id: lekki });
  });

  it("refuses what Udozo would refuse, without asking", async () => {
    expect(await actions.addShop(" ")).toMatchObject({ ok: false, param: "name" });
    expect(await actions.chooseShop("nope", "main")).toMatchObject({ ok: false });
    expect(await actions.moveStock({ from: ikeja, to: ikeja, lines: [{ listing_id: tv, quantity: 1 }] })).toMatchObject({ ok: false, param: "to_shop_id" });
    expect(await actions.moveStock({ from: ikeja, to: lekki, lines: [{ listing_id: tv, quantity: 0 }] })).toMatchObject({ ok: false, param: "lines" });
    expect(await actions.adjustStock(tv, "count", 1, "", null, "nope")).toMatchObject({ ok: false, param: "shop_id" });
    expect(sent).toHaveLength(0);
  });
});

describe("monthly or yearly", () => {
  it("changing plan and signing up say the interval; monthly is the default", async () => {
    await actions.changePlan("premium", "year");
    await actions.changePlan("free");
    await actions.signUp("premium", { name: "Ikeja shop" }, 15_000_000, "year");
    expect(sent.map(call => call.body)).toEqual([{ plan: "premium", interval: "year" }, { plan: "free" }, expect.objectContaining({ plan: "premium", expected_amount: 15_000_000, interval: "year" })]);
    expect(await actions.changePlan("premium", "week" as never)).toMatchObject({ ok: false, param: "interval" });
  });
});
