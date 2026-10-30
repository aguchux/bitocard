// Udozo's wallet (moved from the storefront): top-ups through Udozo's gateways and the customer's own account number.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { topUpWallet, openBankAccount, cancelTopUp } = await import("@/lib/wallet");
const { cancelErrorText } = await import("@/lib/cancel-payment");

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
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cancelling a payment the customer gave up on", () => {
  test("a cancelled top-up returns to the wallet tab with no notice; one paid after all shows as added", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_top_up", id: "t9", status: "failed" }));
    vi.stubGlobal("fetch", fetch);
    await expect(cancelTopUp(form({ id: "t9", back: "/account/wallet?wallet=USD" }))).rejects.toThrow("redirect:/account/wallet?wallet=USD");
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe("http://api.test/v1/store/wallet/top-ups/t9/cancel");
    expect(revalidatePath).toHaveBeenCalledWith("/account/wallet");

    vi.stubGlobal("fetch", vi.fn(async () => reply({ object: "customer_top_up", id: "t9", status: "succeeded" })));
    await expect(cancelTopUp(form({ id: "t9", back: "/account/wallet" }))).rejects.toThrow("redirect:/account/wallet?top_up=t9");
  });

  test("a refusal keeps the notice and says why; a back address outside the wallet is ignored", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { type: "conflict_error", code: "payment_in_progress", message: "x" } }, 409)));
    await expect(cancelTopUp(form({ id: "t9", back: "https://evil.example/x" }))).rejects.toThrow("redirect:/account/wallet?top_up=t9&cancel_error=payment_in_progress");
    expect(cancelErrorText("payment_in_progress")).toMatch(/still being confirmed/);
    expect(cancelErrorText("api_error")).toMatch(/Try again in a minute/);
  });
});

describe("topping the wallet up", () => {
  test("sends the amount in minor units (never a country: the wallet is the customer's own) and returns to the wallet; live goes to the payment page", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_top_up", id: "t1", mode: "live", checkout_url: "https://checkout.stripe.com/c/1" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(topUpWallet({}, form({ amount: "2500.50", country: "GH", method: "stripe" }))).rejects.toThrow("redirect:https://checkout.stripe.com/c/1");
    const [call] = fetch.mock.calls as unknown as Call[];
    expect(call[0]).toBe("http://api.test/v1/store/wallet/top-ups");
    expect(bodyOf(call)).toEqual({ amount: 250050, method: "stripe", return_url: "https://udozo.com/account/wallet" });
  });

  test("the sandbox has no payment page: back to the wallet showing the top-up; nonsense amounts are refused here", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ object: "customer_top_up", id: "t2", mode: "test", checkout_url: "https://sandbox.test" }, 201)));
    await expect(topUpWallet({}, form({ amount: "10" }))).rejects.toThrow("redirect:/account/wallet?top_up=t2");
    expect(await topUpWallet({}, form({ amount: "0.5" }))).toEqual({ error: "Enter an amount of at least 1.", field: "amount" });
  });

  test("the US dollar wallet: its currency is sent and the payment page returns to it", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_top_up", id: "t3", mode: "test", checkout_url: null }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(topUpWallet({}, form({ amount: "1,000", currency: "USD", method: "stripe" }))).rejects.toThrow("redirect:/account/wallet?wallet=USD&top_up=t3");
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0])).toEqual({ amount: 100000, method: "stripe", currency: "USD", return_url: "https://udozo.com/account/wallet?wallet=USD" });
  });

  test("a bank account number: the BVN goes to the API only, and the page refreshes", async () => {
    const fetch = vi.fn(async () => reply({ object: "list", data: [] }));
    vi.stubGlobal("fetch", fetch);
    expect((await openBankAccount({}, form({ bvn: "22222222222" }))).notice).toMatch(/account number is ready/);
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0])).toEqual({ bvn: "22222222222" });
    expect(revalidatePath).toHaveBeenCalledWith("/account/wallet");
  });
});
