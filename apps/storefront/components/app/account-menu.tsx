import Link from "next/link";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { AccountPills } from "./account-pills";

/** A white card on the Account screens. */
export const accountCard = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 sm:p-6";

/** The small "Soon" label on things not built yet. */
export function SoonBadge() {
  return <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Soon</span>;
}

/** A row in a settings list (inside `AccountList`): icon tile, label, optional note, then "Soon" and a chevron. */
export function AccountRow({ href, icon: Icon, label, note, soon = false, attention = false, external = false }: { href: string; icon: LucideIcon; label: string; note?: string; soon?: boolean; attention?: boolean; external?: boolean }) {
  const body = (
    <>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${attention ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-navy-900">{label}</span>
        {note ? <span className={`block text-sm ${attention ? "font-medium text-amber-800" : "text-slate-500"}`}>{note}</span> : null}
      </span>
      {soon ? <SoonBadge /> : null}
      <ChevronRight className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </>
  );
  const className = "group flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50";
  return (
    <li>
      {external ? (
        <a href={href} className={className}>
          {body}
        </a>
      ) : (
        <Link href={href} className={className}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** A list of rows in one rounded card, as on the Account page. */
export function AccountList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70">
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  );
}

/**
 * An account screen: back to the Account page and the tabs to move between screens (phones and tablets; desktops
 * have the sub rail beside the app's rail instead), the title and a short lead, then the screen's own cards.
 */
export function AccountScreen({ title, lead, children }: { title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3 lg:hidden">
        <Link href="/account/profile" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
          <ChevronLeft className="size-4" aria-hidden="true" /> Your account
        </Link>
        <AccountPills />
      </div>
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-navy-900">{title}</h1>
        {lead ? <p className="text-slate-600">{lead}</p> : null}
      </header>
      {children}
    </div>
  );
}

/** What a screen not built yet shows: its icon, that it is coming, and what to do meanwhile. */
export function ComingSoon({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className={`${accountCard} flex flex-col items-center px-6 py-12 text-center sm:py-16`}>
      <span className="grid size-16 place-items-center rounded-2xl bg-pink-50 text-brand-500">
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <span className="mt-5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold tracking-wide text-slate-600 uppercase">Coming soon</span>
      <h2 className="mt-3 text-xl font-bold text-navy-900">{title}</h2>
      <div className="mt-2 max-w-md space-y-2 text-slate-600">{children}</div>
      <Link href="/account" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800">
        Back to Home
      </Link>
    </section>
  );
}
