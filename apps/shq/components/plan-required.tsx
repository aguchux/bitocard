"use client";

import { Sparkles } from "lucide-react";
import { errorMessage, Notice } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";

/** Whether the API refused something because the reseller's plan does not include it (`plan_feature_required`). */
export function isPlanRefusal(error: unknown) {
  return (error as { code?: unknown } | null | undefined)?.code === "plan_feature_required";
}

/** The API's refusal for a feature outside the plan, with the way to a plan that has it. */
export function PlanRequired({ error }: { error: unknown }) {
  return (
    <Notice tone="amber" title="Not part of your plan">
      <span className="block">{errorMessage(error, "Your plan does not include this.")}</span>
      <AppLink href="/settings/plan" className="mt-2 inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
        <Sparkles className="size-4" aria-hidden /> See the plans
      </AppLink>
    </Notice>
  );
}
