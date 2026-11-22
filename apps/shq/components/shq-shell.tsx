"use client";

import type { ReactNode } from "react";
import { ArrowLeftRight, FlaskConical } from "lucide-react";
import { humanise } from "@bitocard/admin-ui";
import { AccountMenu, ConsoleShell, type Crumb, NotificationBell } from "@bitocard/admin-ui/shell";
import { menus, sections, type ShqSection } from "./nav";
import { useReseller, useSignOut } from "./reseller";
import { ModeToggle } from "./environment";

function ShqAccountMenu() {
  const { user, membership, memberships, switchAccount } = useReseller();
  const [signOut, signingOut] = useSignOut();
  const others = memberships.filter(item => item.reseller.id !== membership.reseller.id);
  return (
    <AccountMenu name={user.name} email={user.email} detail={`${membership.reseller.name} · ${humanise(membership.role)}`} signingOut={signingOut} onSignOut={signOut}>
      {others.length
        ? others.map(item => (
            <button
              key={item.reseller.id}
              type="button"
              role="menuitem"
              onClick={() => switchAccount(item.reseller.id)}
              className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-ink hover:bg-canvas"
            >
              <ArrowLeftRight className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Switch to {item.reseller.name}</span>
            </button>
          ))
        : null}
    </AccountMenu>
  );
}

/** Live or sandbox: the sandbox uses test money and simulated fulfilment, never real suppliers. */
export function ModeSwitch() {
  return <ModeToggle />;
}

function SandboxBanner() {
  const { mode, setMode } = useReseller();
  if (mode !== "test") return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 px-4 py-2 text-center text-sm text-amber-950">
      <span className="inline-flex items-center gap-1.5">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-bold">Sandbox.</span> Test money and simulated orders: nothing here is real.
        </span>
      </span>
      <button
        type="button"
        onClick={() => setMode("live")}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-amber-950 px-3.5 text-xs font-bold text-white shadow-sm hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span aria-hidden className="size-2 rounded-full bg-emerald-400" />
        Go live
      </button>
    </div>
  );
}

function ShqBell() {
  return <NotificationBell realm="reseller" userId={useReseller().user.id} />;
}

/** The layout of every SHQ page: rail, section menu, breadcrumbs, live/sandbox switch and account menu. */
export function ShqShell({ section, current, crumbs, actions, children }: { section: ShqSection; current: string; crumbs: Crumb[]; actions?: ReactNode; children: ReactNode }) {
  return (
    <ConsoleShell
      brand="SHQ"
      sections={sections}
      menus={menus}
      section={section}
      current={current}
      crumbs={crumbs}
      actions={
        <>
          {actions}
          <ModeSwitch />
        </>
      }
      notifications={<ShqBell />}
      account={<ShqAccountMenu />}
      banner={<SandboxBanner />}
    >
      {children}
    </ConsoleShell>
  );
}
