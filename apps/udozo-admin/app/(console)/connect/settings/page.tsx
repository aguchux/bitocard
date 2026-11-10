"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Card, CardHeader, currencyDigits, errorMessage, Field, Input, Notice, PageHeader, QueryView, Select, Skeleton, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectSettings, type ConnectState, useConnectSettingsQuery, useConnectStatesQuery, useSetConnectSettingsMutation, useSetConnectStateMutation } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { money, toMinor } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

const toMajor = (minor: number | null, currency: string) => (minor === null ? "" : String(minor / 10 ** currencyDigits(currency)));

function DepositCard({ settings, changes }: { settings: ConnectSettings; changes: boolean }) {
  const id = useId();
  const [save, state] = useSetConnectSettingsMutation();
  const [value, setValue] = useState(toMajor(settings.deposit, settings.currency));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setSaved(false);
    const deposit = value.trim() === "" ? null : toMinor(value, settings.currency);
    if (value.trim() !== "" && deposit === null) return setProblem(`Give the deposit in ${settings.currency}, for example 50000.`);
    const done = await save({ country: settings.country, deposit }).unwrap().catch(() => null);
    if (done) setSaved(true);
  };

  return (
    <Card>
      <CardHeader title="Deposit" description="What each applicant pays from their UdozoPay wallet when they submit. It is held while they run a centre, and goes back if the application is rejected or withdrawn." />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        <p className="text-sm text-ink">
          Now: <span className="font-semibold">{settings.deposit === null ? "Not set" : money(settings.deposit, settings.currency)}</span>
        </p>
        {settings.deposit === null ? <Notice tone="amber">Applications in {settings.name} cannot be submitted until the deposit is set.</Notice> : null}
        {changes ? (
          <form onSubmit={submit} className="space-y-3">
            {problem ? <Notice tone="red">{problem}</Notice> : null}
            {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
            {saved ? <Notice tone="green">Saved. New applications pay this deposit.</Notice> : null}
            <Field label={`Deposit (${settings.currency})`} htmlFor={`${id}-deposit`} hint="Leave it empty to clear it: applications then cannot be submitted.">
              <Input id={`${id}-deposit`} inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} className="max-w-xs" />
            </Field>
            <Button type="submit" loading={state.isLoading}>
              Save deposit
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted">Only finance can change the deposit.</p>
        )}
      </div>
    </Card>
  );
}

/** A percentage typed as people write it ("10", "2.5") as basis points, or null when it is not 0 to 100. */
const bpsOf = (value: string) => {
  const number = Number(value.trim().replace(/%$/, ""));
  return value.trim() && Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 100) : null;
};
const percent = (bps: number) => `${bps / 100}%`;

function FeeCard({ settings, changes }: { settings: ConnectSettings; changes: boolean }) {
  const id = useId();
  const [save, state] = useSetConnectSettingsMutation();
  const [kind, setKind] = useState<"percent" | "fixed" | "">(settings.fee?.kind ?? "");
  const [fee, setFee] = useState(settings.fee?.kind === "percent" ? String(settings.fee.bps / 100) : settings.fee?.kind === "fixed" ? toMajor(settings.fee.amount, settings.currency) : "");
  const [share, setShare] = useState(String(settings.centre_share_bps / 100));
  const [hours, setHours] = useState(String(settings.buyer_free_hours));
  const [dueDays, setDueDays] = useState(String(settings.return_due_days));
  const [answerHours, setAnswerHours] = useState(String(settings.return_answer_hours));
  const [collectDays, setCollectDays] = useState(String(settings.seller_collect_days));
  const [abandonDays, setAbandonDays] = useState(String(settings.abandoned_after_days));
  const [auctionDays, setAuctionDays] = useState(String(settings.auction_after_days));
  const [claimDays, setClaimDays] = useState(String(settings.claim_days));
  const [demurrage, setDemurrage] = useState(String(settings.demurrage_bps / 100));
  const [penalty, setPenalty] = useState(String(settings.loc_penalty_bps / 100));
  const [penaltyCap, setPenaltyCap] = useState(toMajor(settings.loc_penalty_cap, settings.currency));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const now = settings.fee === null ? "Not set" : settings.fee.kind === "percent" ? `${percent(settings.fee.bps)} of the shipping charge` : `${money(settings.fee.amount, settings.currency)} an order`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setSaved(false);
    const centreShare = bpsOf(share);
    if (centreShare === null) return setProblem("Give the centre's share as 0 to 100%.");
    const freeHours = Number(hours);
    if (!Number.isInteger(freeHours) || freeHours < 1 || freeHours > 720) return setProblem("Give the free time to collect as 1 to 720 hours.");
    const whole = (value: string, min: number, max: number) => (/^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max ? Number(value) : null);
    const returnDue = whole(dueDays, 1, 90);
    const answer = whole(answerHours, 1, 720);
    const sellerDays = whole(collectDays, 1, 90);
    if (returnDue === null || answer === null || sellerDays === null) return setProblem("Give the return times as whole numbers: days 1 to 90, hours 1 to 720.");
    const demurrageBps = bpsOf(demurrage);
    const penaltyBps = bpsOf(penalty);
    const cap = toMinor(penaltyCap, settings.currency);
    if (demurrageBps === null || penaltyBps === null) return setProblem("Give storage and the Loss of care penalty as 0 to 100% of the shipping charge.");
    if (cap === null) return setProblem(`Give the penalty's daily cap in ${settings.currency}, for example 500.`);
    const abandoned = whole(abandonDays, 1, 365);
    const auctioned = whole(auctionDays, 1, 730);
    const claims = whole(claimDays, 1, 365);
    if (abandoned === null || auctioned === null || claims === null) return setProblem("Give the days to abandon (1 to 365), to auction (1 to 730) and to claim (1 to 365) as whole numbers.");
    const change = {
      country: settings.country,
      centre_share_bps: centreShare,
      buyer_free_hours: freeHours,
      return_due_days: returnDue,
      return_answer_hours: answer,
      seller_collect_days: sellerDays,
      demurrage_bps: demurrageBps,
      loc_penalty_bps: penaltyBps,
      loc_penalty_cap: cap,
      abandoned_after_days: abandoned,
      auction_after_days: auctioned,
      claim_days: claims,
    };
    let done;
    if (kind === "") done = await save({ ...change, fee_kind: null }).unwrap().catch(() => null);
    else if (kind === "percent") {
      const bps = bpsOf(fee);
      if (bps === null) return setProblem("Give the Connect fee as 0 to 100% of the shipping charge.");
      done = await save({ ...change, fee_kind: "percent", fee_bps: bps }).unwrap().catch(() => null);
    } else {
      const minor = toMinor(fee, settings.currency);
      if (minor === null) return setProblem(`Give the Connect fee in ${settings.currency}, for example 500.`);
      done = await save({ ...change, fee_kind: "fixed", fee: minor }).unwrap().catch(() => null);
    }
    if (done) setSaved(true);
  };

  return (
    <Card>
      <CardHeader title="Connect fee" description="What buyers pay on each order collected at a Connect Centre, on top of the seller's shipping charge. The centre's share goes to its earnings, the rest to Udozo." />
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        <p className="text-sm text-ink">
          Now: <span className="font-semibold">{now}</span> · centre&apos;s share <span className="font-semibold">{percent(settings.centre_share_bps)}</span> · free to collect for{" "}
          <span className="font-semibold">{settings.buyer_free_hours} hours</span>
        </p>
        {settings.fee === null ? <Notice tone="amber">Buyers in {settings.name} cannot choose a Connect Centre until the fee is set.</Notice> : null}
        {changes ? (
          <form onSubmit={submit} className="space-y-3">
            {problem ? <Notice tone="red">{problem}</Notice> : null}
            {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
            {saved ? <Notice tone="green">Saved. New Connect orders use these.</Notice> : null}
            <Field label="Kind" htmlFor={`${id}-kind`}>
              <Select id={`${id}-kind`} value={kind} onChange={event => setKind(event.target.value as "percent" | "fixed" | "")} className="max-w-xs">
                <option value="">Not set (no Connect orders)</option>
                <option value="percent">A share of the shipping charge</option>
                <option value="fixed">A fixed amount an order</option>
              </Select>
            </Field>
            {kind ? (
              <Field label={kind === "percent" ? "Fee (% of shipping)" : `Fee (${settings.currency})`} htmlFor={`${id}-fee`}>
                <Input id={`${id}-fee`} inputMode="decimal" value={fee} onChange={event => setFee(event.target.value)} className="max-w-xs" />
              </Field>
            ) : null}
            <Field label="Centre's share (%)" htmlFor={`${id}-share`} hint="Of the Connect fee, demurrage and penalties; Udozo has the rest.">
              <Input id={`${id}-share`} inputMode="decimal" value={share} onChange={event => setShare(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Free time to collect (hours)" htmlFor={`${id}-hours`} hint="From the moment an item is ready at the centre.">
              <Input id={`${id}-hours`} inputMode="numeric" value={hours} onChange={event => setHours(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Return due (days after ready)" htmlFor={`${id}-due`} hint="An item not collected by then goes back to its seller.">
              <Input id={`${id}-due`} inputMode="numeric" value={dueDays} onChange={event => setDueDays(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Hours to answer a return" htmlFor={`${id}-answer`} hint="Unanswered by the seller or Udozo, it is accepted by itself.">
              <Input id={`${id}-answer`} inputMode="numeric" value={answerHours} onChange={event => setAnswerHours(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Seller's days to collect a return" htmlFor={`${id}-collect`}>
              <Input id={`${id}-collect`} inputMode="numeric" value={collectDays} onChange={event => setCollectDays(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Storage a day (% of shipping)" htmlFor={`${id}-demurrage`} hint="Charged each day past the free time, to the buyer and the seller alike; no cap.">
              <Input id={`${id}-demurrage`} inputMode="decimal" value={demurrage} onChange={event => setDemurrage(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Loss of care penalty a day (% of shipping)" htmlFor={`${id}-penalty`} hint="The seller's, once they did not collect a return in their free days.">
              <Input id={`${id}-penalty`} inputMode="decimal" value={penalty} onChange={event => setPenalty(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label={`Penalty cap a day (${settings.currency})`} htmlFor={`${id}-cap`}>
              <Input id={`${id}-cap`} inputMode="decimal" value={penaltyCap} onChange={event => setPenaltyCap(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Abandoned after (days in Loss of care)" htmlFor={`${id}-abandon`} hint="Then Udozo picks it up to the centre's Final Return Address.">
              <Input id={`${id}-abandon`} inputMode="numeric" value={abandonDays} onChange={event => setAbandonDays(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="May be auctioned after (days in Loss of care)" htmlFor={`${id}-auction`}>
              <Input id={`${id}-auction`} inputMode="numeric" value={auctionDays} onChange={event => setAuctionDays(event.target.value)} className="max-w-xs" />
            </Field>
            <Field label="Days to claim what an auction left over" htmlFor={`${id}-claim`} hint="From the sale; unclaimed money is Udozo's.">
              <Input id={`${id}-claim`} inputMode="numeric" value={claimDays} onChange={event => setClaimDays(event.target.value)} className="max-w-xs" />
            </Field>
            <Button type="submit" loading={state.isLoading}>
              Save Connect fee
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted">Only finance can change the Connect fee.</p>
        )}
      </div>
    </Card>
  );
}

function StatesCard({ country, changes }: { country: string; changes: boolean }) {
  const states = useConnectStatesQuery(country);
  const [setState, state] = useSetConnectStateMutation();
  return (
    <Card>
      <CardHeader title="States" description="Every state is open for applications until it is switched off here. Centres already approved are not affected." />
      <div className="px-5 pb-5 sm:px-6">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <QueryView query={states} loading={<Skeleton className="h-48 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="divide-y divide-line">
                {data.data.map((item: ConnectState) => (
                  <li key={item.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
                      <span className="block text-xs text-muted">{item.open ? "Open" : "Closed"}</span>
                    </span>
                    <Toggle checked={item.open} label={`Open in ${item.name}`} disabled={!changes} onChange={enabled => void setState({ id: item.id, country, enabled })} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">This market has no states yet.</p>
            )
          }
        </QueryView>
      </div>
    </Card>
  );
}

/**
 * Connect > States, deposit and fee, per market: the deposit applicants pay when they submit and the Connect fee buyers
 * pay with its centre's share and free time to collect (finance, inside the step-up window), and the states that take
 * applications (operations), each open unless switched off.
 */
export default function ConnectSettingsPage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const settings = useConnectSettingsQuery(country);
  return (
    <UdozoShell section="connect" current="/connect/settings" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "States, deposit and fee" }]}>
      <PageHeader title="States, deposit and fee" description="Applications open in a market with the connect_applications switch (Settings > Feature switches), once its deposit is set here; buyers choose Connect Centres where connect_shipping is on, once the Connect fee is set." />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="connect-settings-market" value={country} onChange={setCountry} all={false} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <QueryView query={settings} loading={<Skeleton className="h-64 w-full" />}>
          {data => (
            <div className="grid gap-4">
              <DepositCard key={`${data.country}:${data.deposit}`} settings={data} changes={can(admin, "finance")} />
              <FeeCard key={`${data.country}:${JSON.stringify(data.fee)}:${data.centre_share_bps}:${data.buyer_free_hours}`} settings={data} changes={can(admin, "finance")} />
            </div>
          )}
        </QueryView>
        <StatesCard key={country} country={country} changes={can(admin, "operations")} />
      </div>
    </UdozoShell>
  );
}
