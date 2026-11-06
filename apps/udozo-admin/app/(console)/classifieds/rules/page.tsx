"use client";

import { useId, useState, type FormEvent } from "react";
import { Badge, Button, Card, CardHeader, errorMessage, Field, Input, Notice, PageHeader, QueryView, Select, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import {
  type ClassifiedMarketSettings,
  useAddClassifiedWordMutation,
  useClassifiedMarketSettingsQuery,
  useClassifiedWordsQuery,
  useRemoveClassifiedWordMutation,
  useUpdateClassifiedMarketSettingsMutation,
} from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

type Limits = Omit<ClassifiedMarketSettings, "object" | "country" | "reviews_neutral">;

const limitFields: Array<{ key: keyof Limits; label: string; hint: string; min: number; max: number; fallback?: number }> = [
  { key: "listing_days", label: "Days an ad stays live", hint: "Then it expires; the seller can renew it.", min: 1, max: 365 },
  { key: "monthly_listing_limit", label: "Ads per top category in 30 days", hint: "Per seller.", min: 1, max: 10000 },
  { key: "first_listings_reviewed", label: "A new seller's first ads reviewed", hint: "0 puts new sellers' ads live at once (other checks still apply).", min: 0, max: 100 },
  { key: "min_photos", label: "Fewest photos", hint: "Needed to submit.", min: 1, max: 30 },
  { key: "max_photos", label: "Most photos", hint: "At least the fewest.", min: 1, max: 30 },
  {
    key: "username_min_listings",
    label: "Ads before choosing a username",
    hint: "Customers choose a username, their seller page's address, once they have posted this many ads. 0 lets anyone choose one.",
    min: 0,
    max: 100,
    fallback: 5,
  },
  { key: "buy_request_hours", label: "Hours to answer a buy order", hint: "The seller accepts, counters or declines in this time, else it lapses. 1 to 168.", min: 1, max: 168, fallback: 48 },
  { key: "buy_meet_days", label: "Days to meet once accepted", hint: "The buyer and seller meet and pay in person within this time. 1 to 30.", min: 1, max: 30, fallback: 7 },
  { key: "buy_open_per_buyer", label: "Open buy orders per buyer", hint: "Waiting, countered or accepted at once. 1 to 100.", min: 1, max: 100, fallback: 10 },
  { key: "buy_requests_per_day", label: "Buy orders a buyer may send a day", hint: "1 to 200.", min: 1, max: 200, fallback: 20 },
  { key: "review_window_days", label: "Days to review a purchase", hint: "From the purchase completing; reminders go on days 2 and 7. 1 to 180.", min: 1, max: 180, fallback: 30 },
  { key: "review_min_shown", label: "Reviews before the positive share shows", hint: "Counted reviews (positive and negative) in the last 12 months. 1 to 50.", min: 1, max: 50, fallback: 3 },
  {
    key: "unfinished_reminder_hours",
    label: "Hours before reminding an unfinished ad",
    hint: "An ad with its title, category and a photo but not finished: one reminder this long after the seller last changed it. Needs the post reminders switch. 1 to 720.",
    min: 1,
    max: 720,
    fallback: 24,
  },
  { key: "ready_reminder_1_hours", label: "Hours before the first reminder to post", hint: "An ad with everything filled in but not posted: this long after the seller last changed it. 1 to 720.", min: 1, max: 720, fallback: 24 },
  { key: "ready_reminder_2_hours", label: "Hours from the first to the second", hint: "The second reminder to post, this long after the first. 1 to 720.", min: 1, max: 720, fallback: 72 },
  { key: "ready_reminder_3_hours", label: "Hours from the second to the last", hint: "The third and last reminder, this long after the second. 1 to 720.", min: 1, max: 720, fallback: 168 },
];

/** What the market has saved for a field; a setting the API does not send yet reads as its default. */
const savedValue = (saved: ClassifiedMarketSettings, field: (typeof limitFields)[number]) => (saved as Partial<Limits>)[field.key] ?? field.fallback ?? 0;

/**
 * Udozo > Limits and words: each market's posting rules, and the refused and doubtful words. A refused word
 * stops an ad being submitted; a doubtful one sends it to the review queue. Operations change them; all audited.
 */
export default function ClassifiedRulesPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const changes = can(admin, "operations");
  return (
    <UdozoShell section="marketplace" current="/classifieds/rules" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Limits and words" }]}>
      <PageHeader title="Limits and words" description="Posting rules per market, when sellers may choose a username, when sellers are reminded to finish and post their ads, and the words that stop an ad or send it to a moderator. Whole words and phrases match, in any letter case." />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="rules-market" value={country} onChange={setCountry} all={false} />
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <MarketLimits country={country} changes={changes} />
        <Words country={country} changes={changes} />
      </div>
    </UdozoShell>
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
  const [values, setValues] = useState<Record<keyof Limits, string>>(() => Object.fromEntries(limitFields.map(field => [field.key, String(savedValue(saved, field))])) as Record<keyof Limits, string>);
  const [update, updating] = useUpdateClassifiedMarketSettingsMutation();
  const [done, setDone] = useState(false);
  const savedNeutral = saved.reviews_neutral ?? false;
  const [neutral, setNeutral] = useState(savedNeutral);
  const parsed = Object.fromEntries(limitFields.map(field => [field.key, /^\d+$/.test(values[field.key].trim()) ? Number(values[field.key]) : null])) as Record<keyof Limits, number | null>;
  const invalid = limitFields.find(field => parsed[field.key] === null || parsed[field.key]! < field.min || parsed[field.key]! > field.max);
  const changed = limitFields.filter(field => parsed[field.key] !== savedValue(saved, field));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || (!changed.length && neutral === savedNeutral)) return;
    await update({ country: saved.country, ...Object.fromEntries(changed.map(field => [field.key, parsed[field.key]])), ...(neutral !== savedNeutral ? { reviews_neutral: neutral } : {}) }).unwrap();
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
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          disabled={!changes}
          checked={neutral}
          onChange={event => {
            setNeutral(event.target.checked);
            setDone(false);
          }}
        />
        <span>
          <span className="block font-semibold text-ink">Offer Neutral in reviews</span>
          <span className="block text-muted">Off, buyers choose Positive or Negative. Neutral reviews are listed but never counted in the positive share.</span>
        </span>
      </label>
      {invalid ? <p className="text-sm text-red-700">{`${invalid.label}: a whole number from ${invalid.min} to ${invalid.max}.`}</p> : null}
      {updating.error ? <Notice tone="red">{errorMessage(updating.error)}</Notice> : null}
      {done ? <Notice tone="green">Saved. New ads follow these limits.</Notice> : null}
      {changes ? (
        <Button type="submit" loading={updating.isLoading} disabled={Boolean(invalid) || (!changed.length && neutral === savedNeutral)}>
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
