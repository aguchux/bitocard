import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnerNav } from "@/components/owner-nav";
import { PosMark } from "@/components/site-chrome";
import { signOut } from "@/lib/pos-actions";
import { currentOwner } from "@/lib/pos-data";
import { currentCustomer } from "@/lib/session";
import { signInPath } from "@/lib/site";

export const metadata: Metadata = { title: "Your shop", robots: { index: false, follow: false } };

/**
 * The owner's POS: signed in with their Udozo account (else Continue with Udozo), signed up (else sign-up), on the
 * POS's dark header with its places and Sign out.
 */
export default async function OwnerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath("/app"));
  const owner = await currentOwner();
  if (owner.ok && !owner.data.account) redirect("/signup");
  return (
    <>
      <header className="bg-pos-night text-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/app" className="mr-auto rounded-lg no-underline" aria-label="Your shop">
            <PosMark />
          </Link>
          <span className="hidden text-sm text-pos-night-muted sm:inline">
            {customer.name} · Owner
          </span>
          <form action={signOut}>
            <button type="submit" className="h-11 rounded-[10px] border border-pos-night-line px-4 text-sm font-semibold text-white hover:bg-pos-night-2">
              Sign out
            </button>
          </form>
          <div className="w-full">
            <OwnerNav />
          </div>
        </div>
      </header>
      <main className="flex-1 bg-pos-page">
        <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
          {owner.ok ? (
            children
          ) : (
            <section role="alert" className="rounded-[20px] bg-white p-6">
              <h1 className="font-display text-2xl font-bold text-pos-ink">Your shop could not be opened</h1>
              <p className="mt-2 text-pos-ink-2">{owner.message}</p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
