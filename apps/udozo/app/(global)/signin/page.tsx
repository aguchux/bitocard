import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLinks } from "@/components/account-forms";
import { FacebookButton } from "@/components/account/facebook-button";
import { GoogleButton, OrDivider } from "@/components/account/google-button";
import { WhatsappButton } from "@/components/account/whatsapp-button";
import { whatsappMarket } from "@/lib/whatsapp-sign-in";
import { SignInForm } from "@/components/account/sign-in-up";
import { currentCustomer, safeNext } from "@/lib/customer";
import { authErrorText } from "@/lib/facebook";
import { SellVisit } from "@/components/account/sell-visit";
import { sellSourceOf } from "@/lib/sell-sources";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true }, alternates: { canonical: "/signin" } };

const reasons: Record<string, string> = {
  chat: "Sign in to chat with the seller",
  phone: "Sign in to contact the seller",
  call: "Sign in to call the seller",
  save: "Sign in to save listings",
  buy: "Sign in to buy with UdozoPay",
  report: "Sign in to report a listing",
  sell: "Sign in to sell on Udozo",
};

/** Sign in with a Udozo account, the email first, then its password: the same account works on udozo.com and every Udozo store. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; for?: string; email?: string; auth_error?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await currentCustomer()) redirect(next);
  // Sell pressed while signed out: counted on the way to Post an ad (nothing about the visitor kept).
  const selling = params.for === "sell" ? sellSourceOf(next) : null;
  // Continue with WhatsApp, where Udozo is on WhatsApp in the visitor's market (or any open one).
  const whatsapp = await whatsappMarket();
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      {selling ? <SellVisit source={selling} signedIn={false} /> : null}
      <h1 className="text-2xl leading-tight font-extrabold">{reasons[params.for ?? ""] ?? "Sign in to Udozo"}</h1>
      <p className="text-sm text-navy-600">One Udozo account for buying and selling here and on every Udozo store.</p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        {authErrorText(params.auth_error) ? (
          <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {authErrorText(params.auth_error)}
          </p>
        ) : null}
        <div className="grid gap-3">
          <GoogleButton intent="signin" next={next} />
          <FacebookButton intent="signin" next={next} />
          {whatsapp ? <WhatsappButton intent="signin" next={next} /> : null}
        </div>
        {params.auth_error === "google_account_not_found" ? (
          <div className="mt-3">
            <GoogleButton intent="signup" next={next} />
          </div>
        ) : null}
        <OrDivider />
        <SignInForm next={next} email={params.email?.slice(0, 254) ?? ""} />
        <AuthLinks next={next} page="signin" />
      </section>
    </div>
  );
}
