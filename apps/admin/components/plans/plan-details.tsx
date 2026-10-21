"use client";

import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, errorMessage, Field, Input, Notice, Textarea, Toggle } from "@bitocard/admin-ui";
import { useDeletePlanMutation, useUpdatePlanMutation } from "@bitocard/api-client/admin";
import { SettingsPlan, toMinor, toMajor } from "@/components/plans/amounts";

/** The plan's name, description, US dollar price (paid plans), whether resellers can choose it, and its place. */
export function PlanDetails({ plan, editable }: { plan: SettingsPlan; editable: boolean }) {
  const [update, state] = useUpdatePlanMutation();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [price, setPrice] = useState(toMajor(plan.price.amount, "USD"));
  const [order, setOrder] = useState(String(plan.sort_order));
  const [margin, setMargin] = useState(String(plan.usage_margin_bps / 100));
  const [saved, setSaved] = useState(false);
  const cents = plan.free ? 0 : toMinor(price, "USD");
  const sortOrder = /^\d{1,5}$/.test(order.trim()) ? Number(order) : null;
  // The usage margin is entered as a percentage (up to 200, two decimals) and saved in basis points.
  const marginBps = /^\d{1,3}(\.\d{1,2})?$/.test(margin.trim()) && Number(margin) <= 200 ? Math.round(Number(margin) * 100) : null;
  const badPrice = !plan.free && (cents === null || cents === 0);
  const changed = name !== plan.name || description !== (plan.description ?? "") || (!plan.free && cents !== plan.price.amount) || sortOrder !== plan.sort_order || marginBps !== plan.usage_margin_bps;
  return (
    <Card>
      <CardHeader
        title={`${plan.name} plan`}
        description={`${plan.resellers} reseller${plan.resellers === 1 ? "" : "s"} on it now.${plan.free ? " Every reseller starts here; it is never charged." : " Charged monthly from their live wallet."}`}
        actions={<Badge tone={plan.free ? "grey" : "pink"}>{plan.free ? "Free" : "Paid"}</Badge>}
      />
      <form
        className="grid gap-4 px-5 pb-5 sm:px-6 md:grid-cols-2"
        onSubmit={async event => {
          event.preventDefault();
          if (badPrice || sortOrder === null || marginBps === null) return;
          setSaved(false);
          await update({ code: plan.code, name, description: description || null, ...(plan.free ? {} : { price_cents: cents ?? undefined }), sort_order: sortOrder, usage_margin_bps: marginBps })
            .unwrap()
            .then(() => setSaved(true))
            .catch(() => undefined);
        }}
      >
        <Field label="Name" htmlFor={`plan-name-${plan.code}`}>
          <Input id={`plan-name-${plan.code}`} value={name} maxLength={40} disabled={!editable} onChange={event => setName(event.target.value)} />
        </Field>
        {plan.free ? (
          <Field label="Price a month" htmlFor={`plan-price-${plan.code}`} hint="The free plan is never charged.">
            <Input id={`plan-price-${plan.code}`} value="Free" disabled />
          </Field>
        ) : (
          <Field label="Price a month (US dollars)" htmlFor={`plan-price-${plan.code}`} hint="Used where no local price is set: converted at the day's rate when charged." error={price && badPrice ? "Enter a price above zero, like 25 or 24.99." : undefined}>
            <Input id={`plan-price-${plan.code}`} inputMode="decimal" value={price} disabled={!editable} onChange={event => setPrice(event.target.value)} />
          </Field>
        )}
        <div className="md:col-span-2">
          <Field label="Description" htmlFor={`plan-description-${plan.code}`} hint="Shown to resellers with the plan.">
            <Textarea id={`plan-description-${plan.code}`} rows={2} maxLength={300} value={description} disabled={!editable} onChange={event => setDescription(event.target.value)} />
          </Field>
        </div>
        <Field label="Place in the list" htmlFor={`plan-order-${plan.code}`} hint="Lowest first." error={sortOrder === null ? "Enter a whole number." : undefined}>
          <Input id={`plan-order-${plan.code}`} inputMode="numeric" value={order} disabled={!editable} onChange={event => setOrder(event.target.value)} />
        </Field>
        <Field
          label="Usage margin (%)"
          htmlFor={`plan-margin-${plan.code}`}
          hint="Added to BitoCard's cost on usage billed as it goes: AI replies beyond the allowance, mobile money deposit fees."
          error={marginBps === null ? "Enter a percentage from 0 to 200." : undefined}
        >
          <Input id={`plan-margin-${plan.code}`} inputMode="decimal" value={margin} disabled={!editable} onChange={event => setMargin(event.target.value)} />
        </Field>
        {state.error ? <div className="md:col-span-2"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
        {saved && !changed ? <div className="md:col-span-2"><Notice tone="green">Saved. Resellers see it at once; a new price is charged from each reseller&apos;s next renewal.</Notice></div> : null}
        {editable ? (
          <div className="md:col-span-2">
            <Button type="submit" icon={<Save className="size-4" aria-hidden />} loading={state.isLoading} disabled={!changed || badPrice || sortOrder === null || marginBps === null}>
              Save plan
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

/** Whether resellers can choose the plan, and deleting it once nobody is on it. */
export function PlanAvailability({ plan, editable, onDeleted }: { plan: SettingsPlan; editable: boolean; onDeleted: () => void }) {
  const [update, state] = useUpdatePlanMutation();
  const [remove] = useDeletePlanMutation();
  const [deleting, setDeleting] = useState(false);
  if (plan.free) return null;
  return (
    <Card>
      <CardHeader title="Offered to resellers" description="A hidden plan disappears from the list resellers choose from. Resellers already on it keep it and renew as before." />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line p-4">
          <div>
            <p className="font-semibold text-ink">{plan.available ? "Resellers can choose it" : "Hidden from resellers"}</p>
            <p className="text-sm text-muted">{plan.available ? "Listed in SHQ's Settings > Plan." : "Nobody new can choose it."}</p>
          </div>
          <Toggle checked={plan.available} label={`Offer ${plan.name} to resellers`} disabled={!editable || state.isLoading} onChange={available => void update({ code: plan.code, available }).unwrap().catch(() => undefined)} />
        </div>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {editable ? (
          <div>
            <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} disabled={plan.resellers > 0} onClick={() => setDeleting(true)}>
              Delete plan
            </Button>
            {plan.resellers > 0 ? <p className="mt-1 text-xs text-muted">Resellers are on this plan: hide it instead, or move them first.</p> : null}
          </div>
        ) : null}
        <ActionDialog
          open={deleting}
          onClose={() => setDeleting(false)}
          title={`Delete ${plan.name}?`}
          confirmLabel="Delete plan"
          requireReason={false}
          onConfirm={async () => {
            await remove({ code: plan.code }).unwrap();
            onDeleted();
          }}
        >
          <p className="text-sm text-muted">The plan and its local prices are removed for good. Nobody is on it.</p>
        </ActionDialog>
      </div>
    </Card>
  );
}
