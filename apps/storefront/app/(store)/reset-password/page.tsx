import type { Metadata } from "next";
import { ResetForm } from "@/components/store/account-forms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email = "" } = await searchParams;
  return (
    <div className="mx-auto grid max-w-xl gap-5 py-6 sm:py-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c] sm:text-4xl">Choose a new password</h1>
        <p className="mt-2 text-slate-600">Enter the code from your email and your new password. This signs you out on your other devices.</p>
      </div>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <ResetForm email={email} />
      </section>
    </div>
  );
}
