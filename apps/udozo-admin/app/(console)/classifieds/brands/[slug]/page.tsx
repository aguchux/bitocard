"use client";

import { useId, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, Field, formatNumber, Input, Notice, PageHeader, Select, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { readModelLines } from "@/components/model-lines";
import { UdozoShell } from "@/components/shell";
import {
  type AdminClassifiedModel,
  type ClassifiedModelImportResult,
  type ClassifiedModelsFilter,
  useClassifiedModelsQuery,
  useImportClassifiedModelsMutation,
  useUpdateClassifiedModelMutation,
} from "@bitocard/api-client/admin";

const perPage = 50;
const sources = { registry: "Udozo's list", admin: "Added by admin", sellers: "From sellers" } as const;
const words = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);

/**
 * Marketplace > Brand registry > a brand: its models in each category it sells in, in the order sellers see them. Sellers
 * pick from them when they post an ad, and can always type their own. Support reads; operations change.
 */
export default function BrandModelsPage() {
  const { slug } = useParams<{ slug: string }>();
  const admin = useAdmin();
  const changes = can(admin, "operations");
  const [typed, setTyped] = useState("");
  const q = useDebouncedValue(typed.trim());
  const [category, setCategory] = useState("");
  const [source, setSource] = useState<"" | keyof typeof sources>("");
  const [offset, setOffset] = useState(0);
  const filter: ClassifiedModelsFilter = { slug, ...(q ? { q } : {}), ...(category ? { category } : {}), ...(source ? { source } : {}), offset, limit: perPage };
  const models = useClassifiedModelsQuery(filter);
  const brand = models.data?.brand;
  const categories = models.data?.categories ?? [];
  const total = models.data?.total ?? 0;
  const [editing, setEditing] = useState<AdminClassifiedModel | null>(null);
  const reset = () => setOffset(0);

  const columns: Array<Column<AdminClassifiedModel>> = [
    {
      key: "name",
      header: "Model",
      cell: item => (
        <button type="button" className="min-w-0 text-left" onClick={() => setEditing(item)}>
          <span className="block font-semibold text-ink hover:underline">{item.name}</span>
          {item.aliases.length ? <span className="block max-w-72 truncate text-xs text-muted">{item.aliases.join(", ")}</span> : null}
        </button>
      ),
    },
    { key: "category", header: "Category", hideOnMobile: true, cell: item => <span className="text-sm text-muted">{item.category.name}</span> },
    { key: "ads", header: "Live ads", hideOnMobile: true, cell: item => formatNumber(item.listings) },
    {
      key: "source",
      header: "Source",
      cell: item => (
        <span className="flex flex-wrap gap-1">
          {item.source === "sellers" ? <Badge tone="blue">{sources.sellers}</Badge> : item.source === "admin" ? <Badge tone="green">{sources.admin}</Badge> : <Badge tone="grey">{sources.registry}</Badge>}
          {item.enabled ? null : <Badge tone="grey">Off</Badge>}
        </span>
      ),
    },
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/brands" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Brand registry", href: "/classifieds/brands" }, { label: brand?.name ?? "Models" }]}>
      <PageHeader title={brand ? `${brand.name} models` : "Models"} description="What sellers choose from once they have picked this brand, most bought first, each category its own list. Sellers can always type a model that is not here." />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <div className="grid gap-3 border-b border-line px-5 py-3 sm:grid-cols-[minmax(0,1fr)_200px_160px] sm:px-6">
            <label>
              <span className="sr-only">Search models</span>
              <Input
                type="search"
                placeholder="Search names and search words"
                value={typed}
                onChange={event => {
                  setTyped(event.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              <span className="sr-only">Category</span>
              <Select
                value={category}
                onChange={event => {
                  setCategory(event.target.value);
                  reset();
                }}
              >
                <option value="">Every category</option>
                {categories.map(item => (
                  <option key={item.id} value={item.slug}>
                    {item.name} ({formatNumber(item.models)})
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span className="sr-only">Source</span>
              <Select
                value={source}
                onChange={event => {
                  setSource(event.target.value as typeof source);
                  reset();
                }}
              >
                <option value="">Any source</option>
                {Object.entries(sources).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <DataTable columns={columns} rows={models.data?.data} rowKey={item => item.id} loading={models.isLoading} error={models.error ? errorMessage(models.error) : null} onRetry={models.refetch} empty="No models match." />
          {total > perPage ? (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted sm:px-6">
              <span>
                {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + perPage, total))} of {formatNumber(total)}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - perPage))}>
                  Previous
                </Button>
                <Button size="sm" variant="secondary" disabled={offset + perPage >= total} onClick={() => setOffset(offset + perPage)}>
                  Next
                </Button>
              </span>
            </div>
          ) : null}
        </Card>
        <div className="space-y-6">
          {editing ? <ModelEditor key={editing.id} model={editing} changes={changes} onDone={setEditing} /> : <Card><CardHeader title="Choose a model" description="Open one from the list to change it or turn it off." /></Card>}
          {changes ? <ImportModels slug={slug} categories={categories} /> : null}
        </div>
      </div>
    </UdozoShell>
  );
}

function ModelEditor({ model, changes, onDone }: { model: AdminClassifiedModel; changes: boolean; onDone: (model: AdminClassifiedModel | null) => void }) {
  const id = useId();
  const [name, setName] = useState(model.name);
  const [aliases, setAliases] = useState(model.aliases.join(", "));
  const [update, updating] = useUpdateClassifiedModelMutation();
  const [saved, setSaved] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    const result = await update({ id: model.id, name: name.trim(), aliases: words(aliases) }).unwrap();
    onDone(result);
    setSaved(result.listings_renamed ? `Saved. ${formatNumber(result.listings_renamed)} ${result.listings_renamed === 1 ? "ad now reads" : "ads now read"} “${result.name}”.` : "Saved.");
  };
  const toggle = async () => onDone(await update({ id: model.id, enabled: !model.enabled }).unwrap());
  return (
    <Card>
      <CardHeader title={model.name} description={`${model.category.name}. ${formatNumber(model.listings)} live ads.`} />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5 sm:px-6">
        <fieldset disabled={!changes} className="space-y-4">
          <Field label="Name" htmlFor={`${id}-name`} hint="A new name keeps the old one as a search word, and ads follow it.">
            <Input id={`${id}-name`} maxLength={60} value={name} onChange={event => setName(event.target.value)} />
          </Field>
          <Field label="Search words" htmlFor={`${id}-aliases`} hint="Separated by commas: what sellers type instead.">
            <Input id={`${id}-aliases`} value={aliases} onChange={event => setAliases(event.target.value)} placeholder="s23 ultra, s23u" />
          </Field>
        </fieldset>
        {!model.enabled ? <Notice tone="amber">Off: sellers are not offered it, and typing it never brings it back.</Notice> : null}
        {updating.error ? <Notice tone="red">{errorMessage(updating.error)}</Notice> : null}
        {saved ? <Notice tone="green">{saved}</Notice> : null}
        {changes ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" loading={updating.isLoading && updating.originalArgs?.enabled !== undefined} onClick={() => void toggle()}>
              {model.enabled ? "Turn off" : "Turn on"}
            </Button>
            <Button type="submit" loading={updating.isLoading && updating.originalArgs?.enabled === undefined} disabled={!name.trim()}>
              Save
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function ImportModels({ slug, categories }: { slug: string; categories: Array<{ id: string; name: string }> }) {
  const id = useId();
  const [category, setCategory] = useState("");
  const [lines, setLines] = useState("");
  const [add, adding] = useImportClassifiedModelsMutation();
  const [result, setResult] = useState<ClassifiedModelImportResult | null>(null);
  const chosen = category || categories[0]?.id || "";
  const models = readModelLines(lines);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    const answer = await add({ slug, category_id: chosen, models }).unwrap();
    setResult(answer);
    setLines(answer.skipped.map(item => item.name).join("\n"));
  };
  return (
    <Card>
      <CardHeader title="Add models" description="One a line, up to 500 at a time. Each goes last in the list." />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5 sm:px-6">
        <Field label="Category" htmlFor={`${id}-category`}>
          <Select id={`${id}-category`} value={chosen} onChange={event => setCategory(event.target.value)}>
            {categories.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Models" htmlFor={`${id}-lines`} hint="A line may add search words after a bar: Galaxy S24 | s24, s24 5g">
          <textarea id={`${id}-lines`} rows={6} value={lines} onChange={event => setLines(event.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" />
        </Field>
        {adding.error ? <Notice tone="red">{errorMessage(adding.error)}</Notice> : null}
        {result ? (
          <Notice tone={result.skipped.length ? "amber" : "green"}>
            Added {formatNumber(result.added)}.{result.listings_renamed ? ` ${formatNumber(result.listings_renamed)} ads now read as them.` : ""}
            {result.skipped.length ? ` ${formatNumber(result.skipped.length)} skipped and left above: ${result.skipped[0]?.reason}` : ""}
          </Notice>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" loading={adding.isLoading} disabled={!models.length || models.length > 500 || !chosen}>
            Add {models.length ? formatNumber(models.length) : ""} {models.length === 1 ? "model" : "models"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
