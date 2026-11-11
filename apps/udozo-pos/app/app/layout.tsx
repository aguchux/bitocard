import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnerNav, staffLinks } from "@/components/owner-nav";
import { PosMark } from "@/components/site-chrome";
import { signOut } from "@/lib/pos-actions";
import { actorKind } from "@/lib/pos-api";
import { currentOwner, currentPos } from "@/lib/pos-data";
import { currentCustomer, hasDevice } from "@/lib/session";
import { signInPath } from "@/lib/site";
import { staffSignOut } from "@/lib/staff-actions";

export const metadata: Metadata = { title: "Your shop", robots: { index: false, follow: false } };

/**
 * The POS behind sign-in: the owner with their Udozo account (else Continue with Udozo, and sign-up until they have a
 * shop), or a member of staff with their PIN, each on the POS's dark header with the places they may use.
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const staff = (await actorKind()) === "staff";
  if (!staff) {
    const customer = await currentCustomer();
    if (!customer) redirect(signInPath("/app"));
    const owner = await currentOwner();
    if (owner.ok && !owner.data.account) redirect("/signup");
  }
  const pos = await currentPos();
  // A staff session that ended (12 hours idle, signed out elsewhere, suspended or the device unlinked): sign in again.
  if (staff && !pos.ok && (pos.status === 401 || pos.status === 403)) redirect("/signin/staff/end");
  const onDevice = staff && (await hasDevice());
  return (
    <>
      <header className="bg-pos-night text-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/app" className="mr-auto rounded-lg no-underline" aria-label="Your shop">
            <PosMark />
          </Link>
          {pos.ok ? (
            <span className="hidden text-sm text-pos-night-muted sm:inline">
              {pos.data.name} · {pos.data.role}
            </span>
          ) : null}
          <form action={staff ? staffSignOut : signOut}>
            <button type="submit" className="h-11 rounded-[10px] border border-pos-night-line px-4 text-sm font-semibold text-white hover:bg-pos-night-2">
              {onDevice ? "Switch user" : "Sign out"}
            </button>
          </form>
          <div className="w-full">
            <OwnerNav links={staff && pos.ok ? staffLinks(pos.data.permissions) : undefined} />
          </div>
        </div>
      </header>
      <main className="flex-1 bg-pos-page">
        <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
          {pos.ok ? (
            children
          ) : (
            <section role="alert" className="rounded-[20px] bg-white p-6">
              <h1 className="font-display text-2xl font-bold text-pos-ink">Your shop could not be opened</h1>
              <p className="mt-2 text-pos-ink-2">{pos.message}</p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
