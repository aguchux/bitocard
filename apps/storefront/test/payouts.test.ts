// Payouts (the Shop tab): the money from a customer's Safe pay sales paid into their own bank account, at /v1/store/cash
// (crypto, which used to own this page, has left BitoCard).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { addPayoutAccount, payOut, removePayoutAccount, simulatePayout } = await import("@/lib/payout-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls as unknown as Call[];
const bodyOf = (call: Call) => JSON.parse(String(call[1].body));
const account = "4a0c2a1e-5f6a-4f0e-9a51-0e4f3f0f1a33";
const nonce = "0d1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("payouts", () => {
  test("adding a bank account sends the bank and the digits only, to /v1/store/cash; Payouts and Safe pay refresh", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_bank_account", id: account, bank_name: "Sandbox Bank", account_number_last4: "6789", account_name: "ADA SELLER" }, 201));
    vi.stubGlobal("fetch", fetch);
    expect(await addPayoutAccount({}, form({ bank_code: "SBX001", account_number: "0123 456 789" }))).toEqual({ notice: "Added Sandbox Bank ending 6789 (ADA SELLER)." });
    expect(calls(fetch)[0][0]).toBe("http://api.test/v1/store/cash/bank-accounts");
    expect(bodyOf(calls(fetch)[0])).toEqual({ bank_code: "SBX001", account_number: "0123456789" });
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/shop/payouts", "/shop/safe-pay"]);
    expect(await addPayoutAccount({}, form({ bank_code: "", account_number: "0123456789" }))).toEqual({ error: "Choose your bank.", field: "bank_code" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "account_name_mismatch", message: "This account is in the name of SOMEONE ELSE.", param: "account_number" } }, 400)));
    expect(await addPayoutAccount({}, form({ bank_code: "SBX001", account_number: "0123456789" }))).toEqual({ error: "This account is in the name of SOMEONE ELSE.", field: "account_number" });
  });

  test("paying out sends the amount in minor units with the form's nonce, once; the form then gets a fresh one", async () => {
    const fetch = vi.fn(async () => reply({ object: "customer_payout", id: "p1", status: "processing" }, 201));
    vi.stubGlobal("fetch", fetch);
    const first = await payOut({}, form({ bank_account_id: account, amount: "15,000.50", nonce }));
    expect(first).toMatchObject({ notice: "On its way to your bank." });
    expect(calls(fetch)[0][0]).toBe("http://api.test/v1/store/cash/payouts");
    expect(bodyOf(calls(fetch)[0])).toEqual({ amount: 1500050, bank_account_id: account });
    expect(calls(fetch)[0][1].headers["idempotency-key"]).toBe(nonce);
    expect(first.nonce).not.toBe(nonce);
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "insufficient_funds", message: "You can pay out up to ₦0.00 now.", param: "amount" } }, 402)));
    expect(await payOut({}, form({ bank_account_id: account, amount: "15000" }))).toMatchObject({ error: "You can pay out up to ₦0.00 now.", field: "amount" });
  });

  test("signed out, it asks to sign in and come back to Payouts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "authentication_required", message: "Sign in." } }, 401)));
    await expect(removePayoutAccount({}, form({ id: account }))).rejects.toThrow("redirect:/signin?next=%2Fshop%2Fpayouts");
  });

  test("the sandbox's simulated payouts", async () => {
    const settled = vi.fn(async () => reply({ object: "customer_payout", id: "p1", status: "failed" }));
    vi.stubGlobal("fetch", settled);
    expect(await simulatePayout({}, form({ id: "p1", outcome: "failed" }))).toEqual({});
    expect(calls(settled)[0][0]).toBe("http://api.test/v1/store/cash/payouts/p1/simulate");
    expect(bodyOf(calls(settled)[0])).toEqual({ outcome: "failed" });
  });
});
