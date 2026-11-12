import Link from "next/link";
import { type PosPlan, planFeatures, priceText, sortPlans } from "@/lib/pos";

/**
 * Free, Premium and Multi-shop side by side, each with its price in the market's currency (or that it is coming), what
 * it includes and how to start. Premium is marked as the one most shops choose.
 */
export function PlanCards({ plans, cta = "/signup" }: { plans: PosPlan[]; cta?: string }) {
  if (!plans.length) return <p className="text-pos-muted">Plans could not be loaded just now. Try again in a moment.</p>;
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {sortPlans(plans).map(plan => {
        const popular = plan.code === "premium";
        return (
          <article key={plan.code} className={`flex flex-col gap-4 rounded-[20px] bg-white p-6 ${popular ? "border-2 border-pos-600" : "border border-pos-line"}`} aria-labelledby={`plan-${plan.code}`}>
            {popular ? <span className="self-start rounded-full bg-pos-50 px-3 py-1 text-xs font-bold text-pos-700">Most shops choose this</span> : null}
            <h3 id={`plan-${plan.code}`} className="font-display text-2xl font-bold text-pos-ink">
              {plan.name}
            </h3>
            {plan.description ? <p className="text-pos-ink-2">{plan.description}</p> : null}
            <p className="font-display text-3xl font-bold text-pos-ink">{priceText(plan)}</p>
            {plan.paid && plan.trial_days > 0 ? <p className="text-sm font-semibold text-pos-700">{plan.trial_days}-day free trial</p> : null}
            <ul className="grid gap-2 text-pos-ink-2">
              {planFeatures(plan).map(line => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true" className="font-bold text-pos-600">
                    ✓
                  </span>
                  {line}
                </li>
              ))}
            </ul>
            <Link
              href={`${cta}?plan=${plan.code}`}
              className={`mt-auto flex h-12 items-center justify-center rounded-xl text-[15px] font-bold no-underline ${popular ? "bg-pos-600 text-white hover:bg-pos-700" : "border border-pos-600 text-pos-700 hover:bg-pos-50"}`}
            >
              {plan.paid ? (plan.trial_days > 0 ? "Start free trial" : `Choose ${plan.name}`) : "Start free"}
            </Link>
          </article>
        );
      })}
    </div>
  );
}
