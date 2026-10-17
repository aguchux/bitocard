"use client";

import { useEffect, useId, useState } from "react";
import { MailCheck } from "lucide-react";
import { Button, CodeInput, Dialog, errorMessage, Field, formatDateTime, Input, KeyValue, Notice, resendWait, Select, Textarea } from "@bitocard/admin-ui";
import {
  type ExchangeReserves,
  type Mode,
  type ReserveMovement,
  useCancelReserveMovementMutation,
  useConfirmReserveMovementMutation,
  useRequestReserveMovementMutation,
  useResendReserveCodeMutation,
} from "@bitocard/api-client/admin";

/**
 * Funding or drawing down one of BitoCard's exchange reserves, in two steps as manual top-ups: the reserve, amount and
 * why; then the 6-digit code emailed to the admin. Money reserves are a market's; coin reserves are shared by all.
 */
export function ReserveMovementDialog({ open, onClose, kind, mode, reserves, onDone }: { open: boolean; onClose: () => void; kind: "fund" | "withdraw"; mode: Mode; reserves: ExchangeReserves; onDone: (movement: ReserveMovement) => void }) {
  const id = useId();
  const [reserve, setReserve] = useState<"crypto" | "fiat">("crypto");
  const [asset, setAsset] = useState(reserves.coins[0]?.asset ?? "");
  const [marketKey, setMarketKey] = useState(reserves.markets[0] ? `${reserves.markets[0].country}:${reserves.markets[0].currency}` : "");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<ReserveMovement | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [request] = useRequestReserveMovementMutation();
  const [confirm] = useConfirmReserveMovementMutation();
  const [resend] = useResendReserveCodeMutation();
  const [cancel] = useCancelReserveMovementMutation();

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const market = reserves.markets.find(item => `${item.country}:${item.currency}` === marketKey);
  const unit = reserve === "crypto" ? asset : (market?.currency ?? "");
  const needsReference = reserve === "fiat" && kind === "fund";
  const valid = /^\d+(\.\d+)?$/.test(amount.trim()) && Number(amount) > 0 && reason.trim().length >= 5 && (!needsReference || reference.trim().length > 0);
  const wait = pending ? resendWait(pending.code_sent_at, now) : 0;

  const close = () => {
    setPending(null);
    setCode("");
    setAmount("");
    setReference("");
    setReason("");
    setError(null);
    onClose();
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const verb = kind === "fund" ? "Fund" : "Draw down";
  return (
    <Dialog
      open={open}
      onClose={close}
      title={pending ? `Confirm ${pending.number}` : `${verb} a reserve`}
      description={pending ? "Enter the code we emailed you. Nothing moves until you do." : kind === "fund" ? "Put money or coins BitoCard already holds behind the exchange." : "Take money or coins out of the exchange, back to BitoCard's own balance."}
      footer={
        pending ? (
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await cancel(pending.id).unwrap();
                  close();
                })
              }
            >
              Cancel movement
            </Button>
            <Button
              loading={busy}
              disabled={code.length !== 6}
              onClick={() =>
                void run(async () => {
                  const done = await confirm({ id: pending.id, code }).unwrap();
                  onDone(done);
                  close();
                })
              }
            >
              {verb} {pending.amount} {pending.currency}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!valid}
              icon={<MailCheck className="size-4" aria-hidden />}
              onClick={() =>
                void run(async () =>
                  setPending(
                    await request({
                      mode,
                      kind,
                      reserve,
                      ...(reserve === "crypto" ? { asset } : { country: market?.country, currency: market?.currency }),
                      amount: amount.trim(),
                      ...(reference.trim() ? { external_reference: reference.trim() } : {}),
                      reason: reason.trim(),
                    }).unwrap(),
                  ),
                )
              }
            >
              Email me a code
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        {pending ? (
          <>
            <KeyValue
              items={[
                { label: "Reserve", value: pending.reserve === "fiat" ? `${pending.country} money (${pending.currency})` : `${pending.currency} coins` },
                { label: "Amount", value: `${pending.amount} ${pending.currency}${pending.mode === "test" ? " (sandbox)" : ""}` },
                { label: "Code expires", value: formatDateTime(pending.code_expires_at) },
              ]}
            />
            <div className="space-y-2 rounded-lg bg-canvas p-4">
              <p className="text-sm font-semibold text-ink">Code from the email</p>
              <CodeInput label="Code from the email" value={code} onChange={setCode} autoFocus disabled={busy} />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || wait > 0}
                  onClick={() =>
                    void run(async () => {
                      setPending(await resend(pending.id).unwrap());
                      setCode("");
                      setNow(Date.now());
                    })
                  }
                >
                  {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reserve" htmlFor={`${id}-reserve`}>
                <Select id={`${id}-reserve`} value={reserve} onChange={event => setReserve(event.target.value as "crypto" | "fiat")}>
                  <option value="crypto">Coins</option>
                  <option value="fiat">Money (a market)</option>
                </Select>
              </Field>
              {reserve === "crypto" ? (
                <Field label="Coin" htmlFor={`${id}-asset`}>
                  <Select id={`${id}-asset`} value={asset} onChange={event => setAsset(event.target.value)}>
                    {reserves.coins.map(item => (
                      <option key={item.asset} value={item.asset}>
                        {item.asset} · {item.balance} held
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Market wallet" htmlFor={`${id}-country`}>
                  <Select id={`${id}-country`} value={marketKey} onChange={event => setMarketKey(event.target.value)}>
                    {reserves.markets.map(item => (
                      <option key={`${item.country}:${item.currency}`} value={`${item.country}:${item.currency}`}>
                        {item.name} ({item.currency})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <Field label={`Amount (${unit})`} htmlFor={`${id}-amount`} hint={reserve === "crypto" ? "In the coin, for example 0.5." : "In the currency's main unit, for example 2500000.00."}>
              <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} />
            </Field>
            {needsReference ? (
              <Field label="Bank transfer reference" htmlFor={`${id}-reference`} hint="The transfer that put this money aside for the exchange.">
                <Input id={`${id}-reference`} autoComplete="off" value={reference} onChange={event => setReference(event.target.value)} maxLength={120} />
              </Field>
            ) : null}
            {reserve === "crypto" && kind === "fund" ? (
              <Notice tone="amber">Fund only with coins BitoCard already holds in its hot wallet: the daily custody check compares the books with the chain.</Notice>
            ) : null}
            <Field label="Reason" htmlFor={`${id}-reason`} hint="Recorded in the activity log. At least 5 characters.">
              <Textarea id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value)} maxLength={300} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
