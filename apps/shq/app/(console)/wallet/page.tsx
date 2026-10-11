"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownToLine, ArrowLeftRight, Banknote, CircleDollarSign, Clock, CreditCard, Gift, Hourglass, Lock, Plus, Send, Wallet as WalletIcon } from "lucide-react";
import { Button, Card, CardHeader, cn, DataTable, ErrorState, errorMessage, formatDateTime, formatMoney, formatRelative, humanise, LoadMore, Notice, PageHeader, RefreshFailed, StatCard, StatusBadge } from "@bitocard/admin-ui";
import { type Chargeback, type WalletTransaction, useWalletChargebacksQuery, useWalletQuery, useWalletTransactionsInfiniteQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { ConvertDialog, walletName, WalletSwitch } from "@/components/wallets";

const primaryLink = "inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-600";
const secondaryLink = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-500 bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50";

/** A change to a balance, signed and coloured ("+NGN 5,000.00"). */
function Change({ amount, currency }: { amount: number; currency: string }) {
  if (amount === 0) return <span className="text-muted">—</span>;
  return <span className={cn("font-semibold tabular-nums", amount > 0 ? "text-emerald-700" : "text-ink")}>{`${amount > 0 ? "+" : ""}${formatMoney(amount, currency)}`}</span>;
}

/**
 * The payment page sends the payer back here (the API's payment return address) with the provider's own query
 * parameters: Flutterwave adds `status`, `tx_ref` and `transaction_id`; Monnify adds `paymentReference`. They are only
 * a hint: the wallet is credited once BitoCard confirms the payment with the provider.
 */
function PaymentReturn() {
  const search = useSearchParams();
  const router = useRouter();
  const status = search.get("status")?.toLowerCase();
  const returned = status || search.get("tx_ref") || search.get("paymentReference") || search.get("transaction_id");
  if (!returned) return null;
  const cancelled = status === "cancelled" || status === "canceled";
  const failed = status === "failed";
  const dismiss = (
    <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => router.replace("/wallet")}>
      Dismiss
    </Button>
  );
  if (cancelled || failed) {
    return (
      <Notice tone="amber" title={cancelled ? "Payment cancelled" : "Payment not completed"}>
        Nothing was added to your wallet. You can <Link href="/wallet/top-ups" className="font-semibold underline underline-offset-2">start a new top-up</Link> at any time.
        <div>{dismiss}</div>
      </Notice>
    );
  }
  return (
    <Notice tone="green" title="Thanks, we are confirming your payment">
      Your wallet is credited as soon as the payment provider confirms it, usually within a few minutes. Check its progress under{" "}
      <Link href="/wallet/top-ups" className="font-semibold underline underline-offset-2">Top-ups</Link>.
      <div>{dismiss}</div>
    </Notice>
  );
}

export default function WalletPage() {
  return (
    <Suspense fallback={null}>
      <Wallets />
    </Suspense>
  );
}

function Wallets() {
  const { membership, mode } = useReseller();
  const search = useSearchParams();
  const router = useRouter();
  const allowed = can(membership, "admin", "finance", "developer");
  // The country wallet unless `?currency=USD` chose the US dollar one.
  const asked = search.get("currency")?.toUpperCase() || undefined;
  const wallet = useWalletQuery(asked, { skip: !allowed });
  const chargebacks = useWalletChargebacksQuery(undefined, { skip: !allowed });
  const chargebackRows = chargebacks.data?.data ?? [];
  const holding = chargebackRows.some(row => row.payouts_on_hold);
  const data = wallet.data;
  const currency = data?.currency ?? "";
  const transactions = useWalletTransactionsInfiniteQuery(currency || undefined, { skip: !allowed || !currency });
  const rows = transactions.data?.pages.flatMap(page => page.data);
  const wallets = data?.wallets ?? [];
  const primary = wallets.find(item => item.primary)?.currency ?? currency;
  const dollars = Boolean(data) && currency !== primary;
  const other = wallets.find(item => item.currency !== currency)?.currency;
  const [converting, setConverting] = useState(false);
  const choose = (code: string) => router.replace(code === primary ? "/wallet" : `/wallet?currency=${code}`, { scroll: false });
  const money = (minor: number | undefined) => (data && minor !== undefined ? formatMoney(minor, currency) : "—");
  const loading = wallet.isLoading;

  return (
    <ShqShell section="wallet" current="/wallet" crumbs={[{ label: "Wallet", href: "/wallet" }, { label: "Balance" }]}>
      <PageHeader
        title="Wallet"
        description={
          mode === "test"
            ? "Sandbox balances: test money only."
            : "Your wallets: your country's currency and US dollars. Orders are paid from your country wallet, topped up from the US dollar wallet when it runs short."
        }
        actions={
          <>
            {can(membership, "admin", "finance") ? (
              <Link href={dollars ? `/wallet/top-ups?currency=${currency}` : "/wallet/top-ups"} className={primaryLink}>
                <Plus className="size-4" aria-hidden />
                Top up
              </Link>
            ) : null}
            {can(membership, "admin", "finance") && other && data ? (
              <Button variant="secondary" icon={<ArrowLeftRight className="size-4" aria-hidden />} onClick={() => setConverting(true)}>
                Convert
              </Button>
            ) : null}
            {can(membership, "finance") && !dollars ? (
              <Link href="/wallet/payouts" className={secondaryLink}>
                <ArrowDownToLine className="size-4" aria-hidden />
                Withdraw
              </Link>
            ) : null}
          </>
        }
      />
      <PaymentReturn />
      {data && other ? <ConvertDialog open={converting} onClose={() => setConverting(false)} from={currency} to={other} available={data.available} /> : null}

      {!allowed ? (
        <Notice tone="grey" title="No access to the wallet">
          Your role ({humanise(membership.role)}) cannot see the wallet. Ask the account owner if you need it.
        </Notice>
      ) : wallet.error && !data ? (
        <Card>
          <ErrorState message={errorMessage(wallet.error, "Could not load your wallet.")} onRetry={wallet.refetch} />
        </Card>
      ) : (
        <>
          {wallet.error && !wallet.isFetching ? <RefreshFailed message={errorMessage(wallet.error, "Could not load your wallet.")} onRetry={wallet.refetch} /> : null}
          <WalletSwitch wallets={wallets} value={currency} onChange={choose} />
          {dollars ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label={`Available in your ${walletName(currency)}`}
                value={money(data?.available)}
                icon={<CircleDollarSign aria-hidden />}
                tone="blue"
                loading={loading}
                footer={<p className="text-xs text-muted">{`Top up by card in dollars. Converted into your ${primary} wallet when an order needs it, or by hand with Convert. Cannot be withdrawn.`}</p>}
              />
              <StatCard
                label="Reserved for orders"
                value={money(data?.reserved)}
                icon={<Lock aria-hidden />}
                tone="violet"
                loading={loading}
                footer={<p className="text-xs text-muted">Orders are held from your country wallet.</p>}
              />
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Available to spend"
              value={money(data?.available)}
              icon={<WalletIcon aria-hidden />}
              loading={loading}
              footer={<p className="text-xs text-muted">Top-up funds plus withdrawable earnings. Pays the wholesale cost of orders.</p>}
            />
            <StatCard
              label="Top-up funds"
              value={money(data ? data.available - data.earnings.withdrawable : undefined)}
              icon={<CircleDollarSign aria-hidden />}
              tone="blue"
              loading={loading}
              footer={<p className="text-xs text-muted">For paying orders. Top-ups cannot be withdrawn.</p>}
            />
            <StatCard
              label="Withdrawable earnings"
              value={money(data?.earnings.withdrawable)}
              icon={<Banknote aria-hidden />}
              tone="green"
              loading={loading}
              footer={<p className="text-xs text-muted">{data && data.minimum_withdrawal !== null ? `Smallest withdrawal: ${formatMoney(data.minimum_withdrawal, currency)}.` : null}</p>}
            />
            <StatCard
              label="Earnings on hold"
              value={money(data?.earnings.on_hold)}
              icon={<Hourglass aria-hidden />}
              tone="amber"
              loading={loading}
              footer={
                <p className="text-xs text-muted">
                  {data?.earnings.next_release_at
                    ? `Next release ${formatRelative(data.earnings.next_release_at)} (${formatDateTime(data.earnings.next_release_at)}).`
                    : "Profit from each sale becomes withdrawable after the payout hold."}
                </p>
              }
            />
            <StatCard
              label="Reserved for orders"
              value={money(data?.reserved)}
              icon={<Lock aria-hidden />}
              tone="violet"
              loading={loading}
              footer={<p className="text-xs text-muted">Held while orders are in progress; released if an order fails.</p>}
            />
            <StatCard
              label="Withdrawals in progress"
              value={money(data?.payouts_in_progress)}
              icon={<Send aria-hidden />}
              tone="pink"
              loading={loading}
              footer={<p className="text-xs text-muted">On their way to your bank account.</p>}
            />
          </div>
          )}

          {chargebackRows.length ? (
            <Card>
              <CardHeader
                title="Chargebacks"
                description={
                  holding
                    ? "A cardholder disputed a card payment with their bank. Its amount is held from your wallet and withdrawals wait until the card network decides."
                    : "Card payments cardholders disputed (chargebacks)."
                }
                className="pb-4"
              />
              <DataTable<Chargeback>
                caption="Chargebacks"
                rows={chargebackRows}
                rowKey={row => row.id}
                empty="No chargebacks."
                columns={[
                  {
                    key: "dispute",
                    header: "Chargeback",
                    cell: row => (
                      <span className="inline-flex items-center gap-2">
                        <CreditCard className="size-4 text-muted" aria-hidden />
                        <span title={formatDateTime(row.opened_at)}>{`Opened ${formatRelative(row.opened_at)}`}</span>
                      </span>
                    ),
                  },
                  { key: "amount", header: "Amount", align: "right", cell: row => <span className="font-semibold">{formatMoney(row.amount, row.currency)}</span> },
                  {
                    key: "held",
                    header: "Your wallet",
                    cell: row => (
                      <span className="text-xs text-muted">
                        {row.protected
                          ? "Covered by chargeback protection"
                          : row.status === "won"
                            ? "Hold returned"
                            : `${row.status === "lost" ? "Returned to the cardholder" : "Held"}: ${formatMoney(row.held, row.currency)}${row.shortfall ? ` (short ${formatMoney(row.shortfall, row.currency)})` : ""}`}
                      </span>
                    ),
                    hideOnMobile: true,
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: row => (
                      <div className="space-y-0.5">
                        <StatusBadge status={row.status} />
                        {row.payouts_on_hold ? <p className="text-xs text-muted">Withdrawals wait</p> : null}
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}

          {data?.startup_allowance ? (
            <Card className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Gift className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  Startup allowance:{" "}
                  {data.startup_allowance.status === "revoked"
                    ? "ended"
                    : `${formatMoney(data.startup_allowance.remaining, "USD")} of ${formatMoney(data.startup_allowance.granted, "USD")} left`}
                </p>
                <p className="text-xs text-muted">
                  Pays BitoCard&apos;s wholesale cost on orders your customers pay through BitoCard checkout. It is not cash: it cannot be spent directly, withdrawn or transferred, and it does not refill.
                </p>
              </div>
              <StatusBadge status={data.startup_allowance.status} />
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Transactions" description={`Every change to your ${currency ? walletName(currency) : "wallet"}, newest first.`} className="pb-4" />
            <DataTable<WalletTransaction>
              caption="Wallet transactions"
              rows={rows}
              loading={transactions.isLoading}
              error={transactions.error ? errorMessage(transactions.error) : null}
              onRetry={transactions.refetch}
              rowKey={row => row.id}
              empty="No transactions yet. Top up your wallet to get started."
              columns={[
                {
                  key: "description",
                  header: "Description",
                  cell: row => (
                    <span className="break-words">
                      {row.description}
                      {row.conversion ? (
                        <span className="block text-xs text-muted">{`${formatMoney(row.conversion.from.amount, row.conversion.from.currency)} → ${formatMoney(row.conversion.to.amount, row.conversion.to.currency)}`}</span>
                      ) : null}
                    </span>
                  ),
                },
                { key: "type", header: "Type", cell: row => <span className="text-muted">{humanise(row.type)}</span>, hideOnMobile: true },
                {
                  key: "amount",
                  header: "Available",
                  align: "right",
                  cell: row =>
                    row.allowance_change ? (
                      // Startup allowance entries change the allowance (US dollars), never the money available.
                      <span className="inline-flex flex-col items-end">
                        <Change amount={row.allowance_change} currency="USD" />
                        <span className="text-xs text-muted">Startup allowance</span>
                      </span>
                    ) : (
                      <Change amount={row.amount} currency={row.currency ?? currency} />
                    ),
                },
                { key: "reserved", header: "Reserved", align: "right", cell: row => <Change amount={row.reserved_change} currency={row.currency ?? currency} />, hideOnMobile: true },
                { key: "held", header: "On hold", align: "right", cell: row => <Change amount={row.earnings_on_hold_change} currency={row.currency ?? currency} />, hideOnMobile: true },
                {
                  key: "when",
                  header: "When",
                  cell: row => (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted">
                      <Clock className="size-3.5" aria-hidden />
                      {formatDateTime(row.created_at)}
                    </span>
                  ),
                },
              ]}
            />
            <LoadMore hasMore={transactions.hasNextPage} loading={transactions.isFetchingNextPage} onClick={() => transactions.fetchNextPage()} />
          </Card>
        </>
      )}
    </ShqShell>
  );
}
