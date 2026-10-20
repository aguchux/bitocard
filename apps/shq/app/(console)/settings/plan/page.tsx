"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { ActionDialog, Badge, Button, Card, cn, ErrorState, errorMessage, formatDate, formatMoney, Notice, PageHeader, RefreshFailed, Skeleton } from "@bitocard/admin-ui";
import { type PlanDetail, type Subscription, useChangePlanMutation, useResellerPlansQuery, useSubscriptionQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const standardBasics = ["Your own store and the reseller API", "Sell to customers in your country"];

const usd = (cents: number) => formatMoney(cents, "USD");

/** What the plan costs you a month, in your currency when it can be priced (else US dollars). */
function priceText(plan: PlanDetail) {
  return plan.local_price ? formatMoney(plan.local_price.amount, plan.local_price.currency) : usd(plan.price.amount);
}

function PlanCard({ plan, subscription, onChoose, canChange }: { plan: PlanDetail; subscription: Subscription; onChoose: (plan: PlanDetail) => void; canChange: boolean }) {
  const current = subscription.plan.code === plan.code;
  const ending = current && subscription.cancel_at_period_end;
  const free = plan.price.amount === 0;
  const local = plan.local_price && plan.local_price.currency !== "USD" ? plan.local_price : null;
  const features = [...(free ? standardBasics : []), ...plan.feature_details.map(item => item.description)];
  // Choosing a plan you already have does nothing, except taking back a Premium cancellation.
  const action = current ? (ending ? "Keep this plan" : null) : free ? `Move to ${plan.name}` : `Upgrade to ${plan.name}`;

  return (
    <Card className={cn("flex flex-col p-5 sm:p-6", current && "border-brand-500 ring-2 ring-brand-100")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{plan.name}</h2>
        {current ? <Badge tone={ending ? "amber" : "pink"}>{ending ? "Ends soon" : "Current plan"}</Badge> : null}
      </div>
      {plan.description ? <p className="mt-1 text-sm text-muted">{plan.description}</p> : null}
      <p className="mt-3">
        <span className="text-3xl font-extrabold tracking-tight text-ink">{free ? "Free" : priceText(plan)}</span>
        {free ? null : <span className="text-sm text-muted"> a month</span>}
      </p>
      {!free && local ? (
        <p className="mt-0.5 text-xs text-muted">{local.fixed ? `Charged in ${local.currency} from your wallet.` : `${usd(plan.price.amount)} at today's rate, charged in ${local.currency}.`}</p>
      ) : null}
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
  const [change] = useChangePlanMutation();
  const [choosing, setChoosing] = useState<PlanDetail | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const sub = subscription.data;
  // The subscription's price says which currency you are charged in; the plans are then priced in it.
  const currency = sub?.plan.local_price?.currency;
  const plans = useResellerPlansQuery(currency ? { currency } : undefined, { skip: !sub });
  const loadError = subscription.error ?? plans.error;
  const retry = () => {
    void subscription.refetch();
    // The plans wait for the subscription (its currency), so they are asked again only once it has loaded.
    if (sub) void plans.refetch();
  };

  const confirmText = (plan: PlanDetail, current: Subscription) => {
    if (plan.code === current.plan.code) return `${plan.name} carries on and renews ${formatDate(current.renews_at)}. Nothing is charged now.`;
    if (plan.price.amount === 0) {
      return current.renews_at
        ? `You keep ${current.plan.name} until ${formatDate(current.renews_at)}, then move to ${plan.name}. Nothing more is charged.`
        : `You move to ${plan.name} straight away.`;
    }
    const fixed = plan.local_price?.fixed !== false;
    return `${priceText(plan)} is charged now from your live wallet${fixed ? "" : " (the US dollar price at today's rate; later months at the rate on the day)"}, then every month until you cancel. Make sure your live wallet has enough available.`;
  };

  return (
    <ShqShell section="settings" current="/settings/plan" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Plan" }]}>
      <PageHeader title="Plan" description="Standard is free. Paid plans are billed monthly from your wallet and unlock the features listed with them." />
      {changed ? <Notice tone="green">{changed}</Notice> : null}
      {mode === "test" ? <Notice tone="amber">Plans are paid from your live wallet, so they cannot be changed in the sandbox. Switch to live to change your plan.</Notice> : null}
      {!can(membership, "finance") ? <Notice tone="grey">Only the owner and finance members can change the plan.</Notice> : null}

      {!sub || !plans.data ? (
        loadError ? (
          <Card>
            <ErrorState message={errorMessage(loadError, "Could not load your plan.")} onRetry={retry} />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        )
      ) : (
        <>
          {loadError && !subscription.isFetching && !plans.isFetching ? <RefreshFailed message={errorMessage(loadError, "Could not load your plan.")} onRetry={retry} /> : null}
          {sub.past_due_since ? (
            <Notice tone="red" title="Renewal failed">
              {`We could not take the ${sub.plan.name} renewal from your wallet on ${formatDate(sub.past_due_since)}. Top up your live wallet: we try again daily, and the plan moves to Standard if the renewal still fails after 7 days.`}
            </Notice>
          ) : sub.cancel_at_period_end && sub.renews_at ? (
            <Notice tone="amber">{`${sub.plan.name} ends on ${formatDate(sub.renews_at)} and you move to Standard. Nothing more is charged.`}</Notice>
          ) : sub.renews_at ? (
            <Notice tone="blue">{`${sub.plan.name} renews on ${formatDate(sub.renews_at)}, charged from your live wallet.`}</Notice>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.data.data.map(plan => (
              <PlanCard key={plan.code} plan={plan} subscription={sub} onChoose={setChoosing} canChange={canChange} />
            ))}
          </div>
          <p className="text-xs text-muted">
            Plans are charged in your currency. Where BitoCard has not set a price in it, the US dollar price is converted at the exchange rate on the day, including BitoCard&apos;s disclosed conversion margin.
          </p>
          <ActionDialog
            open={choosing !== null}
            onClose={() => setChoosing(null)}
            title={choosing ? (choosing.code === sub.plan.code ? `Keep ${choosing.name}?` : `Move to ${choosing.name}?`) : ""}
            confirmLabel={choosing && choosing.price.amount > 0 && choosing.code !== sub.plan.code ? `Pay ${priceText(choosing)} and upgrade` : "Confirm"}
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
