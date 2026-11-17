"use client";

import { Suspense, useId, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionDialog, Badge, Button, Card, DataTable, Dialog, errorMessage, Field, formatMoney, formatRelative, Input, MoneyInput, Notice, PageHeader, Select, StatusBadge, Tabs, Textarea, Toggle } from "@bitocard/admin-ui";
import { moneyInputValue, parseMoney } from "@bitocard/api-client/money";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminAirtimeLine,
  type AdminAirtimeNetwork,
  type AdminAirtimePurchase,
  type AdminAirtimeSale,
  useAddAirtimeLineMutation,
  useAirtimeOverviewQuery,
  useAirtimePurchaseClaimMutation,
  useAirtimePurchaseDeliveredMutation,
  useAirtimePurchaseRefundMutation,
  useAirtimePurchasesQuery,
  useAirtimeSaleNotReceivedMutation,
  useAirtimeSaleReceivedMutation,
  useAirtimeSaleReverseMutation,
  useAirtimeSellerClearMutation,
  useAirtimeSalesQuery,
  useUpdateAirtimeLineMutation,
  useUpdateAirtimeNetworkMutation,
} from "@bitocard/api-client/admin";

const tabs = [
  { value: "pool", label: "Pool and rates" },
  { value: "lines", label: "Collector lines" },
  { value: "sales", label: "Sales to check" },
  { value: "purchases", label: "Purchases to send" },
] as const;
type Tab = (typeof tabs)[number]["value"];

const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
/** "2,000" or "2,000.50" in the network's currency as minor units; null when it is not an amount. */
const toMinor = (text: string, currency: string) => parseMoney(text, currency);
const naira = (minor: number | null | undefined, currency = "NGN") => formatMoney(minor ?? 0, currency);

/**
 * The airtime exchange (docs/BITOCARD_AIRTIME_EXCHANGE_PLAN.md): the pool per network with its rates (finance),
 * BitoCard's collector lines with today's counts (operations), sellers' transfers to check, and buyers' airtime to send
 * from a line within the hour.
 */
export default function AirtimePage() {
  return (
    <Suspense fallback={null}>
      <Airtime />
    </Suspense>
  );
}

/** Opens on `?tab=` (notices link to Sales to check and Purchases to send). */
function Airtime() {
  const asked = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(tabs.some(item => item.value === asked) ? (asked as Tab) : "pool");
  const overview = useAirtimeOverviewQuery();
  const open = Object.entries(overview.data?.open ?? {});

  return (
    <AdminShell section="orders" current="/orders/airtime" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Airtime exchange" }]}>
      <PageHeader
        title="Airtime exchange"
        description="BitoCard buys customers' unused airtime into a pool per network (sent to its collector lines) and sells it at a discount. Check sellers' transfers, send buyers their airtime within the hour, and keep each line within its daily limits."
      />
      {open.length ? (
        <p className="text-sm text-muted">
          {open.map(([country, on]) => `${country}: ${on ? "open" : "closed (switch airtime_exchange on in Settings > Feature switches)"}`).join(" · ")}
          {overview.data?.mode === "test" ? " · Sandbox" : ""}
        </p>
      ) : null}
      <Tabs label="Show" value={tab} onChange={setTab} items={tabs.map(item => ({ value: item.value, label: item.label }))} />
      {overview.error && !overview.data ? <Notice tone="red">{errorMessage(overview.error)}</Notice> : null}
      {tab === "pool" ? <PoolTab networks={overview.data?.networks} mode={overview.data?.mode ?? "live"} loading={overview.isLoading} /> : null}
      {tab === "lines" ? <LinesTab lines={overview.data?.lines} networks={overview.data?.networks ?? []} loading={overview.isLoading} /> : null}
      {tab === "sales" ? <SalesTab /> : null}
      {tab === "purchases" ? <PurchasesTab lines={overview.data?.lines ?? []} /> : null}
    </AdminShell>
  );
}

function PoolTab({ networks, mode, loading }: { networks: AdminAirtimeNetwork[] | undefined; mode: "live" | "test"; loading: boolean }) {
  const admin = useAdmin();
  const [editing, setEditing] = useState<AdminAirtimeNetwork | null>(null);
  return (
    <Card>
      <DataTable
        caption="Networks"
        rows={loading ? undefined : networks}
        loading={loading}
        rowKey={row => `${row.country}:${row.network}`}
        empty="No networks."
        columns={[
          {
            key: "network",
            header: "Network",
            cell: row => (
              <div className="space-y-1">
                <span className="font-semibold">{row.name}</span>
                <p className="text-xs text-muted">{row.country}</p>
                {!row.enabled ? <Badge tone="grey">Off</Badge> : null}
              </div>
            ),
          },
          { key: "rates", header: "Rates", cell: row => <span className="text-sm">{`Sellers ${percent(row.sell_rate_bps)} · buyers ${percent(row.buy_rate_bps)}`}</span> },
          {
            key: "pool",
            header: "Pool",
            align: "right",
            cell: row => {
              const pool = row.pools.find(item => item.mode === mode);
              return pool ? (
                <div className="space-y-0.5 text-right text-sm">
                  <span className="font-semibold">{`${naira(pool.available - pool.reserved, row.currency)} free`}</span>
                  <p className="text-xs text-muted">{`${naira(pool.reserved, row.currency)} promised · cost ${naira(pool.cost, row.currency)}`}</p>
                  <p className="text-xs text-muted">{`Bought ${naira(pool.bought_total, row.currency)} · sold ${naira(pool.sold_total, row.currency)}`}</p>
                </div>
              ) : (
                <span className="text-sm text-muted">Empty</span>
              );
            },
          },
          { key: "limits", header: "Limits", hideOnMobile: true, cell: row => <span className="text-xs text-muted">{`${naira(row.min_amount)} to ${naira(row.max_amount)} a trade · ${naira(row.seller_daily)} a seller a day (${naira(row.new_seller_daily)} for new sellers, until ${row.established_after} sales) · ${row.credit_hold_hours}h hold · resellers up to ${percent(row.reseller_cap_bps)}`}</span> },
          {
            key: "edit",
            header: "",
            align: "right",
            cell: row =>
              can(admin, "finance") ? (
                <Button variant="secondary" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
              ) : null,
          },
        ]}
      />
      {editing ? <NetworkDialog network={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function NetworkDialog({ network, onClose }: { network: AdminAirtimeNetwork; onClose: () => void }) {
  const id = useId();
  const [update, state] = useUpdateAirtimeNetworkMutation();
  const [sell, setSell] = useState(String(network.sell_rate_bps / 100));
  const [buy, setBuy] = useState(String(network.buy_rate_bps / 100));
  const currency = network.currency;
  const [min, setMin] = useState(moneyInputValue(network.min_amount, currency));
  const [max, setMax] = useState(moneyInputValue(network.max_amount, currency));
  const [daily, setDaily] = useState(moneyInputValue(network.seller_daily, currency));
  const [newDaily, setNewDaily] = useState(moneyInputValue(network.new_seller_daily, currency));
  const [established, setEstablished] = useState(String(network.established_after));
  const [hold, setHold] = useState(String(network.credit_hold_hours));
  const [cap, setCap] = useState(String(network.reseller_cap_bps / 100));
  const [steps, setSteps] = useState(network.transfer_steps);
  const [enabled, setEnabled] = useState(network.enabled);
  const sellBps = Math.round(Number(sell) * 100);
  const buyBps = Math.round(Number(buy) * 100);
  const amounts = [toMinor(min, currency), toMinor(max, currency), toMinor(daily, currency), toMinor(newDaily, currency)];
  const establishedCount = Number(established);
  const capBps = Math.round(Number(cap) * 100);
  const valid =
    sellBps > 0 && buyBps <= 10_000 && sellBps < buyBps && amounts.every(value => value !== null) && amounts[3]! <= amounts[2]! && Number.isInteger(Number(hold)) && Number.isInteger(establishedCount) && establishedCount >= 0 && establishedCount <= 100 && cap.trim() !== "" && capBps >= 0 && capBps <= 5000;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const done = await update({
      country: network.country,
      network: network.network,
      sell_rate_bps: sellBps,
      buy_rate_bps: buyBps,
      min_amount: amounts[0]!,
      max_amount: amounts[1]!,
      seller_daily: amounts[2]!,
      new_seller_daily: amounts[3]!,
      established_after: establishedCount,
      credit_hold_hours: Number(hold),
      reseller_cap_bps: capBps,
      transfer_steps: steps.trim(),
      enabled,
    })
      .unwrap()
      .catch(() => null);
    if (done) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${network.name} rates and limits`}
      description="Sellers always get less than buyers pay. Rates are a percentage of the airtime's face value; changes apply to new trades."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={state.isLoading} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sellers get (%)" htmlFor={`${id}-sell`}>
            <Input id={`${id}-sell`} inputMode="decimal" value={sell} onChange={event => setSell(event.target.value)} />
          </Field>
          <Field label="Buyers pay (%)" htmlFor={`${id}-buy`}>
            <Input id={`${id}-buy`} inputMode="decimal" value={buy} onChange={event => setBuy(event.target.value)} />
          </Field>
          <Field label="Least a trade" htmlFor={`${id}-min`}>
            <MoneyInput id={`${id}-min`} currency={currency} value={min} onValueChange={setMin} />
          </Field>
          <Field label="Most a trade" htmlFor={`${id}-max`}>
            <MoneyInput id={`${id}-max`} currency={currency} value={max} onValueChange={setMax} />
          </Field>
          <Field label="Most a seller a day" htmlFor={`${id}-daily`}>
            <MoneyInput id={`${id}-daily`} currency={currency} value={daily} onValueChange={setDaily} />
          </Field>
          <Field label="Most a new seller a day" htmlFor={`${id}-new-daily`} hint="Never more than every seller's limit.">
            <MoneyInput id={`${id}-new-daily`} currency={currency} value={newDaily} onValueChange={setNewDaily} />
          </Field>
          <Field label="New until this many sales are complete" htmlFor={`${id}-established`}>
            <Input id={`${id}-established`} inputMode="numeric" value={established} onChange={event => setEstablished(event.target.value)} />
          </Field>
          <Field label="Hold before sellers are paid (hours)" htmlFor={`${id}-hold`}>
            <Input id={`${id}-hold`} inputMode="numeric" value={hold} onChange={event => setHold(event.target.value)} />
          </Field>
          <Field label="Resellers' cut cap (%)" htmlFor={`${id}-cap`} hint="On resellers' stores, sellers get these rates less the reseller's airtime markup and buyers pay them plus it, never more than this. 0 to 50.">
            <Input id={`${id}-cap`} inputMode="decimal" value={cap} onChange={event => setCap(event.target.value)} />
          </Field>
        </div>
        <Field label="How sellers send it" htmlFor={`${id}-steps`} hint="{number}, {amount} and {pin} are filled in when shown.">
          <Textarea id={`${id}-steps`} rows={3} value={steps} onChange={event => setSteps(event.target.value)} />
        </Field>
        <Toggle checked={enabled} onChange={setEnabled} label="Trade this network" />
      </form>
    </Dialog>
  );
}

function LinesTab({ lines, networks, loading }: { lines: AdminAirtimeLine[] | undefined; networks: AdminAirtimeNetwork[]; loading: boolean }) {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminAirtimeLine | null>(null);
  const [update] = useUpdateAirtimeLineMutation();
  return (
    <Card>
      {operations ? (
        <div className="mb-4 flex justify-end">
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add line
          </Button>
        </div>
      ) : null}
      <DataTable
        caption="Collector lines"
        rows={loading ? undefined : lines}
        loading={loading}
        rowKey={row => row.id}
        empty="No collector lines yet. Add one per network before opening the exchange."
        columns={[
          {
            key: "line",
            header: "Line",
            cell: row => (
              <div className="space-y-0.5">
                <span className="font-mono font-semibold">{row.number}</span>
                <p className="text-xs text-muted">{`${row.network.toUpperCase()}${row.label ? ` · ${row.label}` : ""}`}</p>
              </div>
            ),
          },
          { key: "received", header: "Received today", align: "right", cell: row => <span className="text-sm">{`${naira(row.received_today)} of ${naira(row.daily_receive)}`}</span> },
          { key: "sent", header: "Sent today", align: "right", cell: row => <span className="text-sm">{`${naira(row.sent_today)} of ${naira(row.daily_send)}`}</span> },
          { key: "balance", header: "On the line", align: "right", cell: row => <span className="font-semibold">{naira(row.balance)}</span> },
          {
            key: "active",
            header: "In use",
            cell: row => <Toggle checked={row.active} disabled={!operations} label={`Use ${row.number}`} onChange={active => update({ id: row.id, active })} />,
          },
          {
            key: "edit",
            header: "",
            align: "right",
            cell: row =>
              operations ? (
                <Button variant="secondary" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
              ) : null,
          },
        ]}
      />
      {adding ? <LineDialog networks={networks} onClose={() => setAdding(false)} /> : null}
      {editing ? <LineDialog networks={networks} line={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function LineDialog({ networks, line, onClose }: { networks: AdminAirtimeNetwork[]; line?: AdminAirtimeLine; onClose: () => void }) {
  const id = useId();
  const [add, adding] = useAddAirtimeLineMutation();
  const [update, updating] = useUpdateAirtimeLineMutation();
  const [network, setNetwork] = useState(line ? `${line.country}:${line.network}` : networks[0] ? `${networks[0].country}:${networks[0].network}` : "");
  const [number, setNumber] = useState(line?.number ?? "");
  const [label, setLabel] = useState(line?.label ?? "");
  const currency = networks.find(item => `${item.country}:${item.network}` === network)?.currency ?? "NGN";
  const [receive, setReceive] = useState(line ? moneyInputValue(line.daily_receive, currency) : "50,000");
  const [send, setSend] = useState(line ? moneyInputValue(line.daily_send, currency) : "50,000");
  const [balance, setBalance] = useState(line ? moneyInputValue(line.balance, currency) : "");
  const [reason, setReason] = useState("");
  const balanceChanged = Boolean(line) && toMinor(balance, currency) !== line!.balance;
  const limits = [toMinor(receive, currency), toMinor(send, currency)];
  const valid = limits.every(value => value !== null) && (line ? !balanceChanged || (toMinor(balance, currency) !== null && reason.trim().length >= 3) : number.trim().length >= 7 && Boolean(network));
  const error = adding.error ?? updating.error;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const [country, key] = network.split(":");
    const done = line
      ? await update({ id: line.id, label: label.trim() || null, daily_receive: limits[0]!, daily_send: limits[1]!, ...(balanceChanged ? { balance: toMinor(balance, currency)!, reason: reason.trim() } : {}) })
          .unwrap()
          .catch(() => null)
      : await add({ country, network: key, number: number.trim(), label: label.trim() || undefined, daily_receive: limits[0]!, daily_send: limits[1]! })
          .unwrap()
          .catch(() => null);
    if (done) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={line ? `Line ${line.number}` : "Add a collector line"}
      description="A line of BitoCard's own that receives sellers' airtime and sends buyers theirs. Keep its daily limits within what the network allows a line."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={adding.isLoading || updating.isLoading} disabled={!valid}>
            {line ? "Save" : "Add line"}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}
        {!line ? (
          <>
            <Field label="Network" htmlFor={`${id}-network`}>
              <Select id={`${id}-network`} value={network} onChange={event => setNetwork(event.target.value)}>
                {networks.map(item => (
                  <option key={`${item.country}:${item.network}`} value={`${item.country}:${item.network}`}>
                    {`${item.name} (${item.country})`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Number" htmlFor={`${id}-number`}>
              <Input id={`${id}-number`} type="tel" autoComplete="off" value={number} onChange={event => setNumber(event.target.value)} />
            </Field>
          </>
        ) : null}
        <Field label="Label" htmlFor={`${id}-label`} hint="Which phone it is in, for staff.">
          <Input id={`${id}-label`} maxLength={60} value={label} onChange={event => setLabel(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Receives a day" htmlFor={`${id}-receive`}>
            <MoneyInput id={`${id}-receive`} currency={currency} value={receive} onValueChange={setReceive} />
          </Field>
          <Field label="Sends a day" htmlFor={`${id}-send`}>
            <MoneyInput id={`${id}-send`} currency={currency} value={send} onValueChange={setSend} />
          </Field>
        </div>
        {line ? (
          <>
            <Field label="Airtime on the line" htmlFor={`${id}-balance`} hint="Change only to match the balance the phone shows.">
              <MoneyInput id={`${id}-balance`} currency={currency} value={balance} onValueChange={setBalance} />
            </Field>
            {balanceChanged ? (
              <Field label="Why it changed" htmlFor={`${id}-reason`}>
                <Input id={`${id}-reason`} maxLength={300} value={reason} onChange={event => setReason(event.target.value)} />
              </Field>
            ) : null}
          </>
        ) : null}
      </form>
    </Dialog>
  );
}

type SalePending = { sale: AdminAirtimeSale; action: "received" | "not_received" | "reverse" | "clear" };

function SalesTab() {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [show, setShow] = useState<"open" | "all">("open");
  const query = useAirtimeSalesQuery({});
  const [receive] = useAirtimeSaleReceivedMutation();
  const [notReceived] = useAirtimeSaleNotReceivedMutation();
  const [reverse] = useAirtimeSaleReverseMutation();
  const [clear] = useAirtimeSellerClearMutation();
  const [pending, setPending] = useState<SalePending | null>(null);
  const rows = query.data?.data.filter(row => show === "all" || ["awaiting_transfer", "sent", "received"].includes(row.status));
  const confirm = async (reason: string) => {
    if (!pending) return;
    if (pending.action === "received") await receive({ id: pending.sale.id, note: reason || undefined }).unwrap();
    else if (pending.action === "not_received") await notReceived({ id: pending.sale.id, reason }).unwrap();
    else if (pending.action === "clear") await clear({ customer: pending.sale.customer.id, reason }).unwrap();
    else await reverse({ id: pending.sale.id, reason }).unwrap();
  };
  return (
    <Card>
      <div className="mb-4">
        <Tabs label="Sales" value={show} onChange={setShow} variant="pills" items={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} />
      </div>
      <DataTable
        caption="Airtime sales"
        rows={query.isLoading ? undefined : rows}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={row => row.id}
        empty="No sales to check."
        columns={[
          {
            key: "sale",
            header: "Sale",
            cell: row => (
              <div className="space-y-0.5">
                <span className="font-semibold">{row.number}</span>
                <p className="text-xs text-muted">{`${row.customer.name ?? row.customer.email} · ${formatRelative(row.created_at)}`}</p>
                {row.seller.paused ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="red">Selling paused</Badge>
                    {operations ? (
                      <button type="button" onClick={() => setPending({ sale: row, action: "clear" })} className="text-xs font-semibold text-pink-700 hover:underline">
                        Clear strikes
                      </button>
                    ) : null}
                  </div>
                ) : row.seller.strikes ? (
                  <Badge tone="amber">{`${row.seller.strikes} of ${row.seller.strike_limit} strikes`}</Badge>
                ) : row.seller.completed_sales === 0 ? (
                  <Badge tone="grey">New seller</Badge>
                ) : null}
              </div>
            ),
          },
          {
            key: "transfer",
            header: "Transfer",
            cell: row => (
              <div className="space-y-0.5 text-sm">
                <span className="font-semibold">{`${naira(row.amount, row.currency)} ${row.network.toUpperCase()}`}</span>
                <p className="font-mono text-xs text-muted">{`${row.from_phone} → ${row.line.number}`}</p>
              </div>
            ),
          },
          { key: "payout", header: "Seller gets", align: "right", hideOnMobile: true, cell: row => naira(row.payout, row.currency) },
          {
            key: "status",
            header: "Status",
            cell: row => (
              <div className="space-y-1">
                <StatusBadge status={row.status} />
                {row.mode === "test" ? <Badge tone="amber">Sandbox</Badge> : null}
                {row.status === "received" && row.credit_at ? <p className="text-xs text-muted">{`Paid ${formatRelative(row.credit_at)}`}</p> : null}
              </div>
            ),
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: row =>
              !operations ? null : ["awaiting_transfer", "sent"].includes(row.status) ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" onClick={() => setPending({ sale: row, action: "received" })}>
                    Received
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setPending({ sale: row, action: "not_received" })}>
                    Not received
                  </Button>
                </div>
              ) : row.status === "expired" ? (
                <Button variant="secondary" size="sm" onClick={() => setPending({ sale: row, action: "received" })}>
                  Arrived late
                </Button>
              ) : row.status === "received" ? (
                <Button variant="danger" size="sm" onClick={() => setPending({ sale: row, action: "reverse" })}>
                  Reversed
                </Button>
              ) : null,
          },
        ]}
      />
      <ActionDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.action === "received" ? "The airtime arrived" : pending?.action === "not_received" ? "Nothing arrived" : pending?.action === "clear" ? "Clear this seller's strikes" : "The network reversed it"}
        description={
          pending?.action === "received"
            ? `Check ${pending.sale.line.number} shows ${naira(pending.sale.amount, pending.sale.currency)} from ${pending.sale.from_phone}. It joins the pool now and the seller is paid after the hold.`
            : pending?.action === "not_received"
              ? pending.sale.status === "sent"
                ? "The seller is told nothing arrived and nothing is paid. They said they sent it, so it counts as a strike: three in 90 days pause their selling."
                : "The seller is told nothing arrived and nothing is paid."
              : pending?.action === "clear"
                ? `${pending.sale.customer.name ?? pending.sale.customer.email} can sell again, and their ${pending.sale.seller.strikes} strikes stop counting. Check their sales first.`
                : "The airtime leaves the pool and the seller is never paid. It counts as a strike against the seller. Only before their hold has passed."
        }
        confirmLabel={pending?.action === "received" ? "Mark received" : pending?.action === "not_received" ? "Not received" : pending?.action === "clear" ? "Clear strikes" : "Reverse"}
        tone={pending?.action === "received" || pending?.action === "clear" ? "primary" : "danger"}
        requireReason={pending?.action !== "received"}
        onConfirm={confirm}
      />
    </Card>
  );
}

type PurchasePending = { purchase: AdminAirtimePurchase; action: "send" | "sent" | "refund" };

function PurchasesTab({ lines }: { lines: AdminAirtimeLine[] }) {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [show, setShow] = useState<"open" | "all">("open");
  const query = useAirtimePurchasesQuery({});
  const [claim, claiming] = useAirtimePurchaseClaimMutation();
  const [deliver] = useAirtimePurchaseDeliveredMutation();
  const [refund] = useAirtimePurchaseRefundMutation();
  const [pending, setPending] = useState<PurchasePending | null>(null);
  const [lineId, setLineId] = useState("");
  const rows = query.data?.data.filter(row => show === "all" || ["paid", "delivering"].includes(row.status));
  const linesFor = (purchase: AdminAirtimePurchase) => lines.filter(line => line.active && line.network === purchase.network && line.balance >= purchase.amount && line.sent_today + purchase.amount <= line.daily_send);
  const confirm = async (reason: string) => {
    if (!pending) return;
    if (pending.action === "sent") await deliver({ id: pending.purchase.id }).unwrap();
    else await refund({ id: pending.purchase.id, reason }).unwrap();
  };
  return (
    <Card>
      <div className="mb-4">
        <Tabs label="Purchases" value={show} onChange={setShow} variant="pills" items={[{ value: "open", label: "To send" }, { value: "all", label: "All" }]} />
      </div>
      <DataTable
        caption="Airtime purchases"
        rows={query.isLoading ? undefined : rows}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={row => row.id}
        empty="Nothing to send."
        columns={[
          {
            key: "purchase",
            header: "Purchase",
            cell: row => (
              <div className="space-y-0.5">
                <span className="font-semibold">{row.number}</span>
                <p className="text-xs text-muted">{`${row.customer.name ?? row.customer.email} · ${formatRelative(row.created_at)}`}</p>
              </div>
            ),
          },
          {
            key: "send",
            header: "Send",
            cell: row => (
              <div className="space-y-0.5 text-sm">
                <span className="font-semibold">{`${naira(row.amount, row.currency)} ${row.network.toUpperCase()}`}</span>
                <p className="font-mono text-xs text-muted">{`to ${row.phone}${row.line ? ` from ${row.line.number}` : ""}`}</p>
              </div>
            ),
          },
          { key: "price", header: "Paid", align: "right", hideOnMobile: true, cell: row => naira(row.price, row.currency) },
          {
            key: "status",
            header: "Status",
            cell: row => (
              <div className="space-y-1">
                <StatusBadge status={row.status} />
                {row.mode === "test" ? <Badge tone="amber">Sandbox</Badge> : null}
                {row.status === "paid" ? <p className="text-xs text-muted">{`Refunded ${formatRelative(row.expires_at)} unless sent`}</p> : null}
              </div>
            ),
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: row =>
              !operations ? null : row.status === "paid" || row.status === "delivering" ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {row.status === "paid" ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setLineId(linesFor(row)[0]?.id ?? "");
                        setPending({ purchase: row, action: "send" });
                      }}
                    >
                      Send
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setPending({ purchase: row, action: "sent" })}>
                      Sent
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setPending({ purchase: row, action: "refund" })}>
                    Refund
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
      {pending?.action === "send" ? (
        <Dialog
          open
          onClose={() => setPending(null)}
          title={`Send ${naira(pending.purchase.amount, pending.purchase.currency)} to ${pending.purchase.phone}`}
          description="Choose the line you are sending from. The purchase is then yours to send: mark it sent once the network confirms."
          footer={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                loading={claiming.isLoading}
                disabled={!lineId}
                onClick={async () => {
                  const done = await claim({ id: pending.purchase.id, line_id: lineId })
                    .unwrap()
                    .catch(() => null);
                  if (done) setPending(null);
                }}
              >
                Take it
              </Button>
            </>
          }
        >
          {claiming.error ? <Notice tone="red">{errorMessage(claiming.error)}</Notice> : null}
          {linesFor(pending.purchase).length ? (
            <Field label="From line" htmlFor="airtime-send-line">
              <Select id="airtime-send-line" value={lineId} onChange={event => setLineId(event.target.value)}>
                {linesFor(pending.purchase).map(line => (
                  <option key={line.id} value={line.id}>
                    {`${line.number} · ${naira(line.balance)} on it · ${naira(line.sent_today)} sent today of ${naira(line.daily_send)}`}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Notice tone="amber">No active line on this network holds enough airtime with room to send it today. Correct a line&apos;s balance, or refund the purchase.</Notice>
          )}
        </Dialog>
      ) : null}
      <ActionDialog
        open={pending?.action === "sent" || pending?.action === "refund"}
        onClose={() => setPending(null)}
        title={pending?.action === "sent" ? "The airtime was sent" : "Refund the buyer"}
        description={
          pending?.action === "sent"
            ? `Only once the network confirms ${pending.purchase.phone} received it. It leaves the pool at its average cost.`
            : "The price goes back to the buyer's wallet and the airtime stays in the pool. The buyer sees the reason."
        }
        confirmLabel={pending?.action === "sent" ? "Mark sent" : "Refund"}
        tone={pending?.action === "sent" ? "primary" : "danger"}
        requireReason={pending?.action === "refund"}
        onConfirm={confirm}
      />
    </Card>
  );
}
