import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { type MethodChoice, TwoStepSetup, TwoStepVerify } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";
import { currentSession, customerApi, nextStep, safeNext, signInPath } from "@/lib/customer";

export const metadata: Metadata = { title: "Two-step sign-in", robots: { index: false, follow: false } };

type Settings = { method: MethodChoice["method"] | null; setup_required: boolean; method_not_allowed: boolean; sent_to: string | null; methods: MethodChoice[] };

/**
 * Two-step sign-in, required for every trader: a new account (or one whose method is no longer allowed, once proved)
 * sets a method up; everyone else enters its code.
 */
export default async function TwoStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const session = await currentSession();
  if (!session) redirect(signInPath(next));
  if (!session.email_verified || !session.two_step.pending) redirect(nextStep(session, next));
  const settings = await customerApi<Settings>("GET", "/v1/afrippa/account/two-step");
  if (!settings.ok) {
    return (
      <AuthPage title="Two-step sign-in">
        <p className="text-sm text-navy-600">This cannot be shown right now. Try again shortly.</p>
      </AuthPage>
    );
  }
  const { setup_required, method, sent_to, methods, method_not_allowed } = settings.data;
  if (setup_required || !method) {
    const lead = method_not_allowed
      ? "Your method is no longer offered in your country. Choose another to finish signing in."
      : "Every Afrippa account confirms each sign-in with a second step. It keeps your coins safe if your password is ever stolen.";
    return (
      <AuthPage title="Set up two-step sign-in" lead={lead}>
        <TwoStepSetup methods={methods} next={next} />
      </AuthPage>
    );
  }
  return (
    <AuthPage title="Confirm it is you">
      <TwoStepVerify method={method} sentTo={sent_to} next={next} />
    </AuthPage>
  );
}
