// Free public spins: signed-out visitors spin at /spin. The storefront server keeps only the API's opaque claim
// token, in an HttpOnly cookie; the dialog that offers a saved claim on first sign-in reads and clears it the same
// way. These tests check the server actions' plumbing (cookies, headers, market), not the API's own rules.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type) }));

const { claimPublicSpin, dismissPublicSpinClaim, pendingPublicSpinClaim, publicSpinRewards, spinPublicWheel } = await import("@/lib/spin-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls as unknown as Call[];

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("NODE_ENV", "test");
  setRequest({ host: "bitocard.com" }, { bc_market: "NG" });
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the visitor wheel", () => {
  test("reads the market's status with no claim token on the first visit", async () => {
    const fetch = vi.fn(async () => reply({ object: "public_spin_rewards", enabled: true, reason: null, segments: [], daily_limit: 6, allowance: null, recent: [], rewards: { coins: [], usd: "0.00", exchange_currencies: [] }, claim_expires_at: "2027-01-01T00:00:00.000Z" }));
    vi.stubGlobal("fetch", fetch);
    const rewards = await publicSpinRewards();
    expect(rewards?.object).toBe("public_spin_rewards");
    const [url, init] = calls(fetch)[0];
    expect(url).toBe("http://api.test/v1/store/spins/public?country=NG");
    expect(init.headers["bitocard-spin-claim"]).toBeUndefined();
  });

  test("without a chosen market or a store, there is nothing to spin yet", async () => {
    setRequest({ host: "bitocard.com" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await publicSpinRewards()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("the first spin creates a claim; the API's token is kept, never read back from the response body to the browser", async () => {
    const spin = { spin: { object: "spin", id: "s1", number: 1, segment: 0, asset: "USDT", amount: "0.0100", usd: "0.01", allowance: { won_usd: "0.01", spins_used: 1, today_left: 5, daily_limit: 6, next_spin_at: null, finished: false } }, status: { object: "public_spin_rewards" }, token: "claim-token-1" };
    const fetch = vi.fn(async () => reply(spin));
    vi.stubGlobal("fetch", fetch);
    const result = await spinPublicWheel();
    expect(result).toEqual({ ok: true, spin: spin.spin });
    const [url, init] = calls(fetch)[0];
    expect(url).toBe("http://api.test/v1/store/spins/public");
    expect(JSON.parse(String(init.body))).toEqual({ country: "NG" });
    expect(init.headers["bitocard-spin-claim"]).toBeUndefined();
  });

  test("a later spin sends the saved claim token back as a header, never in the body", async () => {
    setRequest({ host: "bitocard.com" }, { bc_market: "NG", bc_public_spin: "claim-token-2" });
    const fetch = vi.fn(async () => reply({ spin: { object: "spin", id: "s2", number: 2, segment: 1, asset: "USDC", amount: "0.0200", usd: "0.02", allowance: { won_usd: "0.03", spins_used: 2, today_left: 4, daily_limit: 6, next_spin_at: null, finished: false } }, status: { object: "public_spin_rewards" } }));
    vi.stubGlobal("fetch", fetch);
    await spinPublicWheel();
    const [, init] = calls(fetch)[0];
    expect(init.headers["bitocard-spin-claim"]).toBe("claim-token-2");
    expect(JSON.parse(String(init.body))).toEqual({ country: "NG" });
  });

  test("a refusal (for example the visitor's six spins are used) is returned, never thrown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "public_spins_finished", message: "Create an account to claim your wins and keep spinning." } }, 409)));
    expect(await spinPublicWheel()).toEqual({ ok: false, code: "public_spins_finished", message: "Create an account to claim your wins and keep spinning." });
  });

  test("the store being unreachable is a plain refusal, not a thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await spinPublicWheel()).toEqual({ ok: false, code: null, message: "We could not reach the store. Try again shortly." });
  });
});

describe("claiming a saved visitor win on first sign-in", () => {
  test("with no saved claim, there is nothing to check and no request is made", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await pendingPublicSpinClaim()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("with a saved claim, the signed-in customer's session and the claim token both go to the API", async () => {
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session", bc_public_spin: "claim-token-3" });
    const fetch = vi.fn(async () => reply({ object: "public_spin_claim", status: "active", reason: null, usd: "0.06", spins: 6, currencies: [{ currency: "USD", amount: 6 }] }));
    vi.stubGlobal("fetch", fetch);
    const claim = await pendingPublicSpinClaim();
    expect(claim?.status).toBe("active");
    const [url, init] = calls(fetch)[0];
    expect(url).toBe("http://api.test/v1/store/spins/public-claim");
    expect(init.headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(init.headers["bitocard-spin-claim"]).toBe("claim-token-3");
  });

  test("claiming sends the chosen currency, clears the saved cookie once credited, and refreshes the account", async () => {
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session", bc_public_spin: "claim-token-4" });
    const fetch = vi.fn(async () => reply({ object: "public_spin_claim", status: "claimed", reason: null, usd: "0.06", currency: "USD", amount: 6 }));
    vi.stubGlobal("fetch", fetch);
    const result = await claimPublicSpin("USD");
    expect(result).toEqual({ ok: true, data: { object: "public_spin_claim", status: "claimed", reason: null, usd: "0.06", currency: "USD", amount: 6 } });
    const [url, init] = calls(fetch)[0];
    expect(url).toBe("http://api.test/v1/store/spins/public-claim");
    expect(JSON.parse(String(init.body))).toEqual({ currency: "USD" });
    expect(init.headers["bitocard-spin-claim"]).toBe("claim-token-4");
    expect(revalidatePath).toHaveBeenCalledWith("/account", "layout");
  });

  test("without a saved claim, claiming is refused locally and never calls the API", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await claimPublicSpin("USD")).toEqual({ ok: false, code: "claim_invalid", message: "There is no visitor win to claim." });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("an invalidated claim is returned as the API describes it, and the cookie is left so the dialog can show why", async () => {
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session", bc_public_spin: "claim-token-5" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "claim_invalid", message: "This visitor win has already been handled." } }, 409)));
    expect(await claimPublicSpin("USD")).toEqual({ ok: false, code: "claim_invalid", message: "This visitor win has already been handled." });
  });

  test("dismissing clears the saved claim cookie without calling the API", async () => {
    setRequest({ host: "bitocard.com" }, { bc_public_spin: "claim-token-6" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await dismissPublicSpinClaim();
    expect(fetch).not.toHaveBeenCalled();
  });
});
