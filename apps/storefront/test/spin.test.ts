import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StoreSpinAllowance, StoreSpinRewards } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";
import { spinNote } from "@/components/app/spin-dialog";
import { coinFor, landingAngle, restingAngle, segmentAt, segmentTones, segmentWidth, showSpin, spinBlocks, todayLights, usd, winsPage, winsPerPage } from "@/lib/spin";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const { exchangeRewards, previewExchange, spinWheel } = await import("@/lib/spin-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls as unknown as Call[];

const allowance: StoreSpinAllowance = { won_usd: "0.35", spins_used: 8, today_left: 2, daily_limit: 2, next_spin_at: null, finished: false };
const spin = { object: "spin", id: "spn_1", number: 9, segment: 4, asset: "BNB", amount: "0.000081", usd: "0.05", allowance: { ...allowance, won_usd: "0.40", spins_used: 9, today_left: 1 } };
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
    await expect(spinWheel(nonce)).rejects.toThrow(`redirect:/signin?next=${encodeURIComponent("/account?spin=1")}`);
  });
});

describe("exchanging rewards", () => {
  const preview = { object: "spin_exchange_preview", usd: "0.37", currency: "NGN", amount: 55_500, rate: "1500", coins: [] };

  test("a preview asks for the quote only; exchanging sends the amount shown and the button's nonce", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => reply(JSON.parse(String(init.body)).preview ? preview : { object: "spin_exchange", id: "x", usd: "0.37", currency: "NGN", amount: 55_500, rate: "1500", created_at: "" }));
    vi.stubGlobal("fetch", fetch);
    expect(await previewExchange("NGN")).toEqual({ ok: true, data: preview });
    expect((await exchangeRewards("NGN", 55_500, nonce)).ok).toBe(true);
    const [first, second] = calls(fetch);
    expect(first[0]).toBe("http://api.test/v1/store/spins/exchange");
    expect(JSON.parse(String(first[1].body))).toEqual({ currency: "NGN", preview: true });
    expect(JSON.parse(String(second[1].body))).toEqual({ currency: "NGN", expected_amount: 55_500 });
    expect(second[1].headers["idempotency-key"]).toBe(nonce);
  });

  test("a changed rate comes back as the API's message, never thrown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "rate_changed", message: "The rate changed." } }, 409)));
    expect(await exchangeRewards("NGN", 55_500, nonce)).toEqual({ ok: false, code: "rate_changed", message: "The rate changed." });
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

  test("money", () => {
    expect(usd("0.05")).toBe("$0.05");
    expect(usd("1")).toBe("$1.00");
  });
});

describe("the wheel's look", () => {
  test("the top prize is gold, the other wedges alternate navy and pink", () => {
    const values = ["0.01", "0.02", "0.10", "0.03", "0.01", "0.04"].map(usd => ({ usd }));
    expect(segmentTones(values)).toEqual(["navy", "pink", "gold", "pink", "navy", "pink"]);
    expect(segmentTones([{ usd: "0.01" }, { usd: "0.01" }])).toEqual(["navy", "pink"]);
  });

  test("every coin has a colour and a mark, unknown ones a fallback", () => {
    for (const asset of ["USDT", "USDC", "BNB"]) expect(coinFor(asset).colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(coinFor("BNB").dark).toBe(true);
    expect(coinFor("ETH").glyph).toBe("E");
  });

  test("today's lights: all lit before the first spin, the spins left today, none once finished", () => {
    expect(todayLights(null, 2)).toEqual({ lit: 2, total: 2 });
    expect(todayLights({ ...allowance, today_left: 1 }, 2)).toEqual({ lit: 1, total: 2 });
    expect(todayLights({ ...allowance, finished: true }, 2)).toEqual({ lit: 0, total: 2 });
    expect(todayLights({ ...allowance, daily_limit: 3, today_left: 9 }, 2)).toEqual({ lit: 3, total: 3 });
  });

  test("the wins history shows five at a time, newest first, paging through the rest", () => {
    expect(winsPerPage).toBe(5);
    expect(winsPage(0, 0)).toEqual({ pages: 1, current: 0, start: 0, end: 0 });
    expect(winsPage(5, 0)).toEqual({ pages: 1, current: 0, start: 0, end: 5 });
    expect(winsPage(12, 0)).toEqual({ pages: 3, current: 0, start: 0, end: 5 });
    expect(winsPage(12, 2)).toEqual({ pages: 3, current: 2, start: 10, end: 12 });
    // Out of range (the list shrank, or a stale page): kept within the pages there are.
    expect(winsPage(12, 9)).toMatchObject({ current: 2, start: 10 });
    expect(winsPage(12, -1)).toMatchObject({ current: 0, start: 0 });
    expect(winsPage(100, 19)).toEqual({ pages: 20, current: 19, start: 95, end: 100 });
    // Any page size still works.
    expect(winsPage(10, 1, 6)).toEqual({ pages: 2, current: 1, start: 6, end: 10 });
  });
});

describe("where Spin and win shows", () => {
  const none = { coins: [], usd: "0.00", exchange_currencies: ["NGN", "USD"] };
  const rewards = (patch: Partial<StoreSpinRewards>): StoreSpinRewards => ({ object: "spin_rewards", mode: "live", enabled: true, reason: null, segments: [], daily_limit: 2, allowance: null, recent: [], rewards: none, ...patch });

  test("on Home while the customer can spin, has spins to come, or rewards to move to the wallet", () => {
    expect(showSpin(null)).toBe(false);
    expect(showSpin(rewards({}))).toBe(true);
    expect(showSpin(rewards({ enabled: false, reason: "crypto_not_enabled" }))).toBe(false);
    expect(showSpin(rewards({ enabled: false, reason: "customer_verification_required", allowance }))).toBe(true);
    expect(showSpin(rewards({ enabled: false, reason: "not_enabled", allowance: { ...allowance, finished: true } }))).toBe(false);
    expect(showSpin(rewards({ enabled: false, reason: "not_enabled", allowance: { ...allowance, finished: true }, rewards: { ...none, usd: "0.12" } }))).toBe(true);
  });

  test("the card never names a total", () => {
    const notes = [
      spinNote(rewards({})),
      spinNote(rewards({ allowance })),
      spinNote(rewards({ allowance: { ...allowance, today_left: 0 } })),
      spinNote(rewards({ allowance: { ...allowance, finished: true }, rewards: { ...none, usd: "0.40" } })),
    ];
    expect(notes).toEqual([
      "Spin the wheel and win crypto rewards to spend in the store.",
      "$0.35 won · 2 spins left today",
      "$0.35 won · come back tomorrow",
      "$0.40 of rewards to move to your wallet",
    ]);
    expect(notes.join(" ")).not.toMatch(/\$1\b|of \$|total/i);
  });

  test("every reason the API gives has words, and verification links to the check", () => {
    for (const reason of ["not_enabled", "spins_not_enabled", "crypto_not_enabled", "email_not_verified", "customer_verification_required", "crypto_account_frozen", "claimed_elsewhere"]) expect(spinBlocks[reason]?.title).toBeTruthy();
    expect(spinBlocks.customer_verification_required.link?.href).toBe("/account/verification");
  });
});
