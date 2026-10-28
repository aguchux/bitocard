"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, Dialog, errorMessage, Field, formatDateTime, Input, Notice, PageHeader, QueryView, Skeleton, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type TwoStepMethod, type TwoStepPolicy, useClearTwoStepPolicyMutation, useSetTwoStepPolicyMutation, useTwoStepPoliciesQuery } from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

const methods: Array<{ value: TwoStepMethod; label: string; hint: string }> = [
  { value: "authenticator", label: "Authenticator app", hint: "The strongest: a code from an app on the trader's phone." },
  { value: "email", label: "Emailed code", hint: "A code sent to the trader's email address." },
  { value: "sms", label: "Texted code", hint: "A code sent to the trader's confirmed mobile number." },
];
const methodLabel = (method: TwoStepMethod) => methods.find(item => item.value === method)?.label ?? method;
const marketLabel = (market: string) => (market === "WW" ? "All of Afrippa" : market);

/** Choosing the methods allowed for all of Afrippa or one market. At least one stays allowed. */
function PolicyDialog({ policy, onClose }: { policy: TwoStepPolicy | "new"; onClose: () => void }) {
  const existing = policy === "new" ? null : policy;
  const [market, setMarket] = useState(existing?.market ?? "");
  const [chosen, setChosen] = useState<TwoStepMethod[]>(existing?.methods ?? ["authenticator"]);
  const [save, state] = useSetTwoStepPolicyMutation();
  const code = market.trim().toUpperCase();
  const valid = /^[A-Z]{2}$/.test(code) && chosen.length > 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? marketLabel(existing.market) : "Methods for one market"}
      description="Traders already using a method that is no longer allowed prove it once more at their next sign-in, then set up an allowed one."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            loading={state.isLoading}
            onClick={async () => {
              const saved = await save({ market: code, methods: chosen })
                .unwrap()
                .catch(() => null);
              if (saved) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {existing ? null : (
          <Field label="Market" htmlFor="policy-market" hint="A country code (NG, GH…). The trader's country wins over all of Afrippa.">
            <Input id="policy-market" maxLength={2} value={market} onChange={event => setMarket(event.target.value)} />
          </Field>
        )}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">Allowed methods</legend>
          {methods.map(method => (
            <label key={method.value} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={chosen.includes(method.value)}
                onChange={event => setChosen(current => (event.target.checked ? [...current, method.value] : current.filter(item => item !== method.value)))}
              />
              <span>
                <span className="block font-semibold text-ink">{method.label}</span>
                <span className="block text-muted">{method.hint}</span>
              </span>
            </label>
          ))}
          {chosen.length === 0 ? <p className="text-sm text-red-600">Allow at least one method.</p> : null}
        </fieldset>
      </div>
    </Dialog>
  );
}

/**
 * Settings > Two-step methods: which methods Afrippa's traders may sign in with, for all of Afrippa and per market (the
 * trader's country winning). Two-step itself is always required. Operations change them, after step-up; audited.
 */
export default function TwoStepMethodsPage() {
  const admin = useAdmin();
  const query = useTwoStepPoliciesQuery();
  const [clear] = useClearTwoStepPolicyMutation();
  const [editing, setEditing] = useState<TwoStepPolicy | "new" | null>(null);
  const [clearing, setClearing] = useState<TwoStepPolicy | null>(null);
  const edits = can(admin, "operations");

  const columns: Array<Column<TwoStepPolicy>> = [
    { key: "market", header: "Where", cell: policy => <span className="font-semibold text-ink">{marketLabel(policy.market)}</span> },
    {
      key: "methods",
      header: "Allowed",
      cell: policy => (
        <span className="flex flex-wrap gap-2">
          {policy.methods.map(method => (
            <Badge key={method} tone="blue">
              {methodLabel(method)}
            </Badge>
          ))}
        </span>
      ),
    },
    { key: "updated", header: "Changed", hideOnMobile: true, cell: policy => <span className="text-muted">{formatDateTime(policy.updated_at)}</span> },
    {
      key: "actions",
      header: "",
      cell: policy =>
        edits ? (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(policy)}>
              Change
            </Button>
            {policy.market !== "WW" ? (
              <Button size="sm" variant="ghost" onClick={() => setClearing(policy)}>
                Follow all of Afrippa
              </Button>
            ) : null}
          </span>
        ) : null,
    },
  ];

  return (
    <AfrippaShell section="settings" current="/settings/two-step" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Two-step methods" }]}>
      <PageHeader
        title="Two-step methods"
        description="Every trader signs in with two steps. Choose which methods they may use, for all of Afrippa and per market."
        actions={edits ? <Button onClick={() => setEditing("new")}>Set a market</Button> : null}
      />
      <QueryView query={query} loading={<Skeleton className="h-48 w-full" />}>
        {data => (
          <Card>
            <DataTable<TwoStepPolicy> caption="Two-step methods" rows={data.data} rowKey={policy => policy.market} empty="Every method is allowed everywhere." columns={columns} />
          </Card>
        )}
      </QueryView>
      {editing ? <PolicyDialog policy={editing} onClose={() => setEditing(null)} /> : null}
      <ActionDialog
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title="Follow all of Afrippa"
        description={clearing ? `${clearing.market} goes back to the methods allowed for all of Afrippa.` : undefined}
        confirmLabel="Follow all of Afrippa"
        requireReason={false}
        onConfirm={async () => {
          if (clearing) await clear(clearing.market).unwrap();
          setClearing(null);
        }}
      />
    </AfrippaShell>
  );
}
