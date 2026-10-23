"use client";

import { useEffect, useId, useState } from "react";
import { MailCheck } from "lucide-react";
import { Button, ConfirmCodePanel, confirmCodeProblem, defaultConfirmMethod, Dialog, errorMessage, Field, formatDateTime, formatMoney, Input, KeyValue, Notice, resendWait, Select, Textarea } from "@bitocard/admin-ui";
import {
  type ConfirmMethod,
  type Mode,
  type Supplier,
  type SupplierFundingMovement,
  useCancelSupplierFundingMutation,
  useConfirmSupplierFundingMutation,
  useRequestSupplierFundingMutation,
  useResendSupplierFundingCodeMutation,
} from "@bitocard/api-client/admin";

/**
 * Recording money sent to a supplier outside BitoCard (a bank transfer to its account): the supplier, amount and
 * why; then a 6-digit code, the admin's authenticator app (the default when they have one) or the code emailed to
 * them. Confirming funds the supplier's float, the same balance every order's cost already draws down.
 */
export function SupplierFundingDialog({ open, onClose, mode, suppliers, onDone }: { open: boolean; onClose: () => void; mode: Mode; suppliers: Supplier[]; onDone: (movement: SupplierFundingMovement) => void }) {
  const id = useId();
  const [supplierCode, setSupplierCode] = useState(suppliers[0]?.code ?? "");
  const supplier = suppliers.find(item => item.code === supplierCode);
  const [currency, setCurrency] = useState(supplier?.funding.currency ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<SupplierFundingMovement | null>(null);
  const [code, setCode] = useState("");
  const [methods, setMethods] = useState<ConfirmMethod[] | undefined>(undefined);
  const [method, setMethod] = useState<ConfirmMethod>("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [request] = useRequestSupplierFundingMutation();
  const [confirm] = useConfirmSupplierFundingMutation();
  const [resend] = useResendSupplierFundingCodeMutation();
  const [cancel] = useCancelSupplierFundingMutation();

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const valid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0 && /^[A-Z]{3}$/.test(currency) && reason.trim().length >= 5;
  const wait = pending ? resendWait(pending.code_sent_at, now) : 0;

  const close = () => {
    setPending(null);
    setCode("");
    setMethods(undefined);
    setMethod("email");
    setAmount("");
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

  const confirmFunding = (value = code) => {
    if (!pending) return;
    if (!/^\d{6}$/.test(value)) return setError(confirmCodeProblem(method));
    void run(async () => {
      const done = await confirm({ id: pending.id, code: value, method }).unwrap();
      onDone(done);
      close();
    });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={pending ? `Confirm ${pending.number}` : "Fund a supplier"}
      description={pending ? "Enter your code. Nothing is recorded until you do." : "Record money already sent to a supplier outside BitoCard (a bank transfer to its account). This funds its float; it never sends money itself."}
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
            <Button loading={busy} disabled={code.length !== 6} onClick={() => confirmFunding()}>
              Fund {pending.amount / 100} {pending.currency}
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
                void run(async () => {
                  const created = await request({ mode, supplier_code: supplierCode, currency, amount: Math.round(Number(amount) * 100), reason: reason.trim() }).unwrap();
                  setPending(created);
                  setMethods(created.confirm_with);
                  setMethod(defaultConfirmMethod(created.confirm_with));
                  setNow(Date.now());
                })
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
                { label: "Supplier", value: pending.supplier.name },
                { label: "Amount", value: `${formatMoney(pending.amount, pending.currency)}${pending.mode === "test" ? " (sandbox)" : ""}` },
                { label: "Code expires", value: formatDateTime(pending.code_expires_at) },
              ]}
            />
            <ConfirmCodePanel
              methods={methods}
              method={method}
              onMethodChange={setMethod}
              code={code}
              onCodeChange={setCode}
              busy={busy}
              wait={wait}
              onResend={() =>
                void run(async () => {
                  setPending(await resend(pending.id).unwrap());
                  setCode("");
                  setNow(Date.now());
                })
              }
            />
          </>
        ) : (
          <>
            <Field label="Supplier" htmlFor={`${id}-supplier`}>
              <Select
                id={`${id}-supplier`}
                value={supplierCode}
                onChange={event => {
                  setSupplierCode(event.target.value);
                  const next = suppliers.find(item => item.code === event.target.value);
                  if (next?.funding.currency) setCurrency(next.funding.currency);
                }}
              >
                {suppliers.map(item => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" htmlFor={`${id}-currency`} hint="The supplier's funding currency, for example USD.">
                <Input id={`${id}-currency`} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} maxLength={3} className="uppercase" />
              </Field>
              <Field label="Amount" htmlFor={`${id}-amount`} hint="In the currency's main unit, for example 5000.00.">
                <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} />
              </Field>
            </div>
            <Field label="Reason" htmlFor={`${id}-reason`} hint="The bank transfer this records, for finance's own tracking. Recorded in the activity log. At least 5 characters.">
              <Textarea id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value)} maxLength={300} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
