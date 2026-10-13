import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ShieldCheck } from "lucide-react";
import { formatCrypto, type StoreWithdrawalPreview } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CryptoNav } from "@/components/app/crypto";
import { CreateWithdrawalForm } from "@/components/app/crypto-forms";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Review withdrawal" };

type Search = { asset?: string; chain?: string; address?: string; amount?: string };

/** The withdrawal exactly as it will be sent: the address, the amount, BitoCard's fee and the total. Nothing moves yet. */
export default async function ReviewWithdrawalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const valid = /^[A-Z0-9]{2,10}$/.test(params.asset ?? "") && /^[A-Z]{3,10}$/.test(params.chain ?? "") && /^[0-9a-f-]{36}$/.test(params.address ?? "") && /^\d+(\.\d+)?$/.test(params.amount ?? "");
  const preview = valid
    ? await customerApi<StoreWithdrawalPreview>("POST", "/v1/store/crypto/withdrawals", { asset: params.asset, chain: params.chain, address_id: params.address, amount: params.amount, preview: true })
    : null;
  const quote = preview?.ok ? preview.data : null;
  const back = `/account/crypto/withdraw?asset=${encodeURIComponent(params.asset ?? "")}&chain=${encodeURIComponent(params.chain ?? "")}`;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> Back
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-[#070f4c]">Review your withdrawal</h1>
      <CryptoNav current="/account/crypto/withdraw" />
      {quote ? (
        <section className={card} aria-label="Withdrawal details">
          <div className="flex items-center gap-3">
            <CoinBadge asset={quote.asset} size="size-12" />
            <div>
              <p className="text-sm text-slate-500">You send</p>
              <p className="font-display text-2xl font-extrabold">{formatCrypto(quote.amount, quote.asset)}</p>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-slate-100 text-sm">
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">Network</dt>
              <dd className="font-semibold">{quote.network}</dd>
            </div>
            <div className="py-2.5">
              <dt className="text-slate-500">To</dt>
              <dd className="mt-1 font-mono text-sm break-all">{quote.address}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">BitoCard network fee</dt>
              <dd className="font-semibold">{formatCrypto(quote.fee, quote.asset)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">Taken from your wallet</dt>
              <dd className="font-bold">{formatCrypto(quote.total, quote.asset)}</dd>
            </div>
          </dl>
          {quote.needs_approval ? (
            <p className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              BitoCard checks this withdrawal before it is sent. It stays out of your wallet meanwhile, and comes back if it is not sent.
            </p>
          ) : null}
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Check the address: once sent, crypto cannot be got back.
          </p>
          <div className="mt-4">
            <CreateWithdrawalForm asset={quote.asset} chain={quote.chain} addressId={params.address!} amount={params.amount!} nonce={randomUUID()} />
          </div>
        </section>
      ) : (
        <div className={card} role="alert">
          <p className="font-semibold">This withdrawal cannot be made</p>
          <p className="mt-1 text-sm text-slate-600">{preview && !preview.ok ? preview.message : "Check the amount and address and try again."}</p>
          <Link href={back} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#ff2382] px-4 font-semibold text-white hover:bg-[#e8116d]">
            Back to withdraw
          </Link>
        </div>
      )}
    </div>
  );
}
