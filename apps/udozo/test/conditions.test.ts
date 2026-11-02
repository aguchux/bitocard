// A listing's condition: the stored value `untested` is shown as Foreign used wherever people read it, and old filter
// links keep working.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conditionLabels } from "@bitocard/api-client/classifieds";
import { resaleCondition } from "@/lib/resale-links";
import { readFilters } from "@/lib/search";

describe("listing conditions", () => {
  it("shows untested as Foreign used", () => {
    expect(conditionLabels).toEqual({ new: "New", used: "Used", untested: "Foreign used", parts: "For parts" });
    expect(resaleCondition("untested")).toBe("Foreign used");
    expect(resaleCondition(null)).toBeNull();
  });

  it("keeps the stored value in filter links", () => {
    expect(readFilters({ condition: "untested" }).condition).toEqual(["untested"]);
  });

  it("keeps one list of labels on udozo.com, Seller HQ and the admin", () => {
    const pages = ["apps/udozo/lib/resale-links.ts", "apps/udozo-admin/components/home/registry.tsx", "apps/udozo-admin/app/(console)/classifieds/listings/[id]/page.tsx", "apps/udozo-shq/app/(console)/resale/catalogue/[id]/page.tsx"];
    const root = join(process.cwd(), "..", "..");
    for (const page of pages) expect(readFileSync(join(root, page), "utf8"), page).not.toContain('"Untested"');
  });
});
