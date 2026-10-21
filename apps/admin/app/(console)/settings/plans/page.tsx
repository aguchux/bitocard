"use client";

import { Fragment, useState } from "react";
import { EyeOff, Plus, Save, Trash2 } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, currencyDigits, Dialog, errorMessage, Field, formatMoney, Input, Notice, PageHeader, QueryView, Skeleton, Tabs, Textarea, Toggle } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type PlanSettings, useCreatePlanMutation, useDeletePlanMutation, usePlanSettingsQuery, useSetPlanFeatureMutation, useSetPlanLimitMutation, useUpdatePlanMutation } from "@bitocard/api-client/admin";

type SettingsPlan = PlanSettings["plans"][number];

/** "35000" or "35,000.50" in a currency's major units, to minor units; null when it is not an amount. */
function toMinor(value: string, currency: string) {
  const digits = currencyDigits(currency);
  const match = new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${Math.max(digits, 1)}}))?$`).exec(value.replace(/,/g, "").trim());
  if (!match || (digits === 0 && match[2])) return null;
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? "").padEnd(digits, "0") || 0);
}
const toMajor = (minor: number, currency: string) => String(minor / 10 ** currencyDigits(currency));

/** "Business" to "business"; what the code field suggests from the name. */
const codeFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 30);

/**
 * Every feature down the side, every plan across the top, a switch in each cell. A change applies to resellers on that
 * plan at once; those losing a feature are told.
 */
const scopeLabel = { store: "Each store", account: "Whole account" } as const;

type LimitDefinition = PlanSettings["limits"][number];

/**
 * One plan's value for one limit: a number, or Unlimited. Saved when the box is left or Enter pressed, and the switch
 * saves at once. Lowering a limit only stops new additions; nothing a reseller already has is removed.
 */
function LimitCell({ plan, limit, editable }: { plan: PlanSettings["plans"][number]; limit: LimitDefinition; editable: boolean }) {
  const [setLimit, state] = useSetPlanLimitMutation();
  const value = plan.limits[limit.code] ?? null;
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const unlimited = value === null;
  const label = `${limit.name} on ${plan.name}`;
  const save = async (next: number | null) => {
    if (next === value) return;
    await setLimit({ code: plan.code, limit: limit.code, value: next })
      .unwrap()
      .catch(() => setDraft(value === null ? "" : String(value)));
  };
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return void setDraft(value === null ? "" : String(value));
    const number = Number(trimmed);
    if (!Number.isSafeInteger(number) || number < 0 || number > limit.max) return void setDraft(value === null ? "" : String(value));
    void save(number);
  };
  return (
    <div className="flex flex-col items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={limit.max}
        aria-label={label}
        value={unlimited ? "" : draft}
        placeholder={unlimited ? "∞" : undefined}
        disabled={!editable || unlimited || state.isLoading}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className="h-9 w-20 rounded-lg border border-line bg-white px-2 text-center text-sm tabular-nums focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-canvas"
      />
      <label className="flex items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={unlimited}
          disabled={!editable || state.isLoading}
          onChange={event => {
            if (event.target.checked) void save(null);
            else {
              const start = limit.default ?? 1;
              setDraft(String(start));
              void save(start);
            }
          }}
          className="size-3.5 accent-brand-500"
        />
        Unlimited
      </label>
      {state.error ? <span className="max-w-24 text-xs text-red-600">{errorMessage(state.error)}</span> : null}
    </div>
  );
}

function FeatureMatrix({ settings, editable }: { settings: PlanSettings; editable: boolean }) {
  const [setFeature, state] = useSetPlanFeatureMutation();
  const [pending, setPending] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title="Features and limits by plan"
        description="Switch each feature on or off for each plan, and set how much each plan allows. Resellers on the plan follow at once and are told what they lose; anything a plan does not include is refused. Lowering a limit stops new additions and removes nothing."
      />
      <div className="px-5 pb-5 sm:px-6">
        {state.error ? <div className="mb-4"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-canvas">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-ink">Feature</th>
                {settings.plans.map(plan => (
                  <th key={plan.code} scope="col" className="w-28 px-2 py-3 text-center font-semibold text-ink">
                    <span className="block truncate">{plan.name}</span>
                    {!plan.available ? <span className="text-xs font-normal text-muted">Hidden</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settings.groups.map(group => {
                const features = settings.features.filter(feature => feature.group === group.code);
                const limits = settings.limits.filter(limit => limit.group === group.code);
                if (!features.length && !limits.length) return null;
                return (
                  <Fragment key={group.code}>
                    <tr className="border-t border-line bg-canvas/60">
                      <th scope="colgroup" colSpan={settings.plans.length + 1} className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                        {group.name}
                      </th>
                    </tr>
                    {features.map(feature => (
                      <tr key={feature.code} className="border-t border-line">
                        <th scope="row" className="px-4 py-3 text-left font-normal">
                          <span className="block font-semibold text-ink">{feature.name}</span>
                          <span className="block text-xs text-muted">{feature.description}</span>
                          <span className="block text-xs text-muted">{scopeLabel[feature.scope]}</span>
                        </th>
                        {settings.plans.map(plan => {
                          const key = `${plan.code}:${feature.code}`;
                          const on = plan.features.includes(feature.code);
                          return (
                            <td key={plan.code} className="px-2 py-3 text-center">
                              <span className="inline-flex justify-center">
                                <Toggle
                                  checked={on}
                                  label={`${feature.name} on ${plan.name}`}
                                  disabled={!editable || pending === key}
                                  onChange={async enabled => {
                                    setPending(key);
                                    await setFeature({ code: plan.code, feature: feature.code, enabled })
                                      .unwrap()
                                      .catch(() => undefined);
                                    setPending(null);
                                  }}
                                />
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {limits.map(limit => (
                      <tr key={limit.code} className="border-t border-line">
                        <th scope="row" className="px-4 py-3 text-left font-normal">
                          <span className="block font-semibold text-ink">{limit.name}</span>
                          <span className="block text-xs text-muted">{limit.description}</span>
                          <span className="block text-xs text-muted">{`${scopeLabel[limit.scope]} · default ${limit.default === null ? "unlimited" : limit.default}`}</span>
                        </th>
                        {settings.plans.map(plan => (
                          <td key={plan.code} className="px-2 py-3 text-center">
                            <LimitCell key={`${plan.limits[limit.code]}`} plan={plan} limit={limit} editable={editable} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

/** The plan's name, description, US dollar price (paid plans), whether resellers can choose it, and its place. */
function PlanDetails({ plan, editable }: { plan: SettingsPlan; editable: boolean }) {
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
function PlanAvailability({ plan, editable, onDeleted }: { plan: SettingsPlan; editable: boolean; onDeleted: () => void }) {
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

/** Fixed monthly prices in each market currency; blank means the US dollar price converted on the day. */
function LocalPrices({ plan, editable }: { plan: SettingsPlan; editable: boolean }) {
  const [update, state] = useUpdatePlanMutation();
  const initial = Object.fromEntries(plan.local_prices.map(row => [row.currency, row.fixed === null ? "" : toMajor(row.fixed, row.currency)]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  if (plan.free) return null;
  const problems = plan.local_prices.filter(row => values[row.currency]?.trim() && !toMinor(values[row.currency], row.currency));
  const changes = Object.fromEntries(
    plan.local_prices
      .filter(row => (values[row.currency] ?? "") !== initial[row.currency])
      .map(row => [row.currency, values[row.currency]?.trim() ? toMinor(values[row.currency], row.currency) : null]),
  );
  const count = Object.keys(changes).length;
  return (
    <Card>
      <CardHeader
        title="Prices in local currencies"
        description="Resellers pay in their own currency. Set a fixed monthly price to charge a set amount; leave it blank to charge the US dollar price at the day's rate."
      />
      <div className="px-5 pb-5 sm:px-6">
        {plan.local_prices.length === 0 ? (
          <Notice tone="grey">No markets use a currency other than US dollars yet.</Notice>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {plan.local_prices.map(row => {
              const id = `local-${plan.code}-${row.currency}`;
              const invalid = problems.some(item => item.currency === row.currency);
              return (
                <li key={row.currency} className="grid items-center gap-3 p-4 sm:grid-cols-[1fr_14rem]">
                  <div className="min-w-0">
                    <label htmlFor={id} className="font-semibold text-ink">
                      {row.currency}
                    </label>
                    <p className="truncate text-sm text-muted">{row.markets.join(", ")}</p>
                    <p className="text-xs text-muted">
                      {row.fixed !== null
                        ? `Charged now: ${formatMoney(row.fixed, row.currency)} (fixed)`
                        : row.charged !== null
                          ? `Charged now: ${formatMoney(row.charged, row.currency)} (converted today)`
                          : "No exchange rate today: set a fixed price, or renewals wait for a rate."}
                    </p>
                  </div>
                  <div>
                    <Input
                      id={id}
                      inputMode="decimal"
                      placeholder={row.charged !== null && row.fixed === null ? toMajor(row.charged, row.currency) : "Converted"}
                      value={values[row.currency] ?? ""}
                      disabled={!editable}
                      aria-invalid={invalid}
                      onChange={event => {
                        setSaved(false);
                        setValues(current => ({ ...current, [row.currency]: event.target.value }));
                      }}
                    />
                    {invalid ? <p className="mt-1 text-xs text-red-600">Enter an amount above zero.</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {state.error ? <div className="mt-4"><Notice tone="red">{errorMessage(state.error)}</Notice></div> : null}
        {saved && count === 0 ? <div className="mt-4"><Notice tone="green">Saved. New subscriptions and the next renewals use these prices.</Notice></div> : null}
        {editable && plan.local_prices.length ? (
          <Button
            className="mt-4"
            icon={<Save className="size-4" aria-hidden />}
            loading={state.isLoading}
            disabled={count === 0 || problems.length > 0}
            onClick={async () => {
              await update({ code: plan.code, local_prices: changes as Record<string, number | null> })
                .unwrap()
                .then(() => setSaved(true))
                .catch(() => undefined);
            }}
          >
            {count ? `Save ${count} price${count === 1 ? "" : "s"}` : "Save prices"}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** A new paid plan: name, code, price, description and its features, starting from another plan's if wanted. */
function NewPlanDialog({ settings, open, onClose, onCreated }: { settings: PlanSettings; open: boolean; onClose: () => void; onCreated: (code: string) => void }) {
  const [create, state] = useCreatePlanMutation();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [available, setAvailable] = useState(true);
  const cents = toMinor(price, "USD");
  const finalCode = codeTouched ? code : codeFrom(name);
  const codeOk = /^[a-z][a-z0-9_]{1,29}$/.test(finalCode);
  const ready = name.trim().length > 0 && codeOk && cents !== null && cents > 0;
  const close = () => {
    state.reset();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="New plan"
      description="A paid monthly plan. Choose what it includes; you can change its features and prices any time."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            loading={state.isLoading}
            disabled={!ready}
            onClick={async () => {
              const created = await create({ code: finalCode, name: name.trim(), description: description.trim() || null, price_cents: cents ?? 0, features, available })
                .unwrap()
                .catch(() => null);
              if (created) onCreated(finalCode);
            }}
          >
            Create plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="new-plan-name">
            <Input id="new-plan-name" value={name} maxLength={40} onChange={event => setName(event.target.value)} placeholder="Business" />
          </Field>
          <Field label="Code" htmlFor="new-plan-code" hint="Lower-case letters, numbers and underscores. It cannot change." error={finalCode && !codeOk ? "Start with a letter; 2 to 30 characters." : undefined}>
            <Input
              id="new-plan-code"
              value={finalCode}
              maxLength={30}
              onChange={event => {
                setCodeTouched(true);
                setCode(event.target.value.toLowerCase());
              }}
            />
          </Field>
          <Field label="Price a month (US dollars)" htmlFor="new-plan-price" error={price && (cents === null || cents === 0) ? "Enter a price above zero." : undefined}>
            <Input id="new-plan-price" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} placeholder="49" />
          </Field>
          <div className="flex items-end justify-between gap-3 rounded-xl border border-line p-3">
            <span className="text-sm font-semibold text-ink">Offer to resellers now</span>
            <Toggle checked={available} label="Offer to resellers now" onChange={setAvailable} />
          </div>
        </div>
        <Field label="Description" htmlFor="new-plan-description" hint="Shown to resellers with the plan.">
          <Textarea id="new-plan-description" rows={2} maxLength={300} value={description} onChange={event => setDescription(event.target.value)} />
        </Field>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Features</p>
            <div className="flex flex-wrap gap-2">
              {settings.plans.map(plan => (
                <button key={plan.code} type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => setFeatures(plan.features)}>
                  {`Copy ${plan.name}`}
                </button>
              ))}
            </div>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {settings.features.map(feature => {
              const on = features.includes(feature.code);
              return (
                <li key={feature.code} className="flex items-center justify-between gap-3 p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{feature.name}</span>
                    <span className="block text-xs text-muted">{feature.description}</span>
                  </span>
                  <Toggle checked={on} label={feature.name} onChange={next => setFeatures(current => (next ? [...current, feature.code] : current.filter(item => item !== feature.code)))} />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

/** Settings > Plans: every plan and what it includes, each plan's details and prices, and new plans. */
export default function PlansPage() {
  const admin = useAdmin();
  const editable = can(admin, "finance");
  const settings = usePlanSettingsQuery();
  const [chosen, setChosen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <AdminShell section="settings" current="/settings/plans" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Plans" }]}>
      <PageHeader
        title="Plans"
        description="Startup is free. Other plans are billed monthly from the reseller's live wallet, in their own currency, and include the features you switch on for them."
        actions={
          editable && settings.data ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              New plan
            </Button>
          ) : undefined
        }
      />
      {!editable ? <Notice tone="grey">Only finance admins can change plans.</Notice> : null}
      <QueryView query={settings} message={error => errorMessage(error, "Could not load the plans.")} loading={<Skeleton className="h-96 w-full" />}>
        {data => {
          const plan = data.plans.find(item => item.code === chosen) ?? data.plans.find(item => !item.free) ?? data.plans[0];
          return (
            <div className="space-y-5">
              <FeatureMatrix settings={data} editable={editable} />
              {plan ? (
                <section aria-label="Plan details" className="space-y-5">
                  <Tabs
                    label="Plan"
                    variant="pills"
                    value={plan.code}
                    onChange={setChosen}
                    items={data.plans.map(item => ({ value: item.code, label: item.available ? item.name : `${item.name} (hidden)`, count: item.resellers }))}
                  />
                  {!plan.available ? (
                    <Notice tone="amber" title="Hidden">
                      <span className="inline-flex items-center gap-1.5">
                        <EyeOff className="size-4" aria-hidden /> {`${plan.name} is not offered to resellers. Those on it keep it.`}
                      </span>
                    </Notice>
                  ) : null}
                  {/* Keyed by plan, so each form starts from that plan's saved values. */}
                  <div key={plan.code} className="space-y-5">
                    <PlanDetails plan={plan} editable={editable} />
                    <PlanAvailability plan={plan} editable={editable} onDeleted={() => setChosen(null)} />
                    <LocalPrices plan={plan} editable={editable} />
                  </div>
                </section>
              ) : null}
              <NewPlanDialog
                key={creating ? "open" : "closed"}
                settings={data}
                open={creating}
                onClose={() => setCreating(false)}
                onCreated={code => {
                  setCreating(false);
                  setChosen(code);
                }}
              />
            </div>
          );
        }}
      </QueryView>
    </AdminShell>
  );
}
