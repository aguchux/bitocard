import type { Metadata } from "next";
import { appUrl } from "@bitocard/ui/site";
import { LinkProblem } from "@/components/link-problem";
import { VerifyFooter, VerifyHeader } from "@/components/header";
import { Wizard } from "@/components/wizard";
import { currentCase } from "@/lib/api";
import { brand } from "@/lib/brand";

export const metadata: Metadata = { title: "Identity check" };

/** The applicant's check, resumed from where they left it. Without a session (or once it ended), how to get back in. */
export default async function VerifyPage() {
  const result = await currentCase();
  return (
    <>
      <VerifyHeader brand={result.ok ? result.data.brand : null} />
      <main className="mx-auto w-full max-w-xl px-4 py-5">
        {result.ok ? (
          <Wizard key={result.data.id} initial={result.data} privacyUrl={brand.key === "bitocard" ? appUrl("legals", "/documents/privacy") : brand.privacyUrl} />
        ) : (
          <LinkProblem unreachable={result.status === 0 || result.status >= 500} />
        )}
      </main>
      <VerifyFooter />
    </>
  );
}
