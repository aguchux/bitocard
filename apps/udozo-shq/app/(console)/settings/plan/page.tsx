"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Sparkles, Store } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, cn, ErrorState, errorMessage, formatDate, formatMoney, Notice, PageHeader, RefreshFailed, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type PlanDetail, type SetupFee, type StoreSubscription, useChangeStorePlanMutation, useResellerPlansQuery, useSetupFeeQuery, useStoreSubscriptionsQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { SetupFeeCard } from "@/components/setup-fee";

const startupBasics = ["Your own Resale shops and the reseller API", "Sell to shoppers in your country", "Buy or connect your own domain"];

const usd = (cents: number) => formatMoney(cents, "USD");

/** What the plan costs you a month, in your currency when it can be priced (else US dollars). */
function priceText(plan: PlanDetail) {
  return plan.local_price ? formatMoney(plan.local_price.amount, plan.local_price.currency) : usd(plan.price.amount);
}

/** One line on a store's billing: renewing, ending, moving down, or a failed renewal. */
function billingText(store: StoreSubscription) {
  if (store.past_due_since) return `Renewal failed on ${formatDate(store.past_due_since)}: top up within 7 days to keep it.`;
  if (store.cancel_at_period_end && store.renews_at) return `Ends ${formatDate(store.renews_at)}, then Startup.`;
  if (store.next_plan && store.renews_at) return `Moves to ${store.next_plan.name} on ${formatDate(store.renews_at)}.`;
  if (store.renews_at) return `Renews ${formatDate(store.renews_at)}.`;
  return store.plan.price.amount === 0 ? "Free." : "Set by Udozo, not billed.";
}

function PlanCard({ plan, store, onChoose, canChange }: { plan: PlanDetail; store: StoreSubscription; onChoose: (plan: PlanDetail) => void; canChange: boolean }) {
  const current = store.plan.code === plan.code;
  const ending = current && (store.cancel_at_period_end || Boolean(store.next_plan));
  const waiting = store.next_plan?.code === plan.code;
  const free = plan.price.amount === 0;
  const local = plan.local_price && plan.local_price.currency !== "USD" ? plan.local_price : null;
  const features = [...(free ? startupBasics : []), ...plan.feature_details.map(item => item.description)];
  const action = current ? (ending ? "Keep this plan" : null) : waiting ? null : free ? `Move to ${plan.name}` : `Choose ${plan.name}`;

  return (
    <Card className={cn("flex flex-col p-5 sm:p-6", current && "border-brand-500 ring-2 ring-brand-100")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{plan.name}</h2>
        {current ? <Badge tone={ending ? "amber" : "pink"}>{ending ? "Ends soon" : "Current plan"}</Badge> : waiting ? <Badge tone="blue">From the next renewal</Badge> : null}
      </div>
      {plan.description ? <p className="mt-1 text-sm text-muted">{plan.description}</p> : null}
      <p className="mt-3">
        <span className="text-3xl font-extrabold tracking-tight text-ink">{free ? "Free" : priceText(plan)}</span>
        {free ? null : <span className="text-sm text-muted"> a month per store</span>}
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

/** What the setup fee adds to a first paid month, when it is still due. */
const feeNote = (fee: SetupFee | undefined) => (fee?.due && fee.currency ? ` Your one-time Seller HQ setup fee of ${formatMoney(fee.amount, fee.currency)} is charged with it.` : "");

/** Each store is on Startup or Premium; account-wide features follow the highest. `?store=` opens one store's plans. */
export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <Plans />
    </Suspense>
  );
}

function Plans() {
  const { membership, mode } = useReseller();
  const wanted = useSearchParams().get("store");
  const fee = useSetupFeeQuery();
  // Plans are paid from the live wallet, so they are changed in live mode only (the API refuses the sandbox).
  const canChange = can(membership, "finance") && mode === "live";
  const subscriptions = useStoreSubscriptionsQuery();
  const [change] = useChangeStorePlanMutation();
  const [selected, setSelected] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<PlanDetail | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const list = subscriptions.data;
  const store = list?.data.find(item => item.store.id === (selected ?? wanted)) ?? list?.data[0] ?? null;
  // The store's price says which currency you are charged in; the plans are then priced in it.
  const currency = store?.plan.local_price?.currency;
  const plans = useResellerPlansQuery(currency ? { currency } : undefined, { skip: !list });
  const loadError = subscriptions.error ?? plans.error;
  const retry = () => {
    void subscriptions.refetch();
    if (list) void plans.refetch();
  };

  const confirmText = (plan: PlanDetail, current: StoreSubscription) => {
    const name = current.store.name;
    if (plan.code === current.plan.code) return `${plan.name} carries on for ${name}${current.renews_at ? ` and renews ${formatDate(current.renews_at)}` : ""}. Nothing is charged now.`;
    if (plan.price.amount === 0) {
      return current.renews_at ? `${name} keeps ${current.plan.name} until ${formatDate(current.renews_at)}, then moves to ${plan.name}. Nothing more is charged.` : `${name} moves to ${plan.name} straight away.`;
    }
    const down = current.renews_at && current.plan.price.amount > plan.price.amount;
    if (down) return `${name} keeps ${current.plan.name} until ${formatDate(current.renews_at)}, then moves to ${plan.name} at ${priceText(plan)} a month. Nothing is charged now.`;
    const credit = current.renews_at && current.plan.price.amount > 0 ? ", less credit for the unused days of this month's plan," : "";
    const fixed = plan.local_price?.fixed !== false;
    return `${priceText(plan)} is charged now from your live wallet${credit}${fixed ? "" : " (the US dollar price at today's rate)"}, then every month until you change it.${feeNote(fee.data)} Make sure your live wallet has enough available.`;
  };

  return (
    <ShqShell section="settings" current="/settings/plan" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Plans" }]}>
      <PageHeader title="Plans" description="Each store has its own plan. Startup is free; Premium is billed monthly per store from your wallet and includes a free domain for the store." />
      <SetupFeeCard />
      {changed ? <Notice tone="green">{changed}</Notice> : null}
      {mode === "test" ? <Notice tone="amber">Plans are paid from your live wallet, so they cannot be changed in the sandbox. Switch to live to change a plan.</Notice> : null}
      {!can(membership, "finance") ? <Notice tone="grey">Only the owner and finance members can change plans.</Notice> : null}

      {!list || !plans.data ? (
        loadError ? (
          <Card>
            <ErrorState message={errorMessage(loadError, "Could not load your plans.")} onRetry={retry} />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        )
      ) : !store ? (
        <Notice tone="blue" title="Create a store first">
          <span className="block">Plans are chosen per store. Create your store, then choose its plan here.</span>
          <AppLink href="/store/new" className="mt-2 inline-flex font-semibold text-brand-600 hover:underline">
            Create a store
          </AppLink>
        </Notice>
      ) : (
        <>
          {loadError && !subscriptions.isFetching && !plans.isFetching ? <RefreshFailed message={errorMessage(loadError, "Could not load your plans.")} onRetry={retry} /> : null}
          <Card>
            <CardHeader title="Your stores" description={`Your account is on ${list.account_plan.name}: features for your whole account (such as your team) follow your highest store plan.`} />
            <ul className="divide-y divide-line border-t border-line">
              {list.data.map(item => {
                const active = item.store.id === store.store.id;
                return (
                  <li key={item.store.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelected(item.store.id)}
                      className={cn("flex w-full items-center gap-3 px-5 py-3 text-left sm:px-6", active ? "bg-brand-50" : "hover:bg-canvas")}
                    >
                      <Store className="size-5 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{item.store.name}</span>
                        <span className={cn("block text-sm", item.past_due_since ? "text-red-600" : "text-muted")}>{billingText(item)}</span>
                      </span>
                      <Badge tone={item.plan.price.amount === 0 ? "grey" : "pink"}>{item.plan.name}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          <h2 className="text-base font-bold text-ink">{`Plans for ${store.store.name}`}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.data.data.map(plan => (
              <PlanCard key={plan.code} plan={plan} store={store} onChoose={setChoosing} canChange={canChange} />
            ))}
          </div>
          <p className="text-xs text-muted">
            Plans are charged in your currency. Where Udozo has not set a price in it, the US dollar price is converted at the exchange rate on the day, including Udozo&apos;s disclosed conversion margin.
          </p>
          <ActionDialog
            open={choosing !== null}
            onClose={() => setChoosing(null)}
            title={choosing ? (choosing.code === store.plan.code ? `Keep ${choosing.name}?` : `${store.store.name}: move to ${choosing.name}?`) : ""}
            confirmLabel={choosing && choosing.price.amount > store.plan.price.amount && choosing.code !== store.plan.code ? `Pay and move to ${choosing.name}` : "Confirm"}
            requireReason={false}
            onConfirm={async () => {
              if (!choosing) return;
              const result = await change({ store: store.store.id, plan: choosing.code }).unwrap();
              setChanged(
                result.next_plan && result.renews_at
                  ? `Done. ${result.store.name} moves to ${result.next_plan.name} on ${formatDate(result.renews_at)}.`
                  : result.cancel_at_period_end && result.renews_at
                    ? `Done. ${result.store.name} keeps ${result.plan.name} until ${formatDate(result.renews_at)}.`
                    : `${result.store.name} is on ${result.plan.name}${result.renews_at ? `, renewing ${formatDate(result.renews_at)}` : ""}.`,
              );
            }}
          >
            {choosing ? <p className="text-sm text-muted">{confirmText(choosing, store)}</p> : null}
          </ActionDialog>
        </>
      )}
    </ShqShell>
  );
}
