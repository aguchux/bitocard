import type { Metadata } from "next";
import { ResetForm } from "@/components/account-forms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

/** The emailed code and a new password; every other device is signed out. */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold">Choose a new password</h1>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        <ResetForm email={typeof email === "string" ? email.slice(0, 254) : ""} />
      </section>
    </div>
  );
}
