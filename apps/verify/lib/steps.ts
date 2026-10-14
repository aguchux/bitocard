import { type KycCase, kycItems } from "@bitocard/api-client/kyc";

/** One screen of the wizard: an item the case needs, then the review, or the status once it is sent. */
export type StepKey = (typeof kycItems)[number] | "review" | "status";

export const stepTitles: Record<StepKey, string> = {
  consent: "Before you start",
  business: "Your business",
  business_registration: "Registration certificate",
  business_address: "Proof of business address",
  business_directors: "Directors and owners",
  identity: "Your ID details",
  id_front: "Front of your ID",
  id_back: "Back of your ID",
  selfie: "Selfie",
  liveness: "Liveness check",
  review: "Check and send",
  status: "Your check",
};

/** Cases the applicant can still change. */
export const editable = (kase: Pick<KycCase, "status">) => kase.status === "draft" || kase.status === "resubmit";

/** The ID type chosen, if any. */
export const chosenIdType = (kase: Pick<KycCase, "identity" | "id_types">) => kase.id_types.find(type => type.code === kase.identity?.id_type) ?? null;

/**
 * What the reviewer asked to redo that has been redone: documents uploaded again after the decision, liveness when every
 * frame of the new steps came after it, and anything the applicant saved again in this visit (`saved`).
 */
export function redone(kase: KycCase, saved: ReadonlySet<string> = new Set()): Set<string> {
  const done = new Set(saved);
  if (kase.status !== "resubmit") return done;
  const since = kase.decided_at ? Date.parse(kase.decided_at) : 0;
  const fresh = kase.documents.filter(document => Date.parse(document.uploaded_at) > since);
  for (const document of fresh) if (!document.kind.startsWith("liveness_")) done.add(document.kind);
  const frames = (kase.liveness?.steps.length ?? 0) * (kase.liveness?.frames_per_step ?? 3);
  if (frames && fresh.filter(document => document.kind.startsWith("liveness_")).length >= frames) done.add("liveness");
  return done;
}

/**
 * The screens this case needs, in order, ending with the review. Only what the API requires is asked (a registered
 * business adds its documents; an ID without a back skips that photo); when the reviewer asked to resubmit, only the
 * items asked for (and anything still missing). A sent case shows its status.
 */
export function planSteps(kase: KycCase): StepKey[] {
  if (!editable(kase)) return ["status"];
  const type = chosenIdType(kase);
  let items = kycItems.filter(item => kase.required.includes(item));
  if (type && !type.back) items = items.filter(item => item !== "id_back");
  if (kase.status === "resubmit") items = items.filter(item => kase.resubmit_items.includes(item) || kase.missing.includes(item));
  return [...items, "review"];
}

/** The items still to do: what is missing, and what the reviewer asked to redo that has not been redone yet. */
export function pendingItems(kase: KycCase, saved: ReadonlySet<string> = new Set()): string[] {
  const plan = planSteps(kase);
  const done = redone(kase, saved);
  return plan.filter(step => {
    if (step === "review" || step === "status") return false;
    if (step === "consent" && !kase.consented) return true;
    if (kase.missing.includes(step)) return true;
    return kase.status === "resubmit" && kase.resubmit_items.includes(step) && !done.has(step);
  });
}

/** Where to resume: the first screen with something still to do, else the review (or the status once sent). */
export function currentStep(kase: KycCase, saved: ReadonlySet<string> = new Set()): StepKey {
  if (!editable(kase)) return "status";
  return (pendingItems(kase, saved)[0] as StepKey | undefined) ?? "review";
}

/** The screen before and after one, in the plan. */
export function neighbours(plan: StepKey[], step: StepKey) {
  const at = plan.indexOf(step);
  return { previous: at > 0 ? plan[at - 1] : null, next: at >= 0 && at < plan.length - 1 ? plan[at + 1] : null };
}

/** "Step 3 of 8" for the progress bar. */
export function progress(plan: StepKey[], step: StepKey) {
  const at = Math.max(0, plan.indexOf(step));
  return { number: at + 1, total: plan.length, percent: Math.round(((at + 1) / plan.length) * 100) };
}
