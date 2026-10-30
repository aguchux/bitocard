"use client";

import { useState } from "react";
import { ActionDialog, Button, Card, CardHeader, errorMessage, Field, formatMoney, KeyValue, Notice, Select, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { useResellerCreditQuery, useSetResellerCreditLimitMutation } from "@bitocard/api-client/admin";

const blockedText = {
  maximum: "Already at the highest step.",
  owing: "They owe money: they can raise it once it is paid.",
  no_paid_month: "They can raise it themselves after a full month's invoice is paid in full.",
} as const;

/**
 * The reseller's credit limit: how much billable usage (AI replies past the allowance, mobile money deposit fees,
 * domains) can be owed before it stops. Finance set any value up to US$100 (step-up, audited, with a reason).
 */
export function CreditLimitCard({ resellerId }: { resellerId: string }) {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const credit = useResellerCreditQuery(resellerId);
  const [setLimit] = useSetResellerCreditLimitMutation();
  const [editing, setEditing] = useState(false);
  const [cents, setCents] = useState<number | null>(null);
  const data = credit.data;
  const choices = data ? Array.from(new Set([0, ...data.steps, data.limit_usd_cents])).sort((a, b) => a - b) : [];
  const chosen = cents ?? data?.limit_usd_cents ?? 0;

  return (
    <Card>
      <CardHeader title="Credit limit" description="What billable usage can be owed before it stops. Top-ups pay what is owed first." />
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        {credit.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !data ? (
          <Notice tone="red">{errorMessage(credit.error, "Could not load the credit limit.")}</Notice>
        ) : (
          <>
            <KeyValue
              items={[
                { label: "Limit", value: formatMoney(data.limit_usd_cents, "USD") },
                { label: "Owed", value: data.owed.length ? data.owed.map(item => `${formatMoney(item.amount, item.currency)} of ${formatMoney(item.limit, item.currency)}`).join(" · ") : "Nothing" },
                { label: "Raising it themselves", value: data.can_raise ? `Can raise to ${formatMoney(data.next_limit_usd_cents ?? 0, "USD")}` : data.raise_blocked_by ? blockedText[data.raise_blocked_by] : "—" },
              ]}
            />
            {finance ? (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Change limit
              </Button>
            ) : null}
          </>
        )}
      </div>
      <ActionDialog
        open={editing}
        onClose={() => {
          setEditing(false);
          setCents(null);
        }}
        title="Change the credit limit?"
        description="Up to US$100. Lowering it below what they owe stops billable usage until they pay. Your reason is kept in the audit log."
        confirmLabel="Save limit"
        onConfirm={reason => setLimit({ id: resellerId, cents: chosen, reason }).unwrap()}
      >
        <Field label="New limit" htmlFor="credit-limit">
          <Select id="credit-limit" value={String(chosen)} onChange={event => setCents(Number(event.target.value))}>
            {choices.map(value => (
              <option key={value} value={value}>
                {formatMoney(value, "USD")}
              </option>
            ))}
          </Select>
        </Field>
      </ActionDialog>
    </Card>
  );
}
