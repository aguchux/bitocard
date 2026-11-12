import type { Metadata } from "next";
import { PlanCards } from "@/components/plan-cards";
import { marketFor, publicPlans } from "@/lib/pos-data";
import { currentCustomer } from "@/lib/session";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Udozo POS plans: Free for one small shop, Premium for a busy shop with a team, and Multi-shop for several branches. Paid monthly from your Udozo wallet.",
  alternates: { canonical: "/pricing" },
};

/** Free, Premium and Multi-shop side by side, priced in the owner's (or the asked) market's currency. */
export default async function PricingPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const customer = await currentCustomer();
  const plans = await publicPlans(marketFor(customer?.country, (await searchParams).country));
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-display text-4xl font-bold text-pos-ink">Plans for every shop</h1>
      <p className="mt-3 max-w-2xl text-lg text-pos-ink-2">
        Start on Free, and move up when your shop grows. Paid plans are taken from your Udozo wallet each month: top it up on udozo.com by card, bank transfer or mobile money.
      </p>
      {plans && !plans.open ? (
        <p className="mt-6 rounded-2xl bg-pos-warn-bg p-4 font-semibold text-pos-warn" role="status">
          Udozo POS is coming to your country soon. You can look at the plans now.
        </p>
      ) : null}
      <div className="mt-10">
        <PlanCards plans={plans?.data ?? []} />
      </div>
      <ul className="mt-8 grid gap-2 text-sm text-pos-muted">
        <li>A paid plan with a trial takes nothing until the trial ends.</li>
        <li>Moving to a dearer plan is charged at once, less what is unused of this month; a cheaper one starts when your paid month ends.</li>
        <li>If a renewal cannot be taken, you have 7 days to add funds before your shop moves to Free. Nothing is deleted.</li>
        <li>Plan fees are separate from udozo.com&apos;s fees on online orders.</li>
      </ul>
    </div>
  );
}
