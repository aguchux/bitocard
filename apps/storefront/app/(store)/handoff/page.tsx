import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HandoffLanding } from "@bitocard/ui/handoff-ui";
import { continueSignIn } from "@/lib/handoff-actions";
import { onHouseSite } from "@/lib/handoff";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false, follow: false } };

/** Where another BitoCard site sends a signed-in customer: `/handoff#c=<one-time code>&n=<path>`. */
export default async function HandoffPage() {
  if (!(await onHouseSite())) notFound();
  return (
    <div className="mx-auto max-w-md py-10 sm:py-16">
      <HandoffLanding continueSignIn={continueSignIn} />
    </div>
  );
}
