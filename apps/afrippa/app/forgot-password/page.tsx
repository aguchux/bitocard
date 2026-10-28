import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";
import { safeNext } from "@/lib/customer";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false, follow: false } };

/** A new password with an emailed code; signing in then still asks for the two-step code. */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <AuthPage title="Forgot your password?" lead="Enter your email and we will send you a code to choose a new password.">
      <ForgotPasswordForm next={next} />
    </AuthPage>
  );
}
