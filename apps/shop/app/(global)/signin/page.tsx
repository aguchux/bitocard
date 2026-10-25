import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { handoffStart } from "@bitocard/ui/handoff";
import { ContinueAs } from "@bitocard/ui/handoff-ui";
import { appUrl } from "@bitocard/ui/site";
import { SignInForm } from "@/components/account-forms";
import { currentCustomer, safeNext, siteOrigin } from "@/lib/customer";
import { signedInElsewhere } from "@/lib/handoff";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true }, alternates: { canonical: "/signin" } };

const reasons: Record<string, string> = {
  chat: "Sign in to chat with the seller",
  phone: "Sign in to see the seller's phone",
  save: "Sign in to save listings",
  buy: "Sign in to buy with Safe pay",
  report: "Sign in to report a listing",
  sell: "Sign in to sell on BitoCard Shop",
};

/**
 * Sign in with a BitoCard account: **Continue as <name>** when the customer is signed in on another BitoCard site (one
 * click, through a one-time code from that site), else the email and password. New customers create their account on
 * bitocard.com and come straight back here.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; for?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await currentCustomer()) redirect(next);
  const elsewhere = await signedInElsewhere();
  const self = siteOrigin();
  const backHere = `/handoff/go?to=${encodeURIComponent(self)}&next=${encodeURIComponent(next)}`;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <h1 className="text-2xl leading-tight font-extrabold">{reasons[params.for ?? ""] ?? "Sign in to BitoCard Shop"}</h1>
      <p className="text-sm text-navy-600">Use the same BitoCard account you buy gift cards and airtime with.</p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        {elsewhere ? <ContinueAs name={elsewhere.name} host={elsewhere.host} href={handoffStart(elsewhere.origin, self, next)} /> : null}
        <SignInForm next={next} />
        <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm">
          <a href={appUrl("storefront", `/forgot-password?next=${encodeURIComponent(backHere)}`)} className="font-semibold text-brand-700 hover:underline">
            Forgot password?
          </a>
          <a href={appUrl("storefront", `/signup?next=${encodeURIComponent(backHere)}`)} className="font-bold text-brand-700 hover:underline">
            Create an account
          </a>
        </div>
      </section>
    </div>
  );
}
