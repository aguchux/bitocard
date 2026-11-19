// BitoCard's mobile app opens bitocard.com links itself (docs/BITOCARD_MOBILE_APP_PLAN.md, phase 5): Apple's
// apple-app-site-association and Android's assetlinks.json name the app and the pages it has screens for, only on
// bitocard.com, never a reseller's store.
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const { GET: apple } = await import("@/app/.well-known/apple-app-site-association/route");
const { GET: android } = await import("@/app/.well-known/assetlinks.json/route");
const { appLinkPaths, appleAssociation, androidAssetLinks, servesAppLinks } = await import("@/lib/app-links");

const cert = Array.from({ length: 32 }, (_, i) => (i + 10).toString(16).padStart(2, "0")).join(":").toUpperCase();
const request = (path: string, host = "bitocard.com") => new NextRequest(`https://${host}${path}`, { headers: { host } });

afterEach(() => vi.unstubAllEnvs());

describe("the files", () => {
  test("nothing until the app's IDs are set", () => {
    expect(appleAssociation({})).toBeNull();
    expect(androidAssetLinks({ BITOCARD_ANDROID_PACKAGE: "com.bitocard.app" })).toBeNull();
    expect(androidAssetLinks({ BITOCARD_ANDROID_CERT_SHA256: cert })).toBeNull();
  });

  test("Apple's names the app and only the pages it opens, with shared passwords", () => {
    const file = appleAssociation({ BITOCARD_IOS_APP_IDS: "ABCDE12345.com.bitocard.app, not-an-id" });
    expect(file).toEqual({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.bitocard.app"], components: appLinkPaths.map(path => ({ "/": path })) }] },
      webcredentials: { apps: ["ABCDE12345.com.bitocard.app"] },
    });
    expect(appLinkPaths).toContain("/account/orders/*");
    expect(appLinkPaths).not.toContain("/account/*");
  });

  test("Android's names the package and its certificates, upper case", () => {
    expect(androidAssetLinks({ BITOCARD_ANDROID_PACKAGE: "com.bitocard.app", BITOCARD_ANDROID_CERT_SHA256: `${cert.toLowerCase()}, nonsense` })).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: "com.bitocard.app", sha256_cert_fingerprints: [cert] },
      },
    ]);
    expect(androidAssetLinks({ BITOCARD_ANDROID_PACKAGE: "BitoCard App", BITOCARD_ANDROID_CERT_SHA256: cert })).toBeNull();
  });

  test("only bitocard.com claims its links, never a reseller's store", () => {
    expect(servesAppLinks("bitocard.com")).toBe(true);
    expect(servesAppLinks("www.bitocard.com")).toBe(true);
    expect(servesAppLinks("localhost:3000")).toBe(true);
    expect(servesAppLinks("ada.bitocard.com")).toBe(false);
    expect(servesAppLinks("shop.example.com")).toBe(false);
    expect(servesAppLinks(null)).toBe(false);
  });

  test("the app's own intent filters claim the same pages", () => {
    const app = JSON.parse(readFileSync(new URL("../../../mobile/bitocard/app.json", import.meta.url), "utf8"));
    const filter = app.expo.android.intentFilters.find((item: { autoVerify?: boolean }) => item.autoVerify);
    const claimed = filter.data.map((item: { path?: string; pathPrefix?: string }) => item.path ?? `${item.pathPrefix}*`).sort();
    expect(claimed).toEqual([...appLinkPaths].sort());
    expect(filter.data.every((item: { scheme: string; host: string }) => item.scheme === "https" && item.host === "bitocard.com")).toBe(true);
    expect(app.expo.ios.associatedDomains).toEqual(["applinks:bitocard.com", "webcredentials:bitocard.com"]);
  });
});

describe("the routes", () => {
  test("404 until set up, and on a reseller's store", async () => {
    expect((await apple(request("/.well-known/apple-app-site-association"))).status).toBe(404);
    vi.stubEnv("BITOCARD_IOS_APP_IDS", "ABCDE12345.com.bitocard.app");
    expect((await apple(request("/.well-known/apple-app-site-association", "ada.bitocard.com"))).status).toBe(404);
  });

  test("JSON once set, cached an hour", async () => {
    vi.stubEnv("BITOCARD_IOS_APP_IDS", "ABCDE12345.com.bitocard.app");
    vi.stubEnv("BITOCARD_ANDROID_PACKAGE", "com.bitocard.app");
    vi.stubEnv("BITOCARD_ANDROID_CERT_SHA256", cert);
    const ios = await apple(request("/.well-known/apple-app-site-association"));
    expect(ios.status).toBe(200);
    expect(ios.headers.get("content-type")).toBe("application/json");
    expect(ios.headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await ios.json()).applinks.details[0].appIDs).toEqual(["ABCDE12345.com.bitocard.app"]);
    const droid = await android(request("/.well-known/assetlinks.json"));
    expect((await droid.json())[0].target.package_name).toBe("com.bitocard.app");
  });
});
