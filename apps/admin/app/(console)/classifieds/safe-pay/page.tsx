"use client";

import { useId, useState, type FormEvent } from "react";
import { amountToMinor, Badge, bpsToPercent, Button, Card, CardHeader, errorMessage, Field, formatMoney, Input, Notice, PageHeader, percentToBps, QueryView, Skeleton, Textarea } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ClassifiedSafePaySettings, type ClassifiedSafePaySettingsInput, safePayFee, useClassifiedSafePaySettingsQuery, useCountriesQuery, useUpdateClassifiedSafePaySettingsMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

/** Example prices, in whole units of the market's currency. */
const examplePrices = [50_000, 520_000, 1_200_000, 8_900_000];

const whole = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : null);
const major = (minor: number | null) => (minor === null ? "" : String(minor / 100));

/**
 * BitoCard Shop > Safe pay settings, per market: each side's fee (a rate with a cap), a new seller's order limit, the
 * time limits, and the strike limit. Safe pay opens only once both fees are set (and its switch is on). Changes apply
 * to new requests only. Finance changes them, inside the step-up window; each change is audited.
 */
export default function ClassifiedSafePayPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const settings = useClassifiedSafePaySettingsQuery(country);
  const countries = useCountriesQuery();
  const currency = countries.data?.data.find(item => item.code === country)?.currency ?? "NGN";
  return (
    <AdminShell section="classifieds" current="/classifieds/safe-pay" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Safe pay settings" }]}>
      <PageHeader
        title="Safe pay settings"
        description="Safe pay holds the buyer's money in escrow until the item is handed over. It opens in a market once both fees are set here and the classifieds_safe_pay switch is on (Settings > Feature switches)."
        actions={
          <AppLink href="/classifieds/orders?payout_review=pending" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
            Payouts held for review
          </AppLink>
        }
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="safe-pay-market" value={country} onChange={setCountry} all={false} />
      </div>
      <div className="mt-4">
        <QueryView query={settings} loading={<Skeleton className="h-96 w-full" />}>
          {data => <SettingsForm key={JSON.stringify(data)} saved={data} currency={currency} changes={can(admin, "finance")} />}
        </QueryView>
      </div>
    </AdminShell>
  );
}

/** What people would pay at a few prices with the rates being typed, so a change is seen before it is saved. */
function FeeExamples({ currency, buyerBps, buyerCap, sellerBps, sellerCap }: { currency: string; buyerBps: number | null; buyerCap: number | null; sellerBps: number | null; sellerCap: number | null }) {
  const ready = buyerBps !== null && buyerCap !== null && sellerBps !== null && sellerCap !== null;
  const money = (minor: number) => formatMoney(minor, currency);
  return (
    <Card>
      <CardHeader title="What people would pay" description="With the fees as typed above." />
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        {ready ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">Price</th>
                  <th scope="col" className="py-2 pr-2 font-semibold">Buyer fee</th>
                  <th scope="col" className="py-2 pr-2 font-semibold">Seller fee</th>
                  <th scope="col" className="py-2 font-semibold">BitoCard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {examplePrices.map(major => {
                  const price = major * 100;
                  const buyer = safePayFee(price, buyerBps, buyerCap);
                  const seller = safePayFee(price, sellerBps, sellerCap);
                  return (
                    <tr key={major}>
                      <td className="py-2 pr-2 font-semibold text-ink">{money(price)}</td>
                      <td className="py-2 pr-2">
                        {money(buyer)}
                        {buyer === buyerCap && buyerBps > 0 ? <span className="text-xs text-muted"> cap</span> : null}
                      </td>
                      <td className="py-2 pr-2">
                        {money(seller)}
                        {seller === sellerCap && sellerBps > 0 ? <span className="text-xs text-muted"> cap</span> : null}
                      </td>
                      <td className="py-2 font-semibold text-ink">{money(buyer + seller)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Enter both fees and their caps to see examples.</p>
        )}
        <p className="text-xs text-muted">&ldquo;cap&rdquo; marks a fee held at its cap.</p>
        <Notice tone="amber">Keep Safe pay to the sandbox in a market until the legal advice on holding buyers&apos; money there is done.</Notice>
      </div>
    </Card>
  );
}

function SettingsForm({ saved, currency, changes }: { saved: ClassifiedSafePaySettings; currency: string; changes: boolean }) {
  const id = useId();
  const [form, setForm] = useState({
    buyer_fee: bpsToPercent(saved.buyer_fee_bps),
    buyer_cap: major(saved.buyer_fee_cap),
    seller_fee: bpsToPercent(saved.seller_fee_bps),
    seller_cap: major(saved.seller_fee_cap),
    new_seller_limit: major(saved.new_seller_order_limit),
    accept_hours: String(saved.accept_hours),
    pay_hours: String(saved.pay_hours),
    handover_days: String(saved.handover_days),
    confirm_days: String(saved.confirm_days),
    strike_limit: String(saved.strike_limit),
    transit_days: String(saved.transit_days),
    couriers: saved.couriers.map(courier => (courier.tracking_url ? `${courier.name} | ${courier.tracking_url}` : courier.name)).join("\n"),
  });
  const [update, updating] = useUpdateClassifiedSafePaySettingsMutation();
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [key]: event.target.value });
    setDone(false);
  };

  // Blank fee fields stay unset (Safe pay stays closed); a blank new-seller limit means none.
  const next: ClassifiedSafePaySettingsInput = {};
  const problems: string[] = [];
  const rate = (value: string, key: "buyer_fee_bps" | "seller_fee_bps", label: string) => {
    if (!value.trim()) return;
    const bps = percentToBps(value);
    if (bps === null || bps > 2000) problems.push(`${label}: a percentage from 0 to 20.`);
    else if (bps !== saved[key]) next[key] = bps;
  };
  const money = (value: string, key: "buyer_fee_cap" | "seller_fee_cap", label: string) => {
    if (!value.trim()) return;
    const minor = amountToMinor(value);
    if (minor === null) problems.push(`${label}: an amount in ${currency}.`);
    else if (minor !== saved[key]) next[key] = minor;
  };
  const count = (value: string, key: "accept_hours" | "pay_hours" | "handover_days" | "confirm_days" | "strike_limit" | "transit_days", label: string, min: number, max: number) => {
    const number = whole(value);
    if (number === null || number < min || number > max) problems.push(`${label}: a whole number from ${min} to ${max}.`);
    else if (number !== saved[key]) next[key] = number;
  };
  rate(form.buyer_fee, "buyer_fee_bps", "Buyer's fee");
  money(form.buyer_cap, "buyer_fee_cap", "Buyer's fee cap");
  rate(form.seller_fee, "seller_fee_bps", "Seller's fee");
  money(form.seller_cap, "seller_fee_cap", "Seller's fee cap");
  if (!form.new_seller_limit.trim()) {
    if (saved.new_seller_order_limit !== null) next.new_seller_order_limit = null;
  } else {
    const minor = amountToMinor(form.new_seller_limit);
    if (minor === null || minor < 1) problems.push(`New seller's order limit: an amount in ${currency}, or blank for none.`);
    else if (minor !== saved.new_seller_order_limit) next.new_seller_order_limit = minor;
  }
  count(form.accept_hours, "accept_hours", "Hours to accept", 1, 168);
  count(form.pay_hours, "pay_hours", "Hours to pay", 1, 168);
  count(form.handover_days, "handover_days", "Days to hand over", 1, 30);
  count(form.confirm_days, "confirm_days", "Days to confirm", 1, 30);
  count(form.strike_limit, "strike_limit", "Strike limit", 1, 20);
  count(form.transit_days, "transit_days", "Longest transit time", 1, 60);
  // One courier a line: its name, then optionally " | " and its tracking link with {tracking} where the number goes.
  const couriers = form.couriers
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [name, link] = line.split("|").map(part => part.trim());
      return { name: name ?? "", tracking_url: link || null };
    });
  for (const courier of couriers) {
    if (courier.tracking_url && (!courier.tracking_url.startsWith("https://") || !courier.tracking_url.includes("{tracking}"))) problems.push(`${courier.name}: the tracking link is an https address with {tracking} where the number goes.`);
  }
  if (JSON.stringify(couriers) !== JSON.stringify(saved.couriers)) next.couriers = couriers;
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
        {saved.ready ? <Badge tone="green">Fees set: Safe pay can open here</Badge> : <Badge tone="amber">Fees not set: Safe pay stays closed</Badge>}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
      <Card>
        <CardHeader title="Fees" description="Each side's fee is its rate of the price, or its cap when that is lower. Leave a fee blank to keep Safe pay closed." />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 sm:px-6">
          {input("buyer_fee", "Buyer's fee (%)", "Added to what the buyer pays.", "decimal")}
          {input("buyer_cap", `Buyer's fee cap (${currency})`, "The most a buyer pays in fees on one order.", "decimal")}
          {input("seller_fee", "Seller's fee (%)", "Taken from what the seller receives.", "decimal")}
          {input("seller_cap", `Seller's fee cap (${currency})`, "The most a seller pays on one order.", "decimal")}
        </div>
      </Card>
      <Card>
        <CardHeader title="Limits and time" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 sm:px-6">
          {input("new_seller_limit", `New seller's order limit (${currency})`, "The largest order for a seller's first five sales. Blank: none.", "decimal")}
          {input("strike_limit", "Strike limit", "Cancelling after accepting, not handing over and disputes lost in 90 days; at the limit the seller cannot take orders.")}
          {input("accept_hours", "Hours for the seller to accept", "Then the request lapses.")}
          {input("pay_hours", "Hours for the buyer to pay", "After the seller accepts.")}
          {input("handover_days", "Days to hand over", "After payment; then the buyer is refunded in full.")}
          {input("confirm_days", "Days for the buyer to confirm a delivery", "After it is reported delivered; then the money is released.")}
          {input("transit_days", "Longest transit time (days)", "A parcel not delivered by then can be disputed; without a delivery report the confirm days start after it.")}
        </div>
      </Card>
      <Card>
        <CardHeader title="Couriers" description="Sellers choose one when marking an order shipped (or name another). One a line: the name, then optionally | and its tracking link with {tracking} where the number goes." />
        <div className="px-5 pb-5 sm:px-6">
          <Field label="Couriers" htmlFor={`${id}-couriers`}>
            <Textarea id={`${id}-couriers`} rows={5} disabled={!changes} value={form.couriers} onChange={set("couriers")} placeholder={"GIG Logistics | https://giglogistics.com/track/{tracking}\nDHL"} />
          </Field>
        </div>
      </Card>
      </div>
      <FeeExamples currency={currency} buyerBps={percentToBps(form.buyer_fee)} buyerCap={amountToMinor(form.buyer_cap)} sellerBps={percentToBps(form.seller_fee)} sellerCap={amountToMinor(form.seller_cap)} />
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
      {done ? <Notice tone="green">Saved. New Safe pay requests use these settings; orders already asked keep theirs.</Notice> : null}
      {changes ? (
        <Button type="submit" loading={updating.isLoading} disabled={Boolean(problems.length) || !changed}>
          Save Safe pay settings
        </Button>
      ) : (
        <p className="text-sm text-muted">Finance changes these settings.</p>
      )}
    </form>
  );
}
