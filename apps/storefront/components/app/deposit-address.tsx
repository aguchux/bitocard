"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, QrCode, X } from "lucide-react";
import { CoinBadge } from "@/components/app/crypto";
import { CopyButton } from "@/components/app/crypto-forms";

/** The address with its middle cut out, so the button's card shows it is ready without the whole string. */
const shortAddress = (address: string) => (address.length > 22 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address);

/**
 * The customer's deposit address once a network is chosen: a card with "Show wallet address", which opens it over the
 * whole screen (a native modal dialog: Escape and the close buttons shut it, focus stays inside), centred: the QR code
 * with the BitoCard mark in its middle (`addressQr` makes it at level H, so the mark never changes what it scans as),
 * the address in full with copy, then the network warning and how long it takes to arrive.
 */
export function DepositAddress({
  asset,
  network,
  token,
  address,
  contract,
  confirmations,
  qr,
}: {
  asset: string;
  network: string;
  token: string | null;
  address: string;
  contract: string | null;
  confirmations: number;
  qr: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // The page underneath must not scroll while the dialog covers it.
  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  const show = () => {
    dialog.current?.showModal();
    setOpen(true);
  };
  const close = () => dialog.current?.close();

  return (
    <>
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm" aria-labelledby="your-address">
        <div className="flex items-center gap-3">
          <CoinBadge asset={asset} />
          <div className="min-w-0 flex-1">
            <h2 id="your-address" className="font-bold">
              Your {asset} address on {network}
            </h2>
            <p className="truncate font-mono text-xs text-slate-500">{shortAddress(address)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={show}
          aria-haspopup="dialog"
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700"
        >
          <QrCode className="size-5" aria-hidden="true" /> Show wallet address
        </button>
      </section>

      <dialog
        ref={dialog}
        aria-labelledby="deposit-address-title"
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-slate-50 p-0 text-navy-900 backdrop:bg-navy-900/60"
      >
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-8">
            <button type="button" onClick={close} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-navy-900 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700" aria-label="Back to deposit">
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 id="deposit-address-title" className="truncate font-display text-lg leading-tight font-extrabold">
                Deposit {asset}
              </h2>
              <p className="truncate text-xs text-slate-500">
                {network}
                {token ? ` · ${token}` : ""}
              </p>
            </div>
            <button type="button" onClick={close} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-navy-900 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700" aria-label="Close">
              <X className="size-5" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8">
            <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-5 text-center">
              <div className="w-full rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 py-1 pr-3 pl-1 text-sm font-semibold ring-1 ring-slate-200">
                  <CoinBadge asset={asset} size="size-8" /> {asset} on {network}
                </span>
                {qr ? (
                  <div className="relative mx-auto mt-4 aspect-square w-full max-w-[17rem]">
                    <div role="img" aria-label={`QR code of your ${asset} address`} className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
                    {/* A fifth of the width (qrLogoShare), white pad included: the level H code still reads in full. */}
                    <span className="absolute top-1/2 left-1/2 grid size-[20%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[22%] bg-white p-[3%]" aria-hidden="true">
                      <Image src="/bitocard-mark.png" alt="" width={96} height={96} className="size-full object-contain" />
                    </span>
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">Scan it in the wallet you are sending from</p>
                <p className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 font-mono text-sm leading-relaxed break-all select-all">{address}</p>
                <div className="mt-3 flex justify-center">
                  <CopyButton text={address} label="Copy address" />
                </div>
              </div>

              <ul className="w-full space-y-2 text-left text-sm text-slate-700">
                <li className="flex gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-amber-900 ring-1 ring-amber-200/70">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Send only {asset} on {network}
                    {token ? ` (${token})` : ""}. Anything else sent here, or on another network, may be lost.
                  </span>
                </li>
                <li className="px-1">It arrives after {confirmations} confirmations on the network. This address stays yours.</li>
                {contract ? <li className="px-1 text-xs break-all text-slate-500">Token contract: {contract}</li> : null}
              </ul>

              <button type="button" onClick={close} className="inline-flex min-h-11 items-center rounded-xl px-5 font-semibold text-slate-600 ring-1 ring-slate-300 hover:text-navy-900 hover:ring-slate-400 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700">
                Done
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
