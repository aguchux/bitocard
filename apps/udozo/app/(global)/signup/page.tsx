import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLinks } from "@/components/account-forms";
import { FacebookButton } from "@/components/account/facebook-button";
import { GoogleButton, OrDivider } from "@/components/account/google-button";
import { WhatsappButton } from "@/components/account/whatsapp-button";
import { whatsappMarket } from "@/lib/whatsapp-sign-in";
import { SignUpForm } from "@/components/account/sign-in-up";
import { SignupVisit } from "@/components/account/signup-visit";
import { authErrorText } from "@/lib/facebook";
import { markets } from "@/lib/api";
import { countries } from "@/lib/countries";
import { currentCustomer, safeNext } from "@/lib/customer";
import { cleanRef } from "@/lib/invite";

export const metadata: Metadata = { title: "Create your account", robots: { index: false, follow: true }, alternates: { canonical: "/signup" } };

/**
 * A Udozo account: with Google (then the name, country and mobile on `/verify`), or one step at a time: the email and its code, the name and country (fixed for good: the market they
 * buy and sell in, and their wallet's currency), the mobile and its code, then a password. The country Udozo's
 * marketplace was opened from is chosen first; `email` comes from sign-in's "Create an account with it", and `ref` (a
 * campaign's referral or a Marketing invite's code) is kept on the account it makes.
 */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; country?: string; email?: string; ref?: string; auth_error?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await currentCustomer()) redirect(next);
  const [list, open, whatsapp] = await Promise.all([countries(), markets(), whatsappMarket()]);
  const fromPath = /^\/([a-z]{2})(?:\/|$)/.exec(next)?.[1]?.toUpperCase();
  const suggested = [params.country?.toUpperCase(), fromPath, open.data.length === 1 ? open.data[0]!.country : undefined].find(code => code && list.some(item => item.code === code)) ?? null;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <SignupVisit />
      <h1 className="text-2xl leading-tight font-extrabold">Create your Udozo account</h1>
      <p className="text-sm text-navy-600">Buy and sell near you, and pay safely with UdozoPay. One account works on udozo.com and every Udozo store.</p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        {authErrorText(params.auth_error) ? (
          <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {authErrorText(params.auth_error)}
          </p>
        ) : null}
        {list.length ? (
          <>
            <div className="grid gap-3">
              <GoogleButton intent="signup" next={next} refCode={cleanRef(params.ref)} />
              <FacebookButton intent="signup" next={next} refCode={cleanRef(params.ref)} />
              {whatsapp ? <WhatsappButton intent="signup" next={next} refCode={cleanRef(params.ref)} /> : null}
            </div>
            <OrDivider />
          </>
        ) : null}
        {list.length ? (
          <SignUpForm next={next} markets={list} market={suggested} email={params.email?.slice(0, 254) ?? ""} signupRef={cleanRef(params.ref)} />
        ) : (
          <p role="alert" className="text-sm text-navy-600">
            Sign-up is not available just now. Try again shortly.
          </p>
        )}
        <AuthLinks next={next} page="signup" />
      </section>
    </div>
  );
}
