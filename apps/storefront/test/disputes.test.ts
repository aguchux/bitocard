import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { canDispute, disputeAuthor, disputeStatusLabel } from "@/lib/disputes";
import { activeTab } from "@/components/app/tabs";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { openDispute, replyToDispute } = await import("@/lib/dispute-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "acme.bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("dispute labels", () => {
  test("say where a dispute stands in the customer's words, and never name staff", () => {
    expect(disputeStatusLabel({ status: "open", outcome: null })).toBe("With the store");
    expect(disputeStatusLabel({ status: "escalated", outcome: null })).toBe("With BitoCard");
    expect(disputeStatusLabel({ status: "resolved", outcome: "refunded_customer" })).toBe("Refunded");
    expect(disputeStatusLabel({ status: "resolved", outcome: "rejected" })).toBe("Closed");
    expect(disputeStatusLabel({ status: "resolved", outcome: "resolved_by_reseller" })).toBe("Resolved");
    expect([disputeAuthor("customer", "Acme"), disputeAuthor("reseller", "Acme"), disputeAuthor("bitocard", "Acme"), disputeAuthor("system", "Acme")]).toEqual(["You", "Acme", "BitoCard", "Update"]);
  });

  test("only orders past the payment page can be disputed; dispute pages sit under the Orders tab", () => {
    expect(["completed", "failed", "refunded", "paid"].map(canDispute)).toEqual([true, true, true, true]);
    expect(canDispute("awaiting_payment")).toBe(false);
    expect(activeTab("/account/disputes/abc")).toBe("/account/orders");
  });
});

describe("dispute actions", () => {
  test("opening one sends the order and the customer's words with their session and store, then shows it", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "dispute", id: "d1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(openDispute({}, form({ checkout_id: "c1", subject: "Code used", message: "It says already redeemed." }))).rejects.toThrow("redirect:/account/disputes/d1");
    const [[url, init]] = fetch.mock.calls as unknown as Call[];
    expect([url, init.method]).toEqual(["http://api.test/v1/store/account/disputes", "POST"]);
    expect(JSON.parse(String(init.body))).toEqual({ checkout_id: "c1", subject: "Code used", message: "It says already redeemed." });
    expect([init.headers["bitocard-customer-session"], init.headers["bitocard-store"]]).toEqual(["bcc_session", "acme"]);
    expect(init.headers["idempotency-key"]).toBeTruthy();
  });

  test("a refusal shows the API's message on its field; a signed-out customer is sent to sign in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "parameter_invalid", message: "Choose one of your orders.", param: "checkout_id" } }), { status: 400 })));
    expect(await openDispute({}, form({ checkout_id: "c1", subject: "Code used", message: "Broken" }))).toEqual({ error: "Choose one of your orders.", field: "checkout_id" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_authenticated", message: "Sign in" } }), { status: 401 })));
    await expect(openDispute({}, form({ checkout_id: "c1", subject: "Code used", message: "Broken" }))).rejects.toThrow(`redirect:/signin?next=${encodeURIComponent("/account/disputes/new?order=c1")}`);
  });

  test("a reply is sent on the dispute and the page refreshed", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "dispute", id: "d1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await replyToDispute({}, form({ id: "d1", body: "Still not working" }))).toEqual({ notice: "Sent." });
    const [[url, init]] = fetch.mock.calls as unknown as Call[];
    expect(url).toBe("http://api.test/v1/store/account/disputes/d1/messages");
    expect(JSON.parse(String(init.body))).toEqual({ body: "Still not working" });
    expect(revalidatePath).toHaveBeenCalledWith("/account/disputes/d1");
  });
});
