import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { formatFace, type StoreBankDeposit } from "@bitocard/api-client/storefront";
import { DepositSentForm } from "@/components/app/bank-deposit-forms";
import { DepositBadge } from "@/components/app/bank-deposit-status";
import { RefreshWhile } from "@/components/store/order-status";
import { CopyValue } from "@/components/store/vpn-access";
import { cancelBankDeposit } from "@/lib/bank-deposits";
import { currentCustomer, customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Bank deposit", robots: { index: false, follow: false } };

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));


function explain(deposit: StoreBankDeposit) {
  const amount = formatFace(deposit.amount, deposit.currency);
  switch (deposit.status) {
    case "awaiting_payment":
      return `Pay ${amount} into the account below, by cash at the bank or by transfer, writing the reference exactly. Then tell us you sent it.`;
    case "sent":
      return "We are checking our bank for your payment. It is added to your wallet once it arrives, usually within a working day.";
    case "credited":
      return `${formatFace(deposit.credited_amount ?? deposit.amount, deposit.currency)} was added to your wallet.`;
    case "rejected":
      return "We could not add this to your wallet.";
    case "cancelled":
      return "You cancelled this deposit.";
    case "expired":
      return "You did not tell us you paid in time, so this request ended. If you did pay, contact us with the reference.";
  }
}

/** One bank deposit: where to pay and the reference while it waits, "I've sent it", then what we found. */
export default async function BankDepositPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await currentCustomer();
  if (!customer) redirect(`/signin?next=${encodeURIComponent(`/account/wallet/deposits/${id}`)}`);
  const result = await customerApi<StoreBankDeposit>("GET", `/v1/store/wallet/bank-deposits/${encodeURIComponent(id)}`);
  if (!result.ok) notFound();
  const deposit = result.data;
  const waiting = deposit.status === "awaiting_payment";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RefreshWhile active={deposit.status === "sent"} everyMs={30_000} />
      <Link href="/account/wallet" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Wallet
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{formatFace(deposit.amount, deposit.currency)} by bank deposit</h1>
          <p className="mt-1 text-slate-500">
            {deposit.number} · started {when(deposit.created_at)}
          </p>
        </div>
        <DepositBadge status={deposit.status} size="md" />
      </div>

      <div className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
        <p className="text-slate-700">{explain(deposit)}</p>
        {deposit.status === "rejected" && deposit.decision_note ? <p className="font-semibold text-red-800">{deposit.decision_note}</p> : null}
        {waiting || deposit.status === "sent" ? (
          <>
            <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-navy-900">{deposit.account.bank_name}</span> · {deposit.account.account_name}
              </p>
              <CopyValue label="Account number" value={deposit.account.account_number} />
              <CopyValue label="Reference" value={deposit.reference} />
              <CopyValue label="Amount" value={(deposit.amount / 100).toFixed(2)} />
              {deposit.account.details ? <p className="text-sm whitespace-pre-line text-slate-600">{deposit.account.details}</p> : null}
            </div>
            {waiting ? (
              <>
                <p role="note" className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Write <span className="font-semibold">{deposit.reference}</span> as the depositor&apos;s reference or the transfer&apos;s description, so we can match it to you. Pay exactly{" "}
                    {formatFace(deposit.amount, deposit.currency)}, by {when(deposit.expires_at)}.
                  </span>
                </p>
                <ol className="list-decimal space-y-1.5 rounded-2xl bg-slate-50 p-4 pl-9 text-sm">
                  <li>Pay cash in at any branch of {deposit.account.bank_name}, or transfer from your bank app.</li>
                  <li>Use the reference above, and keep the slip or the transfer&apos;s receipt.</li>
                  <li>Come back here and press <span className="font-semibold">I&apos;ve sent it</span>.</li>
                </ol>
                <DepositSentForm id={deposit.id} name={customer.name} />
                <form action={cancelBankDeposit}>
                  <input type="hidden" name="id" value={deposit.id} />
                  <button type="submit" className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300">
                    Cancel this deposit
                  </button>
                </form>
              </>
            ) : null}
          </>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500">Amount</dt>
            <dd className="font-display text-lg font-bold">{formatFace(deposit.amount, deposit.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Reference</dt>
            <dd className="font-display text-lg font-bold break-all">{deposit.reference}</dd>
          </div>
          {deposit.sent_at ? (
            <div>
              <dt className="text-sm text-slate-500">You said you paid</dt>
              <dd className="font-display text-lg font-bold">{when(deposit.sent_at)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
