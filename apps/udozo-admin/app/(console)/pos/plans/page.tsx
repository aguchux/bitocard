"use client";

import { useId, useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, errorMessage, Field, Input, KeyValue, PageHeader, QueryView, Skeleton, Textarea } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminPosPlan, posLimitKeys, posLimitLabels, usePosPlansQuery, useUpdatePosPlanMutation } from "@bitocard/api-client/admin";
import { money } from "@/components/connect";
import { type PlanDraft, draftOf, limitsLine, planChange } from "@/components/pos";
import { UdozoShell } from "@/components/shell";

function EditPlan({ plan, currencies, onClose }: { plan: AdminPosPlan; currencies: string[]; onClose: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(plan, currencies));
  const [update] = useUpdatePosPlanMutation();
  const set = (patch: Partial<PlanDraft>) => setDraft(current => ({ ...current, ...patch }));

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Change ${plan.name}`}
      description={plan.accounts ? `${plan.accounts} account${plan.accounts === 1 ? " is" : "s are"} on it. A new price is taken from each one's next renewal; new limits apply at once.` : "Nobody is on it yet."}
      confirmLabel="Save plan"
      requireReason={false}
      onConfirm={async () => {
        const result = planChange(plan, currencies, draft);
        if ("error" in result) throw new Error(result.error);
        await update({ code: plan.code, ...result.change }).unwrap();
      }}
    >
      <div className="grid gap-3">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={draft.name} maxLength={40} onChange={event => set({ name: event.target.value })} />
        </Field>
        <Field label="Description" htmlFor={`${id}-description`} hint="Shown on pos.udozo.com's pricing page.">
          <Textarea id={`${id}-description`} value={draft.description} maxLength={300} rows={2} onChange={event => set({ description: event.target.value })} />
        </Field>
        {plan.paid ? (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-ink">Monthly price</legend>
            <p className="text-xs text-muted">Per market currency. Leave one empty and the plan cannot be bought there (Price coming soon).</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {currencies.map(currency => (
                <Field key={currency} label={currency} htmlFor={`${id}-price-${currency}`}>
                  <Input id={`${id}-price-${currency}`} inputMode="decimal" value={draft.prices[currency] ?? ""} onChange={event => set({ prices: { ...draft.prices, [currency]: event.target.value } })} />
                </Field>
              ))}
            </div>
          </fieldset>
        ) : null}
        {plan.paid ? (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-ink">Yearly price</legend>
            <p className="text-xs text-muted">Optional, for owners who pay a year at once (usually less than twelve months). Empty: monthly only in that currency.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {currencies.map(currency => (
                <Field key={currency} label={`${currency} a year`} htmlFor={`${id}-yearly-${currency}`}>
                  <Input id={`${id}-yearly-${currency}`} inputMode="decimal" value={draft.yearly?.[currency] ?? ""} onChange={event => set({ yearly: { ...draft.yearly, [currency]: event.target.value } })} />
                </Field>
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-ink">Limits</legend>
          <p className="text-xs text-muted">{plan.paid ? "Empty is unlimited." : "Free always has a limit on each."}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {posLimitKeys.map(key => (
              <Field key={key} label={posLimitLabels[key]} htmlFor={`${id}-limit-${key}`}>
                <Input id={`${id}-limit-${key}`} inputMode="numeric" value={draft.limits[key]} placeholder={plan.paid ? "Unlimited" : undefined} onChange={event => set({ limits: { ...draft.limits, [key]: event.target.value } })} />
              </Field>
            ))}
          </div>
        </fieldset>
        {plan.paid ? (
          <>
            <Field label="Free trial (days)" htmlFor={`${id}-trial`} hint="0 to 90. Only an owner's first paid plan has one.">
              <Input id={`${id}-trial`} inputMode="numeric" value={draft.trial_days} onChange={event => set({ trial_days: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={draft.shown} onChange={event => set({ shown: event.target.checked })} />
              Offer it on pos.udozo.com (owners on it keep it either way)
            </label>
          </>
        ) : null}
      </div>
    </ActionDialog>
  );
}

function PlanCard({ plan, currencies, edits }: { plan: AdminPosPlan; currencies: string[]; edits: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <CardHeader
        title={plan.name}
        description={plan.description ?? undefined}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {plan.paid ? <Badge tone={plan.shown ? "green" : "grey"}>{plan.shown ? "Offered" : "Hidden"}</Badge> : <Badge tone="blue">Always offered</Badge>}
            {edits ? (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Change
              </Button>
            ) : null}
          </span>
        }
      />
      <KeyValue
        items={[
          { label: "Monthly price", value: plan.paid ? currencies.map(currency => `${currency} ${plan.prices[currency] === undefined ? "not priced" : money(plan.prices[currency], currency)}`).join(" · ") : "Free" },
          ...(plan.paid ? [{ label: "Yearly price", value: Object.keys(plan.yearly_prices ?? {}).length ? currencies.filter(currency => plan.yearly_prices?.[currency] !== undefined).map(currency => `${currency} ${money(plan.yearly_prices![currency]!, currency)}`).join(" · ") : "Monthly only" }] : []),
          { label: "Limits", value: limitsLine(plan.limits) },
          ...(plan.paid ? [{ label: "Free trial", value: plan.trial_days ? `${plan.trial_days} days` : "None" }] : []),
          { label: "Accounts on it", value: plan.accounts.toLocaleString("en-GB") },
        ]}
      />
      {editing ? <EditPlan plan={plan} currencies={currencies} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

/** POS > Plans and prices: Free, Premium and Multi-shop, priced per market currency by finance. */
export default function PosPlansPage() {
  const admin = useAdmin();
  const query = usePosPlansQuery();
  return (
    <UdozoShell section="pos" current="/pos/plans" crumbs={[{ label: "POS", href: "/pos/accounts" }, { label: "Plans and prices" }]}>
      <PageHeader title="Plans and prices" description="What shop owners pay for Udozo POS each month, from their Udozo wallet. Finance changes them; each change asks for your authenticator and is recorded." />
      <div className="mt-6">
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {plans => (
            <div className="grid gap-4">
              {plans.data.map(plan => (
                <PlanCard key={plan.code} plan={plan} currencies={plans.currencies} edits={can(admin, "finance")} />
              ))}
            </div>
          )}
        </QueryView>
      </div>
      {query.error && query.data ? <p className="mt-3 text-sm text-red-700">{errorMessage(query.error)}</p> : null}
    </UdozoShell>
  );
}
