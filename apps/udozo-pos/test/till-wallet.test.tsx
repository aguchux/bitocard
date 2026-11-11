// pos.udozo.com's till, beyond cash and cards (milestone 3): every product read page by page (never cut off at one
// page, the grid drawing the first and search finding the rest), asking for the Udozo wallet part of a basket (a QR
// code or the buyer's mobile number) and waiting for it, and scanning with the camera, with its problems in words.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PosProduct } from "@/lib/pos";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/till", useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));

const { tillShown, timeLeft, walletOutcome, methodLabel } = await import("@/lib/pos");
const { askWallet, cancelWallet, walletStatus } = await import("@/lib/pos-actions");
const { tillCatalogue, tillPage } = await import("@/lib/pos-data");
const { cameraProblem } = await import("@/components/camera-scan");
const { Register } = await import("@/components/register");

const till = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const basket = "0f1e2d3c-4b5a-4968-8776-655443322110";
const request = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const product = (n: number): PosProduct => ({
  object: "pos_product",
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  ref: 100_000 + n,
  sku: `TVS-${String(n).padStart(6, "0")}`,
  title: `Product ${n}`,
  price: { kind: "fixed", amount: 100_000, currency: "NGN" },
  barcode: null,
  category: null,
  photo_url: null,
  status: "active",
  stock: 3,
  held: 0,
  available: 3,
  reorder_level: null,
  low_stock: false,
  on_udozo: false,
  blocked: null,
  ticked_at: "2026-11-11T08:00:00.000Z",
  edit_url: "https://udozo.com/account/listings/x",
});

const sent: Array<{ method: string; url: string; body: unknown }> = [];
let reply: (url: string) => unknown = () => ({});

beforeEach(() => {
  sent.length = 0;
  setRequest({}, { udz_pos: "bcc_owner" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.udozo.test", "");
    sent.push({ method: init.method ?? "GET", url: path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(reply(path));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("every product at the till", () => {
  it("reads the catalogue page by page until there is no more", async () => {
    reply = url => {
      const offset = Number(new URL(`https://x${url}`).searchParams.get("offset"));
      const count = offset >= 2 * tillPage ? 5 : tillPage;
      return { object: "list", currency: "NGN", plan: { code: "premium", name: "Premium" }, shop_kind: { code: "general", name: "General shop" }, summary: { products: 2 * tillPage + 5, limit: null, over_limit: 0, sellable: 0, low_stock: 0, out_of_stock: 0 }, categories: [], total: 2 * tillPage + 5, has_more: offset + count < 2 * tillPage + 5, data: Array.from({ length: count }, (_, index) => product(offset + index)) };
    };
    const result = await tillCatalogue();
    expect(result.ok && result.data.data.length).toBe(2 * tillPage + 5);
    expect(result.ok && result.data.has_more).toBe(false);
    expect(sent.map(call => call.url)).toEqual([0, 1, 2].map(page => `/v1/pos/owner/catalogue?show=all&limit=${tillPage}&offset=${page * tillPage}`));
  });

  it("draws the first products and says how to find the rest", () => {
    const products = Array.from({ length: tillShown + 30 }, (_, index) => product(index));
    const html = renderToStaticMarkup(<Register tillId={till} vatBps={0} currency="NGN" planName="Premium" categories={[]} products={products} />);
    expect(html).toContain(`Showing ${tillShown} of ${tillShown + 30}`);
    expect(html).toContain(`Product ${tillShown - 1}`);
    expect(html).not.toContain(`Product ${tillShown + 1}<`);
    expect(html).toContain(">Camera<");
  });
});

describe("the Udozo wallet at the till", () => {
  it("asks for the rest of the basket from the buyer's wallet, by QR code or their number", async () => {
    reply = () => ({ object: "pos_wallet_request", id: request, number: "PW-000001", status: "waiting", currency: "NGN", amount: 800_000, total: 1_000_000, client_sale_id: basket, for_buyer: false, expires_at: "2026-11-11T13:05:00.000Z", paid_at: null, sale: null, token: `pw_${"a".repeat(32)}`, pay_url: `https://udozo.com/pay/pw_${"a".repeat(32)}` });
    const lines = [{ listing_id: product(1).id, quantity: 2 }];
    const asked = await askWallet({ till_id: till, client_sale_id: basket, lines, payments: [{ method: "cash", amount: 200_000, tendered: 500_000, reference: "" }], wallet_amount: 800_000, expected_total: 1_000_000 });
    expect(asked.ok && asked.data.pay_url).toBe(`https://udozo.com/pay/pw_${"a".repeat(32)}`);
    expect(sent[0]).toMatchObject({ method: "POST", url: "/v1/pos/owner/wallet-requests", body: { till_id: till, client_sale_id: basket, lines, payments: [{ method: "cash", amount: 200_000, tendered: 500_000 }], wallet_amount: 800_000, expected_total: 1_000_000 } });

    await askWallet({ till_id: till, client_sale_id: basket, lines, payments: [], wallet_amount: 1_000_000, expected_total: 1_000_000, phone: "+234 803 123 4567" });
    expect(sent[1]!.body).toMatchObject({ phone: "+2348031234567" });
    expect(await askWallet({ till_id: till, client_sale_id: basket, lines, payments: [], wallet_amount: 1_000_000, expected_total: 1_000_000, phone: "0803" })).toMatchObject({ ok: false, param: "phone" });
    expect(sent).toHaveLength(2);

    await walletStatus(request);
    await cancelWallet(request);
    expect(sent.slice(2).map(call => `${call.method} ${call.url}`)).toEqual([`GET /v1/pos/owner/wallet-requests/${request}`, `POST /v1/pos/owner/wallet-requests/${request}/cancel`]);
  });

  it("says what happened when the buyer does not pay, and how long is left", () => {
    expect(walletOutcome("declined")).toMatch(/declined/);
    expect(walletOutcome("expired")).toMatch(/Five minutes passed/);
    expect(walletOutcome("waiting")).toBeNull();
    expect(timeLeft("2026-11-11T13:05:00.000Z", Date.parse("2026-11-11T13:00:55.000Z"))).toBe("4:05");
    expect(timeLeft("2026-11-11T13:05:00.000Z", Date.parse("2026-11-11T13:06:00.000Z"))).toBe("0:00");
    expect(methodLabel("udozo_wallet")).toBe("Udozo wallet");
  });
});

describe("scanning with the camera", () => {
  it("says in words why the camera did not start", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(cameraProblem(named("NotAllowedError"))).toMatch(/blocked/);
    expect(cameraProblem(named("NotFoundError"))).toMatch(/No camera/);
    expect(cameraProblem(named("NotReadableError"))).toMatch(/Another app/);
    expect(cameraProblem(new Error("x"))).toMatch(/could not start/);
  });
});
