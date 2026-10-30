import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import { formatFace, type StoreWalletTransaction } from "@bitocard/api-client/storefront";

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** One line of activity: in (green, arrow in) or out, what it was (a link where it has a page), when, and the amount. */
function ActivityRow({ credit, label, href, at, amount }: { credit: boolean; label: string; href: string | null; at: string; amount: string }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${credit ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
        {credit ? <ArrowDownLeft className="size-5" aria-hidden="true" /> : <ArrowUpRight className="size-5" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="block truncate font-semibold hover:underline">
            {label}
          </Link>
        ) : (
          <span className="block truncate font-semibold">{label}</span>
        )}
        <span className="block text-sm text-slate-500">{date(at)}</span>
      </span>
      <span className={`shrink-0 font-semibold tabular-nums ${credit ? "text-emerald-700" : "text-navy-900"}`}>
        <span className="sr-only">{credit ? "In: " : "Out: "}</span>
        {credit ? "+" : "−"}
        {amount}
      </span>
    </li>
  );
}

/** The money wallets' activity: top-ups, purchases and refunds, each purchase linking to its order. */
export function MoneyActivityList({ items }: { items: StoreWalletTransaction[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map(item => (
        <ActivityRow
          key={item.id}
          credit={item.amount >= 0}
          label={item.description}
          href={item.checkout_id ? `/account/orders/${item.checkout_id}` : null}
          at={item.created_at}
          amount={formatFace(Math.abs(item.amount), item.currency)}
        />
      ))}
    </ul>
  );
}

/** A wallet card's Transactions heading, with an optional note beneath and View all on the right (to the Transactions screen). */
export function ActivityHeading({ id, note, viewAll, children = "Transactions" }: { id: string; note?: string; viewAll?: string; children?: ReactNode }) {
  return (
    <div className="mb-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-bold">
          {children}
        </h2>
        {note ? <p className="text-sm text-slate-500">{note}</p> : null}
      </div>
      {viewAll ? (
        <Link href={viewAll} className="-mr-2 inline-flex min-h-10 shrink-0 items-center gap-0.5 rounded-xl px-2 text-sm font-semibold text-brand-600 hover:bg-brand-50 hover:text-brand-700">
          View all
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
