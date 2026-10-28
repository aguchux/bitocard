"use client";

import Image from "next/image";
import { createContext, type ReactNode, useActionState, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, Copy, Mail, Plus, QrCode, Send, Trash2, X } from "lucide-react";
import { CoinBadge } from "./coins";
import { Field, FormMessage, type FormState, type NonceFormState, Submit } from "./forms";

type Action<S> = (state: S, form: FormData) => Promise<S>;

/**
 * The money actions of the app the forms are in (its own server actions, over its own session): on-chain withdrawals.
 * The storefront's Crypto tab and BitoCard Crypto each give theirs (`moneyActions`).
 */
export type MoneyActions = {
  addWithdrawalAddress: Action<FormState>;
  removeWithdrawalAddress: Action<FormState>;
  reviewWithdrawal: Action<FormState>;
  createWithdrawal: Action<NonceFormState>;
  confirmWithdrawal: Action<FormState>;
  resendWithdrawalCode: Action<FormState>;
  cancelWithdrawal: Action<FormState>;
};

const Context = createContext<MoneyActions | null>(null);

/** Gives the money forms below the app's actions (in a server layout, passing its server actions). */
export function MoneyActionsProvider({ actions, children }: { actions: MoneyActions; children?: ReactNode }) {
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}

function useMoney() {
  const value = useContext(Context);
  if (!value) throw new Error("Money forms need a MoneyActionsProvider");
  return value;
}

const iconButton = "inline-flex size-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-red-700";
const focusRing = "focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700";

/** Copies text (an address) with one tap, saying so. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold text-navy-900 ring-1 ring-slate-300 hover:ring-slate-400"
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * One button that changes something (pause an ad, cancel a withdrawal, remove an account), with the API's reason
 * shown beside it when it is refused.
 */
export function ActionButton({
  action,
  fields,
  children,
  className,
  label,
}: {
  action: Action<FormState>;
  fields: Record<string, string>;
  children: ReactNode;
  className: string;
  /** The button's accessible name, when it shows only an icon. */
  label?: string;
}) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" disabled={pending} aria-label={label} className={`${className} disabled:opacity-60`}>
        {children}
      </button>
      {state.error ? (
        <p className="max-w-xs text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Removes a saved withdrawal address. */
export function RemoveAddressButton({ id, label }: { id: string; label: string }) {
  return (
    <ActionButton action={useMoney().removeWithdrawalAddress} fields={{ id }} label={`Remove ${label}`} className={iconButton}>
      <Trash2 className="size-4" aria-hidden="true" />
    </ActionButton>
  );
}

/** Cancels a withdrawal still waiting for its code or BitoCard's check (the coins come back). */
export function CancelWithdrawalButton({ id }: { id: string }) {
  return (
    <ActionButton action={useMoney().cancelWithdrawal} fields={{ id }} className="inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-slate-700 ring-1 ring-slate-300 hover:ring-slate-400">
      Cancel this withdrawal
    </ActionButton>
  );
}

/** Saves an address to withdraw to on a network: usable 24 hours after it is added. */
export function AddWithdrawalAddressForm({ chain, network }: { chain: string; network: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(useMoney().addWithdrawalAddress, {});
  return (
    <form action={action} className="space-y-3" aria-label="Add an address">
      <input type="hidden" name="chain" value={chain} />
      <FormMessage state={state} />
      <Field label={`${network} address`} name="address" autoComplete="off" spellCheck={false} required state={state} />
      <Field label="Name" name="label" maxLength={40} placeholder="My wallet" required state={state} hint="New addresses can be used 24 hours after you add them. We email you each time one is added." />
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> Save address
      </Submit>
    </form>
  );
}

/** Where and how much to send: the next step shows the fee and total before anything moves. */
export function WithdrawForm({ asset, chain, addresses, minimum }: { asset: string; chain: string; addresses: Array<{ id: string; label: string; address: string }>; minimum: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(useMoney().reviewWithdrawal, {});
  return (
    <form action={action} className="space-y-4" aria-label={`Send ${asset}`}>
      <input type="hidden" name="asset" value={asset} />
      <input type="hidden" name="chain" value={chain} />
      <FormMessage state={state} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-navy-900">Send to</legend>
        {addresses.map((item, index) => (
          <label key={item.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-slate-200 has-[:checked]:bg-pink-50 has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
            <input type="radio" name="address_id" value={item.id} defaultChecked={index === 0} className="accent-brand-500" />
            <span className="min-w-0">
              <span className="block font-semibold">{item.label}</span>
              <span className="block truncate font-mono text-xs text-slate-500">{item.address}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label={`Amount (${asset})`} name="amount" inputMode="decimal" required state={state} hint={`At least ${minimum} ${asset}. BitoCard's network fee is added on top.`} />
      <Submit pending={pending} className="w-full">
        <Send className="size-4" aria-hidden="true" /> Review withdrawal
      </Submit>
    </form>
  );
}

/** Asks for the withdrawal the customer reviewed: the code to confirm it is emailed next. */
export function CreateWithdrawalForm({ asset, chain, addressId, amount, nonce }: { asset: string; chain: string; addressId: string; amount: string; nonce: string }) {
  const [state, action, pending] = useActionState<NonceFormState, FormData>(useMoney().createWithdrawal, {});
  return (
    <form action={action} className="space-y-3">
      {/* Sent as the Idempotency-Key, so a double tap asks once. */}
      <input type="hidden" name="nonce" value={state.nonce ?? nonce} />
      <input type="hidden" name="asset" value={asset} />
      <input type="hidden" name="chain" value={chain} />
      <input type="hidden" name="address_id" value={addressId} />
      <input type="hidden" name="amount" value={amount} />
      <FormMessage state={state} />
      <Submit pending={pending} className="w-full">
        <Mail className="size-4" aria-hidden="true" /> Email me the code to send it
      </Submit>
    </form>
  );
}

/** The 6-digit code from the email, which confirms the withdrawal; or a new code. */
export function WithdrawalCodeForm({ id }: { id: string }) {
  const { confirmWithdrawal, resendWithdrawalCode } = useMoney();
  const [state, action, pending] = useActionState<FormState, FormData>(confirmWithdrawal, {});
  const [resent, resend, resending] = useActionState<FormState, FormData>(resendWithdrawalCode, {});
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3" aria-label="Confirm the withdrawal">
        <input type="hidden" name="id" value={id} />
        <FormMessage state={state} />
        <Field label="Code from your email" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required state={state} />
        <Submit pending={pending} className="w-full">
          <Check className="size-4" aria-hidden="true" /> Confirm and send
        </Submit>
      </form>
      <form action={resend}>
        <input type="hidden" name="id" value={id} />
        <FormMessage state={resent} />
        <button type="submit" disabled={resending} className="inline-flex min-h-11 items-center font-semibold text-brand-500 hover:underline disabled:opacity-60">
          Send a new code
        </button>
      </form>
    </div>
  );
}

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
        <button type="button" onClick={show} aria-haspopup="dialog" className={`mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 ${focusRing}`}>
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
            <button type="button" onClick={close} className={`grid size-11 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-navy-900 ${focusRing}`} aria-label="Back to deposit">
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
            <button type="button" onClick={close} className={`grid size-11 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-navy-900 ${focusRing}`} aria-label="Close">
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

              <button type="button" onClick={close} className={`inline-flex min-h-11 items-center rounded-xl px-5 font-semibold text-slate-600 ring-1 ring-slate-300 hover:text-navy-900 hover:ring-slate-400 ${focusRing}`}>
                Done
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
