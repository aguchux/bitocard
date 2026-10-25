"use client";

import { useId, useState, type FormEvent } from "react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, Field, formatNumber, formatRelative, Input, Notice, PageHeader, QueryView, Select, Skeleton, Textarea, Toggle, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminClassifiedFeature,
  type ClassifiedFeatureDataType,
  type ClassifiedFeatureInput,
  useClassifiedFeatureSuggestionsQuery,
  useClassifiedFeaturesQuery,
  useCreateClassifiedFeatureMutation,
  useDismissClassifiedFeatureSuggestionMutation,
  useUpdateClassifiedFeatureMutation,
} from "@bitocard/api-client/admin";

const known = new Set<string>(iconNames);
const typeLabels: Record<ClassifiedFeatureDataType, string> = { text: "Text", number: "Number", choice: "Choice", boolean: "Yes or no" };
const list = (value: string) => value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
const keyFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40);

type Editing = { mode: "new"; name?: string; suggestion?: string } | { mode: "edit"; feature: AdminClassifiedFeature };

/** An icon by its lucide name, or a placeholder while the name is not one. */
function FeatureIcon({ name, className = "size-4" }: { name: string; className?: string }) {
  return known.has(name) ? <DynamicIcon name={name as IconName} className={className} aria-hidden /> : <span className={className} aria-hidden />;
}

/**
 * BitoCard Shop > Feature registry: every key sellers can add to an ad (its icon, data type, unit, choices, default,
 * placeholder, limits and search words), and the keys sellers asked for. A key and its data type never change once
 * made, so values already on ads stay valid; switching a key off takes it out of sellers' lists. Operations change it.
 */
export default function ClassifiedFeaturesPage() {
  const admin = useAdmin();
  const changes = can(admin, "operations");
  const [words, setWords] = useState("");
  const q = useDebouncedValue(words.trim());
  const features = useClassifiedFeaturesQuery(q || undefined);
  const [editing, setEditing] = useState<Editing | null>(null);

  const columns: Array<Column<AdminClassifiedFeature>> = [
    {
      key: "key",
      header: "Key",
      cell: item => (
        <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => setEditing({ mode: "edit", feature: item })}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink">
            <FeatureIcon name={item.icon} />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-ink hover:underline">{item.name}</span>
            <span className="block font-mono text-xs text-muted">{item.key}</span>
          </span>
        </button>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: item => `${typeLabels[item.data_type]}${item.unit ? ` · ${item.unit}` : ""}${item.data_type === "choice" ? ` · ${item.choices.length}` : ""}${item.data_type === "boolean" && item.default_value ? ` · ${item.default_value === "true" ? "Yes" : "No"}` : ""}`,
    },
    { key: "placeholder", header: "Placeholder", hideOnMobile: true, cell: item => <span className="text-muted">{item.placeholder ?? "—"}</span> },
    {
      key: "used",
      header: "Used by",
      hideOnMobile: true,
      cell: item => (
        <span className="block max-w-56 text-sm text-muted">
          {item.categories.length > 2 ? `${item.categories.length} categories` : item.categories.join(", ") || "No category"}
          <span className="block text-xs">{formatNumber(item.listings)} ads</span>
        </span>
      ),
    },
    {
      key: "state",
      header: "Filter",
      cell: item => (
        <span className="flex flex-wrap gap-1">
          {item.filterable ? <Badge tone="blue">Filter</Badge> : <span className="text-xs text-muted">No</span>}
          {item.enabled ? null : <Badge tone="grey">Off</Badge>}
        </span>
      ),
    },
  ];

  return (
    <AdminShell section="classifieds" current="/classifieds/features" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Feature registry" }]}>
      <PageHeader
        title="Feature registry"
        description="Every key sellers can add. Each one sets its icon, data type, unit, default and placeholder, so sellers only fill in or tap the value."
        actions={changes ? <Button onClick={() => setEditing({ mode: "new" })}>New feature</Button> : null}
      />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <div className="border-b border-line px-5 py-3 sm:px-6">
            <label>
              <span className="sr-only">Search features</span>
              <Input type="search" placeholder="Search keys and search words" value={words} onChange={event => setWords(event.target.value)} />
            </label>
          </div>
          <DataTable columns={columns} rows={features.data?.data} rowKey={item => item.key} loading={features.isLoading} error={features.error ? errorMessage(features.error) : null} onRetry={features.refetch} empty="No keys match." />
        </Card>
        <div className="space-y-6">
          {editing ? <FeatureEditor key={editing.mode === "edit" ? editing.feature.key : `new:${editing.suggestion ?? ""}`} editing={editing} changes={changes} onDone={setEditing} /> : (
            <Card>
              <CardHeader title="Choose a key" description="Open one from the list to change it, or add a new one." />
            </Card>
          )}
          <Suggestions changes={changes} onAdd={(name, suggestion) => setEditing({ mode: "new", name, suggestion })} />
        </div>
      </div>
    </AdminShell>
  );
}

function FeatureEditor({ editing, changes, onDone }: { editing: Editing; changes: boolean; onDone: (next: Editing | null) => void }) {
  const id = useId();
  const current = editing.mode === "edit" ? editing.feature : null;
  const [name, setName] = useState(current?.name ?? (editing.mode === "new" ? (editing.name ?? "") : ""));
  const [key, setKey] = useState(current?.key ?? keyFrom(name));
  const [keyTouched, setKeyTouched] = useState(false);
  const [dataType, setDataType] = useState<ClassifiedFeatureDataType>(current?.data_type ?? "text");
  const [icon, setIcon] = useState(current?.icon ?? "tag");
  const [unit, setUnit] = useState(current?.unit ?? "");
  const [min, setMin] = useState(current?.min === null || current?.min === undefined ? "" : String(current.min));
  const [max, setMax] = useState(current?.max === null || current?.max === undefined ? "" : String(current.max));
  const [choices, setChoices] = useState((current?.choices ?? []).join("\n"));
  const [defaultValue, setDefaultValue] = useState(current?.default_value ?? "");
  const [placeholder, setPlaceholder] = useState(current?.placeholder ?? "");
  const [synonyms, setSynonyms] = useState((current?.synonyms ?? []).join(", "));
  const [filterable, setFilterable] = useState(current?.filterable ?? false);
  const [create, creating] = useCreateClassifiedFeatureMutation();
  const [update, updating] = useUpdateClassifiedFeatureMutation();
  const [saved, setSaved] = useState(false);
  const error = creating.error ?? updating.error;
  const number = dataType === "number";
  const parseNumber = (value: string) => (value.trim() === "" ? null : Number(value));
  const problems = [
    name.trim().length < 2 ? "Name it in 2 to 40 characters." : null,
    !/^[a-z][a-z0-9_]{1,39}$/.test(key) ? "The key is lower-case letters, digits and underscores, starting with a letter." : null,
    !known.has(icon) ? "Choose an icon by its lucide name, for example memory-stick." : null,
    number && min.trim() && !Number.isFinite(Number(min)) ? "The smallest value is a number." : null,
    number && max.trim() && !Number.isFinite(Number(max)) ? "The largest value is a number." : null,
    dataType === "choice" && !list(choices).length ? "Add the choices, one a line." : null,
  ].filter(Boolean) as string[];

  const fields: ClassifiedFeatureInput = {
    name: name.trim(),
    icon,
    placeholder: placeholder.trim() || null,
    default_value: defaultValue.trim() || null,
    synonyms: list(synonyms),
    filterable,
    ...(number ? { unit: unit.trim() || null, min: parseNumber(min), max: parseNumber(max) } : {}),
    ...(dataType === "choice" ? { choices: list(choices) } : {}),
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problems.length) return;
    setSaved(false);
    if (current) {
      const result = await update({ key: current.key, ...fields }).unwrap();
      onDone({ mode: "edit", feature: result });
    } else {
      const result = await create({ ...fields, name: name.trim(), icon, key, data_type: dataType, ...(editing.mode === "new" && editing.suggestion ? { suggestion: editing.suggestion } : {}) }).unwrap();
      onDone({ mode: "edit", feature: result });
    }
    setSaved(true);
  };

  const toggleEnabled = async () => {
    if (!current) return;
    onDone({ mode: "edit", feature: await update({ key: current.key, enabled: !current.enabled }).unwrap() });
  };

  return (
    <Card>
      <CardHeader title={current ? current.name : "New feature"} description={current ? `${formatNumber(current.listings)} ads use it. Its key and type stay as they are.` : "Sellers see it as soon as it is saved."} />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5 sm:px-6">
        <fieldset disabled={!changes} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor={`${id}-name`}>
              <Input
                id={`${id}-name`}
                maxLength={40}
                value={name}
                onChange={event => {
                  setName(event.target.value);
                  if (!current && !keyTouched) setKey(keyFrom(event.target.value));
                }}
              />
            </Field>
            <Field label="Key" htmlFor={`${id}-key`}>
              <Input
                id={`${id}-key`}
                className="font-mono"
                disabled={Boolean(current)}
                value={key}
                onChange={event => {
                  setKey(event.target.value);
                  setKeyTouched(true);
                }}
              />
            </Field>
            <Field label="Data type" htmlFor={`${id}-type`}>
              <Select id={`${id}-type`} disabled={Boolean(current)} value={dataType} onChange={event => setDataType(event.target.value as ClassifiedFeatureDataType)}>
                {(Object.keys(typeLabels) as ClassifiedFeatureDataType[]).map(value => (
                  <option key={value} value={value}>
                    {typeLabels[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Icon" htmlFor={`${id}-icon`} hint="A lucide icon name.">
              <span className="flex items-center gap-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-ink">
                  <FeatureIcon name={icon} className="size-5" />
                </span>
                <Input id={`${id}-icon`} className="font-mono" value={icon} onChange={event => setIcon(event.target.value.trim().toLowerCase())} />
              </span>
            </Field>
            {number ? (
              <>
                <Field label="Unit" htmlFor={`${id}-unit`}>
                  <Input id={`${id}-unit`} maxLength={12} value={unit} onChange={event => setUnit(event.target.value)} placeholder="GB" />
                </Field>
                <span className="grid grid-cols-2 gap-3">
                  <Field label="Min" htmlFor={`${id}-min`}>
                    <Input id={`${id}-min`} inputMode="decimal" value={min} onChange={event => setMin(event.target.value)} />
                  </Field>
                  <Field label="Max" htmlFor={`${id}-max`}>
                    <Input id={`${id}-max`} inputMode="decimal" value={max} onChange={event => setMax(event.target.value)} />
                  </Field>
                </span>
              </>
            ) : null}
            <Field label="Default" htmlFor={`${id}-default`} hint={dataType === "boolean" ? "true, false or blank." : "Blank for none."}>
              <Input id={`${id}-default`} value={defaultValue} onChange={event => setDefaultValue(event.target.value)} />
            </Field>
            <Field label="Placeholder" htmlFor={`${id}-placeholder`}>
              <Input id={`${id}-placeholder`} maxLength={40} value={placeholder} onChange={event => setPlaceholder(event.target.value)} placeholder="e.g. 128" />
            </Field>
          </div>
          {dataType === "choice" ? (
            <Field label="Choices" htmlFor={`${id}-choices`} hint="One a line, in the order sellers see them. Choices ads use cannot be removed.">
              <Textarea id={`${id}-choices`} rows={4} value={choices} onChange={event => setChoices(event.target.value)} />
            </Field>
          ) : null}
          <Field label="Search words" htmlFor={`${id}-synonyms`} hint="Separated by commas: what sellers might type instead.">
            <Input id={`${id}-synonyms`} value={synonyms} onChange={event => setSynonyms(event.target.value)} placeholder="rom, internal storage, capacity" />
          </Field>
          <span className="flex items-center justify-between gap-3 text-sm text-ink">
            Buyers can filter on it
            <Toggle label="Buyers can filter on it" checked={filterable} onChange={setFilterable} />
          </span>
        </fieldset>
        <div className="rounded-xl bg-canvas p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">How sellers see it</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-white p-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-canvas text-ink">
              <FeatureIcon name={icon} />
            </span>
            <span className="w-28 shrink-0 truncate text-sm font-semibold text-ink">{name || "Name"}</span>
            <span className="flex h-9 min-w-0 flex-1 items-center justify-between rounded-md border border-line px-2 text-sm text-muted">
              <span className="truncate">{dataType === "choice" ? "Pick one" : dataType === "boolean" ? "Yes or no" : placeholder || defaultValue || " "}</span>
              {number && unit ? <strong className="text-ink">{unit}</strong> : null}
            </span>
          </div>
        </div>
        {problems.length && changes ? (
          <ul className="list-disc pl-4 text-sm text-red-700">
            {problems.map(problem => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
        {saved ? <Notice tone="green">Saved.</Notice> : null}
        {changes ? (
          <div className="flex flex-wrap justify-end gap-2">
            {current ? (
              <Button type="button" variant="secondary" loading={updating.isLoading && updating.originalArgs?.enabled !== undefined} onClick={() => void toggleEnabled()}>
                {current.enabled ? "Turn off" : "Turn on"}
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => onDone(null)}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={creating.isLoading || (updating.isLoading && updating.originalArgs?.enabled === undefined)} disabled={problems.length > 0}>
              {current ? "Save" : "Add feature"}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function Suggestions({ changes, onAdd }: { changes: boolean; onAdd: (name: string, suggestion: string) => void }) {
  const suggestions = useClassifiedFeatureSuggestionsQuery();
  const [dismiss, dismissing] = useDismissClassifiedFeatureSuggestionMutation();
  return (
    <Card>
      <CardHeader title={`Suggested by sellers${suggestions.data?.data.length ? ` (${suggestions.data.data.length})` : ""}`} description="Keys sellers looked for and could not find, most asked first." />
      <div className="px-5 pb-5 sm:px-6">
        {dismissing.error ? <Notice tone="red">{errorMessage(dismissing.error)}</Notice> : null}
        <QueryView query={suggestions} loading={<Skeleton className="h-24 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="divide-y divide-line">
                {data.data.map(item => (
                  <li key={item.name_key} className="flex flex-wrap items-center gap-2 py-2.5">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold text-ink">{item.name}</span>
                      <span className="text-muted">
                        {" "}
                        · {item.sellers} {item.sellers === 1 ? "seller" : "sellers"}
                        {item.categories.length ? ` · ${item.categories.join(", ")}` : ""}
                      </span>
                      <span className="block text-xs text-muted">Last asked {formatRelative(item.last_at)}</span>
                    </span>
                    {changes ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="ghost" loading={dismissing.isLoading && dismissing.originalArgs === item.name_key} onClick={() => void dismiss(item.name_key)}>
                          Dismiss
                        </Button>
                        <Button size="sm" onClick={() => onAdd(item.name, item.name_key)}>
                          Add
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No suggestions waiting.</p>
            )
          }
        </QueryView>
      </div>
    </Card>
  );
}
