import { beforeEach, describe, expect, test, vi } from "vitest";

const currentStore = vi.fn();
const storeApi = vi.fn();
vi.mock("@/lib/store", () => ({ currentStore: () => currentStore() }));
vi.mock("@/lib/api", () => ({ storeApi: (...args: unknown[]) => storeApi(...args) }));

const { cryptoSite, cryptoSiteHref } = await import("@/lib/crypto-site");

describe("handing the Crypto tab to BitoCard Crypto", () => {
  beforeEach(() => {
    currentStore.mockReset();
    storeApi.mockReset();
  });

  test("a country store reads its own settings; root bitocard.com asks the API; unreachable is no", async () => {
    currentStore.mockResolvedValue({ store: { app: { desktop_nav: "rail", crypto_site: true } } });
    expect(await cryptoSite()).toBe(true);
    currentStore.mockResolvedValue({ store: null });
    storeApi.mockResolvedValue({ ok: true, data: { object: "store_app", desktop_nav: "rail", install_prompt: false, crypto_site: false } });
    expect(await cryptoSite()).toBe(false);
    expect(storeApi).toHaveBeenCalledWith("/v1/store/app");
    storeApi.mockResolvedValue({ ok: false, status: 0 });
    expect(await cryptoSite()).toBe(false);
  });

  test("the market asked becomes BitoCard Crypto's page for it, through this site's handoff", () => {
    expect(cryptoSiteHref({ market: "gh" })).toBe("/handoff/go?to=http%3A%2F%2Flocalhost%3A3008&next=%2Fgh");
    expect(cryptoSiteHref({ market: "WW" })).toContain("next=%2F");
    expect(cryptoSiteHref({ market: "../x" })).toContain("next=%2F");
  });
});
