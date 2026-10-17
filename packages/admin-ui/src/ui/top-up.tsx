'use client';

import { useEffect, useId, useState } from 'react';
import { MailCheck } from 'lucide-react';
import type { ConfirmMethod, ManualTopUp, ManualTopUpInput, ManualTopUpSource } from '@bitocard/api-client/admin';
import { errorMessage, formatDateTime, formatMoney } from '../format';
import { Dialog } from './data';
import { amountToMinor } from './pricing';
import { Button, Field, Input, KeyValue, Select, Textarea } from './primitives';
import { Badge, Notice, type Tone } from './status';
import { ConfirmCodePanel, confirmCodeProblem, defaultConfirmMethod } from './confirm-code';

const resendAfterSeconds = 60;

export const topUpSourceLabels: Record<ManualTopUpSource, string> = {
  received: 'Money received by BitoCard',
  goodwill: 'Goodwill credit (BitoCard pays)',
};

const statusLabels: Record<ManualTopUp['status'], { label: string; tone: Tone }> = {
  awaiting_code: { label: 'Waiting for code', tone: 'amber' },
  expired: { label: 'Code expired', tone: 'grey' },
  completed: { label: 'Added', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

/** What is wrong with the form, field by field (empty when it can be sent). */
export function topUpProblems(form: { amount: string; source: ManualTopUpSource; reference: string; reason: string }) {
  const problems: Partial<Record<'amount' | 'reference' | 'reason', string>> = {};
  const minor = amountToMinor(form.amount);
  if (minor === null || minor <= 0) problems.amount = 'Enter an amount above zero, with at most two decimals.';
  if (form.source === 'received' && !form.reference.trim()) problems.reference = 'Enter the bank transfer or payment reference.';
  if (form.reason.trim().length < 5) problems.reason = 'At least 5 characters.';
  return problems;
}

/** Seconds until another code can be sent (0 when it can be now). */
export function resendWait(sentAt: string | null, now = Date.now()) {
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil(resendAfterSeconds - (now - new Date(sentAt).getTime()) / 1000));
}

/**
 * Manual top-up in two steps. First the wallet, amount, where the money comes from and why; "Email me a code" asks
 * the API, which emails a 6-digit code to the signed-in admin. Then the code: the authenticator app's when the admin has
 * one (the default then), or the emailed one; only it adds the money. The emailed code can be sent again after a
 * minute, and the top-up cancelled while it waits.
 */
export function WalletTopUpDialog({
  open,
  onClose,
  targetName,
  currencies,
  chooseMode,
  modeNote,
  onRequest,
  onConfirm,
  onResend,
  onCancel,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** Whose wallet, as the dialog names it. */
  targetName: string;
  /** The wallets that can be topped up (the first is the default); `code` null sends no currency (the country's). */
  currencies: Array<{ code: string | null; label: string; currency: string }>;
  /** Resellers: live or the sandbox. Customers are topped up in their store's mode. */
  chooseMode: boolean;
  modeNote?: string;
  onRequest: (input: ManualTopUpInput) => Promise<ManualTopUp>;
  onConfirm: (id: string, code: string, method: ConfirmMethod) => Promise<ManualTopUp>;
  onResend: (id: string) => Promise<ManualTopUp>;
  onCancel: (id: string) => Promise<unknown>;
  onDone?: (topUp: ManualTopUp) => void;
}) {
  const id = useId();
  const [wallet, setWallet] = useState(0);
  const [mode, setMode] = useState<'live' | 'test'>('live');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<ManualTopUpSource>('received');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<ManualTopUp | null>(null);
  const [code, setCode] = useState('');
  const [methods, setMethods] = useState<ConfirmMethod[] | undefined>(undefined);
  const [method, setMethod] = useState<ConfirmMethod>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // The resend countdown ticks only while a code is awaited.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const chosen = currencies[wallet] ?? currencies[0];
  const problems = topUpProblems({ amount, source, reference, reason });
  const minor = amountToMinor(amount);
  const wait = pending ? resendWait(pending.code_sent_at, now) : 0;

  const reset = () => {
    setWallet(0);
    setMode('live');
    setAmount('');
    setSource('received');
    setReference('');
    setReason('');
    setTouched(false);
    setPending(null);
    setCode('');
    setMethods(undefined);
    setMethod('email');
    setError(null);
  };
  const close = () => {
    reset();
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

  const request = () => {
    setTouched(true);
    if (Object.keys(problems).length || minor === null) return;
    void run(async () => {
      const created = await onRequest({
        ...(chooseMode ? { mode } : {}),
        ...(chosen?.code ? { currency: chosen.code } : {}),
        amount: minor,
        source,
        ...(reference.trim() ? { external_reference: reference.trim() } : {}),
        reason: reason.trim(),
      });
      setPending(created);
      setMethods(created.confirm_with);
      setMethod(defaultConfirmMethod(created.confirm_with));
      setNow(Date.now());
    });
  };

  const confirm = (value = code) => {
    if (!pending) return;
    if (!/^\d{6}$/.test(value)) return setError(confirmCodeProblem(method));
    void run(async () => {
      const done = await onConfirm(pending.id, value, method);
      onDone?.(done);
      close();
    });
  };

  const footer = pending ? (
    <>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await onCancel(pending.id);
            close();
          })
        }
      >
        Cancel top-up
      </Button>
      <Button loading={busy} disabled={code.length !== 6} onClick={() => confirm()}>
        Add {formatMoney(pending.amount, pending.currency)}
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={close} disabled={busy}>
        Cancel
      </Button>
      <Button loading={busy} icon={<MailCheck className="size-4" aria-hidden />} onClick={request}>
        Email me a code
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title={pending ? `Confirm ${pending.number}` : 'Top up wallet'}
      description={pending ? `Enter your code to add the money to ${targetName}'s wallet.` : `Add money to ${targetName}'s wallet. Nothing moves until you enter the code we email you.`}
      footer={footer}
    >
      <div className="space-y-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        {pending ? (
          <>
            <KeyValue
              items={[
                { label: 'Amount', value: `${formatMoney(pending.amount, pending.currency)}${pending.mode === 'test' ? ' (sandbox)' : ''}` },
                { label: 'Source', value: topUpSourceLabels[pending.source] },
                ...(pending.external_reference ? [{ label: 'Reference', value: pending.external_reference }] : []),
                { label: 'Code expires', value: pending.code_expires_at ? formatDateTime(pending.code_expires_at) : '—' },
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
                  setPending(await onResend(pending.id));
                  setCode('');
                  setNow(Date.now());
                })
              }
            />
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Wallet" htmlFor={`${id}-wallet`}>
                <Select id={`${id}-wallet`} value={wallet} onChange={event => setWallet(Number(event.target.value))}>
                  {currencies.map((option, index) => (
                    <option key={option.label} value={index}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {chooseMode ? (
                <Field label="Mode" htmlFor={`${id}-mode`}>
                  <Select id={`${id}-mode`} value={mode} onChange={event => setMode(event.target.value as 'live' | 'test')}>
                    <option value="live">Live</option>
                    <option value="test">Sandbox</option>
                  </Select>
                </Field>
              ) : null}
            </div>
            {!chooseMode && modeNote ? <p className="text-sm text-muted">{modeNote}</p> : null}
            <Field label={`Amount (${chosen?.currency ?? ''})`} htmlFor={`${id}-amount`} error={touched ? problems.amount : undefined}>
              <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} placeholder="25000.00" />
            </Field>
            <Field label="Where the money comes from" htmlFor={`${id}-source`}>
              <Select id={`${id}-source`} value={source} onChange={event => setSource(event.target.value as ManualTopUpSource)}>
                {Object.entries(topUpSourceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {source === 'received' ? (
              <Field label="Bank or payment reference" htmlFor={`${id}-reference`} error={touched ? problems.reference : undefined} hint="As it shows on BitoCard's bank statement.">
                <Input id={`${id}-reference`} autoComplete="off" value={reference} onChange={event => setReference(event.target.value)} maxLength={120} />
              </Field>
            ) : null}
            <Field label="Reason" htmlFor={`${id}-reason`} error={touched ? problems.reason : undefined} hint="Recorded in the activity log.">
              <Textarea id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value)} maxLength={300} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The latest manual top-ups of one wallet owner, newest first. */
export function ManualTopUpsList({ topUps }: { topUps: ManualTopUp[] }) {
  if (!topUps.length) return <p className="text-sm text-muted">No manual top-ups yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {topUps.map(topUp => (
        <li key={topUp.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="font-semibold text-ink">
              {formatMoney(topUp.amount, topUp.currency)}
              {topUp.mode === 'test' ? <span className="font-normal text-muted"> · sandbox</span> : null}
            </p>
            <p className="truncate text-muted">
              {topUp.number} · {topUp.source === 'received' ? `Received${topUp.external_reference ? ` (${topUp.external_reference})` : ''}` : 'Goodwill'} · {topUp.requested_by.name ?? 'Admin'} ·{' '}
              {formatDateTime(topUp.completed_at ?? topUp.created_at)}
            </p>
          </div>
          <Badge tone={statusLabels[topUp.status].tone}>{statusLabels[topUp.status].label}</Badge>
        </li>
      ))}
    </ul>
  );
}
