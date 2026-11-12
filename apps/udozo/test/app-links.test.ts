// Udozo's mobile app opens udozo.com links itself (docs/UDOZO_MOBILE_APP_PLAN.md, phase 0): Apple's
// apple-app-site-association and Android's assetlinks.json name the app and the pages, only on udozo.com.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const { GET: apple } = await import("@/app/.well-known/apple-app-site-association/route");
const { GET: android } = await import("@/app/.well-known/assetlinks.json/route");
const { appLinkPaths, appleAssociation, androidAssetLinks, servesAppLinks } = await import("@/lib/app-links");

const cert = Array.from({ length: 32 }, (_, i) => (i + 10).toString(16).padStart(2, "0")).join(":").toUpperCase();
const request = (path: string, host = "udozo.com") => new NextRequest(`https://${host}${path}`, { headers: { host } });

beforeEach(() => {
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
});

afterEach(() => vi.unstubAllEnvs());

describe("the files", () => {
  test("nothing until the app's IDs are set", () => {
    expect(appleAssociation({})).toBeNull();
    expect(androidAssetLinks({ UDOZO_ANDROID_PACKAGE: "com.udozo.app" })).toBeNull();
    expect(androidAssetLinks({ UDOZO_ANDROID_CERT_SHA256: cert })).toBeNull();
  });

  test("Apple's names the app and only the pages it opens, with shared passwords", () => {
    const file = appleAssociation({ UDOZO_IOS_APP_IDS: "ABCDE12345.com.udozo.app, not-an-id" });
    expect(file).toEqual({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.udozo.app"], components: appLinkPaths.map(path => ({ "/": path })) }] },
      webcredentials: { apps: ["ABCDE12345.com.udozo.app"] },
    });
    expect(appLinkPaths).toContain("/pay/*");
    expect(appLinkPaths).not.toContain("/api/*");
  });

  test("Android's names the package and its certificates, upper case", () => {
    expect(androidAssetLinks({ UDOZO_ANDROID_PACKAGE: "com.udozo.app", UDOZO_ANDROID_CERT_SHA256: `${cert.toLowerCase()}, nonsense` })).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: "com.udozo.app", sha256_cert_fingerprints: [cert] },
      },
    ]);
    expect(androidAssetLinks({ UDOZO_ANDROID_PACKAGE: "Udozo App", UDOZO_ANDROID_CERT_SHA256: cert })).toBeNull();
  });

  test("only udozo.com claims its links, never a reseller's own domain", () => {
    expect(servesAppLinks("udozo.com")).toBe(true);
    expect(servesAppLinks("www.udozo.com")).toBe(true);
    expect(servesAppLinks("localhost:3007")).toBe(true);
    expect(servesAppLinks("shop.example.com")).toBe(false);
    expect(servesAppLinks("abc.udozo.com")).toBe(false);
    expect(servesAppLinks(null)).toBe(false);
  });
});

describe("the routes", () => {
  test("404 until set up", async () => {
    expect((await apple(request("/.well-known/apple-app-site-association"))).status).toBe(404);
    expect((await android(request("/.well-known/assetlinks.json"))).status).toBe(404);
  });

  test("JSON, cached an hour, once set up; 404 on a store's domain", async () => {
    vi.stubEnv("UDOZO_IOS_APP_IDS", "ABCDE12345.com.udozo.app");
    vi.stubEnv("UDOZO_ANDROID_PACKAGE", "com.udozo.app");
    vi.stubEnv("UDOZO_ANDROID_CERT_SHA256", cert);
    const ios = await apple(request("/.well-known/apple-app-site-association"));
    expect(ios.status).toBe(200);
    expect(ios.headers.get("content-type")).toBe("application/json");
    expect(ios.headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await ios.json()).applinks.details[0].appIDs).toEqual(["ABCDE12345.com.udozo.app"]);
    const droid = await android(request("/.well-known/assetlinks.json"));
    expect((await droid.json())[0].target.package_name).toBe("com.udozo.app");
    expect((await apple(request("/.well-known/apple-app-site-association", "shop.example.com"))).status).toBe(404);
  });

  test("the proxy leaves .well-known alone, so Apple's file is never rewritten to a store", () => {
    const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    expect(proxy).toContain("\\.well-known/");
  });
});
