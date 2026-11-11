import { ownerOnly } from "@/lib/gates";
import type { Metadata } from "next";
import Link from "next/link";
import { SettlementAccountForm, TillAccount, UnmatchedActions } from "@/components/collection-forms";
import { collectionBlockText, collectionText, dayText, money, saleTime, settlementText } from "@/lib/pos";
import { ownerCollections, ownerCollectionTransfers, ownerSettlements } from "@/lib/pos-data";
import { udozoUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Payments", robots: { index: false, follow: false } };

const card = "rounded-[20px] bg-white p-5 sm:p-6";

/**
 * Udozo collection accounts (milestone 4): a bank account number per till that buyers transfer to. Udozo confirms each
 * transfer itself, the sale waiting at the till completes on its own, and the day's money is paid to the owner's bank
 * account the next working day, less Udozo's fee. Transfers that matched no sale wait here to attach or keep.
 */
export default async function CollectionsPage() {
  await ownerOnly();
  const [overview, unmatched, recent, settlements] = await Promise.all([ownerCollections(), ownerCollectionTransfers("unmatched"), ownerCollectionTransfers(), ownerSettlements()]);
  if (!overview.ok) {
    return (
      <p role="alert" className={`${card} text-pos-error`}>
        {overview.message}
      </p>
    );
  }
  const data = overview.data;
  const blocked = collectionBlockText(data.blocked);
  const sandbox = data.mode === "test";
  const done = recent.ok ? recent.data.data.filter((item) => item.status !== "unmatched") : [];
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">Payments</h1>
        <p className="mt-1 max-w-2xl text-pos-ink-2">
          Give each till its own bank account number. A buyer&apos;s transfer completes the sale waiting at the till on its own, and the day&apos;s money is paid to your bank the next working day, less Udozo&apos;s fee.
        </p>
      </div>

      {data.held ? (
        <p role="status" className="rounded-[20px] bg-pos-warn-bg p-4 text-pos-warn">
          Udozo is holding your settlements{data.held.reason ? `: ${data.held.reason}` : ""}. Transfers still come in; they are paid once the hold is lifted.
        </p>
      ) : null}

      <section aria-labelledby="money" className={`${card} grid gap-3 sm:grid-cols-3`}>
        <h2 id="money" className="sr-only">
          Your collections
        </h2>
        <p>
          <span className="block text-sm text-pos-muted">Collected, not yet paid</span>
          <span className="font-display text-2xl font-bold text-pos-ink">{money(data.collected, data.currency)}</span>
        </p>
        <p>
          <span className="block text-sm text-pos-muted">Next paid on</span>
          <span className="font-display text-2xl font-bold text-pos-ink">{dayText(data.next_settlement)}</span>
        </p>
        <p>
          <span className="block text-sm text-pos-muted">Not matched to a sale</span>
          <span className={`font-display text-2xl font-bold ${data.unmatched ? "text-pos-warn" : "text-pos-ink"}`}>{data.unmatched}</span>
        </p>
      </section>

      <section aria-labelledby="settle" className={`${card} grid gap-3`}>
        <h2 id="settle" className="font-display text-xl font-bold text-pos-ink">
          Where your collections are paid
        </h2>
        <SettlementAccountForm accounts={data.bank_accounts} current={data.settlement_bank_account_id} addUrl={udozoUrl("/account/payouts")} />
      </section>

      <section aria-labelledby="tills" className={`${card} grid gap-3`}>
        <h2 id="tills" className="font-display text-xl font-bold text-pos-ink">
          Your tills&apos; accounts
        </h2>
        {blocked ? (
          <p className="rounded-xl bg-pos-50 p-3 text-pos-ink-2">
            {blocked}
            {data.blocked === "plan" ? (
              <>
                {" "}
                <Link href="/app/billing" className="font-semibold">
                  Change plan
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        <ul className="grid gap-3">
          {data.tills.map((till) => (
            <TillAccount key={till.id} till={till} blocked={blocked !== null} bvnRequired={data.bvn_required} sandbox={sandbox} currency={data.currency} />
          ))}
        </ul>
      </section>

      {unmatched.ok && unmatched.data.data.length ? (
        <section aria-labelledby="unmatched" className={`${card} grid gap-3`}>
          <h2 id="unmatched" className="font-display text-xl font-bold text-pos-ink">
            Transfers not matched to a sale
          </h2>
          <p className="text-pos-ink-2">They are yours and paid with the day&apos;s collections either way. Use one for the sale it was for, or keep it.</p>
          <ul className="grid gap-3">
            {unmatched.data.data.map((item) => (
              <li key={item.id} className="grid gap-2 border-b border-pos-line pb-3">
                <p className="text-pos-ink">
                  <strong>{money(item.amount, item.currency)}</strong> from {item.payer_name ?? "an unnamed account"} into {item.till?.name ?? "a till"}&apos;s account
                  <span className="text-sm text-pos-muted"> · {item.number} · {saleTime(item.received_at)}</span>
                </p>
                <UnmatchedActions collection={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="settlements" className={`${card} grid gap-3`}>
        <h2 id="settlements" className="font-display text-xl font-bold text-pos-ink">
          Settlements
        </h2>
        {settlements.ok && settlements.data.data.length ? (
          <ul className="grid gap-2">
            {settlements.data.data.map((item) => (
              <li key={item.id}>
                <Link href={`/app/collections/settlements/${item.id}`} className="grid gap-1 rounded-xl border border-pos-line p-3 no-underline hover:bg-pos-50 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <span className="min-w-0">
                    <span className="block font-semibold text-pos-ink">
                      {dayText(item.day)} · {item.number}
                    </span>
                    <span className="block text-sm text-pos-ink-2">{settlementText(item)}</span>
                  </span>
                  <span className="font-display text-lg font-bold text-pos-ink">{money(item.amount, item.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-pos-ink-2">Nothing settled yet. Each working day, what came in before it began is paid to your bank.</p>
        )}
      </section>

      {done.length ? (
        <section aria-labelledby="recent" className={`${card} grid gap-2`}>
          <h2 id="recent" className="font-display text-xl font-bold text-pos-ink">
            Recent transfers
          </h2>
          <ul className="grid gap-1">
            {done.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-pos-line py-2">
                <span>
                  <strong>{money(item.amount, item.currency)}</strong> from {item.payer_name ?? "an unnamed account"}
                  <span className="text-sm text-pos-muted">
                    {" "}
                    · {collectionText(item)}
                    {item.sale ? (
                      <>
                        {" "}
                        (
                        <Link href={`/app/sales/${item.sale.id}`} className="font-semibold">
                          open
                        </Link>
                        )
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="text-sm text-pos-muted">
                  fee {money(item.fee, item.currency)} · {saleTime(item.received_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
