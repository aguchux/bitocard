import { describe, expect, test } from "vitest";
import type { KycCase } from "@bitocard/api-client/kyc";
import { currentStep, neighbours, pendingItems, planSteps, progress, redone } from "@/lib/steps";

const base: KycCase = {
  object: "kyc_case",
  id: "kyc_1",
  kind: "kyc",
  subject: "customer",
  mode: "live",
  country: "NG",
  country_name: "Nigeria",
  brand: { name: "Ada Gifts", logo_url: null },
  status: "draft",
  consented: false,
  business_type: null,
  business: null,
  identity: null,
  id_types: [
    { code: "passport", label: "International passport", back: false },
    { code: "nin", label: "National ID card", back: true },
  ],
  documents: [],
  liveness: null,
  required: ["consent", "identity", "id_front", "id_back", "selfie", "liveness"],
  missing: ["consent", "identity", "id_front", "id_back", "selfie", "liveness"],
  resubmit_items: [],
  reason: null,
  note: null,
  return_url: "https://ada.bitocard.com/account/verification",
  submitted_at: null,
  decided_at: null,
};
const make = (change: Partial<KycCase>): KycCase => ({ ...base, ...change });
const doc = (kind: string, at = "2026-10-10T10:00:00Z") => ({ kind, content_type: "image/jpeg", size: 1000, uploaded_at: at });

describe("the wizard's steps", () => {
  test("a new KYC case starts with consent and ends with the review", () => {
    expect(planSteps(base)).toEqual(["consent", "identity", "id_front", "id_back", "selfie", "liveness", "review"]);
    expect(currentStep(base)).toBe("consent");
  });

  test("resumes at the first thing still missing, then the review", () => {
    expect(currentStep(make({ consented: true, missing: ["id_front", "id_back", "selfie", "liveness"] }))).toBe("id_front");
    expect(currentStep(make({ consented: true, missing: [] }))).toBe("review");
  });

  test("an ID without a back skips that photo", () => {
    const kase = make({ consented: true, identity: { id_type: "passport", id_number_hint: "••••1234", full_name: "Ada Obi", date_of_birth: "1990-01-01" }, missing: ["id_front", "id_back"] });
    expect(planSteps(kase)).not.toContain("id_back");
    expect(pendingItems(kase)).toEqual(["id_front"]);
  });

  test("KYB: the business type first; a registered business adds its three documents", () => {
    const kyb = make({ kind: "kyb", subject: "reseller", required: ["consent", "business", "identity", "id_front", "selfie", "liveness"], missing: ["business", "identity", "id_front", "selfie", "liveness"], consented: true });
    expect(currentStep(kyb)).toBe("business");
    const registered = make({
      ...kyb,
      business_type: "registered",
      required: ["consent", "business", "business_registration", "business_address", "business_directors", "identity", "id_front", "selfie", "liveness"],
      missing: ["business_registration", "business_address", "business_directors", "identity", "id_front", "selfie", "liveness"],
    });
    expect(planSteps(registered)).toEqual(["consent", "business", "business_registration", "business_address", "business_directors", "identity", "id_front", "selfie", "liveness", "review"]);
    expect(currentStep(registered)).toBe("business_registration");
  });

  test("sent cases show their status", () => {
    for (const status of ["submitted", "approved", "declined"] as const) {
      expect(planSteps(make({ status }))).toEqual(["status"]);
      expect(currentStep(make({ status }))).toBe("status");
    }
  });

  test("a resubmission asks only for what the reviewer ticked, until it is redone", () => {
    const decided = "2026-10-11T09:00:00Z";
    const kase = make({ status: "resubmit", consented: true, missing: [], resubmit_items: ["id_front", "selfie"], decided_at: decided, documents: [doc("id_front"), doc("selfie")] });
    expect(planSteps(kase)).toEqual(["id_front", "selfie", "review"]);
    expect(currentStep(kase)).toBe("id_front");
    const front = { ...kase, documents: [doc("id_front", "2026-10-12T09:00:00Z"), doc("selfie")] };
    expect(currentStep(front)).toBe("selfie");
    expect(currentStep(front, new Set(["selfie"]))).toBe("review");
  });

  test("liveness counts as redone only when every new frame came after the decision", () => {
    const decided = "2026-10-11T09:00:00Z";
    const liveness = { steps: [{ code: "smile", label: "Smile" }, { code: "look_up", label: "Look up" }], frames_per_step: 3 };
    const later = "2026-10-12T09:00:00Z";
    const frames = (n: number) => Array.from({ length: n }, (_, i) => doc(`liveness_${Math.floor(i / 3)}_${i % 3}`, later));
    const kase = make({ status: "resubmit", consented: true, missing: [], resubmit_items: ["liveness"], decided_at: decided, liveness });
    expect(redone({ ...kase, documents: frames(5) }).has("liveness")).toBe(false);
    expect(redone({ ...kase, documents: frames(6) }).has("liveness")).toBe(true);
    expect(currentStep({ ...kase, documents: frames(6) })).toBe("review");
  });

  test("neighbours and progress", () => {
    const plan = planSteps(base);
    expect(neighbours(plan, "id_front")).toEqual({ previous: "identity", next: "id_back" });
    expect(neighbours(plan, "consent").previous).toBeNull();
    expect(neighbours(plan, "review").next).toBeNull();
    expect(progress(plan, "consent")).toEqual({ number: 1, total: 7, percent: 14 });
    expect(progress(plan, "review").percent).toBe(100);
  });
});
