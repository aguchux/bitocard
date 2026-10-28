import type { Metadata } from "next";
import { AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";

export const metadata: Metadata = { title: "Verify your identity", robots: { index: false, follow: false } };

/** The identity check, needed to trade with real money: it opens with verify.afrippa.com. */
export default async function VerificationPage() {
  await requireCustomer("/verification");
  return (
    <AccountShell title="Verify your identity" current="/wallets">
      <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
        <p className="font-semibold">Identity checks open soon</p>
        <p className="mt-1 text-sm text-slate-600">Trading with real money needs a quick identity check, once. We will tell you when you can do it here.</p>
      </section>
    </AccountShell>
  );
}
