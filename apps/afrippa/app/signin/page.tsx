import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";
import { currentSession, nextStep, safeNext } from "@/lib/customer";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true }, alternates: { canonical: "/signin" } };

const reasons: Record<string, string> = {
  trade: "Sign in to trade",
  post: "Sign in to post an ad",
};

/** Signing in with an Afrippa account: the email and password, then the two-step code. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; for?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const session = await currentSession();
  if (session) redirect(nextStep(session, next));
  const query = `?next=${encodeURIComponent(next)}`;
  return (
    <AuthPage
      title={reasons[params.for ?? ""] ?? "Sign in to Afrippa"}
      below={
        <p className="text-sm text-navy-600">
          New to Afrippa?{" "}
          <Link href={`/signup${query}`} className="font-bold text-brand-700 hover:underline">
            Create an account
          </Link>
        </p>
      }
    >
      <SignInForm next={next} />
      <Link href={`/forgot-password${query}`} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
        Forgot password?
      </Link>
    </AuthPage>
  );
}
