// Udozo Connect on udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 2): the Connect Centre agreement applicants accept, the
// footer's links to it and to connect.udozo.com, and notices' /connect/... addresses opening connect.udozo.com.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectUrl } from "@/lib/connect";
import { legalDocuments } from "@/lib/legal";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Udozo Connect on udozo.com", () => {
  it("publishes the Connect Centre agreement at the address the API names, with the owner's rules", () => {
    const agreement = legalDocuments.find(doc => doc.slug === "connect-centres");
    expect(agreement?.title).toBe("Connect Centre agreement");
    const text = JSON.stringify(agreement);
    for (const rule of ["deposit", "72 hours", "2.1%", "48 hours", "Loss of care", "₦500 a day", "30 days in Loss of care", "auction after 90 days", "70% of the Connect fee"]) expect(text).toContain(rule);
    // The API asks applicants to accept the agreement at this path (connectAgreementPath).
    expect(read("../../udozo-api/src/connect/applications.service.ts")).toContain("export const connectAgreementPath = '/legal/connect-centres';");
  });

  it("says in the privacy notice what an application keeps, and in the cookie notice how connect.udozo.com signs in", () => {
    const privacy = JSON.stringify(legalDocuments.find(doc => doc.slug === "privacy"));
    expect(privacy).toContain("Connect Centre applications");
    expect(privacy).toContain("connect.udozo.com");
    expect(JSON.stringify(legalDocuments.find(doc => doc.slug === "cookies"))).toContain("udz_connect");
  });

  it("links to connect.udozo.com and the agreement from the footer, and sends notices' addresses there", () => {
    expect(connectUrl).toBe("https://connect.udozo.com");
    const footer = read("../components/footer.tsx");
    expect(footer).toContain("Become a Connect Centre");
    expect(footer).toContain('href="/legal/connect-centres"');
    expect(read("../next.config.ts")).toContain('{ source: "/connect/:path*", destination: `${(process.env.NEXT_PUBLIC_CONNECT_URL ?? "https://connect.udozo.com")');
  });
});
