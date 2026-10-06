"use client";

import { useState } from "react";
import { CheckCircle2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { ActionDialog, Button, Card, CardHeader, type Column, DataTable, errorMessage, Field, formatMoney, Input, Notice, PageHeader, RefreshFailed, Select, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type FeeKind,
  type FeeReportGroup,
  type FeeRule,
  percentToPpb,
  useCountriesQuery,
  useDeleteFeeRuleMutation,
  useFeeReconciliationQuery,
  useFeeReportQuery,
  useFeeRulesQuery,
  usePlansQuery,
  useSetFeeRuleMutation,
} from "@bitocard/api-client/admin";

const kindLabels: Record<FeeKind, string> = { supplier_order: "Own-supplier orders", gateway_payment: "Own-gateway payments" };
const categories = ["gift_cards", "airtime", "data", "bills", "pay_tv", "esim", "software", "virtual_numbers", "virtual_cards", "mobile_money"];
const humanise = (value: string) => value.replace(/_/g, " ").replace(/^./, char => char.toUpperCase());

function RuleDialog({ rule, onClose }: { rule: FeeRule | null; onClose: () => void }) {
  const countries = useCountriesQuery();
  const plans = usePlansQuery();
  const [save] = useSetFeeRuleMutation();
  const [kind, setKind] = useState<FeeKind>(rule?.kind ?? "supplier_order");
  const [country, setCountry] = useState(rule?.country_code ?? "");
  const [category, setCategory] = useState(rule?.category ?? "");
  const [plan, setPlan] = useState(rule?.plan_code ?? "");
  const [rate, setRate] = useState(rule ? rule.rate_percent : "");
  const [minFee, setMinFee] = useState(rule?.min_fee_minor ? String(rule.min_fee_minor) : "");
  const ppb = percentToPpb(rate);
  const editing = Boolean(rule);

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={editing ? "Change fee rate" : "Add a fee rate"}
      description="The most specific rate for a transaction applies: country, then category, then plan. Rates run from 0.0000001% to 10%; fees are exact, with fractions carried to the reseller's next transaction."
      confirmLabel="Save rate"
      requireReason={false}
      onConfirm={async () => {
        if (ppb === null) throw new Error("Enter a rate from 0 to 10%, with at most 7 decimal places.");
        await save({
          kind,
          country_code: country || null,
          category: kind === "supplier_order" ? category || null : null,
          plan_code: plan || null,
          rate_ppb: ppb,
          min_fee_minor: minFee ? Number(minFee) : null,
        }).unwrap();
      }}
    >
      <Field label="Fee on" htmlFor="rule-kind">
        <Select id="rule-kind" value={kind} disabled={editing} onChange={event => setKind(event.target.value as FeeKind)}>
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor="rule-country">
          <Select id="rule-country" value={country} disabled={editing} onChange={event => setCountry(event.target.value)}>
            <option value="">Any country</option>
            {countries.data?.data.map(item => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plan" htmlFor="rule-plan">
          <Select id="rule-plan" value={plan} disabled={editing} onChange={event => setPlan(event.target.value)}>
            <option value="">Any plan</option>
            {plans.data?.data.map(item => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {kind === "supplier_order" ? (
        <Field label="Category" htmlFor="rule-category">
          <Select id="rule-category" value={category} disabled={editing} onChange={event => setCategory(event.target.value)}>
            <option value="">Any category</option>
            {categories.map(item => (
              <option key={item} value={item}>
                {humanise(item)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rate (%)" htmlFor="rule-rate" hint={ppb === null ? "0 to 10, up to 7 decimals (0.0000001)" : `${ppb.toLocaleString("en-GB")} parts per billion`}>
          <Input id="rule-rate" inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} placeholder="0.01" aria-invalid={rate !== "" && ppb === null ? true : undefined} />
        </Field>
        <Field label="Minimum fee (minor units)" htmlFor="rule-min" hint={country ? "Optional, in the country's currency." : "Needs a country."}>
          <Input id="rule-min" inputMode="numeric" value={minFee} disabled={!country} onChange={event => setMinFee(event.target.value.replace(/\D/g, ""))} placeholder="None" />
        </Field>
      </div>
    </ActionDialog>
  );
}

function Report() {
  const [group, setGroup] = useState<FeeReportGroup>("reseller");
  const [range] = useState(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to: to.toISOString() };
  });
  const report = useFeeReportQuery({ ...range, group_by: group });
  const reconciliation = useFeeReconciliationQuery();
  const columns: Array<Column<NonNullable<typeof report.data>["data"][number]>> = [
    { key: "label", header: humanise(group), cell: row => humanise(row.label) },
    { key: "count", header: "Transactions", align: "right", cell: row => row.transactions.toLocaleString("en-GB") },
    { key: "charged", header: "Charged", align: "right", hideOnMobile: true, cell: row => formatMoney(row.charged, row.currency) },
    { key: "refunded", header: "Refunded", align: "right", hideOnMobile: true, cell: row => formatMoney(row.refunded, row.currency) },
    { key: "net", header: "Net", align: "right", cell: row => formatMoney(row.net, row.currency) },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader
          title="Fee revenue, last 30 days"
          description="Live fees, per currency."
          actions={
            <Select aria-label="Group by" value={group} onChange={event => setGroup(event.target.value as FeeReportGroup)} className="w-40">
              {(["reseller", "kind", "category", "country", "plan"] as const).map(value => (
                <option key={value} value={value}>
                  {`By ${value}`}
                </option>
              ))}
            </Select>
          }
        />
        <DataTable
          columns={columns}
          rows={report.data?.data}
          rowKey={row => `${row.key}-${row.currency}`}
          loading={report.isLoading}
          error={report.error ? errorMessage(report.error) : null}
          onRetry={report.refetch}
          empty="No fees in the last 30 days."
          caption="Fee revenue"
        />
      </Card>
      <Card>
        <CardHeader title="Reconciliation" description="Exact fees = charged + carried; the fee account = charged − refunded." />
        <div className="px-5 pb-5 sm:px-6">
          {reconciliation.data && reconciliation.error && !reconciliation.isFetching ? (
            <RefreshFailed message={errorMessage(reconciliation.error)} onRetry={reconciliation.refetch} />
          ) : null}
          {reconciliation.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : !reconciliation.data && reconciliation.error ? (
            <Notice tone="red">{errorMessage(reconciliation.error)}</Notice>
          ) : reconciliation.data?.ok ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="size-5" aria-hidden />
              {`All ${reconciliation.data.checked} fee balances add up.`}
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-semibold text-red-700">
                <XCircle className="size-5" aria-hidden />
                Fees do not add up
              </p>
              <pre className="overflow-x-auto rounded-lg bg-canvas p-3 text-xs">{JSON.stringify(reconciliation.data, null, 2)}</pre>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Platform fees on resellers' own integrations: rates (finance), revenue and reconciliation. */
export default function FeesPage() {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const rules = useFeeRulesQuery();
  const [remove] = useDeleteFeeRuleMutation();
  const [editing, setEditing] = useState<FeeRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<FeeRule | null>(null);

  const columns: Array<Column<FeeRule>> = [
    { key: "kind", header: "Fee on", cell: row => kindLabels[row.kind] },
    {
      key: "scope",
      header: "Applies to",
      cell: row => [row.country_code ?? "Any country", row.category ? humanise(row.category) : "any category", row.plan_code ? `${row.plan_code} plan` : "any plan"].join(" · "),
    },
    { key: "rate", header: "Rate", align: "right", cell: row => `${row.rate_percent}%` },
    { key: "min", header: "Minimum", align: "right", hideOnMobile: true, cell: row => (row.min_fee_minor && row.country_code ? `${row.min_fee_minor} minor` : "None") },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: row =>
        finance ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" icon={<Pencil className="size-4" aria-hidden />} aria-label="Change rate" onClick={() => setEditing(row)} />
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} aria-label="Delete rate" onClick={() => setDeleting(row)} />
          </div>
        ) : null,
    },
  ];

  return (
    <AdminShell section="settings" current="/settings/fees" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Platform fees" }]}>
      <PageHeader
        title="Platform fees"
        description="BitoCard's fees on resellers' own-integration transactions, held from their wallet before each transaction and charged exactly after it, with fractions carried."
        actions={
          finance ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing("new")}>
              Add rate
            </Button>
          ) : null
        }
      />
      <Card>
        <CardHeader title="Rates" description="No matching rate means no fee." />
        <DataTable
          columns={columns}
          rows={rules.data?.data}
          rowKey={row => row.id}
          loading={rules.isLoading}
          error={rules.error ? errorMessage(rules.error) : null}
          onRetry={rules.refetch}
          empty="No fee rates yet: own-integration transactions are free."
          caption="Fee rates"
        />
      </Card>
      <Report />
      {editing ? <RuleDialog key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <ActionDialog
          open
          onClose={() => setDeleting(null)}
          title="Delete this rate?"
          description="Transactions it covered fall back to the next most specific rate, or no fee."
          confirmLabel="Delete"
          tone="danger"
          requireReason={false}
          onConfirm={() => remove(deleting.id).unwrap()}
        />
      ) : null}
    </AdminShell>
  );
}
