"use client";

import { Button, Card, CardHeader, DataTable, errorMessage, formatNumber, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { useLedgerCheckQuery } from "@bitocard/api-client/admin";

/** Money > Books check: every account's balance against the sum of its postings, and every entry balanced (finance). */
export default function LedgerCheckPage() {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const check = useLedgerCheckQuery(undefined, { skip: !finance });
  return (
    <UdozoShell section="money" current="/money/ledger" crumbs={[{ label: "Money", href: "/money/payouts" }, { label: "Books check" }]}>
      <PageHeader
        title="Books check"
        description="Checks Udozo's books: every account's balance equals the sum of its postings, and every journal entry balances in each currency."
        actions={
          finance ? (
            <Button variant="secondary" loading={check.isFetching} onClick={() => void check.refetch()}>
              Run again
            </Button>
          ) : undefined
        }
      />
      {!finance ? (
        <Notice tone="grey">Only finance admins can run the books check.</Notice>
      ) : (
        <QueryView query={check} message={error => errorMessage(error, "Could not run the books check.")} loading={<Skeleton className="h-40 w-full" />}>
          {data => (
            <div className="space-y-6">
              {data.ok ? (
                <Notice tone="green" title="The books are consistent">
                  {`${formatNumber(data.accounts_checked)} accounts checked: every balance matches its postings and every entry balances.`}
                </Notice>
              ) : (
                <Notice tone="red" title="The books do not add up">
                  {`${data.account_mismatches.length} accounts and ${data.unbalanced_entries.length} entries need investigating. Nothing is changed automatically.`}
                </Notice>
              )}
              {data.account_mismatches.length ? (
                <Card>
                  <CardHeader title="Accounts whose balance does not match" />
                  <DataTable
                    caption="Accounts whose balance does not match"
                    rows={data.account_mismatches}
                    rowKey={row => row.account_id}
                    columns={[
                      { key: "account", header: "Account", cell: row => <code className="font-mono text-xs">{row.account_id}</code> },
                      { key: "balance", header: "Balance", align: "right", cell: row => row.balance },
                      { key: "postings", header: "From postings", align: "right", cell: row => row.from_postings },
                    ]}
                  />
                </Card>
              ) : null}
              {data.unbalanced_entries.length ? (
                <Card>
                  <CardHeader title="Entries that do not balance" />
                  <DataTable
                    caption="Entries that do not balance"
                    rows={data.unbalanced_entries}
                    rowKey={row => `${row.entry_id}-${row.currency}`}
                    columns={[
                      { key: "entry", header: "Entry", cell: row => <code className="font-mono text-xs">{row.entry_id}</code> },
                      { key: "currency", header: "Currency", cell: row => row.currency },
                      { key: "off", header: "Off by", align: "right", cell: row => row.off_by },
                    ]}
                  />
                </Card>
              ) : null}
            </div>
          )}
        </QueryView>
      )}
    </UdozoShell>
  );
}
