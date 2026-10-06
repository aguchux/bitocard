"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDownToLine, CheckCircle2, XCircle } from "lucide-react";
import {
  ActionDialog,
  Button,
  Card,
  CardHeader,
  currencyDigits,
  DataTable,
  errorMessage,
  Field,
  formatDateTime,
  formatMoney,
  formatRelative,
  Input,
  KeyValue,
  LoadMore,
  Notice,
  PageHeader,
  RefreshFailed,
  Select,
  Skeleton,
  StatusBadge,
} from "@bitocard/admin-ui";
import { type BankAccount, type Payout, useBankAccountsQuery, useCreatePayoutMutation, usePayoutsInfiniteQuery, useSimulatePayoutMutation, usePublicCountryQuery, useWalletQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** "5,000.50" → minor units, or null when it is not a valid amount. */
function toMinor(value: string, currency: string) {
  const cleaned = value.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = currencyDigits(currency);
  if ((cleaned.split(".")[1] ?? "").length > digits) return null;
  return Math.round(Number(cleaned) * 10 ** digits);
}

const toMajor = (minor: number, currency: string) => (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
const accountLabel = (account: BankAccount) => `${account.bank_name} ····${account.account_number_last4}`;

function Withdraw({ accounts, sandbox }: { accounts: BankAccount[]; sandbox: boolean }) {
  const id = useId();
  const { membership } = useReseller();
  const wallet = useWalletQuery();
  const country = usePublicCountryQuery(membership.reseller.country ?? "", { skip: !membership.reseller.country });
  const holdDays = country.data?.payout_hold_days;
  const [create] = useCreatePayoutMutation();
  const [value, setValue] = useState("");
  const [accountId, setAccountId] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ amount: number; account: BankAccount } | null>(null);
  const [done, setDone] = useState<Payout | null>(null);
  const [now] = useState(() => Date.now());

  if (!wallet.data) return wallet.error ? <Notice tone="red">{errorMessage(wallet.error, "Could not load your wallet.")}</Notice> : <Skeleton className="h-64 w-full" />;
  const { currency, earnings, minimum_withdrawal: minimum, payouts_in_progress: inProgress } = wallet.data;
  const chosen = accounts.find(item => item.id === (accountId || accounts[0]?.id));
  const coolingOff = chosen && !sandbox && new Date(chosen.payouts_available_from).getTime() > now;
  const canWithdraw = earnings.withdrawable >= minimum && earnings.withdrawable > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setDone(null);
    const amount = toMinor(value, currency);
    if (amount === null || amount <= 0) return setInvalid("Enter an amount, for example 5000.");
    if (amount < minimum) return setInvalid(`The smallest withdrawal is ${formatMoney(minimum, currency)}.`);
    if (amount > earnings.withdrawable) return setInvalid(`You can withdraw up to ${formatMoney(earnings.withdrawable, currency)}.`);
    if (!chosen) return setInvalid("Choose a bank account.");
    setInvalid(null);
    setConfirm({ amount, account: chosen });
  };

  return (
    <Card className="p-5 sm:p-6">
      {wallet.error && !wallet.isFetching ? <RefreshFailed message={errorMessage(wallet.error, "Could not load your wallet.")} onRetry={wallet.refetch} /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Withdraw earnings</h2>
            <p className="mt-0.5 text-sm text-muted">Only earnings past the payout hold can be withdrawn. Top-up funds stay in your wallet to pay for orders.</p>
          </div>
          <KeyValue
            items={[
              { label: "Withdrawable now", value: <span className="text-lg font-bold">{formatMoney(earnings.withdrawable, currency)}</span> },
              { label: "Smallest withdrawal", value: formatMoney(minimum, currency) },
              ...(holdDays !== undefined ? [{ label: "Payout hold", value: holdDays === 1 ? "1 day after each sale" : `${holdDays} days after each sale` }] : []),
              {
                label: "On hold",
                value: earnings.next_release_at
                  ? `${formatMoney(earnings.on_hold, currency)}, next release ${formatRelative(earnings.next_release_at)}`
                  : formatMoney(earnings.on_hold, currency),
              },
              { label: "On the way to your bank", value: formatMoney(inProgress, currency) },
            ]}
          />
          <p className="text-xs text-muted">Profit from each sale is held for a period set for your country before it can be withdrawn.</p>
        </div>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {done ? (
            <Notice tone="green" title="Withdrawal requested">
              {`${formatMoney(done.amount, done.currency)} is on its way. ${sandbox ? "Mark it as paid or failed in the list below." : "We email the owner when the bank confirms it."}`}
            </Notice>
          ) : null}
          {!canWithdraw ? (
            <Notice tone="grey">{`You need at least ${formatMoney(minimum, currency)} in withdrawable earnings to withdraw.`}</Notice>
          ) : null}
          <Field label="Pay to" htmlFor={`${id}-account`}>
            <Select id={`${id}-account`} value={chosen?.id ?? ""} onChange={event => setAccountId(event.target.value)}>
              {accounts.map(item => (
                <option key={item.id} value={item.id}>
                  {`${accountLabel(item)} (${item.account_name})`}
                </option>
              ))}
            </Select>
          </Field>
          {coolingOff && chosen ? <Notice tone="amber">{`Withdrawals to this new account start ${formatDateTime(chosen.payouts_available_from)}.`}</Notice> : null}
          <Field label={`Amount (${currency})`} htmlFor={`${id}-amount`} error={invalid ?? undefined}>
            <div className="flex gap-2">
              <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" placeholder="5000" value={value} onChange={event => setValue(event.target.value)} aria-invalid={invalid ? true : undefined} />
              <Button type="button" variant="ghost" onClick={() => setValue(toMajor(earnings.withdrawable, currency))} disabled={!canWithdraw}>
                All
              </Button>
            </div>
          </Field>
          <Button type="submit" className="w-full sm:w-auto" icon={<ArrowDownToLine className="size-4" aria-hidden />} disabled={!canWithdraw || !value.trim() || Boolean(coolingOff)}>
            Withdraw
          </Button>
        </form>
      </div>
      <ActionDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Confirm withdrawal"
        description={confirm ? `${formatMoney(confirm.amount, currency)} to ${accountLabel(confirm.account)}` : undefined}
        confirmLabel="Withdraw"
        requireReason={false}
        onConfirm={async () => {
          if (!confirm) return;
          const payout = await create({ amount: confirm.amount, bank_account_id: confirm.account.id }).unwrap();
          setValue("");
          setDone(payout);
        }}
      >
        {confirm ? (
          <p className="text-sm text-muted">
            {`The money goes to ${confirm.account.account_name}. A withdrawal cannot be cancelled once it starts; if the bank refuses it, the amount returns to your earnings.`}
          </p>
        ) : null}
      </ActionDialog>
    </Card>
  );
}

export default function PayoutsPage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "finance");
  const sandbox = mode === "test";
  const accounts = useBankAccountsQuery(undefined, { skip: !allowed });
  const payouts = usePayoutsInfiniteQuery(undefined, { skip: !allowed });
  const [simulate, simulateState] = useSimulatePayoutMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = payouts.data?.pages.flatMap(page => page.data);
  const list = accounts.data?.data;
  // Each payout names its account, even one removed since (the account list shows only current ones).
  const accountName = (row: Payout) => {
    if (row.bank_account) return `${row.bank_account.bank_name} ····${row.bank_account.account_number_last4}${row.bank_account.removed ? " (removed)" : ""}`;
    const account = list?.find(item => item.id === row.bank_account_id);
    return account ? accountLabel(account) : "—";
  };

  const run = async (row: Payout, outcome: "paid" | "failed") => {
    setBusy(`${row.id}:${outcome}`);
    await simulate({ id: row.id, outcome })
      .unwrap()
      .catch(() => null);
    setBusy(null);
  };

  return (
    <ShqShell section="wallet" current="/wallet/payouts" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Withdrawals" }]}>
      <PageHeader title="Withdrawals" description="Pay your earnings out to your bank account." />
      {!allowed ? (
        <Notice tone="grey" title="No access to withdrawals">
          Only the owner and finance members can withdraw earnings.
        </Notice>
      ) : (
        <>
          {accounts.error && !accounts.isFetching && list ? <RefreshFailed message={errorMessage(accounts.error, "Could not load your bank accounts.")} onRetry={accounts.refetch} /> : null}
          {!list ? (
            accounts.error ? <Notice tone="red">{errorMessage(accounts.error, "Could not load your bank accounts.")}</Notice> : <Skeleton className="h-64 w-full" />
          ) : list.length === 0 ? (
            <Notice tone="blue" title="Add a payout bank account first">
              Withdrawals go to a bank account in your verified name or your business name.{" "}
              <Link href="/wallet/bank-accounts" className="font-semibold underline underline-offset-2">
                Add a bank account
              </Link>
            </Notice>
          ) : (
            <Withdraw accounts={list} sandbox={sandbox} />
          )}
          {simulateState.error ? <Notice tone="red">{errorMessage(simulateState.error)}</Notice> : null}
          <Card>
            <CardHeader title="Your withdrawals" description="Newest first." className="pb-4" />
            <DataTable<Payout>
              caption="Withdrawals"
              rows={rows}
              loading={payouts.isLoading}
              error={payouts.error ? errorMessage(payouts.error) : null}
              onRetry={payouts.refetch}
              rowKey={row => row.id}
              empty="No withdrawals yet."
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
                { key: "account", header: "To", cell: row => <span className="text-muted">{accountName(row)}</span>, hideOnMobile: true },
                { key: "created", header: "Requested", cell: row => <span className="whitespace-nowrap text-muted">{formatDateTime(row.created_at)}</span> },
                { key: "completed", header: "Completed", cell: row => <span className="whitespace-nowrap text-muted">{formatDateTime(row.completed_at)}</span>, hideOnMobile: true },
                ...(sandbox
                  ? [
                      {
                        key: "simulate",
                        header: "",
                        align: "right" as const,
                        cell: (row: Payout) =>
                          row.status === "pending" || row.status === "processing" ? (
                            <span className="inline-flex flex-wrap justify-end gap-2">
                              <Button size="sm" variant="secondary" icon={<CheckCircle2 className="size-4" aria-hidden />} loading={busy === `${row.id}:paid`} disabled={busy !== null} onClick={() => run(row, "paid")}>
                                Mark paid
                              </Button>
                              <Button size="sm" variant="ghost" icon={<XCircle className="size-4" aria-hidden />} loading={busy === `${row.id}:failed`} disabled={busy !== null} onClick={() => run(row, "failed")}>
                                Mark failed
                              </Button>
                            </span>
                          ) : null,
                      },
                    ]
                  : []),
              ]}
            />
            <LoadMore hasMore={payouts.hasNextPage} loading={payouts.isFetchingNextPage} onClick={() => payouts.fetchNextPage()} />
          </Card>
        </>
      )}
    </ShqShell>
  );
}
