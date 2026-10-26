"use client";

import { useId, useState, type FormEvent } from "react";
import { amountToMinor, Badge, bpsToPercent, Button, Card, CardHeader, errorMessage, Field, formatMoney, Input, Notice, PageHeader, percentToBps, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ClassifiedResaleSettings, type ClassifiedResaleSettingsInput, safePayFee, useAddResaleClaimPhraseMutation, useClassifiedResaleSettingsQuery, useCountriesQuery, useRemoveResaleClaimPhraseMutation, useResaleClaimPhrasesQuery, useUpdateClassifiedResaleSettingsMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

/** Example prices, in whole units of the market's currency. */
const examplePrices = [50_000, 520_000, 1_200_000];

const whole = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : null);
const major = (minor: number | null) => (minor === null ? "" : String(minor / 100));

/**
 * BitoCard Shop > Resale settings, per market (B2B reselling, docs/BITOCARD_B2B_RESELLING_PLAN.md): the discounts
 * suppliers may give resellers, the highest markup limit they may set (never above the market's markup cap),
 * BitoCard's capped fee on a reseller's margin, and resale's time and strike limits. Resale opens in a market once the
 * reseller fee is set here and the classifieds_resale switch is on. Finance changes them, inside the step-up window;
 * each change is audited.
 */
export default function ClassifiedResalePage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const settings = useClassifiedResaleSettingsQuery(country);
  const countries = useCountriesQuery();
  const currency = countries.data?.data.find(item => item.code === country)?.currency ?? "NGN";
  return (
    <AdminShell section="classifieds" current="/classifieds/resale" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Resale settings" }]}>
      <PageHeader
        title="Resale settings"
        description="Sellers can open their listings to resellers' stores, at a discount and markup limit they choose inside these limits. Resale opens in a market once the reseller fee is set here and the classifieds_resale switch is on (Settings > Feature switches)."
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="resale-market" value={country} onChange={setCountry} all={false} />
      </div>
      <div className="mt-4">
        <QueryView query={settings} loading={<Skeleton className="h-96 w-full" />}>
          {data => <SettingsForm key={JSON.stringify(data)} saved={data} currency={currency} changes={can(admin, "finance")} />}
        </QueryView>
      </div>
      <div className="mt-6">
        <ClaimPhrases changes={can(admin, "operations")} />
      </div>
    </AdminShell>
  );
}

/**
 * Words a Resale shop's own text may not use, in every market: claims of owning, making or stocking the items it resells.
 * Its home page cannot be saved or published while one appears (whole words, any case). Operations keep the list.
 */
function ClaimPhrases({ changes }: { changes: boolean }) {
  const id = useId();
  const phrases = useResaleClaimPhrasesQuery();
  const [add, adding] = useAddResaleClaimPhraseMutation();
  const [remove] = useRemoveResaleClaimPhraseMutation();
  const [phrase, setPhrase] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phrase.trim().length < 3) return;
    const result = await add(phrase.trim());
    if ("data" in result) setPhrase("");
  };
  return (
    <Card>
      <CardHeader title="Ownership claims refused on Resale shops" description="A reseller's store never owns, makes or stocks what it resells. Its words cannot use these phrases (whole words, any case)." />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        <QueryView query={phrases} loading={<Skeleton className="h-16 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="flex flex-wrap gap-2">
                {data.data.map(row => (
                  <li key={row.id} className="inline-flex items-center gap-1 rounded-full bg-canvas px-3 py-1 text-sm ring-1 ring-line">
                    {row.phrase}
                    {changes ? (
                      <button type="button" aria-label={`Remove ${row.phrase}`} className="ml-1 rounded-full px-1 text-muted hover:text-red-600" onClick={() => void remove(row.id)}>
                        ×
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No phrases yet.</p>
            )
          }
        </QueryView>
        {changes ? (
          <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
            <div className="min-w-56 flex-1">
              <Field label="Add a phrase" htmlFor={`${id}-phrase`}>
                <Input id={`${id}-phrase`} value={phrase} maxLength={120} placeholder="our own brand" onChange={event => setPhrase(event.target.value)} />
              </Field>
            </div>
            <Button type="submit" loading={adding.isLoading} disabled={phrase.trim().length < 3}>
              Add
            </Button>
          </form>
        ) : null}
        {adding.error ? <Notice tone="red">{errorMessage(adding.error)}</Notice> : null}
      </div>
    </Card>
  );
}

/** At a few prices, with the limits being typed: the supplier's net at the smallest discount, and the reseller's largest margin and BitoCard's fee on it. */
function Examples({ currency, discountMin, markupMax, feeBps, feeCap }: { currency: string; discountMin: number | null; markupMax: number | null; feeBps: number | null; feeCap: number | null }) {
  const money = (minor: number) => formatMoney(minor, currency);
  const ready = discountMin !== null && markupMax !== null && feeBps !== null && feeCap !== null;
  return (
    <Card>
      <CardHeader title="At these limits" description="A supplier giving the smallest discount, a reseller selling at the highest price they may." />
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        {ready ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">Price</th>
                  <th scope="col" className="py-2 pr-2 font-semibold">Supplier gets</th>
                  <th scope="col" className="py-2 pr-2 font-semibold">Reseller sells at</th>
                  <th scope="col" className="py-2 font-semibold">BitoCard on the margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {examplePrices.map(price => {
                  const minor = price * 100;
                  const net = minor - Math.floor((minor * discountMin) / 10000);
                  const top = minor + Math.floor((minor * markupMax) / 10000);
                  return (
                    <tr key={price}>
                      <td className="py-2 pr-2 font-semibold text-ink">{money(minor)}</td>
                      <td className="py-2 pr-2">{money(net)}</td>
                      <td className="py-2 pr-2">{money(top)}</td>
                      <td className="py-2 font-semibold text-ink">{money(safePayFee(top - net, feeBps, feeCap))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Enter the smallest discount, the markup limit and the reseller fee with its cap to see examples.</p>
        )}
        <p className="text-xs text-muted">The Safe pay fees apply on top, as for any Safe pay order.</p>
        <Notice tone="amber">Keep resale off in a market until the legal advice on holding money for supplier and reseller there is done.</Notice>
      </div>
    </Card>
  );
}

function SettingsForm({ saved, currency, changes }: { saved: ClassifiedResaleSettings; currency: string; changes: boolean }) {
  const id = useId();
  const [form, setForm] = useState({
    discount_min: bpsToPercent(saved.discount_min_bps),
    discount_max: bpsToPercent(saved.discount_max_bps),
    markup_max: bpsToPercent(saved.markup_max_bps),
    reseller_fee: bpsToPercent(saved.reseller_fee_bps),
    reseller_cap: major(saved.reseller_fee_cap),
    accept_hours: String(saved.accept_hours),
    reseller_strike_limit: String(saved.reseller_strike_limit),
  });
  const [update, updating] = useUpdateClassifiedResaleSettingsMutation();
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [key]: event.target.value });
    setDone(false);
  };

  const next: ClassifiedResaleSettingsInput = {};
  const problems: string[] = [];
  const rate = (value: string, key: "discount_min_bps" | "discount_max_bps" | "markup_max_bps" | "reseller_fee_bps", label: string, max: number, optional = false) => {
    if (!value.trim()) {
      if (!optional) problems.push(`${label}: a percentage.`);
      return;
    }
    const bps = percentToBps(value);
    if (bps === null || bps > max) problems.push(`${label}: a percentage from 0 to ${max / 100}.`);
    else if (bps !== saved[key]) next[key] = bps;
  };
  rate(form.discount_min, "discount_min_bps", "Smallest discount", 10000);
  rate(form.discount_max, "discount_max_bps", "Largest discount", 10000);
  rate(form.markup_max, "markup_max_bps", "Markup limit", saved.markup_cap_bps);
  rate(form.reseller_fee, "reseller_fee_bps", "Reseller fee", 5000, true);
  if (form.reseller_cap.trim()) {
    const minor = amountToMinor(form.reseller_cap);
    if (minor === null) problems.push(`Reseller fee cap: an amount in ${currency}.`);
    else if (minor !== saved.reseller_fee_cap) next.reseller_fee_cap = minor;
  }
  const min = percentToBps(form.discount_min);
  const max = percentToBps(form.discount_max);
  if (min !== null && max !== null && min > max) problems.push("The smallest discount cannot be above the largest.");
  const count = (value: string, key: "accept_hours" | "reseller_strike_limit", label: string, low: number, high: number) => {
    const number = whole(value);
    if (number === null || number < low || number > high) problems.push(`${label}: a whole number from ${low} to ${high}.`);
    else if (number !== saved[key]) next[key] = number;
  };
  count(form.accept_hours, "accept_hours", "Hours to accept", 1, 168);
  count(form.reseller_strike_limit, "reseller_strike_limit", "Reseller strike limit", 1, 20);
  const changed = Object.keys(next).length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problems.length || !changed) return;
    await update({ country: saved.country, ...next }).unwrap();
    setDone(true);
  };

  const input = (key: keyof typeof form, label: string, hint: string, mode: "decimal" | "numeric" = "numeric") => (
    <Field label={label} hint={hint} htmlFor={`${id}-${key}`}>
      <Input id={`${id}-${key}`} inputMode={mode} disabled={!changes} value={form[key]} onChange={set(key)} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {saved.open ? <Badge tone="green">Resale is open here</Badge> : <Badge tone="amber">Resale is closed here</Badge>}
        {saved.reseller_fee_bps === null || saved.reseller_fee_cap === null ? <Badge tone="amber">Reseller fee not set</Badge> : null}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="What suppliers may offer" description="Each supplier chooses their discount and markup limit inside these, per listing." />
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 sm:px-6">
              {input("discount_min", "Smallest discount (%)", "So reselling is worth a reseller's while.", "decimal")}
              {input("discount_max", "Largest discount (%)", "The most a supplier may give resellers.", "decimal")}
              {input("markup_max", "Markup limit (%)", `How far above the supplier's price a reseller may sell; at most the market's markup cap, ${saved.markup_cap_bps / 100}%.`, "decimal")}
            </div>
          </Card>
          <Card>
            <CardHeader title="BitoCard's fee and limits" description="The fee is a rate of the reseller's margin, or its cap when that is lower. Leave it blank to keep resale closed." />
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 sm:px-6">
              {input("reseller_fee", "Reseller fee (%)", "Taken from the reseller's margin on release.", "decimal")}
              {input("reseller_cap", `Reseller fee cap (${currency})`, "The most taken from one sale's margin.", "decimal")}
              {input("accept_hours", "Hours for the supplier to accept", "Then the buyer's money is unlocked.")}
              {input("reseller_strike_limit", "Reseller strike limit", "Upheld disputes over a store's note, upheld reports and cancellations in 90 days; at the limit the store's resale checkout pauses.")}
            </div>
          </Card>
        </div>
        <Examples
          currency={currency}
          discountMin={percentToBps(form.discount_min)}
          markupMax={percentToBps(form.markup_max)}
          feeBps={percentToBps(form.reseller_fee)}
          feeCap={amountToMinor(form.reseller_cap)}
        />
      </div>
      {problems.length ? (
        <Notice tone="red">
          <ul className="list-disc pl-4">
            {problems.map(problem => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {updating.error ? <Notice tone="red">{errorMessage(updating.error)}</Notice> : null}
      {done ? <Notice tone="green">Saved. Listings opened to resellers from now on use these limits.</Notice> : null}
      {changes ? (
        <Button type="submit" loading={updating.isLoading} disabled={Boolean(problems.length) || !changed}>
          Save resale settings
        </Button>
      ) : (
        <p className="text-sm text-muted">Finance changes these settings.</p>
      )}
    </form>
  );
}
