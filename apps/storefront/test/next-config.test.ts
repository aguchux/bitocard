// The /resellers redirect runs on the Host header alone before any page or API call, so it cannot ask which
// subdomains are house-owned: every country store (docs/BITOCARD_COUNTRY_STORES_PLAN.md, Stage 5) is kept off it by
// its subdomain shape (exactly two letters, never a reseller's — reseller subdomains need at least three characters),
// not by a maintained list of pilot codes.
import { describe, expect, test } from "vitest";
import config from "../next.config";

describe("next.config redirects", () => {
  test("/resellers sends a reseller's own subdomain to bitocard.com, but never any market's country store", async () => {
    const redirects = await config.redirects!();
    const rule = redirects!.find(item => item.source === "/resellers" && "has" in item);
    // Next.js anchors `has`/`missing` host matching with ^...$ (prepare-destination.js's matchHas): match the same way.
    const pattern = new RegExp(`^${(rule as { has: Array<{ value: string }> }).has[0].value}$`);
    for (const host of ["adadigital.bitocard.com", "acme.bitocard.com"]) expect(pattern.test(host), host).toBe(true);
    // Not just the three original pilots: any two-letter country code, for any market the list ever grows to.
    for (const host of ["bitocard.com", "www.bitocard.com", "ng.bitocard.com", "gh.bitocard.com", "ke.bitocard.com", "us.bitocard.com", "za.bitocard.com"]) {
      expect(pattern.test(host), host).toBe(false);
    }
  });
});
