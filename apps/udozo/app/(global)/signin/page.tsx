import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLinks } from "@/components/account-forms";
import { SignInForm } from "@/components/account/sign-in-up";
import { currentCustomer, safeNext } from "@/lib/customer";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true }, alternates: { canonical: "/signin" } };

const reasons: Record<string, string> = {
  chat: "Sign in to chat with the seller",
  phone: "Sign in to see the seller's phone",
  save: "Sign in to save listings",
  buy: "Sign in to buy with Safe pay",
  report: "Sign in to report a listing",
  sell: "Sign in to sell on Udozo",
};

/** Sign in with a Udozo account, the email first, then its password: the same account works on udozo.com and every Udozo store. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; for?: string; email?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await currentCustomer()) redirect(next);
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <h1 className="text-2xl leading-tight font-extrabold">{reasons[params.for ?? ""] ?? "Sign in to Udozo"}</h1>
      <p className="text-sm text-navy-600">One Udozo account for buying and selling here and on every Udozo store.</p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        <SignInForm next={next} email={params.email?.slice(0, 254) ?? ""} />
        <AuthLinks next={next} page="signin" />
      </section>
    </div>
  );
}
