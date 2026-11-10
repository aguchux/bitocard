import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EarningsCard, EarningsLines } from "@/components/centre-earnings";
import { Panel, Problem } from "@/components/centre-ui";
import { readCentre, readEarnings } from "@/lib/centre-data";
import { money } from "@/lib/connect";
import { udozoUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Earnings" };

/** The owner's earnings: their 70% of each Connect fee, storage and penalty, held for the payout hold, then moved to their payouts. */
export default async function EarningsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const centre = await readCentre(id);
  if (!centre.ok) return null;
  if (centre.data.role !== "owner") notFound();
  const earnings = await readEarnings(id);
  if (!earnings.ok) return <Problem message={earnings.message} />;
  const { data } = earnings;
  const payoutsUrl = udozoUrl("/account/payouts");
  const fees = data.accounts.find(account => account.mode === "live")?.currency ?? data.accounts[0]?.currency;
  return (
    <div className="grid gap-4">
      <p className="text-slate-600">
        Your centre earns 70% of the Connect fee on every item it hands over, and of the storage and penalties it collects. Move what is ready to your payouts, then pay it to your bank from{" "}
        <a href={payoutsUrl} className="font-semibold text-brand-700 underline">
          Payouts on udozo.com
        </a>
        .
      </p>
      {data.accounts.length ? (
        data.accounts.map(account => <EarningsCard key={`${account.mode}-${account.currency}`} centre={id} account={account} holdDays={data.hold_days} payoutsUrl={payoutsUrl} />)
      ) : (
        <Panel title="No earnings yet">
          <p className="text-slate-600">You earn as soon as this centre hands its first item over.</p>
        </Panel>
      )}
      <p className="text-sm text-slate-600">
        This centre has handed over {data.centre.handed_over === 1 ? "1 item" : `${data.centre.handed_over} items`}
        {fees ? `, earning ${money(data.centre.connect_fees, fees)} in Connect fees` : ""}.
      </p>
      <h2 className="mt-2 text-lg font-extrabold text-navy-900">Latest</h2>
      <EarningsLines lines={data.lines} country={centre.data.country} />
    </div>
  );
}
