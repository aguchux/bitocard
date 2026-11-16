import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { bankDepositStatus, formatFace, type StoreBankDeposit } from "@bitocard/api-client/storefront";

/** Each status's colours: amber waits on the customer, blue on us, green credited, red not credited, grey ended. */
export const depositTone: Record<StoreBankDeposit["status"], string> = {
  awaiting_payment: "bg-amber-50 text-amber-900",
  sent: "bg-sky-50 text-sky-900",
  credited: "bg-green-50 text-green-800",
  rejected: "bg-red-50 text-red-800",
  cancelled: "bg-slate-100 text-slate-700",
  expired: "bg-slate-100 text-slate-700",
};

/** The status in words on its colour (never colour alone). */
export function DepositBadge({ status, size = "sm" }: { status: StoreBankDeposit["status"]; size?: "sm" | "md" }) {
  return <span className={`inline-flex shrink-0 rounded-full font-semibold ${size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs"} ${depositTone[status]}`}>{bankDepositStatus[status]}</span>;
}

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));

/** Bank deposits as rows: amount (what was credited, once it was), reference and date, the status, opening each one's page. */
export function DepositRows({ items }: { items: StoreBankDeposit[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map(item => (
        <li key={item.id}>
          <Link href={`/account/wallet/deposits/${item.id}`} className="flex min-h-16 items-center gap-3 py-2.5 hover:text-brand-600">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-navy-900">{formatFace(item.status === "credited" ? (item.credited_amount ?? item.amount) : item.amount, item.currency)}</span>
              <span className="block truncate text-sm text-slate-500">
                {item.reference} · {item.number} · {day(item.created_at)}
              </span>
            </span>
            <DepositBadge status={item.status} />
            <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
