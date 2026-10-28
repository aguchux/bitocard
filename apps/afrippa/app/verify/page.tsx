import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";
import { currentSession, nextStep, safeNext, signInPath } from "@/lib/customer";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

/** A new account confirms its email here, before setting two-step up. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const session = await currentSession();
  if (!session) redirect(signInPath(next));
  if (session.email_verified) redirect(nextStep(session, next));
  return (
    <AuthPage title="Confirm your email" lead={`We sent a 6-digit code to ${session.email}. Enter it to carry on.`}>
      <VerifyForm next={next} />
    </AuthPage>
  );
}
