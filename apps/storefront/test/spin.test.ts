import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StoreSpinAllowance, StoreSpinRewards } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";
import { showSpinCard } from "@/components/app/crypto";
import { landingAngle, restingAngle, segmentAt, segmentWidth, spinBlocks, usd, wonPercent } from "@/lib/spin";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const { spinWheel } = await import("@/lib/spin-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls as unknown as Call[];

const allowance: StoreSpinAllowance = { total_usd: "1.00", won_usd: "0.35", spins_total: 64, spins_used: 8, spins_left: 56, today_left: 2, daily_limit: 5, next_spin_at: null, finished: false };
const spin = { object: "spin", id: "spn_1", number: 9, segment: 4, asset: "BNB", amount: "0.000081", usd: "0.05", allowance: { ...allowance, won_usd: "0.40", spins_used: 9, spins_left: 55, today_left: 1 } };
const nonce = "0d1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("spinning", () => {
  test("posts an empty body with the customer's session and the button's nonce as the Idempotency-Key, and returns the win", async () => {
    const fetch = vi.fn(async () => reply(spin, 201));
    vi.stubGlobal("fetch", fetch);
    expect(await spinWheel(nonce)).toEqual({ ok: true, spin });
    const [url, init] = calls(fetch)[0];
    expect(url).toBe("http://api.test/v1/store/spins");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(init.headers["idempotency-key"]).toBe(nonce);
    expect(init.headers["bitocard-customer-session"]).toBe("bcc_session");
  });

  test("without a usable nonce each spin gets its own key", async () => {
    const fetch = vi.fn(async () => reply(spin, 201));
    vi.stubGlobal("fetch", fetch);
    await spinWheel();
    await spinWheel("bad key!");
    const [first, second] = calls(fetch).map(call => call[1].headers["idempotency-key"]);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });

  test("a refusal returns the API's message and code, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "customer_verification_required", message: "Verify your identity to spin." } }, 403)));
    expect(await spinWheel(nonce)).toEqual({ ok: false, code: "customer_verification_required", message: "Verify your identity to spin." });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await spinWheel(nonce)).toEqual({ ok: false, code: null, message: "We could not reach the store. Try again shortly." });
  });

  test("today's limit returns the allowance as it is now, so the wheel says when to come back", async () => {
    const later = { ...allowance, today_left: 0, next_spin_at: "2026-10-15T00:00:00.000Z" };
    const fetch = vi.fn(async (url: string, init: RequestInit) =>
      init.method === "POST" ? reply({ error: { code: "spin_limit_today", message: "That is today's spins done." } }, 409) : reply({ object: "spin_rewards", allowance: later }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await spinWheel(nonce)).toEqual({ ok: false, code: "spin_limit_today", message: "That is today's spins done.", allowance: later });
    expect(calls(fetch).map(call => [call[1].method, call[0]])).toEqual([
      ["POST", "http://api.test/v1/store/spins"],
      ["GET", "http://api.test/v1/store/spins"],
    ]);
  });

  test("signed out: sent to sign in, back to the wheel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "authentication_required", message: "Sign in." } }, 401)));
    await expect(spinWheel(nonce)).rejects.toThrow(`redirect:/signin?next=${encodeURIComponent("/account/crypto/spin")}`);
  });
});

describe("the wheel's geometry", () => {
  test("each landing puts the won segment under the pointer, at least the asked turns further on", () => {
    for (const count of [12, 8]) {
      let current = restingAngle(count);
      expect(segmentAt(current, count)).toBe(0);
      for (const [segment, turns, offset] of [
        [4, 6, 0],
        [0, 7, 0.39],
        [11 % count, 8, -0.39],
        [3, 6, 0.9],
        [3, 6, -0.9],
      ] as const) {
        const next = landingAngle({ current, segment, count, turns, offset });
        expect(segmentAt(next, count)).toBe(segment);
        expect(next).toBeGreaterThanOrEqual(current + turns * 360);
        expect(next).toBeLessThan(current + (turns + 1) * 360);
        current = next;
      }
    }
  });

  test("lands inside the segment, never on a line", () => {
    const count = 12;
    const width = segmentWidth(count);
    for (const offset of [-1, -0.4, 0, 0.4, 1]) {
      const angle = landingAngle({ current: 0, segment: 5, count, turns: 6, offset });
      const point = (((-angle % 360) + 360) % 360) - 5 * width;
      expect(point).toBeGreaterThanOrEqual(width * 0.1 - 1e-9);
      expect(point).toBeLessThanOrEqual(width * 0.9 + 1e-9);
    }
  });

  test("always spins forwards, from any angle, at least one turn", () => {
    expect(landingAngle({ current: 12345.6, segment: 7, count: 12, turns: 0 })).toBeGreaterThan(12345.6 + 359);
    expect(landingAngle({ current: -90, segment: 2, count: 12, turns: 6 })).toBeGreaterThan(-90 + 6 * 360);
  });

  test("money and progress", () => {
    expect(usd("0.05")).toBe("$0.05");
    expect(usd("1")).toBe("$1.00");
    expect(wonPercent("0.35", "1.00")).toBeCloseTo(35);
    expect(wonPercent("2", "1.00")).toBe(100);
    expect(wonPercent("0", "0")).toBe(0);
  });
});

describe("where Spin and win shows", () => {
  const rewards = (patch: Partial<StoreSpinRewards>): StoreSpinRewards => ({ object: "spin_rewards", mode: "live", enabled: true, reason: null, segments: [], allowance: null, recent: [], ...patch });

  test("on Home and Crypto while the customer can spin, or their $1 is under way", () => {
    expect(showSpinCard(null)).toBe(false);
    expect(showSpinCard(rewards({}))).toBe(true);
    expect(showSpinCard(rewards({ enabled: false, reason: "crypto_not_enabled" }))).toBe(false);
    expect(showSpinCard(rewards({ enabled: false, reason: "customer_verification_required", allowance }))).toBe(true);
    expect(showSpinCard(rewards({ enabled: false, reason: "not_enabled", allowance: { ...allowance, finished: true } }))).toBe(false);
  });

  test("every reason the API gives has words, and verification links to the check", () => {
    for (const reason of ["not_enabled", "spins_not_enabled", "crypto_not_enabled", "email_not_verified", "customer_verification_required", "crypto_account_frozen", "claimed_elsewhere"]) expect(spinBlocks[reason]?.title).toBeTruthy();
    expect(spinBlocks.customer_verification_required.link?.href).toBe("/account/verification");
  });
});
