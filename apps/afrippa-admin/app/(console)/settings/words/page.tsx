"use client";

import { useState } from "react";
import { Button, Card, DataTable, errorMessage, Field, Input, Notice, PageHeader, QueryView, Skeleton, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type RefusedWord, useAddRefusedWordMutation, useRefusedWordsQuery, useRemoveRefusedWordMutation } from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

/** Adding a phrase, everywhere or in one market. */
function AddWord() {
  const [phrase, setPhrase] = useState("");
  const [market, setMarket] = useState("");
  const [add, state] = useAddRefusedWordMutation();
  const code = market.trim().toUpperCase();
  const valid = phrase.trim().length >= 2 && phrase.trim().length <= 60 && (code === "" || /^[A-Z]{2}$/.test(code));
  return (
    <form
      className="grid gap-4 p-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={async event => {
        event.preventDefault();
        if (!valid) return;
        const saved = await add({ phrase: phrase.trim(), market: code || null })
          .unwrap()
          .catch(() => null);
        if (saved) {
          setPhrase("");
          setMarket("");
        }
      }}
    >
      {state.error ? (
        <div className="sm:col-span-3">
          <Notice tone="red">{errorMessage(state.error)}</Notice>
        </div>
      ) : null}
      <Field label="Phrase" htmlFor="word-phrase" hint="2 to 60 characters.">
        <Input id="word-phrase" maxLength={60} value={phrase} onChange={event => setPhrase(event.target.value)} />
      </Field>
      <Field label="Market" htmlFor="word-market" hint="Empty for every market.">
        <Input id="word-market" maxLength={2} value={market} onChange={event => setMarket(event.target.value)} />
      </Field>
      <Button type="submit" disabled={!valid} loading={state.isLoading}>
        Refuse it
      </Button>
    </form>
  );
}

/**
 * Settings > Refused words: phrases Afrippa refuses in traders' ad terms, nicknames and feedback, everywhere or in one
 * market (contact details that move a trade off Afrippa are always refused). Operations keep the list; audited.
 */
export default function RefusedWordsPage() {
  const admin = useAdmin();
  const query = useRefusedWordsQuery();
  const [remove, removeState] = useRemoveRefusedWordMutation();
  const edits = can(admin, "operations");

  const columns: Array<Column<RefusedWord>> = [
    { key: "phrase", header: "Phrase", cell: word => <span className="font-semibold text-ink">{word.phrase}</span> },
    { key: "market", header: "Where", cell: word => word.market ?? "Every market" },
    {
      key: "actions",
      header: "",
      cell: word =>
        edits ? (
          <Button size="sm" variant="ghost" onClick={() => void remove(word.id)}>
            Remove
          </Button>
        ) : null,
    },
  ];

  return (
    <AfrippaShell section="settings" current="/settings/words" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Refused words" }]}>
      <PageHeader
        title="Refused words"
        description="Phrases refused in traders' ad terms, nicknames and feedback. Links, emails, handles and phone numbers are always refused; the order room is never checked."
      />
      {edits ? (
        <Card className="mb-4">
          <AddWord />
        </Card>
      ) : null}
      {removeState.error ? <Notice tone="red">{errorMessage(removeState.error)}</Notice> : null}
      <QueryView query={query} loading={<Skeleton className="h-48 w-full" />}>
        {data => (
          <Card>
            <DataTable<RefusedWord> caption="Refused words" rows={data.data} rowKey={word => word.id} empty="No phrases yet." columns={columns} />
          </Card>
        )}
      </QueryView>
    </AfrippaShell>
  );
}
