import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { SimulateCheck, StartCheckForm } from "@/components/verification";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { checkText, type TraderVerification } from "@/lib/verification-types";

export const metadata: Metadata = { title: "Verify your identity", robots: { index: false, follow: false } };

/**
 * The identity check, needed to trade with real money: where it stands, and starting or carrying on with it on
 * verify.afrippa.com (Verify in Afrippa's name; reviewed by a person on Afrippa's team). The sandbox simulates it.
 */
export default async function VerificationPage() {
  await requireCustomer("/verification");
  const result = await customerApi<TraderVerification>("GET", "/v1/afrippa/account/verification");
  return (
    <AccountShell title="Verify your identity" current="/wallets">
      {!result.ok ? (
        <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
          <p className="font-semibold">We could not load your identity check</p>
          <p className="mt-1 text-sm text-slate-600">{result.message}</p>
        </section>
      ) : (
        <CheckSection verification={result.data} />
      )}
    </AccountShell>
  );
}

function CheckSection({ verification }: { verification: TraderVerification }) {
  const { title, body, action } = checkText(verification);
  const sandbox = verification.mode === "test";
  return (
    <section className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{body}</p>
      </div>
      {action && !(sandbox && action === "continue") ? <StartCheckForm label={action === "continue" ? "Carry on with my check" : action === "again" ? "Start a new check" : "Start my check"} /> : null}
      {sandbox && verification.latest?.status === "in_progress" ? <SimulateCheck /> : null}
    </section>
  );
}
