"use client";

import { useId, useState, type FormEvent } from "react";
import { Badge, Button, Card, CardHeader, errorMessage, Field, Input, Notice, PageHeader, QueryView, Select, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type ClassifiedMarketSettings,
  useAddClassifiedWordMutation,
  useClassifiedMarketSettingsQuery,
  useClassifiedWordsQuery,
  useRemoveClassifiedWordMutation,
  useUpdateClassifiedMarketSettingsMutation,
} from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

type Limits = Omit<ClassifiedMarketSettings, "object" | "country">;

const limitFields: Array<{ key: keyof Limits; label: string; hint: string; min: number; max: number }> = [
  { key: "listing_days", label: "Days an ad stays live", hint: "Then it expires; the seller can renew it.", min: 1, max: 365 },
  { key: "monthly_listing_limit", label: "Ads per top category in 30 days", hint: "Per seller.", min: 1, max: 10000 },
  { key: "first_listings_reviewed", label: "A new seller's first ads reviewed", hint: "0 puts new sellers' ads live at once (other checks still apply).", min: 0, max: 100 },
  { key: "min_photos", label: "Fewest photos", hint: "Needed to submit.", min: 1, max: 30 },
  { key: "max_photos", label: "Most photos", hint: "At least the fewest.", min: 1, max: 30 },
];

/**
 * BitoCard Shop > Limits and words: each market's posting rules, and the refused and doubtful words. A refused word
 * stops an ad being submitted; a doubtful one sends it to the review queue. Operations change them; all audited.
 */
export default function ClassifiedRulesPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const changes = can(admin, "operations");
  return (
    <AdminShell section="classifieds" current="/classifieds/rules" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Limits and words" }]}>
      <PageHeader title="Limits and words" description="Posting rules per market, and the words that stop an ad or send it to a moderator. Whole words and phrases match, in any letter case." />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="rules-market" value={country} onChange={setCountry} all={false} />
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <MarketLimits country={country} changes={changes} />
        <Words country={country} changes={changes} />
      </div>
    </AdminShell>
  );
}

function MarketLimits({ country, changes }: { country: string; changes: boolean }) {
  const settings = useClassifiedMarketSettingsQuery(country);
  return (
    <Card>
      <CardHeader title="Posting limits" description={`For sellers in ${country}.`} />
      <div className="px-5 pb-5 sm:px-6">
        <QueryView query={settings} loading={<Skeleton className="h-64 w-full" />}>
          {data => <LimitsForm key={`${data.country}:${JSON.stringify(data)}`} saved={data} changes={changes} />}
        </QueryView>
      </div>
    </Card>
  );
}

function LimitsForm({ saved, changes }: { saved: ClassifiedMarketSettings; changes: boolean }) {
  const id = useId();
  const [values, setValues] = useState<Record<keyof Limits, string>>(() => Object.fromEntries(limitFields.map(field => [field.key, String(saved[field.key])])) as Record<keyof Limits, string>);
  const [update, updating] = useUpdateClassifiedMarketSettingsMutation();
  const [done, setDone] = useState(false);
  const parsed = Object.fromEntries(limitFields.map(field => [field.key, /^\d+$/.test(values[field.key].trim()) ? Number(values[field.key]) : null])) as Record<keyof Limits, number | null>;
  const invalid = limitFields.find(field => parsed[field.key] === null || parsed[field.key]! < field.min || parsed[field.key]! > field.max);
  const changed = limitFields.filter(field => parsed[field.key] !== saved[field.key]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || !changed.length) return;
    await update({ country: saved.country, ...Object.fromEntries(changed.map(field => [field.key, parsed[field.key]])) }).unwrap();
    setDone(true);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {limitFields.map(field => (
          <Field key={field.key} label={field.label} hint={field.hint} htmlFor={`${id}-${field.key}`}>
            <Input id={`${id}-${field.key}`} inputMode="numeric" disabled={!changes} value={values[field.key]} onChange={event => {
                setValues({ ...values, [field.key]: event.target.value });
                setDone(false);
              }} />
          </Field>
        ))}
      </div>
      {invalid ? <p className="text-sm text-red-700">{`${invalid.label}: a whole number from ${invalid.min} to ${invalid.max}.`}</p> : null}
      {updating.error ? <Notice tone="red">{errorMessage(updating.error)}</Notice> : null}
      {done ? <Notice tone="green">Saved. New ads follow these limits.</Notice> : null}
      {changes ? (
        <Button type="submit" loading={updating.isLoading} disabled={Boolean(invalid) || !changed.length}>
          Save limits
        </Button>
      ) : null}
    </form>
  );
}

function Words({ country, changes }: { country: string; changes: boolean }) {
  const id = useId();
  const words = useClassifiedWordsQuery(country);
  const [add, adding] = useAddClassifiedWordMutation();
  const [remove, removing] = useRemoveClassifiedWordMutation();
  const [phrase, setPhrase] = useState("");
  const [action, setAction] = useState<"block" | "review">("review");
  const [scope, setScope] = useState<"market" | "all">("market");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phrase.trim().length < 2) return;
    await add({ phrase: phrase.trim(), action, country: scope === "market" ? country : null }).unwrap();
    setPhrase("");
  };

  return (
    <Card>
      <CardHeader title="Refused and doubtful words" description={`Those for every market and for ${country}.`} />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        {changes ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <Field label="Word or phrase" htmlFor={`${id}-phrase`}>
              <Input id={`${id}-phrase`} maxLength={60} value={phrase} onChange={event => setPhrase(event.target.value)} placeholder="e.g. replica" />
            </Field>
            <Field label="What it does" htmlFor={`${id}-action`}>
              <Select id={`${id}-action`} value={action} onChange={event => setAction(event.target.value as "block" | "review")}>
                <option value="review">Send to review</option>
                <option value="block">Refuse the ad</option>
              </Select>
            </Field>
            <Field label="Where" htmlFor={`${id}-scope`}>
              <Select id={`${id}-scope`} value={scope} onChange={event => setScope(event.target.value as "market" | "all")}>
                <option value="market">{country} only</option>
                <option value="all">Every market</option>
              </Select>
            </Field>
            <Button type="submit" loading={adding.isLoading} disabled={phrase.trim().length < 2}>
              Add
            </Button>
          </form>
        ) : null}
        {adding.error ?? removing.error ? <Notice tone="red">{errorMessage(adding.error ?? removing.error)}</Notice> : null}
        <QueryView query={words} loading={<Skeleton className="h-40 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="divide-y divide-line">
                {data.data.map(word => (
                  <li key={word.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 font-medium text-ink">{word.phrase}</span>
                    <Badge tone={word.action === "block" ? "red" : "amber"}>{word.action === "block" ? "Refuses" : "Reviews"}</Badge>
                    <Badge tone="grey" dot={false}>
                      {word.country ?? "Every market"}
                    </Badge>
                    {changes ? (
                      <Button size="sm" variant="ghost" loading={removing.isLoading && removing.originalArgs === word.id} onClick={() => void remove(word.id)}>
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No words yet.</p>
            )
          }
        </QueryView>
      </div>
    </Card>
  );
}
