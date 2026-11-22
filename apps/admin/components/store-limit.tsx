"use client";

import { useState } from "react";
import { ActionDialog, Button, Field, Input } from "@bitocard/admin-ui";
import { useSetResellerStoreLimitMutation, type ResellerDetail } from "@bitocard/api-client/admin";

/** A blank or a whole number from 1 to 1000; null when blank (everyone's ceiling), undefined when not valid. */
export function parseStoreLimit(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const count = Number(trimmed);
  return count >= 1 && count <= 1000 ? count : undefined;
}

/** How many stores the reseller may run, and (operations) Change: their own ceiling, or everyone's. */
export function StoreLimit({ reseller, operator }: { reseller: ResellerDetail; operator: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [save] = useSetResellerStoreLimitMutation();
  const allowed = reseller.stores_allowed ?? null;
  const own = reseller.max_stores ?? null;
  const parsed = parseStoreLimit(value);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>
        {reseller.stores.length} of {allowed === null ? "no limit" : allowed} {own === null ? "(everyone’s ceiling)" : "(their own ceiling)"}
      </span>
      {operator ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setValue(own === null ? "" : String(own));
            setOpen(true);
          }}
        >
          Change
        </Button>
      ) : null}
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(false)}
          title="Stores this reseller may run"
          description="Leave it blank to follow the ceiling for everyone (Settings > Integrations > Reseller limits and usage). Lowering it never closes a store they already have."
          confirmLabel="Save"
          onConfirm={async reason => {
            if (parsed === undefined) throw new Error("Enter a whole number from 1 to 1000, or leave it blank.");
            await save({ id: reseller.id, max_stores: parsed, reason }).unwrap();
          }}
        >
          <Field label="Stores" htmlFor="store-limit">
            <Input id="store-limit" inputMode="numeric" value={value} placeholder="Everyone’s ceiling" onChange={event => setValue(event.target.value)} />
          </Field>
        </ActionDialog>
      ) : null}
    </span>
  );
}
