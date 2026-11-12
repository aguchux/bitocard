import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentCustomer } from "@/lib/session";
import { safeNext, signInPath, udozoUrl } from "@/lib/site";
import { UdozoMark } from "@/components/site-chrome";
import { SignInTabs } from "@/components/signin-tabs";
import { StaffSignInForm } from "@/components/staff-auth";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true }, alternates: { canonical: "/signin" } };

/**
 * Two doors on one card, as tabs (`?as=staff` opens Staff). Shop owners Continue with Udozo (udozo.com's handoff: pos.udozo.com never asks for a Udozo
 * password). Staff sign in with the shop code, their phone and their PIN, never a Udozo account.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; ended?: string; as?: string }> }) {
  const query = await searchParams;
  const next = safeNext(query.next);
  const ended = query.ended === "1";
  if (await currentCustomer()) redirect(next);
  return (
    <div className="mx-auto grid max-w-[1100px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 md:py-16">
      <section aria-labelledby="why" className="flex flex-col gap-4">
        <h1 id="why" className="font-display text-4xl font-bold text-pos-ink">
          Sell in your shop with the stock you list on Udozo
        </h1>
        <ul className="grid gap-3 text-pos-ink-2">
          {[
            "Products ticked Sell at POS on udozo.com come to your till",
            "One stock count for your shop and your Udozo listings",
            "Your team signs in with a PIN, without seeing your Udozo account",
          ].map(line => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="font-bold text-pos-600">
                ✓
              </span>
              {line}
            </li>
          ))}
        </ul>
      </section>
      <SignInTabs
        initial={ended || query.as === "staff" ? "staff" : "owner"}
        owner={
          <section aria-labelledby="owner">
            <h2 id="owner" className="font-display text-2xl font-bold text-pos-ink">
              Shop owner
            </h2>
            <p className="mt-2 text-pos-ink-2">Use the account you sell with on udozo.com. You get full admin rights for your shop.</p>
            <a href={signInPath(next)} className="mt-5 flex h-12 items-center justify-center gap-2 rounded-xl bg-pos-600 font-bold text-white no-underline hover:bg-pos-700">
              <UdozoMark className="h-6 w-6" />
              Continue with Udozo
            </a>
            <p className="mt-3 text-sm text-pos-muted">
              No Udozo account? <a href={udozoUrl("/signup")}>Create one free on udozo.com</a>, then come back here. New to Udozo POS? <Link href="/signup">Start free</Link>.
            </p>
          </section>
        }
        staff={
          <section aria-labelledby="staff">
            <h2 id="staff" className="font-display text-2xl font-bold text-pos-ink">
              Staff
            </h2>
            <p className="mt-2 text-pos-ink-2">Sign in with your shop’s code, your phone number and the 6-digit PIN you set from your invite. No Udozo account needed.</p>
            {ended ? <p className="mt-3 rounded-xl bg-pos-warn-bg p-3 text-sm font-semibold text-pos-warn">You were signed out. Sign in again to carry on.</p> : null}
            <StaffSignInForm />
            <p className="mt-3 text-sm text-pos-muted">
              Setting up a shop’s till? <Link href="/link">Link this device</Link> with the code from the shop owner.
            </p>
          </section>
        }
      />
    </div>
  );
}
