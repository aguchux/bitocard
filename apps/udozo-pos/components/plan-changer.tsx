"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type BillingInterval, money, type PosAccount, type PosPlan, planFeatures, priceText, sortPlans, yearlySaving } from "@/lib/pos";
import { changePlan } from "@/lib/pos-actions";
import { useConfirm } from "./confirm-dialog";

/** What choosing a plan (and how it is paid) does, in words, for the confirmation. */
export function changeWords(account: Pick<PosAccount, "status" | "plan" | "billing_interval">, target: Pick<PosPlan, "code" | "name" | "paid" | "price" | "yearly_price">, interval: BillingInterval = "month") {
  const current = account.plan;
  const currentInterval = account.billing_interval ?? "month";
  const period = interval === "year" ? "year" : "month";
  if (account.status === "trial") return target.paid ? `Your trial carries on with ${target.name}, paid ${interval === "year" ? "yearly" : "monthly"} once it ends.` : "Your trial ends now and your shop moves to Free, with nothing taken.";
  if (!target.paid) return account.status === "past_due" ? "Your shop moves to Free now." : `${current.name} runs to the end of the ${currentInterval === "year" ? "year" : "month"} you paid for, then your shop moves to Free.`;
  const price = interval === "year" ? target.yearly_price : target.price;
  const dearer = !current.paid || (target.price?.amount ?? 0) > (current.price?.amount ?? 0) || account.status === "past_due" || (interval === "year" && currentInterval === "month");
  return dearer
    ? `${target.name}'s first ${period} (${price ? money(price.amount, price.currency) : "its price"}) is taken from your Udozo wallet now, less what is unused of what you paid, and a new ${period} starts today.`
    : `${target.name}, paid ${interval === "year" ? "yearly" : "monthly"}, starts when the ${currentInterval === "year" ? "year" : "month"} you paid for ends.`;
}

/**
 * Changing plan from Billing: each plan offered in the owner's country with Choose, monthly or yearly where a plan has
 * a yearly price, confirmed in words first. A change waiting for the period's end is taken back by choosing the current
 * plan and interval again.
 */
export function PlanChanger({ account, plans, addFundsUrl }: { account: PosAccount; plans: PosPlan[]; addFundsUrl: string }) {
  const router = useRouter();
  const currentInterval = account.billing_interval ?? "month";
  const [interval, setInterval] = useState<BillingInterval>(currentInterval);
  const [problem, setProblem] = useState<{ message: string; short: boolean } | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const yearly = plans.some(plan => plan.yearly_price);
  const waitingPlan = account.next_plan && account.next_plan !== account.plan.code ? account.next_plan : null;
  const waitingInterval = account.next_interval ?? null;
  const choose = async (target: PosPlan) => {
    const keep = target.code === account.plan.code && interval === currentInterval;
    if (!(await confirm({ title: keep ? `Stay on ${target.name}?` : `Move to ${target.name}${target.paid ? `, paid ${interval === "year" ? "yearly" : "monthly"}` : ""}?`, body: keep ? "The change you chose is taken back." : changeWords(account, target, interval), action: keep ? `Stay on ${target.name}` : `Move to ${target.name}` }))) return;
    start(async () => {
      const result = await changePlan(target.code, target.paid ? interval : undefined);
      setProblem(result.ok ? null : { message: result.message, short: result.code === "wallet_balance_low" });
      if (result.ok) router.refresh();
    });
  };
  return (
    <div className="grid gap-4">
      {dialog}
      {yearly ? (
        <div role="radiogroup" aria-label="How to pay" className="flex w-fit gap-1 rounded-full bg-white p-1">
          {(["month", "year"] as const).map(option => (
            <button key={option} type="button" role="radio" aria-checked={interval === option} onClick={() => setInterval(option)} className={`h-10 rounded-full px-4 text-sm font-semibold ${interval === option ? "bg-pos-600 text-white" : "text-pos-ink-2 hover:bg-pos-50"}`}>
              {option === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-3">
        {sortPlans(plans.filter(plan => plan.available || plan.code === account.plan.code)).map(plan => {
          const current = plan.code === account.plan.code && (!plan.paid || interval === currentInterval);
          const next = (plan.code === waitingPlan || (!waitingPlan && plan.code === account.plan.code && waitingInterval)) && (!plan.paid || interval === (waitingInterval ?? currentInterval));
          const unavailable = plan.paid && interval === "year" && !plan.yearly_price;
          const saving = interval === "year" ? yearlySaving(plan) : null;
          return (
            <li key={plan.code} className={`flex flex-col gap-3 rounded-[20px] bg-white p-5 ${current ? "border-2 border-pos-600" : "border border-pos-line"}`}>
              <h3 className="font-display text-xl font-bold text-pos-ink">{plan.name}</h3>
              <p className="font-display text-2xl font-bold text-pos-ink">{priceText(plan, interval)}</p>
              {saving ? <p className="text-sm font-semibold text-pos-700">Save {saving}% on twelve months</p> : null}
              <ul className="grid gap-1 text-sm text-pos-ink-2">
                {planFeatures(plan)
                  .slice(0, 4)
                  .map(line => (
                    <li key={line}>✓ {line}</li>
                  ))}
              </ul>
              {current && !waitingPlan && !waitingInterval ? (
                <span className="mt-auto flex h-11 items-center justify-center rounded-xl bg-pos-50 font-semibold text-pos-700">Your plan</span>
              ) : next ? (
                <span className="mt-auto flex h-11 items-center justify-center rounded-xl bg-pos-page font-semibold text-pos-muted">Starts when this period ends</span>
              ) : unavailable ? (
                <span className="mt-auto flex h-11 items-center justify-center rounded-xl bg-pos-page font-semibold text-pos-muted">Monthly only</span>
              ) : (
                <button type="button" disabled={busy} onClick={() => choose(plan)} className="mt-auto h-11 rounded-xl border border-pos-600 font-semibold text-pos-700 hover:bg-pos-50 disabled:opacity-60">
                  {current ? `Stay on ${plan.name}` : `Choose ${plan.name}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {problem ? (
        <p role="alert" className="font-semibold text-pos-error">
          {problem.message}{" "}
          {problem.short ? (
            <a href={addFundsUrl} target="_blank" rel="noopener" className="underline">
              Add funds
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
