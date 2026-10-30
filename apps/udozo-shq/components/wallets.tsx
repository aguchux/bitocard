"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowLeftRight } from "lucide-react";
import { amountToMinor, Button, cn, Dialog, errorMessage, Field, formatMoney, Input, Notice, useDebouncedValue } from "@bitocard/admin-ui";
import { type WalletConversion, type WalletSummary, useConvertWalletMutation } from "@bitocard/api-client/reseller";

/** "US dollars" for USD, otherwise the currency code. */
export const walletName = (currency: string) => (currency === "USD" ? "US dollar wallet" : `${currency} wallet`);

/**
 * The reseller's wallets side by side (their country's currency, then US dollars), each with what it can spend; the
 * chosen one is pressed. Choosing one shows its balances and transactions.
 */
export function WalletSwitch({ wallets, value, onChange }: { wallets: WalletSummary[]; value: string; onChange: (currency: string) => void }) {
  if (wallets.length < 2) return null;
  return (
    <div role="group" aria-label="Wallets" className="grid gap-3 sm:grid-cols-2">
      {wallets.map(wallet => {
        const active = wallet.currency === value;
        return (
          <button
            key={wallet.currency}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(wallet.currency)}
            className={cn(
              "flex min-h-16 items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-left transition",
              active ? "border-brand-500 ring-2 ring-brand-500/20" : "border-line hover:border-brand-300",
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{walletName(wallet.currency)}</span>
              <span className="block text-xs text-muted">{wallet.primary ? "Orders, earnings and withdrawals" : "Top up in dollars; converts for orders"}</span>
            </span>
            <span className="shrink-0 text-right text-lg font-bold tabular-nums text-ink">{formatMoney(wallet.available, wallet.currency)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Converts money from one wallet to the other at Udozo's rate: what arrives is previewed as the amount is typed
 * (`preview`, nothing moves), then converted on confirmation.
 */
export function ConvertDialog(props: { open: boolean; onClose: () => void; from: string; to: string; available: number }) {
  // Mounted only while open, so every opening starts empty.
  return props.open ? <Convert {...props} /> : null;
}

function Convert({ onClose, from, to, available }: { onClose: () => void; from: string; to: string; available: number }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [done, setDone] = useState<WalletConversion | null>(null);
  const [convert, state] = useConvertWalletMutation();
  const [preview, previewState] = useConvertWalletMutation();
  const [previewed, setPreviewed] = useState<WalletConversion | null>(null);
  const amount = amountToMinor(value.replace(/[,\s]/g, ""));
  const typed = useDebouncedValue(amount, 400);
  const tooMuch = amount !== null && amount > available;
  // The preview shown is the one for the amount typed now.
  const quote = previewed && typed !== null && previewed.from.amount === typed ? previewed : null;

  useEffect(() => {
    if (typed === null || typed <= 0) return;
    let live = true;
    preview({ from, to, amount: typed, preview: true })
      .unwrap()
      .then(result => {
        if (live) setPreviewed(result);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [typed, from, to, preview]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (amount === null || amount <= 0 || tooMuch) return;
    const result = await convert({ from, to, amount })
      .unwrap()
      .catch(() => null);
    if (result) setDone(result);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Convert to your ${walletName(to)}`}
      description="At Udozo's exchange rate. Converted money pays for orders; it cannot be withdrawn."
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={`${id}-form`} loading={state.isLoading} disabled={amount === null || amount <= 0 || tooMuch} icon={<ArrowLeftRight className="size-4" aria-hidden />}>
              Convert
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice tone="green" title="Converted">
          {`${formatMoney(done.from.amount, done.from.currency)} became ${formatMoney(done.to.amount, done.to.currency)}.`}
        </Notice>
      ) : (
        <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
          {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
          <Field
            label={`Amount (${from})`}
            htmlFor={`${id}-amount`}
            hint={`Your ${walletName(from)} has ${formatMoney(available, from)}.`}
            error={tooMuch ? "That is more than this wallet has." : undefined}
          >
            <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" placeholder="20" value={value} onChange={event => setValue(event.target.value)} aria-invalid={tooMuch || undefined} />
          </Field>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm" aria-live="polite">
            {quote ? (
              <>
                <p className="font-semibold text-ink">{`You get ${formatMoney(quote.to.amount, quote.to.currency)}`}</p>
                <p className="text-xs text-muted">{`Rate: ${to === "USD" ? from : to} ${Number(quote.rate).toLocaleString("en-GB", { maximumFractionDigits: 4 })} per US dollar`}</p>
              </>
            ) : previewState.error && typed ? (
              <p className="text-muted">{errorMessage(previewState.error, "Conversions are not available right now.")}</p>
            ) : (
              <p className="text-muted">Enter an amount to see what arrives.</p>
            )}
          </div>
        </form>
      )}
    </Dialog>
  );
}
