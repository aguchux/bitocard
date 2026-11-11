"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { money, type PosAccount, type PosPlan, planFeatures, priceText, sortPlans } from "@/lib/pos";
import { changePlan } from "@/lib/pos-actions";
import { useConfirm } from "./confirm-dialog";

/** What choosing a plan does, in words, for the confirmation. */
export function changeWords(account: Pick<PosAccount, "status" | "plan">, target: Pick<PosPlan, "code" | "name" | "paid" | "price">) {
  const current = account.plan;
  if (account.status === "trial") return target.paid ? `Your trial carries on with ${target.name}.` : "Your trial ends now and your shop moves to Free, with nothing taken.";
  if (!target.paid) return account.status === "past_due" ? "Your shop moves to Free now." : `${current.name} runs to the end of the month you paid for, then your shop moves to Free.`;
  const dearer = !current.paid || (target.price?.amount ?? 0) > (current.price?.amount ?? 0) || account.status === "past_due";
  return dearer
    ? `${target.name}'s first month (${target.price ? money(target.price.amount, target.price.currency) : "its price"}) is taken from your Udozo wallet now, less what is unused of this month, and a new month starts today.`
    : `${target.name} starts when the month you paid for ends.`;
}

/**
 * Changing plan from Billing: each plan offered in the owner's country with Choose, confirmed in words first. A change
 * waiting for the month's end can be taken back by choosing the current plan again.
 */
export function PlanChanger({ account, plans, addFundsUrl }: { account: PosAccount; plans: PosPlan[]; addFundsUrl: string }) {
  const router = useRouter();
  const [problem, setProblem] = useState<{ message: string; short: boolean } | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const waiting = account.next_plan && account.next_plan !== account.plan.code ? account.next_plan : null;
  const choose = async (target: PosPlan) => {
    const keep = target.code === account.plan.code;
    if (!(await confirm({ title: keep ? `Stay on ${target.name}?` : `Move to ${target.name}?`, body: keep ? "The change you chose is taken back." : changeWords(account, target), action: keep ? `Stay on ${target.name}` : `Move to ${target.name}` }))) return;
    start(async () => {
      const result = await changePlan(target.code);
      setProblem(result.ok ? null : { message: result.message, short: result.code === "wallet_balance_low" });
      if (result.ok) router.refresh();
    });
  };
  return (
    <div className="grid gap-4">
      {dialog}
      <ul className="grid gap-4 md:grid-cols-3">
        {sortPlans(plans.filter(plan => plan.available || plan.code === account.plan.code)).map(plan => {
          const current = plan.code === account.plan.code;
          const next = plan.code === waiting;
          return (
            <li key={plan.code} className={`flex flex-col gap-3 rounded-[20px] bg-white p-5 ${current ? "border-2 border-pos-600" : "border border-pos-line"}`}>
              <h3 className="font-display text-xl font-bold text-pos-ink">{plan.name}</h3>
              <p className="font-display text-2xl font-bold text-pos-ink">{priceText(plan)}</p>
              <ul className="grid gap-1 text-sm text-pos-ink-2">
                {planFeatures(plan)
                  .slice(0, 4)
                  .map(line => (
                    <li key={line}>✓ {line}</li>
                  ))}
              </ul>
              {current && !waiting ? (
                <span className="mt-auto flex h-11 items-center justify-center rounded-xl bg-pos-50 font-semibold text-pos-700">Your plan</span>
              ) : next ? (
                <span className="mt-auto flex h-11 items-center justify-center rounded-xl bg-pos-page font-semibold text-pos-muted">Starts at the month&apos;s end</span>
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
