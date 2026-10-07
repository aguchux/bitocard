import type { Metadata } from "next";
import { ForgotForm } from "@/components/store/account-forms";

export const metadata: Metadata = { title: "Forgot your password", alternates: { canonical: "/forgot-password" }, robots: { index: false, follow: true } };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto grid max-w-xl gap-5 py-6 sm:py-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c] sm:text-4xl">Forgot your password?</h1>
        <p className="mt-2 text-slate-600">Enter your account email and we will send you a code to choose a new password.</p>
      </div>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <ForgotForm />
      </section>
    </div>
  );
}
