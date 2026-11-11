"use client";

import { useParams } from "next/navigation";
import { Badge, Card, CardHeader, formatDate, KeyValue, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type AdminPosAccountDetail, posAccountStatusLabels, usePosAccountQuery } from "@bitocard/api-client/admin";
import { money } from "@/components/connect";
import { accountState, limitsLine, posStatusTones, vatWords } from "@/components/pos";
import { PosCustomersCard } from "@/components/pos-customers";
import { UdozoShell } from "@/components/shell";

const chargeKinds = { signup: "First month", renewal: "Renewal", upgrade: "Plan change" } as const;

function AccountView({ account }: { account: AdminPosAccountDetail }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="Plan" actions={<Badge tone={posStatusTones[account.status]}>{posAccountStatusLabels[account.status]}</Badge>} />
        <p className="text-sm text-ink">{accountState(account)}</p>
        <KeyValue
          className="mt-4"
          items={[
            { label: "Plan", value: account.plan.name },
            { label: "Limits", value: limitsLine(account.limits) },
            { label: "Market", value: `${account.country} · ${account.currency}` },
            { label: "Mode", value: account.mode === "live" ? "Live" : "Sandbox" },
            { label: "Current month", value: account.period_start && account.period_end ? `${formatDate(account.period_start)} to ${formatDate(account.period_end)}` : "None (Free)" },
            { label: "Signed up", value: formatDate(account.created_at) },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Owner" />
        <KeyValue
          items={[
            { label: "Name", value: <AppLink href={`/customers/${account.owner.id}`}>{account.owner.name}</AppLink> },
            { label: "Email", value: account.owner.email },
          ]}
        />
      </Card>
      {account.shops.map(shop => (
        <Card key={shop.id}>
          <CardHeader title={shop.name} description={`Shop code ${shop.shop_code}`} />
          <KeyValue
            items={[
              { label: "Address", value: shop.address ?? "—" },
              { label: "Phone", value: shop.phone ?? "—" },
              { label: "Tax ID", value: shop.tin ?? "—" },
              { label: "VAT", value: vatWords(shop.vat_bps) },
            ]}
          />
          <h3 className="mt-4 text-sm font-semibold text-ink">Tills ({shop.tills.length})</h3>
          <ul className="mt-2 grid gap-1 text-sm">
            {shop.tills.map(till => (
              <li key={till.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="font-medium text-ink">{till.name}</span>
                <span className="text-muted">
                  {till.printer_width} mm receipts{till.auto_print ? " · prints each sale" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <PosCustomersCard account={account.id} currency={account.currency} />
      <Card>
        <CardHeader title="Charges" description="Taken from the owner's Udozo wallet into POS revenue." />
        {account.charges.length ? (
          <ul className="grid gap-2 text-sm">
            {account.charges.map(charge => (
              <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">
                    {charge.number} · {charge.plan.name} · {chargeKinds[charge.kind]}
                  </span>
                  <span className="block text-xs text-muted">
                    {formatDate(charge.period_start)} to {formatDate(charge.period_end)}
                    {charge.credit > 0 ? `, less ${money(charge.credit, charge.currency)} unused` : ""}
                  </span>
                </span>
                <span className="font-semibold text-ink">{money(charge.amount, charge.currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing charged yet.</p>
        )}
      </Card>
    </div>
  );
}

/** One owner's Udozo POS account: where the plan stands, the owner, each shop with its tills, and the charges. */
export default function PosAccountPage() {
  const { id } = useParams<{ id: string }>();
  const query = usePosAccountQuery(id);
  const title = query.data?.shops[0]?.name ?? "Account";
  return (
    <UdozoShell section="pos" current="/pos/accounts" crumbs={[{ label: "POS", href: "/pos/accounts" }, { label: "Accounts", href: "/pos/accounts" }, { label: title }]}>
      <PageHeader title={title} description={query.data ? `${query.data.owner.name}'s Udozo POS account` : undefined} />
      <div className="mt-6">
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {account => <AccountView account={account} />}
        </QueryView>
      </div>
    </UdozoShell>
  );
}
