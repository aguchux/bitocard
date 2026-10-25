import type { Metadata } from "next";
import { HandoffLanding } from "@bitocard/ui/handoff-ui";
import { continueSignIn } from "@/lib/handoff-actions";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false, follow: false } };

/** Where another BitoCard site sends a signed-in customer: `/handoff#c=<one-time code>&n=<path>`. */
export default function HandoffPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <HandoffLanding continueSignIn={continueSignIn} />
    </div>
  );
}
