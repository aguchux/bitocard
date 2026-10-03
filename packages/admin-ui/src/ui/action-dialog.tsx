'use client';

import { useId, useState, type ReactNode } from 'react';
import { errorMessage } from '../format';
import { Dialog } from './data';
import { Button, Field, Textarea } from './primitives';
import { Notice } from './status';

/**
 * Confirms an audited admin action and asks why (the reason goes into the audit trail). Extra inputs go in
 * `children`. `onConfirm` returns a promise; errors from the API are shown in the dialog, which stays open.
 */
export function ActionDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  children,
  requireReason = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: (reason: string) => Promise<unknown>;
  children?: ReactNode;
  requireReason?: boolean;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tooShort = requireReason && reason.trim().length < 5;

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={busy}
            disabled={tooShort}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                close();
              } catch (failure) {
                setError(errorMessage(failure));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        {children}
        {requireReason ? (
          <Field label="Reason" htmlFor={`${id}-reason`} hint="Recorded in the activity log. At least 5 characters.">
            <Textarea id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
