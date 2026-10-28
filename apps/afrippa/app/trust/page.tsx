import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { BlockButton } from "@/components/trust";
import { reportReasons } from "@/lib/orders-types";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Trust and safety", robots: { index: false, follow: false } };

type Standing = {
  strikes: number;
  strike_limit: number;
  strike_window_days: number;
  cancellations_today: number;
  cancellation_limit: number;
  restriction: { code: string; until: string | null; message: string } | null;
  lost_appeals: Array<{ order_id: string; number: string; decided_at: string }>;
  upheld_reports: Array<{ report_id: string; number: string; decided_at: string }>;
};
type Report = { id: string; number: string; reported: string; reason: string; status: "open" | "upheld" | "dismissed"; created_at: string };

const reasonText = new Map(reportReasons);
const reportStatus: Record<Report["status"], string> = { open: "With Afrippa's team", upheld: "Upheld", dismissed: "Dismissed" };

/**
 * The trader's standing (strikes from lost appeals and upheld reports, cool-offs, the daily cancellation limit, and
 * whether anything stops them trading now), the traders they blocked, and the reports they made.
 */
export default async function TrustPage() {
  await requireCustomer("/trust");
  const [standing, blocks, reports] = await Promise.all([
    customerApi<Standing>("GET", "/v1/afrippa/p2p/standing"),
    customerApi<{ data: Array<{ nickname: string; created_at: string }> }>("GET", "/v1/afrippa/p2p/blocks"),
    customerApi<{ data: Report[] }>("GET", "/v1/afrippa/p2p/reports"),
  ]);
  return (
    <AccountShell title="Trust and safety" current="/trust">
      <Section title="Your standing">
        {standing.ok ? (
          <>
            {standing.data.restriction ? (
              <p className="rounded-xl bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-800" role="alert">
                {standing.data.restriction.message}
                {standing.data.restriction.until ? ` Until ${tradeDate(standing.data.restriction.until)}.` : ""}
              </p>
            ) : (
              <p className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-800">You can trade.</p>
            )}
            <p className="text-sm text-slate-600">
              {standing.data.strikes} of {standing.data.strike_limit} strikes in {standing.data.strike_window_days} days: reaching the limit pauses your trading. An appeal decided against you, or an upheld report about you, is a strike and starts a 24-hour
              cool-off. {standing.data.cancellations_today} of {standing.data.cancellation_limit} cancelled or expired orders as the buyer today.
            </p>
            {standing.data.lost_appeals.length || standing.data.upheld_reports.length ? (
              <ul className="space-y-1 text-sm">
                {standing.data.lost_appeals.map(item => (
                  <li key={item.order_id}>
                    Appeal lost on{" "}
                    <Link href={`/orders/${item.order_id}`} className="font-semibold text-brand-700 underline">
                      {item.number}
                    </Link>
                    , {tradeDate(item.decided_at)}
                  </li>
                ))}
                {standing.data.upheld_reports.map(item => (
                  <li key={item.report_id}>
                    Report {item.number} upheld, {tradeDate(item.decided_at)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-600">{standing.message}</p>
        )}
      </Section>
      <Section title="Traders you blocked">
        {blocks.ok && blocks.data.data.length ? (
          <ul className="space-y-2">
            {blocks.data.data.map(item => (
              <li key={item.nickname} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/trader/${item.nickname}`} className="font-semibold text-brand-700 hover:underline">
                  {item.nickname}
                </Link>
                <BlockButton nickname={item.nickname} blocked />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">Nobody. Block a trader from their page: neither of you will see the other&apos;s ads.</p>
        )}
      </Section>
      <Section title="Your reports">
        {reports.ok && reports.data.data.length ? (
          <ul className="space-y-2">
            {reports.data.data.map(report => (
              <li key={report.id} className="rounded-2xl bg-slate-50 p-3 text-sm">
                <span className="font-semibold">{report.number}</span> · {report.reported} · {reasonText.get(report.reason) ?? report.reason}
                <span className="block text-slate-500">
                  {reportStatus[report.status]} · {tradeDate(report.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">No reports. Report a trader from their page or an order with them.</p>
        )}
      </Section>
    </AccountShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${cardClass} grid gap-3`} aria-label={title}>
      <h2 className="font-display text-lg font-extrabold">{title}</h2>
      {children}
    </section>
  );
}
