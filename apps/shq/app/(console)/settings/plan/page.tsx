"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { ActionDialog, Badge, Button, Card, cn, ErrorState, errorMessage, formatDate, formatMoney, humanise, Notice, PageHeader, Skeleton } from "@bitocard/admin-ui";
import { type Plan, type Subscription, useChangePlanMutation, useExchangeRatesQuery, useResellerPlansQuery, useSubscriptionQuery, useWalletQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** Plain words for the feature codes plans carry. */
const featureText: Record<string, string> = {
  chargeback_protection: "Chargebacks handled by BitoCard, not taken from your wallet",
  priority_support: "Priority support, including chat",
  international_selling: "Sell to customers outside your country",
};
const standardBasics = ["Your own store and the reseller API", "Sell to customers in your country", "Chargebacks are taken from your wallet"];

const usd = (cents: number) => formatMoney(cents, "USD");

/** The plan price in the reseller's currency at BitoCard's current `pay` rate (what a charge would use today). */
function useLocalPrice(priceCents: number, currency: string | undefined) {
  const rates = useExchangeRatesQuery(undefined, { skip: !currency || currency === "USD" || priceCents === 0 });
  const rate = rates.data?.data.find(item => item.currency === currency);
  if (!currency || currency === "USD" || !rate?.available || !rate.pay) return null;
  const major = (priceCents / 100) * Number(rate.pay);
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 0 }).format(major).replace(/ /g, " ");
}

function PlanCard({ plan, subscription, currency, onChoose, canChange }: { plan: Plan; subscription: Subscription; currency?: string; onChoose: (plan: Plan) => void; canChange: boolean }) {
  const current = subscription.plan.code === plan.code;
  const ending = current && subscription.cancel_at_period_end;
  const local = useLocalPrice(plan.price.amount, currency);
  const free = plan.price.amount === 0;
  const features = plan.features.length ? plan.features.map(code => featureText[code] ?? humanise(code)) : plan.code === "standard" ? standardBasics : [];
  // Choosing a plan you already have does nothing, except taking back a Premium cancellation.
  const action = current ? (ending ? "Keep this plan" : null) : free ? `Move to ${plan.name}` : `Upgrade to ${plan.name}`;

  return (
    <Card className={cn("flex flex-col p-5 sm:p-6", current && "border-brand-500 ring-2 ring-brand-100")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{plan.name}</h2>
        {current ? <Badge tone={ending ? "amber" : "pink"}>{ending ? "Ends soon" : "Current plan"}</Badge> : null}
      </div>
      <p className="mt-3">
        <span className="text-3xl font-extrabold tracking-tight text-ink">{free ? "Free" : usd(plan.price.amount)}</span>
        {free ? null : <span className="text-sm text-muted"> a month</span>}
      </p>
      {local ? <p className="mt-0.5 text-xs text-muted">{`About ${local} a month at today's rate.`}</p> : null}
      <ul className="mt-4 flex-1 space-y-2">
        {features.map(text => (
          <li key={text} className="flex gap-2 text-sm text-ink">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {action && canChange ? (
        <Button className="mt-5 w-full" variant={free ? "secondary" : "primary"} icon={free ? undefined : <Sparkles className="size-4" aria-hidden />} onClick={() => onChoose(plan)}>
          {action}
        </Button>
      ) : null}
    </Card>
  );
}

export default function PlanPage() {
  const { membership, mode } = useReseller();
  // Plans are paid from the live wallet, so they are changed in live mode only (the API refuses the sandbox).
  const canChange = can(membership, "finance") && mode === "live";
  const subscription = useSubscriptionQuery();
  const plans = useResellerPlansQuery();
  // The wallet gives the currency charges are taken in (the live wallet; the sandbox one has the same currency).
  const wallet = useWalletQuery(undefined, { skip: !can(membership, "admin", "finance", "developer") });
  const [change] = useChangePlanMutation();
  const [choosing, setChoosing] = useState<Plan | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const sub = subscription.data;
  const currency = wallet.data?.currency;

  const confirmText = (plan: Plan, current: Subscription) => {
    if (plan.code === current.plan.code) return `${plan.name} carries on and renews ${formatDate(current.renews_at)}. Nothing is charged now.`;
    if (plan.price.amount === 0) {
      return current.renews_at
        ? `You keep ${current.plan.name} until ${formatDate(current.renews_at)}, then move to ${plan.name}. Nothing more is charged.`
        : `You move to ${plan.name} straight away.`;
    }
    return `${usd(plan.price.amount)} is charged now from your live wallet${currency ? ` in ${currency} at BitoCard's exchange rate` : ""}, then every month until you cancel. Make sure your live wallet has enough available.`;
  };

  return (
    <ShqShell section="settings" current="/settings/plan" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Plan" }]}>
      <PageHeader title="Plan" description="Standard is free. Premium is billed monthly from your wallet." />
      {changed ? <Notice tone="green">{changed}</Notice> : null}
      {mode === "test" ? <Notice tone="amber">Plans are paid from your live wallet, so they cannot be changed in the sandbox. Switch to live to change your plan.</Notice> : null}
      {!can(membership, "finance") ? <Notice tone="grey">Only the owner and finance members can change the plan.</Notice> : null}

      {subscription.error || plans.error ? (
        <Card>
          <ErrorState
            message={errorMessage(subscription.error ?? plans.error, "Could not load your plan.")}
            onRetry={() => {
              void subscription.refetch();
              void plans.refetch();
            }}
          />
        </Card>
      ) : !sub || !plans.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          {sub.past_due_since ? (
            <Notice tone="red" title="Renewal failed">
              {`We could not take the ${sub.plan.name} renewal from your wallet on ${formatDate(sub.past_due_since)}. Top up your live wallet: we try again daily, and the plan moves to Standard if the renewal still fails after 7 days.`}
            </Notice>
          ) : sub.cancel_at_period_end && sub.renews_at ? (
            <Notice tone="amber">{`${sub.plan.name} ends on ${formatDate(sub.renews_at)} and you move to Standard. Nothing more is charged.`}</Notice>
          ) : sub.renews_at ? (
            <Notice tone="blue">{`${sub.plan.name} renews on ${formatDate(sub.renews_at)}, charged from your live wallet.`}</Notice>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            {plans.data.data.map(plan => (
              <PlanCard key={plan.code} plan={plan} subscription={sub} currency={currency} onChoose={setChoosing} canChange={canChange} />
            ))}
          </div>
          <p className="text-xs text-muted">Prices are set in US dollars and charged in your currency at the exchange rate on the day, including BitoCard&apos;s disclosed conversion margin.</p>
          <ActionDialog
            open={choosing !== null}
            onClose={() => setChoosing(null)}
            title={choosing ? (choosing.code === sub.plan.code ? `Keep ${choosing.name}?` : `Move to ${choosing.name}?`) : ""}
            confirmLabel={choosing && choosing.price.amount > 0 && choosing.code !== sub.plan.code ? `Pay ${usd(choosing.price.amount)} and upgrade` : "Confirm"}
            requireReason={false}
            onConfirm={async () => {
              if (!choosing) return;
              const result = await change({ plan: choosing.code }).unwrap();
              setChanged(
                result.cancel_at_period_end && result.renews_at
                  ? `Done. ${result.plan.name} stays on until ${formatDate(result.renews_at)}.`
                  : `You are on ${result.plan.name}${result.renews_at ? `, renewing ${formatDate(result.renews_at)}` : ""}.`,
              );
            }}
          >
            {choosing ? <p className="text-sm text-muted">{confirmText(choosing, sub)}</p> : null}
          </ActionDialog>
        </>
      )}
    </ShqShell>
  );
}
