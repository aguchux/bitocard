import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText, LogOut, ShieldCheck, Store } from "lucide-react";
import { legalDocuments } from "@bitocard/ui/legal";
import { appUrl } from "@bitocard/ui/site";
import { NameForm, PasswordForm } from "@/components/store/account-forms";
import { signOut } from "@/lib/account-actions";
import { currentCustomer } from "@/lib/customer";

export const metadata: Metadata = { title: "Account" };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join("");

/** A row in a settings list: icon, label, optional note and a chevron. */
function Row({ href, icon: Icon, label, note, external = false }: { href: string; icon: typeof Store; label: string; note?: string; external?: boolean }) {
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {note ? <span className="block text-sm text-slate-500">{note}</span> : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
    </>
  );
  const className = "flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-slate-50";
  return external ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

/** The Account tab: who the customer is, their name and password, identity check, legal documents and signing out. */
export default async function ProfilePage() {
  const customer = (await currentCustomer())!;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="sr-only">Account</h1>
      <section className="flex items-center gap-4 rounded-3xl bg-white p-5 ring-1 ring-slate-100">
        <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-pink-50 text-xl font-extrabold text-[#ff2382]">
          {initials(customer.name) || "?"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xl font-extrabold">{customer.name}</p>
          <p className="truncate text-slate-500">{customer.email}</p>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="details" className="rounded-3xl bg-white p-5 ring-1 ring-slate-100">
          <h2 id="details" className="mb-4 text-lg font-bold">
            Your details
          </h2>
          <NameForm name={customer.name} />
        </section>
        <section aria-labelledby="password" className="rounded-3xl bg-white p-5 ring-1 ring-slate-100">
          <h2 id="password" className="mb-4 text-lg font-bold">
            Password
          </h2>
          <PasswordForm />
        </section>
      </div>

      <section aria-label="More" className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-100">
        <Row href="/account/verification" icon={ShieldCheck} label="Identity check" note="Needed once for some products in some countries" />
        <Row href="/" icon={Store} label="Shop the full store" />
        {legalDocuments.map(doc => (
          <Row key={doc.href} href={appUrl("legals", doc.href)} icon={FileText} label={doc.short} external />
        ))}
      </section>

      <form action={signOut}>
        <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-[#070f4c] ring-1 ring-slate-200 hover:ring-slate-300">
          <LogOut className="size-5" aria-hidden="true" /> Sign out
        </button>
      </form>
    </div>
  );
}
