import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cardClass } from "@afrippa/ui/trade-views";
import { ChangePasswordForm, type MethodChoice, PhoneForm, RecoveryCodesForm, TwoStepSetup } from "@/components/account-forms";
import { AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Security", robots: { index: false, follow: false } };

type TwoStepSettings = { method: MethodChoice["method"] | null; sent_to: string | null; recovery_codes_left: number; methods: MethodChoice[] };

const methodName: Record<MethodChoice["method"], string> = { authenticator: "An authenticator app", email: "Codes by email", sms: "Codes by text message" };

/**
 * The trader's own security: their password, their two-step method (changed only with a code from it; never turned
 * off), new recovery codes, and the mobile number texted codes go to. Every change is emailed to them.
 */
export default async function SecurityPage() {
  const trader = await requireCustomer("/security");
  const settings = await customerApi<TwoStepSettings>("GET", "/v1/afrippa/account/two-step");
  const twoStep = settings.ok ? settings.data : null;
  return (
    <AccountShell title="Security" current="/security">
      <Section title="Two-step sign-in">
        {twoStep?.method ? (
          <>
            <p className="text-sm text-navy-600">
              {methodName[twoStep.method]}
              {twoStep.sent_to ? `, to ${twoStep.sent_to}` : ""}. {twoStep.recovery_codes_left} recovery {twoStep.recovery_codes_left === 1 ? "code" : "codes"} left. Two-step sign-in stays on: you can change the method, never turn it off.
            </p>
            <details className="rounded-2xl ring-1 ring-slate-200">
              <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">Change my method</summary>
              <div className="px-4 pb-4">
                <TwoStepSetup methods={twoStep.methods} next="/security" changing={twoStep.method} />
              </div>
            </details>
            <details className="rounded-2xl ring-1 ring-slate-200">
              <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">New recovery codes</summary>
              <div className="px-4 pb-4">
                <RecoveryCodesForm />
              </div>
            </details>
          </>
        ) : (
          <p className="text-sm text-navy-600">Your two-step settings cannot be shown right now. Try again shortly.</p>
        )}
      </Section>
      <Section title="Mobile number">
        <p className="text-sm text-navy-600">
          {trader.phone ? `${trader.phone}${trader.phone_verified ? ", confirmed" : ", not confirmed yet"}.` : "No mobile number yet."} A confirmed number lets you get two-step codes by text message.
        </p>
        <PhoneForm current={trader.phone} />
      </Section>
      <Section title="Password">
        <p className="text-sm text-navy-600">Signed up with Google and never set a password? Use Forgot password when signing in to set one.</p>
        <ChangePasswordForm />
      </Section>
    </AccountShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${cardClass} grid gap-3`} aria-label={title}>
      <h2 className="font-display text-lg font-extrabold">{title}</h2>
      {children}
    </section>
  );
}
