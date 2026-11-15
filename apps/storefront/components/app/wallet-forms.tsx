"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Landmark, Plus, Trash2, X } from "lucide-react";
import { formatFace, walletName, type StorePaymentMethod, type StoreWallet, type StoreWalletCurrencyOption } from "@bitocard/api-client/storefront";
import { FormMessage, Submit, TextField } from "@/components/store/account-forms";
import type { FormState } from "@/lib/account-actions";
import { addWallet, type ConversionState, convertWallets, openBankAccount, removeWallet, simulateDeposit, topUpWallet } from "@/lib/wallet";

/** Topping the wallet up: an amount, then the payment page of the method chosen. */
export function TopUpForm({ currency, primary = true, methods, amount, sandbox }: { currency: string; primary?: boolean; methods: StorePaymentMethod[]; amount?: string; sandbox: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(topUpWallet, {});
  return (
    <form action={action} className="space-y-4" aria-label="Top up your wallet">
      <FormMessage state={state} />
      {primary ? null : <input type="hidden" name="currency" value={currency} />}
      <TextField label={`Amount (${currency})`} name="amount" inputMode="decimal" required defaultValue={amount} state={state} hint="Spent only in this store. Wallet money cannot be withdrawn." />
      {methods.length ? (
        <fieldset>
          <legend className="text-sm font-semibold">Pay with</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {methods.map((method, index) => (
              <label key={method.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-pink-50">
                <input type="radio" name="method" value={method.id} defaultChecked={index === 0} className="mt-1 accent-brand-500" />
                <span>
                  <span className="block text-sm font-semibold">{method.label}</span>
                  <span className="block text-xs text-slate-500">{method.description}</span>
                  {method.networks.length ? (
                    <span className="mt-1.5 flex flex-wrap gap-1" aria-label={`Networks: ${method.networks.join(", ")}`}>
                      {method.networks.map(network => (
                        <span key={network} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {network}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : sandbox ? null : (
        <p className="text-sm text-slate-600">{primary ? "Card and mobile money top-ups are not open in your country yet." : `Top-ups of your ${walletName(currency)} are not open yet.`}</p>
      )}
      <Submit pending={pending} className="w-full sm:w-auto">
        <Plus className="size-4" aria-hidden="true" /> {sandbox ? "Add test money" : "Continue to payment"}
      </Submit>
    </form>
  );
}

/** Opening the customer's own bank account number (Nigeria asks for the BVN, which goes to the bank only). */
export function BankAccountForm({ needsBvn }: { needsBvn: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(openBankAccount, {});
  return (
    <form action={action} className="space-y-4" aria-label="Get a bank account number">
      <FormMessage state={state} />
      {needsBvn ? (
        <TextField label="BVN" name="bvn" inputMode="numeric" pattern="\d{11}" maxLength={11} required state={state} hint="The bank needs your BVN to open the account. We pass it on and do not keep it." />
      ) : null}
      <Submit pending={pending} className="w-full sm:w-auto">
        <Landmark className="size-4" aria-hidden="true" /> Get my account number
      </Submit>
    </form>
  );
}

/** The bank account popup's ID: one popup, opened from the wallet card and from Add funds. */
const bankDialogId = "wallet-bank-account";

/** Opens the bank account popup (closing Add funds first, when it is asked from there). */
function openBankDialog(from?: HTMLDialogElement | null) {
  from?.close();
  (document.getElementById(bankDialogId) as HTMLDialogElement | null)?.showModal();
}

/** The link that opens the bank account popup: "Get a free account number". */
export function BankAccountLink({ tone = "dark", from }: { tone?: "dark" | "light"; from?: () => HTMLDialogElement | null }) {
  return (
    <button
      type="button"
      onClick={() => openBankDialog(from?.())}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold underline-offset-2 hover:underline ${tone === "light" ? "text-pink-200 hover:text-white" : "text-brand-500"}`}
    >
      <Landmark className="size-4" aria-hidden="true" /> Get a free account number
    </button>
  );
}

/**
 * The customer's own bank account number: a popup with the BVN form where needed (Nigeria; passed to the bank, never
 * kept). Rendered once on the wallet page; `BankAccountLink` opens it.
 */
export function BankAccountDialog({ needsBvn }: { needsBvn: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <dialog
      ref={dialog}
      id={bankDialogId}
      aria-labelledby={`${bankDialogId}-title`}
      onClick={event => event.target === dialog.current && dialog.current?.close()}
      className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-900/50"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 id={`${bankDialogId}-title`} className="flex items-center gap-2 text-lg font-bold">
          <Landmark className="size-5" aria-hidden="true" /> Your own account number
        </h2>
        <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="grid size-11 place-items-center rounded-xl hover:bg-slate-50">
          <X className="size-6" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-4 p-5">
        <p className="text-sm text-slate-600">A bank account number in your name, free. Transfer to it from any bank app and the money is added to your wallet once it arrives.</p>
        <BankAccountForm needsBvn={needsBvn} />
      </div>
    </dialog>
  );
}

/**
 * "Add funds" beside the balance: a popup (native dialog: Escape and the backdrop close it, focus stays inside) to top
 * up by card or mobile money through a payment page. Where the market offers bank account numbers it also shows the
 * customer's (to transfer to), or the link to get one. Opens by itself when the customer came to top up for a purchase.
 */
export function AddFunds({ wallet, amount, open = false }: { wallet: StoreWallet; amount?: string; open?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const sandbox = wallet.mode === "test";
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600"
      >
        <Plus className="size-5" aria-hidden="true" /> Add funds
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="add-funds-title"
        onClick={event => event.target === dialog.current && dialog.current?.close()}
        className="m-auto max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-900/50"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 id="add-funds-title" className="text-lg font-bold">
            {wallet.wallets.length > 1 ? `Add to your ${walletName(wallet.currency)}` : "Add funds"}
          </h2>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="grid size-11 place-items-center rounded-xl hover:bg-slate-50">
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-6 p-5">
          <TopUpForm currency={wallet.currency} primary={wallet.wallets.find(item => item.currency === wallet.currency)?.primary ?? true} methods={wallet.top_up_methods} amount={amount} sandbox={sandbox} />
          {wallet.reserved_accounts_available ? (
            <section aria-labelledby="add-bank" className="border-t border-slate-100 pt-5">
              <h3 id="add-bank" className="mb-1 flex items-center gap-2 font-semibold">
                <Landmark className="size-5" aria-hidden="true" /> Bank transfer
              </h3>
              {wallet.reserved_accounts.length ? (
                <>
                  <p className="mb-3 text-sm text-slate-600">Transfer to your account number from any bank app: the money is added to your wallet once it arrives.</p>
                  <ul className="space-y-3">
                    {wallet.reserved_accounts.map(account => (
                      <li key={account.id} className="rounded-2xl bg-slate-50 p-4">
                        <p className="font-display text-2xl font-extrabold tracking-wide">{account.account_number}</p>
                        <p className="text-sm text-slate-600">
                          {account.bank_name} · {account.account_name}
                        </p>
                        {sandbox ? (
                          <form action={simulateDeposit} className="mt-3 flex flex-wrap items-center gap-2">
                            <input type="hidden" name="id" value={account.id} />
                            <input name="amount" defaultValue="5000" inputMode="decimal" aria-label="Test transfer amount" className="min-h-10 w-28 rounded-xl border border-slate-200 bg-white px-3" />
                            <button type="submit" className="min-h-10 rounded-xl bg-white px-3 font-semibold ring-1 ring-slate-200 hover:ring-slate-300">
                              Simulate a transfer
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="mb-2 text-sm text-slate-600">Prefer to pay by bank transfer? Get an account number of your own, free.</p>
                  <BankAccountLink from={() => dialog.current} />
                </>
              )}
            </section>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

const dialogClass = "m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-900/50";

/** A dialog's header with its title and Close. */
function DialogHead({ id, title, onClose }: { id: string; title: React.ReactNode; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
      <h2 id={id} className="flex items-center gap-2 text-lg font-bold">
        {title}
      </h2>
      <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center rounded-xl hover:bg-slate-50">
        <X className="size-6" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Why a currency cannot be added yet, in words. */
const optionReason = (reason: string | null) => (reason === "rate_unavailable" ? "Paused just now" : "Not open yet");

/**
 * "Add wallet": a wallet in the currency of another market BitoCard opened for it. Each is topped up with that market's
 * own methods, and pays for anything at BitoCard's rate, shown before paying. Shown only while there is one to add.
 */
export function AddWallet({ options }: { options: StoreWalletCurrencyOption[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(addWallet, {});
  if (!options.length) return null;
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand-500 ring-1 ring-slate-200 hover:ring-slate-300">
        <Plus className="size-4" aria-hidden="true" /> Add wallet
      </button>
      <dialog ref={dialog} aria-labelledby="add-wallet-title" onClick={event => event.target === dialog.current && dialog.current?.close()} className={dialogClass}>
        <DialogHead id="add-wallet-title" title="Add a wallet" onClose={() => dialog.current?.close()} />
        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-600">Hold money in another currency. Top it up with that country&apos;s payment methods, move money into it, and pay from it anywhere in the store. Like every wallet, it is spent only here and never withdrawn.</p>
          <FormMessage state={state} />
          <ul className="space-y-2">
            {options.map(option => (
              <li key={option.currency} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{option.currency}</span>
                  <span className="block text-sm text-slate-500">{option.country_name}</span>
                </span>
                {option.available ? (
                  <form action={action}>
                    <input type="hidden" name="currency" value={option.currency} />
                    <Submit pending={pending}>Add</Submit>
                  </form>
                ) : (
                  <span className="text-sm text-slate-500">{optionReason(option.reason)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}

/** Removing the wallet shown: only an added one, only while it has nothing in it. */
export function RemoveWallet({ currency }: { currency: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(removeWallet, {});
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="currency" value={currency} />
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-600 hover:text-red-700 disabled:opacity-60">
        <Trash2 className="size-4" aria-hidden="true" /> Remove your {walletName(currency)}
      </button>
    </form>
  );
}

/**
 * "Move money" between the customer's wallets: the amount and the two wallets, then what arrives at BitoCard's rate
 * (shown first, `preview`), then Move, refused if the rate has moved against them since.
 */
export function MoveMoney({ wallet }: { wallet: StoreWallet }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ConversionState, FormData>(convertWallets, {});
  const others = wallet.wallets.filter(item => item.currency !== wallet.currency);
  const [to, setTo] = useState(others[0]?.currency ?? "");
  const [amount, setAmount] = useState("");
  // A quote stands only for what it was asked for; changing anything asks again.
  const [stale, setStale] = useState(false);
  const quote = state.quote && !stale ? state.quote : null;
  if (!others.length) return null;
  const balance = wallet.balance;
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-white/10 px-5 font-semibold text-white ring-1 ring-white/20 hover:bg-white/15">
        <ArrowLeftRight className="size-5" aria-hidden="true" /> Move money
      </button>
      <dialog ref={dialog} aria-labelledby="move-money-title" onClick={event => event.target === dialog.current && dialog.current?.close()} className={dialogClass}>
        <DialogHead id="move-money-title" title={<><ArrowLeftRight className="size-5" aria-hidden="true" /> Move money</>} onClose={() => dialog.current?.close()} />
        {state.done && !stale ? (
          <div className="space-y-4 p-5" role="status">
            <p className="font-semibold">Moved {formatFace(state.done.from.amount, state.done.from.currency)} to your {walletName(state.done.to.currency)}.</p>
            <p className="text-sm text-slate-600">{formatFace(state.done.to.amount, state.done.to.currency)} is there now.</p>
            <button type="button" onClick={() => { setStale(true); setAmount(""); dialog.current?.close(); }} className="inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
              Done
            </button>
          </div>
        ) : (
          <form action={action} onChange={() => setStale(true)} onSubmit={() => setStale(false)} className="space-y-4 p-5">
            <FormMessage state={stale ? {} : state} />
            <input type="hidden" name="from" value={wallet.currency} />
            <p className="text-sm text-slate-600">From your {walletName(wallet.currency)}: {formatFace(balance, wallet.currency)} available.</p>
            <TextField label={`Amount (${wallet.currency})`} name="amount" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} state={stale ? {} : state} />
            <label className="block">
              <span className="text-sm font-semibold">To</span>
              <select name="to" value={to} onChange={event => setTo(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3">
                {others.map(item => (
                  <option key={item.currency} value={item.currency}>
                    Your {walletName(item.currency)} ({formatFace(item.balance, item.currency)})
                  </option>
                ))}
              </select>
            </label>
            {quote ? (
              <div className="rounded-2xl bg-slate-50 p-4" aria-live="polite">
                <p className="text-sm text-slate-600">You get</p>
                <p className="font-display text-2xl font-extrabold">{formatFace(quote.to.amount, quote.to.currency)}</p>
                <p className="mt-1 text-xs text-slate-500">At our exchange rate, 1 {quote.from.currency} = {quote.rate} {quote.to.currency}. Spent only in this store; never withdrawn.</p>
                <input type="hidden" name="expected" value={quote.to.amount} />
              </div>
            ) : null}
            <Submit pending={pending} className="w-full sm:w-auto">
              {quote ? `Move ${formatFace(quote.from.amount, quote.from.currency)}` : "See what you get"}
            </Submit>
          </form>
        )}
      </dialog>
    </>
  );
}
