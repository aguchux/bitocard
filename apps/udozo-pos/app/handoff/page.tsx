import type { Metadata } from "next";
import { HandoffLanding } from "@bitocard/ui/handoff-ui";
import { PosMark } from "@/components/site-chrome";
import { continueSignIn } from "@/lib/handoff-actions";

export const metadata: Metadata = { title: "Signing you in", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Where udozo.com sends a signed-in owner: `/handoff#c=<one-time code>&n=<path>`. */
export default function HandoffPage() {
  return (
    <>
      <header className="bg-pos-night px-4 py-4">
        <PosMark />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-16">
        <HandoffLanding continueSignIn={continueSignIn} />
      </main>
    </>
  );
}
