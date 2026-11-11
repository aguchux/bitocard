// Paying a shop's Udozo POS till from the Udozo wallet (docs/UDOZO_POS_PLAN.md): the link the till's QR code opens. The
// buyer, signed in, sees the shop, what they are buying and the amount, and pays or declines; nothing is taken until
// they press Pay. A token not in the till's shape is never sent to Udozo.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatPrice } from "@bitocard/api-client/storefront";
import type { PosWalletPayment } from "@/lib/pos-pay";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("not-found"); }, usePathname: () => "/pay", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const { posPayOutcome, posPayToken } = await import("@/lib/pos-pay");
const { declinePos, payPos } = await import("@/lib/pos-pay-actions");
const { default: PosPayPage } = await import("@/app/(account)/pay/[token]/page");

const token = `pw_${"a".repeat(32)}`;
const customer = { object: "customer", id: "c9", email: "bola@example.com", name: "Bola Ade", first_name: "Bola", last_name: "Ade", name_confirmed: true, email_verified: true, phone: "+2348031234567", phone_verified: true, phone_verification_available: true, country: "NG", currency: "NGN", created_at: "2026-11-01T00:00:00Z" };
const payment = (over: Partial<PosWalletPayment> = {}): PosWalletPayment => ({
  object: "pos_wallet_payment",
  number: "PW-000007",
  status: "waiting",
  shop: { name: "Ada's Gadget Hub" },
  currency: "NGN",
  amount: 800_000,
  total: 1_000_000,
  items: [{ title: "Samsung 43 inch TV", quantity: 2 }],
  own_shop: false,
  expires_at: "2026-11-11T13:05:00.000Z",
  paid_at: null,
  ...over,
});

let calls: Array<{ method: string; url: string; body: unknown }>;
let answer: () => Response;
beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_session" });
  calls = [];
  answer = () => Response.json(payment());
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url: url.replace("http://api.test", ""), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/pos-payments/")) return answer();
    if (url.includes("/v1/store/account")) return Response.json(customer);
    return Response.json({});
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const page = async (value = token) => renderToStaticMarkup(await PosPayPage({ params: Promise.resolve({ token: value }) }));

describe("paying a shop's till", () => {
  test("shows the shop, what is bought, what was paid at the counter and what the wallet pays", async () => {
    const html = await page();
    expect(calls.some(call => call.url === `/v1/store/account/pos-payments/${token}`)).toBe(true);
    expect(html).toContain("Pay Ada&#x27;s Gadget Hub");
    expect(html).toContain("2 × Samsung 43 inch TV");
    expect(html).toContain("Paid at the counter");
    expect(html).toContain(`Pay ${formatPrice(800_000, "NGN")}`);
    expect(html).toContain("Decline");
    expect(html).toContain("Only pay at the shop");
  });

  test("once it is no longer waiting, says what happened, and a shop never pays itself", async () => {
    answer = () => Response.json(payment({ status: "paid", paid_at: "2026-11-11T13:01:00.000Z" }));
    const paid = await page();
    expect(paid).toContain("Paid. Show this to Ada&#x27;s Gadget Hub");
    expect(paid).not.toContain(`Pay ${formatPrice(800_000, "NGN")}`);
    answer = () => Response.json(payment({ own_shop: true }));
    expect(await page()).toContain("This is your own shop");
    expect(posPayOutcome({ status: "expired", shop: { name: "X" } })).toMatch(/ran out of time/);
    expect(posPayOutcome({ status: "waiting", shop: { name: "X" } })).toBeNull();
  });

  test("an unknown request or a token not in the till's shape is not found, and never asked of Udozo", async () => {
    await expect(page("pw_short")).rejects.toThrow("not-found");
    expect(calls.some(call => call.url.includes("pos-payments"))).toBe(false);
    answer = () => Response.json({ error: { code: "resource_missing", message: "Not here." } }, { status: 404 });
    await expect(page()).rejects.toThrow("not-found");
    expect(posPayToken.test(token)).toBe(true);
  });

  test("pays exactly the amount seen, and says when the wallet is too low", async () => {
    await payPos(token, 800_000);
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: `/v1/store/account/pos-payments/${token}/pay`, body: { expected_amount: 800_000 } });
    answer = () => Response.json({ error: { code: "wallet_balance_low", message: "Your wallet has too little." } }, { status: 402 });
    expect(await payPos(token, 800_000)).toMatchObject({ ok: false, code: "wallet_balance_low" });
    expect(await payPos("../x", 800_000)).toMatchObject({ ok: false, code: "resource_missing" });
    const before = calls.length;
    expect(await payPos(token, 0)).toMatchObject({ ok: false });
    expect(calls.length).toBe(before);
    answer = () => Response.json(payment({ status: "declined" }));
    expect(await declinePos(token)).toMatchObject({ ok: true, data: { status: "declined" } });
  });
});
