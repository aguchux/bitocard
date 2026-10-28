"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, formatMoney, formatNumber, humanise, Notice, PageHeader, QueryView, Skeleton, Tabs, errorMessage, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AfrippaBooks, useAfrippaBooksCheckQuery, useAfrippaBooksQuery } from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

type Mode = AfrippaBooks["mode"];
type Line = AfrippaBooks["coins"][number];
type Trial = AfrippaBooks["trial_balance"][number];

/** Coins come as decimal strings in the coin, money as minor units. */
const amount = (value: string | number, currency: string) => (typeof value === "string" ? `${value} ${currency}` : formatMoney(value, currency));

const lineColumns: Array<Column<Line>> = [
  { key: "kind", header: "Account", cell: line => <span className="font-semibold text-ink">{humanise(line.kind)}</span> },
  { key: "currency", header: "In", cell: line => line.currency },
  { key: "accounts", header: "Accounts", cell: line => formatNumber(line.accounts), align: "right", hideOnMobile: true },
  { key: "debits", header: "Debits", cell: line => amount(line.debits, line.currency), align: "right", hideOnMobile: true },
  { key: "credits", header: "Credits", cell: line => amount(line.credits, line.currency), align: "right", hideOnMobile: true },
  { key: "balance", header: "Balance", cell: line => <span className="font-semibold">{amount(line.balance, line.currency)}</span>, align: "right" },
];

const trialColumns: Array<Column<Trial>> = [
  { key: "currency", header: "In", cell: row => <span className="font-semibold text-ink">{row.currency}</span> },
  { key: "holds", header: "Afrippa holds", cell: row => amount(row.holds, row.currency), align: "right" },
  { key: "owes", header: "Afrippa owes", cell: row => amount(row.owes, row.currency), align: "right" },
  { key: "balanced", header: "", cell: row => <Badge tone={row.balanced ? "green" : "red"}>{row.balanced ? "Balanced" : "Out of balance"}</Badge>, align: "right" },
];

/** Finance's integrity check of Afrippa's books: every balance from its postings, every entry balanced. Run on request. */
function BooksCheck() {
  const [run, setRun] = useState(false);
  const query = useAfrippaBooksCheckQuery(undefined, { skip: !run });
  const result = query.data;
  return (
    <Card>
      <CardHeader
        title="Integrity check"
        description="Every account's balance against its postings, and every entry balanced. Afrippa's books only."
        actions={
          <Button size="sm" variant="secondary" loading={query.isFetching} onClick={() => (run ? void query.refetch() : setRun(true))}>
            {run ? "Check again" : "Check the books"}
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {query.error ? <Notice tone="red">{errorMessage(query.error)}</Notice> : null}
        {result ? (
          result.ok ? (
            <Notice tone="green">All {formatNumber(result.accounts_checked)} accounts match their postings, and every entry balances.</Notice>
          ) : (
            <Notice tone="red" title="Problems found">
              {result.account_mismatches.length} accounts do not match their postings and {result.unbalanced_entries.length} entries do not balance. Tell engineering before anything else moves.
            </Notice>
          )
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Home > Books: Afrippa's own books, never BitoCard's. Each kind of account per currency with its balance and the
 * period's debits and credits (coins in the coin, money in minor units), and a trial balance per currency: what Afrippa
 * holds against what it owes. Finance and operations read it; finance runs the integrity check.
 */
export default function BooksPage() {
  const admin = useAdmin();
  const [mode, setMode] = useState<Mode>("live");
  const [range, setRange] = useState(defaultDateRange);
  const allowed = can(admin, "finance", "operations");
  const query = useAfrippaBooksQuery({ mode, ...range }, { skip: !allowed });
  return (
    <AfrippaShell section="home" current="/books" crumbs={[{ label: "Dashboard", href: "/" }, { label: "Books" }]}>
      <PageHeader title="Books" description="Afrippa's own ledger: what it holds for traders, what it owes them and what it has earned." actions={<DateRangePicker value={range} onChange={setRange} />} />
      <Tabs
        label="Mode"
        value={mode}
        onChange={setMode}
        items={[
          { value: "live", label: "Live" },
          { value: "test", label: "Sandbox" },
        ]}
      />
      {!allowed ? (
        <Notice tone="amber">Only finance and operations can read the books.</Notice>
      ) : (
        <div className="space-y-4">
          <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
            {books => (
              <>
                <Card>
                  <CardHeader title="Trial balance" description="Per currency, what Afrippa holds against what it owes. They should always be equal." />
                  <DataTable<Trial> caption="Trial balance" rows={books.trial_balance} rowKey={row => row.currency} empty="Nothing in the books yet." columns={trialColumns} />
                </Card>
                <Card>
                  <CardHeader title="Coins" />
                  <DataTable<Line> caption="Coin accounts" rows={books.coins} rowKey={line => `${line.kind}:${line.currency}`} empty="No coin accounts yet." columns={lineColumns} />
                </Card>
                <Card>
                  <CardHeader title="Money" />
                  <DataTable<Line> caption="Money accounts" rows={books.money} rowKey={line => `${line.kind}:${line.currency}`} empty="No money accounts." columns={lineColumns} />
                </Card>
              </>
            )}
          </QueryView>
          {can(admin, "finance") ? <BooksCheck /> : null}
        </div>
      )}
    </AfrippaShell>
  );
}
