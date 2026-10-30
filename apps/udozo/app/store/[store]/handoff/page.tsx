import type { Metadata } from "next";
import { HandoffLanding } from "@bitocard/ui/handoff-ui";
import { continueSignIn } from "@/lib/handoff-actions";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false, follow: false } };

/** Where udozo.com sends a signed-in shopper back to this store: `/handoff#c=<one-time code>&n=<path>`. */
export default function StoreHandoffPage() {
  return (
    <div className="mx-auto max-w-md py-10 sm:py-16">
      <HandoffLanding continueSignIn={continueSignIn} />
    </div>
  );
}
