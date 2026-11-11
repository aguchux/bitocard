import { PlanChanger } from "@/components/plan-changer";
import { money, statusText } from "@/lib/pos";
import { currentOwner, ownerCharges } from "@/lib/pos-data";
import { udozoUrl } from "@/lib/site";

const kinds = { signup: "First month", renewal: "Renewal", upgrade: "Plan change" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The plan, where it stands, changing it, the Udozo wallet it is paid from, and every charge so far. */
export default async function BillingPage() {
  const [owner, charges] = await Promise.all([currentOwner(), ownerCharges()]);
  if (!owner.ok || !owner.data.account) return null;
  const { account, plans, wallet } = owner.data;
  const addFunds = udozoUrl("/account/wallet");
  return (
    <div className="grid gap-6">
      <h1 className="font-display text-3xl font-bold text-pos-ink">Plan and billing</h1>
      <section aria-labelledby="now" className={`rounded-[20px] p-6 ${account.status === "past_due" ? "bg-pos-warn-bg" : "bg-white"}`}>
        <h2 id="now" className="font-display text-xl font-bold text-pos-ink">
          {account.plan.name}
        </h2>
        <p className={`mt-1 ${account.status === "past_due" ? "font-semibold text-pos-warn" : "text-pos-ink-2"}`}>{statusText(account, plans)}</p>
        <p className="mt-3 text-pos-ink-2">
          Your Udozo wallet: <strong className="text-pos-ink">{money(wallet.balance, wallet.currency)}</strong>.{" "}
          <a href={addFunds} target="_blank" rel="noopener">
            Add funds on udozo.com
          </a>
        </p>
      </section>
      <section aria-labelledby="change">
        <h2 id="change" className="mb-4 font-display text-xl font-bold text-pos-ink">
          Change plan
        </h2>
        <PlanChanger account={account} plans={plans} addFundsUrl={addFunds} />
      </section>
      <section aria-labelledby="charges" className="rounded-[20px] bg-white p-6">
        <h2 id="charges" className="font-display text-xl font-bold text-pos-ink">
          Charges
        </h2>
        {!charges.ok ? (
          <p className="mt-2 text-pos-ink-2">{charges.message}</p>
        ) : charges.data.data.length === 0 ? (
          <p className="mt-2 text-pos-ink-2">Nothing has been charged yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {charges.data.data.map(charge => (
              <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pos-line p-3">
                <span className="min-w-0">
                  <span className="block font-semibold text-pos-ink">
                    {charge.number} · {charge.plan.name} · {kinds[charge.kind]}
                  </span>
                  <span className="block text-sm text-pos-muted">
                    {day(charge.period_start)} to {day(charge.period_end)}
                    {charge.credit > 0 ? `, less ${money(charge.credit, charge.currency)} unused` : ""}
                  </span>
                </span>
                <span className="font-display font-bold text-pos-ink">{money(charge.amount, charge.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
