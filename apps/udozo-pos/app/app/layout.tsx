import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OfflineSync } from "@/components/offline-sync";
import { AppShell } from "@/components/app-shell";
import { staffLinks } from "@/components/owner-nav";
import { signOut } from "@/lib/pos-actions";
import { actorKind } from "@/lib/pos-api";
import { currentOwner, currentPos } from "@/lib/pos-data";
import { currentCustomer, hasDevice } from "@/lib/session";
import { signInPath } from "@/lib/site";
import { staffSignOut } from "@/lib/staff-actions";

export const metadata: Metadata = { title: "Your shop", robots: { index: false, follow: false } };

/**
 * The POS behind sign-in: the owner with their Udozo account (else Continue with Udozo, and sign-up until they have a
 * shop), or a member of staff with their PIN, each in the POS's Windows-style shell (title bar, navigation pane) with the places they may use.
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
  // A PIN from before PINs were 6 digits: a new one before anything else.
  if (staff && pos.ok && pos.data.pinChangeRequired) redirect("/signin/pin");
  const linked = await hasDevice();
  const onDevice = staff && linked;
  const who = pos.ok ? { name: pos.data.name, role: pos.data.role, shop: pos.data.shops.length > 1 ? `${pos.data.shops.length} shops` : (pos.data.shops[0]?.name ?? null) } : null;
  return (
    <AppShell links={staff && pos.ok ? staffLinks(pos.data.permissions) : undefined} who={who} signOut={staff ? staffSignOut : signOut} signOutLabel={onDevice ? "Switch user" : "Sign out"}>
      {linked ? <OfflineSync /> : null}
      {pos.ok ? (
        children
      ) : (
        <section role="alert" className="rounded-[20px] bg-white p-6">
          <h1 className="font-display text-2xl font-bold text-pos-ink">Your shop could not be opened</h1>
          <p className="mt-2 text-pos-ink-2">{pos.message}</p>
        </section>
      )}
    </AppShell>
  );
}
