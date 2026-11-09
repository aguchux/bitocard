// The rules the pages share: which wizard step a refusal opens, where each requirement is put right, the step an
// application opens on, and its timeline.
import { describe, expect, it } from "vitest";
import { firstStep, requirementKeys, requirementLink, stepForParam, timeline } from "@/lib/connect";
import { application } from "./fixtures";

describe("the step a refusal opens", () => {
  it("is the step holding the field", () => {
    expect(stepForParam("business_name")).toBe("business");
    expect(stepForParam("registration_number")).toBe("business");
    expect(stepForParam("area_id")).toBe("office");
    expect(stepForParam("address")).toBe("office");
    expect(stepForParam("state")).toBe("office");
    expect(stepForParam("capacity")).toBe("running");
    expect(stepForParam("person_name")).toBe("running");
    expect(stepForParam("photos")).toBe("photos");
  });

  it("is Check and send for account requirements and the deposit", () => {
    for (const param of ["identity", "mobile", "agreement", "deposit", "expected_deposit", "version", null]) expect(stepForParam(param)).toBe("send");
  });

  it("is the first step still missing something for `details`", () => {
    expect(stepForParam("details", application({ hours: null }))).toBe("running");
    expect(stepForParam("details", application({ address: null }))).toBe("office");
    expect(stepForParam("details", application({ business_name: null, hours: null }))).toBe("business");
  });
});

describe("the step an application opens on", () => {
  it("is the first with a gap, then photos, then Check and send", () => {
    expect(firstStep(null)).toBe("business");
    expect(firstStep(application({ area: null }))).toBe("office");
    expect(firstStep(application({ photos: [] }))).toBe("photos");
    expect(firstStep(application())).toBe("send");
  });
});

describe("requirement links", () => {
  it("send account requirements to udozo.com and the rest to the wizard's steps", () => {
    const udozo = "https://udozo.com";
    expect(requirementLink("identity", udozo).href).toBe("https://udozo.com/account/verification");
    expect(requirementLink("mobile", udozo).href).toBe("https://udozo.com/account/profile#phone");
    expect(requirementLink("deposit", udozo).href).toBe("https://udozo.com/account/wallet");
    expect(requirementLink("agreement", udozo, "/legal/connect-centres").href).toBe("https://udozo.com/legal/connect-centres");
    expect(requirementLink("photos", udozo).step).toBe("photos");
    expect(requirementLink("state", udozo).step).toBe("office");
    expect(requirementLink("details", udozo).step).toBe("business");
    for (const key of requirementKeys) expect(requirementLink(key, udozo).label).toBeTruthy();
  });
});

describe("the timeline", () => {
  it("tells what happened, in order", () => {
    const items = timeline(
      application({
        status: "rejected",
        submitted_at: "2026-11-09T10:00:00.000Z",
        changes: { note: "A clearer shopfront photo, please.", at: "2026-11-10T10:00:00.000Z" },
        visit: { at: "2026-11-12T10:00:00.000Z", note: null, visitor: { name: "Tunde", phone: null }, confirmed_at: null, reschedule_note: null, visited_at: "2026-11-12T11:00:00.000Z" },
        decision: { at: "2026-11-13T10:00:00.000Z", reason: "The office is too small." },
      }),
    );
    expect(items.map(item => item.key)).toEqual(["started", "sent", "changes", "visit", "visited", "rejected"]);
    expect(items.at(-1)!.body).toBe("The office is too small.");
  });
});
