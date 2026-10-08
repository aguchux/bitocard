import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { safeNext, shopperHeader, siteOrigin } from "@/lib/customer";
import { storeSubdomain } from "@/lib/store";

afterEach(() => vi.unstubAllEnvs());

describe("safeNext", () => {
  test("follows only paths on this site", () => {
    expect(safeNext("/account/orders/1?x=2")).toBe("/account/orders/1?x=2");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/a\\b", "account", "", null, undefined]) {
      expect(safeNext(bad), String(bad)).toBe("/account");
    }
    expect(safeNext("//evil.com", "/")).toBe("/");
  });
});

describe("storeSubdomain", () => {
  test("names a reseller's store from its host; bitocard.com and www are BitoCard's own", async () => {
    setRequest({ host: "acme.bitocard.com" });
    expect(await storeSubdomain()).toBe("acme");
    setRequest({ host: "acme.localhost:3000" });
    expect(await storeSubdomain()).toBe("acme");
    for (const host of ["bitocard.com", "www.bitocard.com", "acme.evil.com", "a.b.bitocard.com", ""]) {
      setRequest({ host });
      expect(await storeSubdomain(), host).toBeNull();
    }
  });
});

describe("siteOrigin", () => {
  test("comes from the store's configured address, never from forwarded headers", async () => {
    vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
    setRequest({ host: "bitocard.com", "x-forwarded-host": "evil.com", "x-forwarded-proto": "http" });
    expect(await siteOrigin()).toBe("https://bitocard.com");
    setRequest({ host: "acme.bitocard.com" });
    expect(await siteOrigin()).toBe("https://acme.bitocard.com");
  });
});

describe("shopperHeader", () => {
  const secret = "store-server-secret-for-tests-0123456789";

  test("signs the shopper's address the way the API checks it", async () => {
    vi.stubEnv("STORE_SERVER_SECRET", secret);
    setRequest({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    const now = 1_800_000_000_000;
    const header = (await shopperHeader(now))["bitocard-client"];
    const t = Math.floor(now / 1000);
    expect(header).toBe(`t=${t},ip=203.0.113.7,v1=${createHmac("sha256", secret).update(`${t}.203.0.113.7`).digest("hex")}`);
    setRequest({ "x-real-ip": "198.51.100.20", "x-forwarded-for": "203.0.113.7" });
    expect((await shopperHeader(now))["bitocard-client"]).toContain("ip=198.51.100.20");
  });

  test("sends nothing without the secret or a usable address", async () => {
    setRequest({ "x-forwarded-for": "203.0.113.7" });
    expect(await shopperHeader()).toEqual({});
    vi.stubEnv("STORE_SERVER_SECRET", secret);
    setRequest({ "x-forwarded-for": "not an address" });
    expect(await shopperHeader()).toEqual({});
  });
});
