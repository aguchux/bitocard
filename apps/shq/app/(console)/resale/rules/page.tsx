"use client";

import { useId, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button, Card, CardHeader, DataTable, Field, Input, Notice, PageHeader, Select, Skeleton, Toggle, errorMessage, formatBps, formatRelative } from "@bitocard/admin-ui";
import {
  type ResaleRule,
  useCreateResaleRuleMutation,
  useDeleteResaleRuleMutation,
  useResaleAccountQuery,
  useResaleCategoriesQuery,
  useResaleRulesQuery,
  useUpdateResaleRuleMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { ResaleGate, signedPercentToBps } from "@/components/resale";

/**
 * Resale > Rules: every resale listing of a category (or every category) added to a store at a markup, now and as new
 * ones open, held to each listing's markup limit. Listings removed by hand stay out.
 */
export default function ResaleRulesPage() {
  const id = useId();
  const { membership } = useReseller();
  const canEdit = can(membership, "admin");
  const account = useResaleAccountQuery();
  const stores = account.data?.stores ?? [];
  const country = account.data?.country ?? "";
  const categories = useResaleCategoriesQuery(country, { skip: !country || !account.data?.available });
  const rules = useResaleRulesQuery(undefined, { skip: !account.data?.available });
  const [create, creating] = useCreateResaleRuleMutation();
  const [update] = useUpdateResaleRuleMutation();
  const [remove] = useDeleteResaleRuleMutation();
  const [picked, setStoreId] = useState("");
  // The first store until another is chosen.
  const storeId = picked || stores[0]?.id || "";
  const [category, setCategory] = useState("");
  const [markup, setMarkup] = useState("15");
  const markupBps = signedPercentToBps(markup);
  const valid = Boolean(storeId) && markupBps !== null && markupBps >= 0 && markupBps <= 20000;
  const storeName = (storeId: string) => stores.find(store => store.id === storeId)?.name ?? "A store";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    await create({ store_id: storeId, category: category || null, markup_bps: markupBps! });
  };

  return (
    <ShqShell section="resale" current="/resale/rules" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Rules" }]}>
      <PageHeader title="Auto-listing rules" description="Add every resale listing of a category to a store at your markup, now and as suppliers open new ones. Each is held to its supplier’s markup limit; listings you remove stay out." />
      {account.isLoading ? <Skeleton className="h-24" /> : <ResaleGate account={account.data} />}
      {account.data?.available && stores.length ? (
        <>
          {canEdit ? (
            <Card>
              <CardHeader title="New rule" />
              <form className="grid gap-4 p-5 sm:grid-cols-4 sm:items-end" onSubmit={submit}>
                <Field label="Store" htmlFor={`${id}-store`}>
                  <Select id={`${id}-store`} value={storeId} onChange={event => setStoreId(event.target.value)}>
                    {stores.map(store => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Category" htmlFor={`${id}-category`}>
                  <Select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)}>
                    <option value="">Every category</option>
                    {(categories.data?.data ?? []).map(top => (
                      <optgroup key={top.slug} label={top.name}>
                        <option value={top.slug}>All {top.name}</option>
                        {top.children.map(child => (
                          <option key={child.slug} value={child.slug}>{child.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
                <Field label="Markup (%)" htmlFor={`${id}-markup`} hint="Held to each listing’s limit.">
                  <Input id={`${id}-markup`} inputMode="decimal" value={markup} onChange={event => setMarkup(event.target.value)} />
                </Field>
                <Button type="submit" loading={creating.isLoading} disabled={!valid}>Add rule</Button>
              </form>
              {creating.error ? <div className="px-5 pb-5"><Notice tone="red">{errorMessage(creating.error)}</Notice></div> : null}
            </Card>
          ) : null}
          <Card>
            <DataTable<ResaleRule>
              caption="Rules"
              rows={rules.isLoading ? undefined : rules.data?.data}
              loading={rules.isLoading}
              error={rules.error ? errorMessage(rules.error) : null}
              onRetry={rules.refetch}
              rowKey={row => row.id}
              empty="No rules yet."
              columns={[
                { key: "what", header: "Adds", cell: row => <span className="font-semibold text-ink">{row.category?.name ?? "Every category"}</span> },
                { key: "store", header: "To", cell: row => storeName(row.store_id) },
                { key: "markup", header: "Markup", cell: row => formatBps(row.markup_bps) },
                { key: "added", header: "Added", cell: row => String(row.listings_added), hideOnMobile: true },
                { key: "run", header: "Last run", cell: row => <span className="text-muted">{row.last_run_at ? formatRelative(row.last_run_at) : "—"}</span>, hideOnMobile: true },
                {
                  key: "active",
                  header: "On",
                  cell: row => <Toggle checked={row.active} label={`Rule for ${row.category?.name ?? "every category"} on`} disabled={!canEdit} onChange={active => void update({ id: row.id, active })} />,
                },
                {
                  key: "delete",
                  header: "",
                  cell: row =>
                    canEdit ? (
                      <Button variant="ghost" size="sm" aria-label="Delete rule" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => void remove(row.id)}>
                        <span className="sr-only">Delete</span>
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        </>
      ) : null}
    </ShqShell>
  );
}
