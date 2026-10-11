import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { esimTopUpOptions, topUpEsim, cancelEsim } = await import("@/lib/esim-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const checkout = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const esim = "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c";
const token = `bca_${"a".repeat(43)}`;

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("eSIM top-ups and cancelling", () => {
  test("signed in: the customer's own checkout, the option and wallet sent, and the page refreshed", async () => {
    const fetch = vi.fn(async () => reply({ object: "esim_top_up", id: "t1", name: "1GB", status: "completed", amount: 100, currency: "NGN", failure_reason: null }));
    vi.stubGlobal("fetch", fetch);
    const result = await topUpEsim({ checkout }, esim, "opt_4f1c2b9a0d7e6c5b3a21", "USD");
    expect(result.ok).toBe(true);
    const [call] = fetch.mock.calls as unknown as Call[];
    expect([call[0], call[1].method]).toEqual([`http://api.test/v1/store/checkouts/${checkout}/esims/${esim}/top-ups`, "POST"]);
    expect(JSON.parse(String(call[1].body))).toEqual({ option_id: "opt_4f1c2b9a0d7e6c5b3a21", wallet_currency: "USD" });
    expect(call[1].headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(refresh).toHaveBeenCalled();
  });

  test("on an order link: the options are read with the customer's proof; cancelling posts", async () => {
    const fetch = vi.fn(async () => reply({ object: "list", data: [], wallets: [], available: false }));
    vi.stubGlobal("fetch", fetch);
    expect((await esimTopUpOptions({ token }, esim)).ok).toBe(true);
    await cancelEsim({ token }, esim);
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => [call[0], call[1].method])).toEqual([
      [`http://api.test/v1/store/access/${token}/esims/${esim}/top-up-options`, "GET"],
      [`http://api.test/v1/store/access/${token}/esims/${esim}/cancel`, "POST"],
    ]);
  });

  test("nonsense is refused here, never sent", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await topUpEsim({ checkout }, esim, "../../admin", "USD")).toEqual({ ok: false, error: "Choose a top-up." });
    expect(await cancelEsim({ checkout: "not-an-id" }, esim)).toEqual({ ok: false, error: "This order was not found." });
    expect(await cancelEsim({ token: "bca_short" }, esim)).toEqual({ ok: false, error: "This link is not valid." });
    expect(fetch).not.toHaveBeenCalled();
  });
});
