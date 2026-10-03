"use client";

import { useId, useState, type FormEvent } from "react";
import { CheckCircle2, CreditCard, ExternalLink, XCircle } from "lucide-react";
import { Button, Card, CardHeader, currencyDigits, DataTable, errorMessage, Field, formatDateTime, formatMoney, Input, LoadMore, Notice, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { type TopUp, useCreateTopUpMutation, useSimulateTopUpMutation, useTopUpsInfiniteQuery, useWalletQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** Smallest and largest top-up the API accepts, in minor units. */
const minAmount = 100;
const maxAmount = 100_000_000_00;

/** "5,000.50" in the wallet currency → minor units, or null when it is not a valid amount. */
function toMinor(value: string, currency: string) {
  const cleaned = value.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = currencyDigits(currency);
  const [, fraction = ""] = cleaned.split(".");
  if (fraction.length > digits) return null;
  return Math.round(Number(cleaned) * 10 ** digits);
}

/** The payment page returns the payer to the wallet; only HTTPS addresses are accepted, so local development uses the API's default. */
const returnUrl = () => (window.location.protocol === "https:" ? `${window.location.origin}/wallet` : undefined);

function NewTopUp({ currency, sandbox }: { currency: string; sandbox: boolean }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [created, setCreated] = useState<TopUp | null>(null);
  const [create, state] = useCreateTopUpMutation();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setCreated(null);
    const amount = currency ? toMinor(value, currency) : null;
    if (amount === null) return setInvalid("Enter an amount, for example 5000.");
    if (amount < minAmount) return setInvalid(`The smallest top-up is ${formatMoney(minAmount, currency)}.`);
    if (amount > maxAmount) return setInvalid(`The largest single top-up is ${formatMoney(maxAmount, currency)}.`);
    setInvalid(null);
    const topUp = await create({ amount, return_url: returnUrl() })
      .unwrap()
      .catch(() => null);
    if (!topUp) return;
    // Live: off to the payment page, which returns to the wallet. The sandbox has no payment page: simulate it below.
    if (!sandbox && topUp.checkout_url) {
      window.location.assign(topUp.checkout_url);
      return;
    }
    setValue("");
    setCreated(topUp);
  };

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <h2 className="text-lg font-bold text-ink">Add money</h2>
          <p className="mt-0.5 text-sm text-muted">
            Pay by card, bank or mobile money on a secure payment page. Your wallet is credited once the payment is confirmed. Top-ups pay the wholesale cost of orders and cannot be withdrawn.
          </p>
        </div>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {created ? (
          <Notice tone="blue" title="Sandbox top-up created">
            {`${formatMoney(created.amount, created.currency)} is waiting for payment. Mark it as paid or failed in the list below.`}
          </Notice>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="sm:w-72">
            <Field label={`Amount${currency ? ` (${currency})` : ""}`} htmlFor={`${id}-amount`} error={invalid ?? undefined} hint={currency ? `At least ${formatMoney(minAmount, currency)}.` : undefined}>
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="5000"
                value={value}
                onChange={event => setValue(event.target.value)}
                aria-invalid={invalid ? true : undefined}
                disabled={!currency}
              />
            </Field>
          </div>
          <Button type="submit" className="sm:mt-7" loading={state.isLoading} disabled={!currency || !value.trim()} icon={<CreditCard className="size-4" aria-hidden />}>
            {sandbox ? "Create test top-up" : "Continue to payment"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function TopUpsPage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "finance");
  const sandbox = mode === "test";
  const wallet = useWalletQuery(undefined, { skip: !allowed });
  const topUps = useTopUpsInfiniteQuery(undefined, { skip: !allowed });
  const [simulate, simulateState] = useSimulateTopUpMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = topUps.data?.pages.flatMap(page => page.data);

  const run = async (row: TopUp, outcome: "succeeded" | "failed") => {
    setBusy(`${row.id}:${outcome}`);
    await simulate({ id: row.id, outcome })
      .unwrap()
      .catch(() => null);
    setBusy(null);
  };

  return (
    <ShqShell section="wallet" current="/wallet/top-ups" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Top-ups" }]}>
      <PageHeader title="Top-ups" description="Add money to your wallet so you can pay for orders." />
      {!allowed ? (
        <Notice tone="grey" title="No access to top-ups">
          Only the owner, admins and finance members can top up the wallet.
        </Notice>
      ) : (
        <>
          {wallet.error ? <Notice tone="red">{errorMessage(wallet.error, "Could not load your wallet.")}</Notice> : null}
          <NewTopUp currency={wallet.data?.currency ?? ""} sandbox={sandbox} />
          {simulateState.error ? <Notice tone="red">{errorMessage(simulateState.error)}</Notice> : null}
          <Card>
            <CardHeader title="Your top-ups" description="Card and bank payments, and bank transfers into your bank transfer accounts, newest first." className="pb-4" />
            <DataTable<TopUp>
              caption="Top-ups"
              rows={rows}
              loading={topUps.isLoading}
              error={topUps.error ? errorMessage(topUps.error) : null}
              onRetry={topUps.refetch}
              rowKey={row => row.id}
              empty="No top-ups yet."
              columns={[
                { key: "amount", header: "Amount", cell: row => <span className="tabular-nums">{formatMoney(row.amount, row.currency)}</span> },
                {
                  key: "status",
                  header: "Status",
                  cell: row => (
                    <span className="inline-flex flex-col items-end gap-0.5 md:items-start">
                      <StatusBadge status={row.status} />
                      {row.failure_reason ? <span className="text-xs text-muted">{row.failure_reason}</span> : null}
                    </span>
                  ),
                },
                { key: "source", header: "Paid by", cell: row => <span className="text-muted">{row.source === "bank_transfer" ? "Bank transfer" : "Payment page"}</span>, hideOnMobile: true },
                { key: "created", header: "Started", cell: row => <span className="whitespace-nowrap text-muted">{formatDateTime(row.created_at)}</span> },
                { key: "completed", header: "Completed", cell: row => <span className="whitespace-nowrap text-muted">{formatDateTime(row.completed_at)}</span>, hideOnMobile: true },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: row =>
                    row.status !== "pending" ? null : sandbox ? (
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="secondary" icon={<CheckCircle2 className="size-4" aria-hidden />} loading={busy === `${row.id}:succeeded`} disabled={busy !== null} onClick={() => run(row, "succeeded")}>
                          Mark paid
                        </Button>
                        <Button size="sm" variant="ghost" icon={<XCircle className="size-4" aria-hidden />} loading={busy === `${row.id}:failed`} disabled={busy !== null} onClick={() => run(row, "failed")}>
                          Mark failed
                        </Button>
                      </span>
                    ) : row.checkout_url ? (
                      <a href={row.checkout_url} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                        Continue payment
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : null,
                },
              ]}
            />
            <LoadMore hasMore={topUps.hasNextPage} loading={topUps.isFetchingNextPage} onClick={() => topUps.fetchNextPage()} />
          </Card>
        </>
      )}
    </ShqShell>
  );
}
