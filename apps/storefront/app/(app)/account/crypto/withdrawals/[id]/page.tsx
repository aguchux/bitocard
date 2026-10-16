import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { formatCrypto, type StoreCryptoWithdrawal } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CryptoNav, date, withdrawalStatus } from "@/components/app/crypto";
import { ActionButton, CopyButton, WithdrawalCodeForm } from "@/components/app/crypto-forms";
import { cancelWithdrawal } from "@/lib/crypto-actions";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Withdrawal" };

const explain: Partial<Record<StoreCryptoWithdrawal["status"], string>> = {
  awaiting_code: "Enter the code we emailed you to send it. It is taken out of your wallet until you confirm or cancel.",
  review: "BitoCard checks this withdrawal before it is sent. You can cancel it until then.",
  queued: "It is being sent.",
  submitting: "It is being sent.",
  broadcast: "It is on the network, waiting for confirmations.",
  completed: "It is confirmed on the network.",
  failed: "It could not be sent. The coins are back in your wallet.",
  rejected: "It was not approved. The coins are back in your wallet.",
  cancelled: "It was cancelled. The coins are back in your wallet.",
};

/** One withdrawal: what was sent where, its status, and (while it waits) the code to confirm it or a way to cancel. */
export default async function WithdrawalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const result = await customerApi<StoreCryptoWithdrawal>("GET", `/v1/store/crypto/withdrawals/${id}`);
  if (!result.ok) notFound();
  const item = result.data;
  const open = item.status === "awaiting_code" || item.status === "review";

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href={`/account/crypto/withdraw?asset=${item.asset}&chain=${item.chain}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Withdraw
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Withdrawal {item.number}</h1>
      <CryptoNav current="/account/crypto/withdraw" />
      <section className={card} aria-label="Withdrawal details">
        <div className="flex items-center gap-3">
          <CoinBadge asset={item.asset} size="size-12" />
          <div>
            <p className="text-sm text-slate-500">{withdrawalStatus[item.status]}</p>
            <p className="font-display text-2xl font-extrabold">{formatCrypto(item.amount, item.asset)}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">{explain[item.status]}</p>
        <dl className="mt-3 divide-y divide-slate-100 text-sm">
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">Network</dt>
            <dd className="font-semibold">{item.network}</dd>
          </div>
          <div className="py-2.5">
            <dt className="text-slate-500">To</dt>
            <dd className="mt-1 font-mono text-sm break-all">{item.address}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">Fee</dt>
            <dd className="font-semibold">{formatCrypto(item.fee, item.asset)}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">Asked for</dt>
            <dd>{date(item.created_at)}</dd>
          </div>
          {item.tx_hash ? (
            <div className="py-2.5">
              <dt className="text-slate-500">Transaction</dt>
              <dd className="mt-1 font-mono text-xs break-all">{item.tx_hash}</dd>
              <dd className="mt-2">
                <CopyButton text={item.tx_hash} label="Copy transaction" />
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      {item.status === "awaiting_code" ? (
        <section className={card} aria-label="Confirm">
          <WithdrawalCodeForm id={item.id} />
        </section>
      ) : null}
      {open ? (
        <ActionButton action={cancelWithdrawal} fields={{ id: item.id }} className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-slate-700 ring-1 ring-slate-300 hover:ring-slate-400">
          Cancel this withdrawal
        </ActionButton>
      ) : null}
    </div>
  );
}
