'use client';

import { useId } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import type { ConfirmMethod } from '@bitocard/api-client/admin';
import { cn } from '../format';
import { Button } from './primitives';
import { CodeInput } from './code-input';

const methodLabels: Record<ConfirmMethod, { label: string; hint: string; code: string }> = {
  authenticator: { label: 'Authenticator app', hint: 'The 6-digit code your app shows now.', code: 'Code from your authenticator app' },
  email: { label: 'Emailed code', hint: 'Sent to your admin email.', code: 'Code from the email' },
};

/** The authenticator app when the API offers it (the admin has one set up), else the emailed code. */
export function defaultConfirmMethod(offered: ConfirmMethod[] | undefined): ConfirmMethod {
  return offered?.includes('authenticator') ? 'authenticator' : 'email';
}

/** What an admin is asked for a 6-digit code it has not finished typing, by method. */
export function confirmCodeProblem(method: ConfirmMethod) {
  return method === 'authenticator' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter the 6-digit code from the email.';
}

/**
 * Confirming a money action with a 6-digit code: the admin's authenticator app (offered when they have one set up,
 * and then the default) or the code we emailed them (always sent). Only the emailed code can be sent again.
 */
export function ConfirmCodePanel({
  methods,
  method,
  onMethodChange,
  code,
  onCodeChange,
  onComplete,
  busy,
  wait,
  onResend,
}: {
  /** From the request's `confirm_with`; missing means the emailed code only. */
  methods: ConfirmMethod[] | undefined;
  method: ConfirmMethod;
  onMethodChange: (method: ConfirmMethod) => void;
  code: string;
  onCodeChange: (code: string) => void;
  onComplete?: (code: string) => void;
  busy: boolean;
  /** Seconds until another email can be sent. */
  wait: number;
  onResend: () => void;
}) {
  const id = useId();
  const offered: ConfirmMethod[] = methods?.includes('authenticator') ? ['authenticator', 'email'] : ['email'];
  const labels = methodLabels[method];
  return (
    <div className="space-y-3 rounded-lg bg-canvas p-4">
      {offered.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Confirm with</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {offered.map(option => {
              const Icon = option === 'authenticator' ? KeyRound : Mail;
              return (
                <label
                  key={option}
                  htmlFor={`${id}-${option}`}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium',
                    method === option ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line',
                    busy ? 'opacity-60' : '',
                  )}
                >
                  <input
                    id={`${id}-${option}`}
                    type="radio"
                    name={`${id}-method`}
                    value={option}
                    className="size-4 accent-brand-600"
                    checked={method === option}
                    disabled={busy}
                    onChange={() => {
                      onMethodChange(option);
                      onCodeChange('');
                    }}
                  />
                  <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                  {methodLabels[option].label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      <p className="text-sm font-semibold text-ink">{labels.code}</p>
      <CodeInput key={method} label={labels.code} value={code} onChange={onCodeChange} onComplete={onComplete} autoFocus disabled={busy} />
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 pt-1 text-sm text-muted">
        <span>{labels.hint}</span>
        {method === 'email' ? (
          <Button size="sm" variant="ghost" disabled={busy || wait > 0} onClick={onResend}>
            {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
