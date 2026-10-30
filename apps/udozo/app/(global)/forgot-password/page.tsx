import type { Metadata } from "next";
import { ForgotForm } from "@/components/account-forms";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

/** Forgot password: a code is emailed (the same answer whether or not the account exists). */
export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold">Reset your password</h1>
      <p className="text-sm text-navy-600">Enter the email of your Udozo account. We will email you a code.</p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        <ForgotForm email={typeof email === "string" ? email.slice(0, 254) : ""} />
      </section>
    </div>
  );
}
