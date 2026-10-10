import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { activeTab } from "@/components/app/tabs";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { topUpWallet, openBankAccount } = await import("@/lib/wallet");
const { startCheckout } = await import("@/lib/account-actions");
const { paymentMethodsFor } = await import("@/lib/payment-methods");

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
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("topping the wallet up", () => {
  test("sends the amount in minor units and returns to the wallet; live goes to the payment page", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_top_up", id: "t1", mode: "live", checkout_url: "https://checkout.stripe.com/c/1" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(topUpWallet({}, form({ amount: "2500.50", country: "NG", method: "stripe" }))).rejects.toThrow("redirect:https://checkout.stripe.com/c/1");
    const [call] = fetch.mock.calls as unknown as Call[];
    expect(call[0]).toBe("http://api.test/v1/store/wallet/top-ups");
    expect(bodyOf(call)).toEqual({ amount: 250050, country: "NG", method: "stripe", return_url: "https://bitocard.com/account/wallet?country=NG" });
  });

  test("the sandbox has no payment page: back to the wallet showing the top-up; nonsense amounts are refused here", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ object: "customer_top_up", id: "t2", mode: "test", checkout_url: "https://sandbox.test" }, 201)));
    await expect(topUpWallet({}, form({ amount: "10", country: "NG" }))).rejects.toThrow("redirect:/account/wallet?country=NG&top_up=t2");
    expect(await topUpWallet({}, form({ amount: "0.5" }))).toEqual({ error: "Enter an amount of at least 1.", field: "amount" });
  });

  test("a bank account number: the BVN goes to the API only, and the page refreshes", async () => {
    const fetch = vi.fn(async () => reply({ object: "list", data: [] }));
    vi.stubGlobal("fetch", fetch);
    expect((await openBankAccount({}, form({ country: "NG", bvn: "22222222222" }))).notice).toMatch(/account number is ready/);
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0])).toEqual({ country: "NG", bvn: "22222222222" });
    expect(revalidatePath).toHaveBeenCalledWith("/account/wallet");
  });

  test("the Wallet tab is its own place", () => {
    expect(activeTab("/account/wallet")).toBe("/account/wallet");
  });
});

describe("paying from the wallet", () => {
  const product = { product_id: "p1", face_value_minor: "2500", country: "NG", back: "/p/x" };

  test("first the price: a preview is asked for and shown, nothing paid", async () => {
    const fetch = vi.fn(async () => reply({ object: "checkout_preview", quote_id: "q1", amount: 3800000, currency: "NGN", wallet_balance: 5000000, expires_at: "2026-10-10T12:10:00Z", tax: null }, 201));
    vi.stubGlobal("fetch", fetch);
    const state = await startCheckout({}, form({ ...product, wallet_required: "1", method: "wallet" }));
    expect(state.preview).toEqual({ quote_id: "q1", amount: 3800000, currency: "NGN", wallet_balance: 5000000, expires_at: "2026-10-10T12:10:00Z" });
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0])).toMatchObject({ preview: true, method: "wallet" });
  });

  test("then that quote is paid and the customer goes to the order; a low wallet offers a top-up", async () => {
    const fetch = vi.fn(async () => reply({ object: "checkout", id: "c1", mode: "live", checkout_url: null }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(startCheckout({}, form({ ...product, wallet_required: "1", method: "wallet", quote_id: "q1" }))).rejects.toThrow("redirect:/account/orders/c1");
    const body = bodyOf((fetch.mock.calls as unknown as Call[])[0]);
    expect([body.quote_id, body.preview]).toEqual(["q1", undefined]);

    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "wallet_balance_low", message: "Your wallet has NGN 0.00. Add NGN 38,000.00 to buy this.", param: null } }, 402)));
    expect(await startCheckout({}, form({ ...product, wallet_required: "1", quote_id: "q1" }))).toEqual({ error: "Your wallet has NGN 0.00. Add NGN 38,000.00 to buy this.", field: "wallet" });
  });

  test("paying by card never asks for a preview", async () => {
    const fetch = vi.fn(async () => reply({ object: "checkout", id: "c2", mode: "live", checkout_url: "https://checkout.stripe.com/c/2" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(startCheckout({}, form({ ...product, method: "stripe" }))).rejects.toThrow("redirect:https://checkout.stripe.com/c/2");
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0]).preview).toBeUndefined();
  });

  test("changing country brings that country's methods and the wallet there", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/payment-methods")
        ? reply({ object: "list", mode: "live", wallet_required: true, data: [{ object: "payment_method", id: "wallet", label: "Wallet", description: "", networks: [] }] })
        : reply({ object: "customer_wallet", currency: "GHS", balance: 1000, enabled: true }),
    );
    vi.stubGlobal("fetch", fetch);
    const choice = await paymentMethodsFor("GH");
    expect([choice.walletRequired, choice.methods.map(item => item.id), choice.wallet?.currency]).toEqual([true, ["wallet"], "GHS"]);
    expect((fetch.mock.calls as unknown as Call[]).map(call => call[0]).sort()).toEqual(["http://api.test/v1/store/payment-methods?country=GH", "http://api.test/v1/store/wallet?country=GH"]);
  });
});
