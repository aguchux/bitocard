import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/account-forms";
import { AuthPage } from "@/components/auth-page";
import { countries } from "@/lib/api";
import { currentSession, nextStep, safeNext } from "@/lib/customer";

export const metadata: Metadata = { title: "Create your account", robots: { index: false, follow: true }, alternates: { canonical: "/signup" } };

/** A new Afrippa account: then the emailed code, then two-step sign-in (required from day one). */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const session = await currentSession();
  if (session) redirect(nextStep(session, next));
  return (
    <AuthPage
      title="Create your Afrippa account"
      lead="Buy and sell crypto with people in your country. You will confirm your email and set up two-step sign-in next."
      below={
        <p className="text-sm text-navy-600">
          Already have an account?{" "}
          <Link href={`/signin?next=${encodeURIComponent(next)}`} className="font-bold text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <SignUpForm next={next} countries={await countries()} />
    </AuthPage>
  );
}
