"use client";

import type { ReactNode } from "react";
import { ArrowLeftRight, FlaskConical } from "lucide-react";
import { cn, humanise } from "@bitocard/admin-ui";
import { AccountMenu, ConsoleShell, type Crumb, NotificationBell } from "@bitocard/admin-ui/shell";
import { menus, sections, type ShqSection } from "./nav";
import { useReseller, useSignOut } from "./reseller";

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
  const { mode, setMode } = useReseller();
  return (
    <button
      type="button"
      onClick={() => setMode(mode === "live" ? "test" : "live")}
      aria-pressed={mode === "test"}
      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold", mode === "test" ? "bg-amber-100 text-amber-800" : "bg-canvas text-muted hover:text-ink")}
    >
      <FlaskConical className="size-3.5" aria-hidden />
      {mode === "test" ? "Sandbox" : "Live"}
    </button>
  );
}

function SandboxBanner() {
  const { mode, setMode } = useReseller();
  if (mode !== "test") return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      <span>
        <span className="font-semibold">Sandbox.</span> Test money and simulated orders: nothing here is real.
      </span>
      <button type="button" onClick={() => setMode("live")} className="font-semibold underline underline-offset-2">
        Back to live
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
