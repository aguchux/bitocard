import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentCustomer } from "@/lib/session";
import { safeNext, signInPath, udozoUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: true }, alternates: { canonical: "/signin" } };

/**
 * Two doors on one page. Shop owners Continue with Udozo (udozo.com's handoff: pos.udozo.com never asks for a Udozo
 * password). Staff sign in with the shop code, phone and PIN once staff accounts come (milestone 5).
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
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
      <div className="flex flex-col gap-5">
        <section aria-labelledby="owner" className="rounded-[20px] border border-pos-line bg-white p-6">
          <h2 id="owner" className="font-display text-2xl font-bold text-pos-ink">
            Shop owner
          </h2>
          <p className="mt-2 text-pos-ink-2">Use the account you sell with on udozo.com. You get full admin rights for your shop.</p>
          <a href={signInPath(next)} className="mt-5 flex h-12 items-center justify-center gap-2 rounded-xl bg-pos-600 font-bold text-white no-underline hover:bg-pos-700">
            <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-md bg-white/20 font-display text-sm">
              U
            </span>
            Continue with Udozo
          </a>
          <p className="mt-3 text-sm text-pos-muted">
            No Udozo account? <a href={udozoUrl("/signup")}>Create one free on udozo.com</a>, then come back here. New to Udozo POS? <Link href="/signup">Start free</Link>.
          </p>
        </section>
        <section aria-labelledby="staff" className="rounded-[20px] border border-dashed border-pos-line bg-pos-page p-6">
          <h2 id="staff" className="font-display text-2xl font-bold text-pos-ink">
            Staff
          </h2>
          <p className="mt-2 text-pos-ink-2">Staff will sign in here with the shop code, their phone number and a 4-digit PIN from their invite, without a Udozo account.</p>
          <p className="mt-3 inline-block rounded-md bg-pos-warn-bg px-2 py-1 text-sm font-semibold text-pos-warn">Coming soon</p>
        </section>
      </div>
    </div>
  );
}
