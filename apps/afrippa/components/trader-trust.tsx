import Link from "next/link";
import { tradeDate } from "@afrippa/ui/trade-views";
import { currentCustomer, customerApi } from "@/lib/customer";
import { BlockButton, ReportForm } from "@/components/trust";

type TrustCard = {
  nickname: string;
  orders_30d: number;
  orders_total: number;
  completion_rate_30d: number | null;
  avg_pay_minutes: number | null;
  avg_release_minutes: number | null;
  feedback: { positive: number; negative: number };
  latest_feedback: Array<{ rating: "positive" | "negative"; comment: string | null; from: string; created_at: string }>;
};

const minutes = (value: number | null) => (value === null ? "No orders yet" : `${value < 1 ? "Under a minute" : `${Math.round(value)} min`}`);

/**
 * What a signed-in trader sees about another before trading: their completion rate, how fast they pay and release,
 * their feedback and its latest comments (by nickname), with Block and Report. Its own small part on the trader page,
 * never cached: signed out it only asks to sign in.
 */
export async function TraderTrust({ nickname }: { nickname: string }) {
  const viewer = await currentCustomer();
  if (!viewer) {
    return (
      <p className="rounded-3xl bg-white p-5 text-sm text-slate-600 ring-1 ring-slate-200/70">
        <Link href={`/signin?next=${encodeURIComponent(`/trader/${nickname}`)}`} className="font-semibold text-brand-700 underline">
          Sign in
        </Link>{" "}
        to see how {nickname} trades: their completion rate, how fast they pay and release, and their feedback.
      </p>
    );
  }
  const [card, blocks, profile] = await Promise.all([
    customerApi<TrustCard>("GET", `/v1/afrippa/p2p/traders/${encodeURIComponent(nickname)}`),
    customerApi<{ data: Array<{ nickname: string }> }>("GET", "/v1/afrippa/p2p/blocks"),
    customerApi<{ nickname: string }>("GET", "/v1/afrippa/p2p/profile"),
  ]);
  if (!card.ok) return <p className="rounded-3xl bg-white p-5 text-sm text-slate-600 ring-1 ring-slate-200/70">{card.message}</p>;
  const trust = card.data;
  // Their own card: nothing to block or report.
  const self = profile.ok && profile.data.nickname.toLowerCase() === trust.nickname.toLowerCase();
  const blocked = blocks.ok && blocks.data.data.some(item => item.nickname.toLowerCase() === nickname.toLowerCase());
  return (
    <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-200/70" aria-label={`How ${trust.nickname} trades`}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Completed in 30 days", trust.completion_rate_30d === null ? "No orders yet" : `${trust.completion_rate_30d}%`],
          ["Orders in 30 days", String(trust.orders_30d)],
          ["Pays in", minutes(trust.avg_pay_minutes)],
          ["Releases in", minutes(trust.avg_release_minutes)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-display text-lg font-extrabold text-navy-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h2 className="font-semibold">
          Feedback: {trust.feedback.positive} good, {trust.feedback.negative} bad
        </h2>
        {trust.latest_feedback.length ? (
          <ul className="mt-2 space-y-2">
            {trust.latest_feedback.map((item, index) => (
              <li key={index} className="rounded-2xl bg-slate-50 p-3 text-sm">
                <span className={`font-semibold ${item.rating === "positive" ? "text-emerald-700" : "text-red-700"}`}>{item.rating === "positive" ? "Good" : "Bad"}</span> · {item.from} · {tradeDate(item.created_at)}
                {item.comment ? <p className="mt-1 whitespace-pre-wrap">{item.comment}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-slate-600">No feedback yet.</p>
        )}
      </div>
      {self ? null : (
        <div className="flex flex-wrap items-start gap-3">
          <BlockButton nickname={trust.nickname} blocked={blocked} />
          <div className="min-w-0 flex-1">
            <ReportForm nickname={trust.nickname} />
          </div>
        </div>
      )}
    </section>
  );
}
