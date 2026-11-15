// Choosing a market on bitocard.com, the one store (country stores are retired, docs/BITOCARD_MULTI_WALLETS_PLAN.md):
// chooseMarket() only remembers it and refreshes the store, never sending anyone to another address;
// onResellerStore() reads the API's house flag.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type) }));

const { chooseMarket } = await import("@/app/(store)/market-action");
const { onResellerStore } = await import("@/lib/store");

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chooseMarket", () => {
  test("remembers the market and refreshes bitocard.com; never a redirect", async () => {
    setRequest({ host: "bitocard.com" });
    await chooseMarket("ng");
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  test("staying global is a choice too; anything else is ignored", async () => {
    setRequest({ host: "bitocard.com" });
    await chooseMarket("global");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    await chooseMarket("https://evil.example");
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("onResellerStore", () => {
  test("true on a reseller's hosted store, false on bitocard.com itself", async () => {
    setRequest({ host: "bitocard.com" });
    expect(await onResellerStore()).toBe(false);

    setRequest({ host: "acme.bitocard.com" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ object: "storefront", name: "Acme", subdomain: "acme", house: false }), { status: 200 })));
    expect(await onResellerStore()).toBe(true);
  });
});
