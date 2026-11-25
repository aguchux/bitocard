"use client";

import { useState } from "react";
import { Button, errorMessage, Field, Notice, Select } from "@bitocard/admin-ui";
import { type DvaGateway, useUpdateCountryMutation } from "@bitocard/api-client/admin";

const names = { flutterwave: "Flutterwave", paystack: "Paystack" } satisfies Record<DvaGateway, string>;
const otherGateway = (gateway: DvaGateway) => (gateway === "paystack" ? "flutterwave" : "paystack");

export function DvaPriority({ code, priority, enabled, editable }: { code: string; priority?: DvaGateway[]; enabled: boolean; editable: boolean }) {
  const [draft, setDraft] = useState<DvaGateway | null>(null);
  const [save, state] = useUpdateCountryMutation();
  if (priority === undefined) return <p className="px-4 pb-5 text-sm text-muted sm:px-6">Provider priority is unavailable on this API version.</p>;
  const first = draft ?? priority[0] ?? "flutterwave";
  const second = otherGateway(first);
  const disabled = !editable || state.isLoading;

  return (
    <form className="space-y-3 px-4 pb-5 sm:px-6" onSubmit={event => {
      event.preventDefault();
      void save({ code, dva_gateway_priority: [first, second] }).unwrap().then(() => setDraft(null), () => undefined);
    }}>
      {!enabled ? <Notice tone="amber">Dedicated bank accounts are off in this market. You can save the order for when they are enabled.</Notice> : null}
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Field label="First choice" htmlFor="dva-first">
          <Select id="dva-first" value={first} disabled={disabled} onChange={event => setDraft(event.target.value as DvaGateway)}>
            <option value="flutterwave">{names.flutterwave}</option>
            <option value="paystack">{names.paystack}</option>
          </Select>
        </Field>
        <Field label="Second choice" htmlFor="dva-second">
          <Select id="dva-second" value={second} disabled={disabled} onChange={event => setDraft(otherGateway(event.target.value as DvaGateway))}>
            <option value="flutterwave">{names.flutterwave}</option>
            <option value="paystack">{names.paystack}</option>
          </Select>
        </Field>
      </div>
      {priority.length === 0 ? <p className="text-xs text-muted">This market is using its default routing. Save the priority to apply this order.</p> : null}
      <p className="text-xs text-muted">Applies to new accounts. The second provider is used if the first is unavailable or declines the request.</p>
      {editable ? <Button type="submit" loading={state.isLoading} disabled={priority[0] === first}>Save priority</Button> : null}
    </form>
  );
}
