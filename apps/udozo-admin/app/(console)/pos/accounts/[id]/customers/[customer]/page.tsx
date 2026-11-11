"use client";

import { useParams } from "next/navigation";
import { Badge, Card, CardHeader, formatDate, KeyValue, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { type AdminPosCustomerDetail, usePosAccountQuery, usePosCustomerQuery } from "@bitocard/api-client/admin";
import { money } from "@/components/connect";
import { udozoRatingWords } from "@/components/pos-customers";
import { UdozoShell } from "@/components/shell";

const entryWords: Record<AdminPosCustomerDetail["entries"][number]["kind"], string> = { credit_sale: "Bought on credit", repayment: "Paid back", refund: "Refunded" };

function CustomerView({ customer, currency }: { customer: AdminPosCustomerDetail; currency: string }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="Details" actions={customer.udozo ? <Badge tone="blue">Linked to Udozo</Badge> : <Badge tone="grey">Shop only</Badge>} />
        <KeyValue
          items={[
            { label: "Number", value: customer.number },
            { label: "Mobile", value: customer.phone ?? "—" },
            { label: "Email", value: customer.email ?? "—" },
            { label: "Address", value: customer.address ?? "—" },
            { label: "Added", value: `${formatDate(customer.created_at)}${customer.source === "udozo" ? ", by paying through Udozo" : ""}` },
            { label: "Sales", value: `${customer.sales_count}, ${money(customer.spent, currency)} spent` },
            { label: "Owes the shop", value: money(customer.owed, currency) },
            { label: "Credit limit", value: customer.credit_limit === null ? "None set" : money(customer.credit_limit, currency) },
          ]}
        />
        {customer.notes ? <p className="mt-3 text-sm whitespace-pre-line text-ink">{customer.notes}</p> : null}
      </Card>
      {customer.udozo_rating ? (
        <Card>
          <CardHeader title="On Udozo" />
          <p className="text-sm text-ink">{udozoRatingWords(customer.udozo_rating)}</p>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="What they owe, line by line" />
        {customer.entries.length ? (
          <ul className="grid gap-1 text-sm">
            {customer.entries.map(entry => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
                <span>
                  {entryWords[entry.kind]} {money(Math.abs(entry.amount), currency)}
                  {entry.sale?.number ? ` (${entry.sale.number})` : ""}
                  {entry.method ? ` · ${entry.method}` : ""}
                  {entry.reference ? ` · ${entry.reference}` : ""}
                </span>
                <span className="text-muted">
                  owes {money(entry.owed_after, currency)} · {formatDate(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing bought on credit.</p>
        )}
      </Card>
      <Card>
        <CardHeader title="Sales" description="The latest 20." />
        {customer.sales.length ? (
          <ul className="grid gap-1 text-sm">
            {customer.sales.map(sale => (
              <li key={sale.id} className="flex justify-between gap-3 border-b border-line py-1">
                <span>
                  {sale.number}
                  {sale.status === "refunded" ? " · Refunded" : ""}
                </span>
                <span className="text-muted">
                  {money(sale.total, sale.currency)} · {formatDate(sale.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No sales yet.</p>
        )}
      </Card>
    </div>
  );
}

/** One customer of a POS shop, read by Udozo's team under the shop's account. */
export default function PosCustomerPage() {
  const { id, customer } = useParams<{ id: string; customer: string }>();
  const account = usePosAccountQuery(id);
  const query = usePosCustomerQuery({ account: id, id: customer });
  const shop = account.data?.shops[0]?.name ?? "Account";
  return (
    <UdozoShell section="pos" current="/pos/accounts" crumbs={[{ label: "POS", href: "/pos/accounts" }, { label: shop, href: `/pos/accounts/${id}` }, { label: query.data?.name ?? "Customer" }]}>
      <PageHeader title={query.data?.name ?? "Customer"} description={`A customer of ${shop}`} />
      <div className="mt-6">
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {data => <CustomerView customer={data} currency={account.data?.currency ?? "NGN"} />}
        </QueryView>
      </div>
    </UdozoShell>
  );
}
