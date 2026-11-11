"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { type BillingInterval, dueToday, money, type PosPlan, planFeatures, priceText, readVat, sortPlans, yearlySaving } from "@/lib/pos";
import { type ShopFields, signUp } from "@/lib/pos-actions";

const input = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none";
const label = "block text-sm font-semibold text-pos-ink-2";
const primary = "flex h-12 items-center justify-center rounded-xl bg-pos-600 px-6 font-bold text-white hover:bg-pos-700 disabled:opacity-60";
const secondary = "flex h-12 items-center justify-center rounded-xl border border-pos-line px-5 font-semibold text-pos-ink hover:bg-pos-page";

type Step = "shop" | "plan" | "pay";
const stepNames: Array<[Step, string]> = [
  ["shop", "Your shop"],
  ["plan", "Choose a plan"],
  ["pay", "Confirm"],
];

/**
 * Sign-up after Continue with Udozo: the shop (in the account's own country and currency), the plan, then what is due
 * today from the Udozo wallet, with Add funds on udozo.com when it is short. Free and trials take nothing today.
 */
export function SignupWizard({ plans, currency, wallet, initialPlan, addFundsUrl, name }: { plans: PosPlan[]; currency: string; wallet: number; initialPlan: string | null; addFundsUrl: string; name: string }) {
  const router = useRouter();
  const ids = useId();
  const choices = sortPlans(plans.filter(plan => plan.available));
  const [step, setStep] = useState<Step>("shop");
  const [shop, setShop] = useState({ name: "", address: "", phone: "", tin: "", vat: "0" });
  const [code, setCode] = useState(choices.find(plan => plan.code === initialPlan)?.code ?? choices[0]?.code ?? "free");
  const [problem, setProblem] = useState<{ message: string; param: string | null; short?: boolean } | null>(null);
  const [busy, start] = useTransition();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const plan = choices.find(item => item.code === code) ?? choices[0];
  // Yearly only where the chosen plan has a yearly price.
  const paidAs: BillingInterval = plan?.paid && plan.yearly_price && interval === "year" ? "year" : "month";
  const due = plan ? dueToday(plan, paidAs) : 0;
  const yearly = choices.some(item => item.yearly_price);
  const short = due > wallet;

  const toPlan = (event: React.FormEvent) => {
    event.preventDefault();
    if (!shop.name.trim()) return setProblem({ message: "Give your shop's name.", param: "shop.name" });
    if (readVat(shop.vat) === null) return setProblem({ message: "VAT is a rate from 0% to 50%, such as 7.5.", param: "vat_bps" });
    setProblem(null);
    setStep("plan");
  };

  const submit = () => {
    if (!plan) return;
    const fields: ShopFields = { name: shop.name, address: shop.address || null, phone: shop.phone || null, tin: shop.tin || null, vat_bps: readVat(shop.vat) ?? 0 };
    start(async () => {
      const result = await signUp(plan.code, fields, due, paidAs);
      if (result.ok) return router.push("/app/setup?welcome=1");
      if (result.code === "price_changed") router.refresh();
      if (result.param?.startsWith("shop") || result.param === "vat_bps") setStep("shop");
      setProblem({ message: result.message, param: result.param, short: result.code === "wallet_balance_low" });
    });
  };

  const field = (key: keyof typeof shop, text: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`${ids}-${key}`} className={label}>
        {text}
      </label>
      <input id={`${ids}-${key}`} value={shop[key]} onChange={event => setShop({ ...shop, [key]: event.target.value })} className={input} {...extra} />
    </div>
  );

  return (
    <div className="grid gap-6">
      <ol className="flex flex-wrap gap-2" aria-label="Sign-up steps">
        <li className="rounded-full bg-pos-50 px-3 py-1 text-sm font-semibold text-pos-700">✓ Signed in as {name}</li>
        {stepNames.map(([key, text], index) => (
          <li key={key} aria-current={step === key ? "step" : undefined} className={`rounded-full px-3 py-1 text-sm font-semibold ${step === key ? "bg-pos-600 text-white" : "bg-pos-page text-pos-muted"}`}>
            {index + 2}. {text}
          </li>
        ))}
      </ol>

      {step === "shop" ? (
        <form onSubmit={toPlan} className="grid gap-4 rounded-[20px] border border-pos-line bg-white p-6">
          <h2 className="font-display text-2xl font-bold text-pos-ink">Your shop</h2>
          <p className="text-pos-ink-2">This is printed on your receipts. Your shop sells in {currency}, your Udozo account&apos;s currency.</p>
          {field("name", "Shop name", { required: true, maxLength: 80, autoComplete: "organization" })}
          {field("address", "Address (optional)", { maxLength: 300, autoComplete: "street-address" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("phone", "Shop phone (optional)", { maxLength: 30, inputMode: "tel", autoComplete: "tel" })}
            {field("tin", "Tax ID or TIN (optional)", { maxLength: 40 })}
          </div>
          <div>
            {field("vat", "VAT added to sales (%)", { inputMode: "decimal", maxLength: 6, "aria-describedby": `${ids}-vat-help` })}
            <p id={`${ids}-vat-help`} className="mt-1 text-sm text-pos-muted">
              0 if you do not charge VAT. Nigeria&apos;s rate is 7.5. You can change it later.
            </p>
          </div>
          <button type="submit" className={`${primary} sm:justify-self-start`}>
            Continue: choose a plan
          </button>
        </form>
      ) : null}

      {step === "plan" ? (
        <section className="grid gap-4 rounded-[20px] border border-pos-line bg-white p-6" aria-labelledby={`${ids}-plan`}>
          <h2 id={`${ids}-plan`} className="font-display text-2xl font-bold text-pos-ink">
            Choose your plan
          </h2>
          {yearly ? (
            <div role="radiogroup" aria-label="How to pay" className="flex w-fit gap-1 rounded-full bg-pos-page p-1">
              {(["month", "year"] as const).map(option => (
                <button key={option} type="button" role="radio" aria-checked={interval === option} onClick={() => setInterval(option)} className={`h-10 rounded-full px-4 text-sm font-semibold ${interval === option ? "bg-pos-600 text-white" : "text-pos-ink-2 hover:bg-white"}`}>
                  {option === "month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          ) : null}
          <fieldset className="grid gap-3">
            <legend className="sr-only">Plan</legend>
            {choices.map(item => (
              <label key={item.code} className={`flex cursor-pointer gap-3 rounded-2xl p-4 ${item.code === code ? "border-2 border-pos-600 bg-pos-50" : "border border-pos-line"}`}>
                <input type="radio" name="plan" value={item.code} checked={item.code === code} onChange={() => setCode(item.code)} className="mt-1 size-5 accent-pos-600" />
                <span className="grid gap-1">
                  <span className="font-display text-lg font-bold text-pos-ink">
                    {item.name} · {priceText(item, item.paid && item.yearly_price && interval === "year" ? "year" : "month")}
                  </span>
                  {interval === "year" && item.paid && !item.yearly_price ? <span className="text-sm text-pos-muted">Monthly only</span> : null}
                  {interval === "year" && yearlySaving(item) ? <span className="text-sm font-semibold text-pos-700">Save {yearlySaving(item)}% on twelve months</span> : null}
                  {item.paid && item.trial_days > 0 ? <span className="text-sm font-semibold text-pos-700">{item.trial_days}-day free trial</span> : null}
                  <span className="text-sm text-pos-ink-2">{planFeatures(item).slice(0, 4).join(" · ")}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep("shop")} className={secondary}>
              Back
            </button>
            <button type="button" onClick={() => setStep("pay")} className={primary}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === "pay" && plan ? (
        <section className="grid gap-4 rounded-[20px] border border-pos-line bg-white p-6" aria-labelledby={`${ids}-pay`}>
          <h2 id={`${ids}-pay`} className="font-display text-2xl font-bold text-pos-ink">
            Confirm and open your shop
          </h2>
          <dl className="grid gap-2 rounded-2xl bg-pos-page p-4 text-pos-ink-2">
            <div className="flex justify-between gap-3">
              <dt>Shop</dt>
              <dd className="font-semibold text-pos-ink">{shop.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Plan</dt>
              <dd className="font-semibold text-pos-ink">{plan.name}</dd>
            </div>
            {plan.paid && plan.trial_days > 0 ? (
              <div className="flex justify-between gap-3">
                <dt>Free trial</dt>
                <dd className="font-semibold text-pos-ink">{plan.trial_days} days</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 border-t border-pos-line pt-2">
              <dt>Due today</dt>
              <dd className="font-display text-xl font-bold text-pos-ink">{money(due, currency)}</dd>
            </div>
            {plan.paid && plan.price ? (
              <div className="flex justify-between gap-3">
                <dt>Then</dt>
                <dd className="font-semibold text-pos-ink">{priceText(plan, paidAs)}, from your Udozo wallet</dd>
              </div>
            ) : null}
          </dl>
          {due > 0 ? (
            <p className={short ? "rounded-xl bg-pos-warn-bg p-3 font-semibold text-pos-warn" : "text-pos-ink-2"}>
              Your Udozo wallet has {money(wallet, currency)}.{" "}
              {short ? (
                <>
                  Add {money(due - wallet, currency)} or more on udozo.com, then come back and confirm.{" "}
                  <a href={addFundsUrl} target="_blank" rel="noopener" className="underline">
                    Add funds
                  </a>
                </>
              ) : (
                <>{money(due, currency)} is taken from it now.</>
              )}
            </p>
          ) : plan.paid ? (
            <p className="text-pos-ink-2">Nothing is taken today. When the trial ends, the first month comes from your Udozo wallet; you can move to Free before then.</p>
          ) : (
            <p className="text-pos-ink-2">Free needs no payment. You can move to a paid plan at any time.</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep("plan")} className={secondary}>
              Back
            </button>
            <button type="button" onClick={submit} disabled={busy || short} className={primary}>
              {due > 0 ? `Pay ${money(due, currency)} and open my shop` : plan.paid ? "Start free trial" : "Open my shop"}
            </button>
          </div>
        </section>
      ) : null}

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
