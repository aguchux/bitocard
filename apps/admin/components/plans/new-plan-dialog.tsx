"use client";

import { useState } from "react";
import { Button, Dialog, errorMessage, Field, Input, Notice, Textarea, Toggle } from "@bitocard/admin-ui";
import { type PlanSettings, useCreatePlanMutation } from "@bitocard/api-client/admin";
import { toMinor, codeFrom } from "@/components/plans/amounts";

/** A new paid plan: name, code, price, description and its features, starting from another plan's if wanted. */
export function NewPlanDialog({ settings, open, onClose, onCreated }: { settings: PlanSettings; open: boolean; onClose: () => void; onCreated: (code: string) => void }) {
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
