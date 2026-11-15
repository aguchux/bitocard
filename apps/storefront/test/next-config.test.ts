// The /resellers redirect runs on the Host header alone: every subdomain of bitocard.com but www is a reseller's store
// (country stores are retired, docs/BITOCARD_MULTI_WALLETS_PLAN.md).
import { describe, expect, test } from "vitest";
import config from "../next.config";

describe("next.config redirects", () => {
  test("/resellers sends a reseller's own subdomain to bitocard.com", async () => {
    const redirects = await config.redirects!();
    const rule = redirects!.find(item => item.source === "/resellers" && "has" in item);
    // Next.js anchors `has`/`missing` host matching with ^...$ (prepare-destination.js's matchHas): match the same way.
    const pattern = new RegExp(`^${(rule as { has: Array<{ value: string }> }).has[0].value}$`);
    for (const host of ["adadigital.bitocard.com", "acme.bitocard.com", "ng.bitocard.com"]) expect(pattern.test(host), host).toBe(true);
    for (const host of ["bitocard.com", "www.bitocard.com"]) expect(pattern.test(host), host).toBe(false);
  });


  test("crypto's old addresses go to the wallet, cash-out included; nothing goes to BitoCard Shop", async () => {
    const redirects = await config.redirects!();
    const crypto = redirects!.find(item => item.source === "/account/crypto/:path*");
    expect(crypto?.destination).toBe("/account/wallet");
    expect(redirects!.some(item => item.source === "/account/crypto/cash-out")).toBe(false);
    expect(redirects!.some(item => item.source.startsWith("/shop") || item.destination.includes("/shop"))).toBe(false);
  });
});
