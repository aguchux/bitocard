// pos.udozo.com's server side: Continue with Udozo goes through udozo.com's handoff (never a password here), the code
// is exchanged for a session in this site's own `udz_pos` cookie, each action calls its owner route with what was
// checked here first, and the public reads never throw.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const { continueSignIn } = await import("@/lib/handoff-actions");
const { GET: continueWithUdozo } = await import("@/app/(site)/signin/udozo/route");
const actions = await import("@/lib/pos-actions");
const { marketFor, posApps, publicPlans } = await import("@/lib/pos-data");
const { default: robots } = await import("@/app/robots");
const { default: sitemap } = await import("@/app/sitemap");
const { safeNext, siteOrigin } = await import("@/lib/site");
const { NextRequest } = await import("next/server");

const shop = "5e0d2a1b-9c8f-4d3e-8b7a-6f5e4d3c2b1a";
const till = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const sent: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = [];
let reply: () => Response = () => Response.json({ object: "pos_account" });

beforeEach(() => {
  sent.length = 0;
  reply = () => Response.json({ object: "pos_account" });
  setRequest({}, { udz_pos: "bcc_owner" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubEnv("POS_URL", "https://pos.udozo.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    sent.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> });
    return reply();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const path = (index = 0) => sent[index]!.url.replace("https://api.udozo.test", "");

describe("signing in", () => {
  it("sends Continue with Udozo to udozo.com's handoff, naming this site and where to land", () => {
    const res = continueWithUdozo(new NextRequest("https://pos.udozo.test/signin/udozo?next=/app/billing"));
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://udozo.test/handoff/go");
    expect(to.searchParams.get("to")).toBe("https://pos.udozo.test");
    expect(to.searchParams.get("next")).toBe("/app/billing");
    const away = new URL(continueWithUdozo(new NextRequest("https://pos.udozo.test/signin/udozo?next=//evil.example")).headers.get("location")!);
    expect(away.searchParams.get("next")).toBe("/app");
  });

  it("exchanges the code once for a session in udz_pos, landing on the POS", async () => {
    setRequest({});
    reply = () => Response.json({ customer: { id: "c1" }, session: { token: "bcc_new" } });
    const code = `bch_${"a".repeat(40)}`;
    expect(await continueSignIn(code, "")).toEqual({ ok: true, next: "/app" });
    expect(path()).toBe("/v1/store/account/handoff/exchange");
    expect(sent[0]!.body).toEqual({ code, origin: "https://pos.udozo.test" });
    expect(request.cookies.get("udz_pos")).toBe("bcc_new");
    expect(request.set.at(-1)!.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
    expect(await continueSignIn("nope", "/app")).toEqual({ ok: false, unreachable: false });
    expect(sent).toHaveLength(1);
  });

  it("follows only this site's own paths", () => {
    expect(safeNext("/app/setup")).toBe("/app/setup");
    expect(safeNext("https://evil.example")).toBe("/app");
    expect(safeNext("/\t/evil.example")).toBe("/app");
    expect(siteOrigin()).toBe("https://pos.udozo.test");
  });
});

describe("the owner's actions", () => {
  it("signs up with the shop, the plan and what was shown due today", async () => {
    const result = await actions.signUp("premium", { name: " Ada's Gadget Hub ", address: null, phone: "0803", tin: null, vat_bps: 750 }, 0);
    expect(result.ok).toBe(true);
    expect([sent[0]!.method, path()]).toEqual(["POST", "/v1/pos/owner/signup"]);
    expect(sent[0]!.body).toEqual({ plan: "premium", shop: { name: "Ada's Gadget Hub", address: null, phone: "0803", tin: null, vat_bps: 750 }, expected_amount: 0 });
    expect(sent[0]!.headers["bitocard-customer-session"]).toBe("bcc_owner");
    expect(sent[0]!.headers["idempotency-key"]).toBeTruthy();
  });

  it("refuses here, without asking Udozo, what Udozo would refuse", async () => {
    expect(await actions.signUp("gold", { name: "Shop" }, 0)).toMatchObject({ ok: false, param: "plan" });
    expect(await actions.signUp("free", { name: "  " }, 0)).toMatchObject({ ok: false, param: "shop.name" });
    expect(await actions.signUp("free", { name: "Shop", vat_bps: 6000 }, 0)).toMatchObject({ ok: false, param: "vat_bps" });
    expect(await actions.updateShop("../x", { name: "Shop" })).toMatchObject({ ok: false, code: "resource_missing" });
    expect(await actions.updateTill(till, { printer_width: 72 as 80 })).toMatchObject({ ok: false, param: "printer_width" });
    expect(await actions.changePlan("enterprise")).toMatchObject({ ok: false, param: "plan" });
    expect(sent).toHaveLength(0);
  });

  it("calls each owner route", async () => {
    await actions.changePlan("multi_shop");
    await actions.updateShop(shop, { address: " 12 Allen Avenue ", vat_bps: 0 });
    await actions.addTill(shop, " Counter 2 ");
    await actions.updateTill(till, { auto_print: true });
    await actions.removeTill(till);
    expect(sent.map((item, index) => [item.method, path(index), item.body])).toEqual([
      ["POST", "/v1/pos/owner/plan", { plan: "multi_shop" }],
      ["PATCH", `/v1/pos/owner/shops/${shop}`, { address: "12 Allen Avenue", vat_bps: 0 }],
      ["POST", `/v1/pos/owner/shops/${shop}/tills`, { name: "Counter 2" }],
      ["PATCH", `/v1/pos/owner/tills/${till}`, { auto_print: true }],
      ["DELETE", `/v1/pos/owner/tills/${till}`, undefined],
    ]);
  });

  it("passes Udozo's refusal on in words, and says when the session ended", async () => {
    reply = () => Response.json({ error: { code: "wallet_balance_low", message: "Your Udozo wallet needs NGN 15000.00 for this.", param: null } }, { status: 402 });
    expect(await actions.changePlan("premium")).toEqual({ ok: false, code: "wallet_balance_low", message: "Your Udozo wallet needs NGN 15000.00 for this.", param: null });
    reply = () => Response.json({ error: { code: "authentication_required", message: "Sign in." } }, { status: 401 });
    expect(await actions.addTill(shop, "")).toMatchObject({ ok: false, message: "Your session ended. Sign in again to carry on." });
  });

  it("signs out of this site only, then goes home", async () => {
    reply = () => Response.json({ object: "signed_out" });
    await expect(actions.signOut()).rejects.toMatchObject({ to: "/" });
    expect(path()).toBe("/v1/store/account/signout");
    expect(request.cookies.has("udz_pos")).toBe(false);
  });
});

describe("the public reads", () => {
  it("asks for a market's plans, and answers null or Coming soon when Udozo cannot answer", async () => {
    reply = () => Response.json({ object: "list", country: "NG", currency: "NGN", open: true, data: [] });
    expect((await publicPlans("NG"))?.currency).toBe("NGN");
    expect(path()).toBe("/v1/pos/plans?country=NG");
    await publicPlans("bad");
    expect(path(1)).toBe("/v1/pos/plans");
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await publicPlans("NG")).toBeNull();
    expect(await posApps()).toEqual({ object: "pos_apps", android: null, ios: null, windows: null });
  });

  it("prices for the owner's own country, else the one asked for, else Nigeria", () => {
    expect(marketFor("GH", "KE")).toBe("GH");
    expect(marketFor(null, "ke")).toBe("KE");
    expect(marketFor(undefined, "kenya")).toBe("NG");
    expect(marketFor(null, undefined)).toBe("NG");
  });
});

describe("search engines", () => {
  it("index the public pages only", () => {
    const rules = robots().rules as { allow: string[]; disallow: string[] };
    expect(rules.allow).toEqual(["/", "/pricing", "/download"]);
    expect(rules.disallow).toEqual(["/app", "/signin", "/signup", "/handoff"]);
    expect(sitemap().map(entry => entry.url)).toEqual(["https://pos.udozo.test/", "https://pos.udozo.test/pricing", "https://pos.udozo.test/download"]);
  });
});
