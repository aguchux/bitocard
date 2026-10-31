'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { setStepUpHandler } from '@bitocard/api-client';
import { useAdminSessionQuery, useAdminStepUpMutation } from '@bitocard/api-client/admin';
import { errorMessage } from '../format';
import { CodeInput } from '../ui/code-input';
import { Dialog } from '../ui/data';
import { Notice } from '../ui/status';
import { Button } from '../ui/primitives';
import { AppLink } from './session';

/**
 * The admin app's one prompt for the step-up window: when a sensitive or money action answers `step_up_required`, the
 * admin enters their authenticator code and presses Confirm (never on the sixth digit), which opens 5 minutes on this
 * session; the action is then sent again by the API client. Cancelling leaves the action refused. An admin who has not
 * turned 2-step verification on (Udozo's team members choose) is sent to `setupHref` to do so first.
 */
export function StepUpPrompt({ setupHref = '/account' }: { setupHref?: string } = {}) {
  const noAuthenticator = useAdminSessionQuery().data?.admin.authenticator === false;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stepUp, { isLoading }] = useAdminStepUpMutation();
  const settle = useRef<((opened: boolean) => void) | null>(null);

  useEffect(() => {
    setStepUpHandler(
      () =>
        new Promise<boolean>(resolve => {
          settle.current = resolve;
          setCode('');
          setError(null);
          setOpen(true);
        }),
    );
    return () => setStepUpHandler(null);
  }, []);

  const finish = (opened: boolean) => {
    setOpen(false);
    settle.current?.(opened);
    settle.current = null;
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your authenticator app.');
    try {
      await stepUp({ code }).unwrap();
      finish(true);
    } catch (caught) {
      setCode('');
      setError(errorMessage(caught));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => finish(false)}
      title="Confirm it's you"
      description="This action moves money or changes a sensitive setting. Enter the code from your authenticator app to allow these actions for the next 5 minutes."
      footer={
        noAuthenticator ? (
          <>
            <Button variant="ghost" onClick={() => finish(false)}>
              Cancel
            </Button>
            <AppLink
              href={setupHref}
              onClick={() => finish(false)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <ShieldCheck className="size-4" aria-hidden />
              Turn on 2-step verification
            </AppLink>
          </>
        ) : (
        <>
          <Button variant="ghost" onClick={() => finish(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button loading={isLoading} disabled={code.length !== 6} icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => void confirm()}>
            Confirm
          </Button>
        </>
        )
      }
    >
      {noAuthenticator ? (
        <Notice tone="amber">This needs a code from an authenticator app, and you have not turned 2-step verification on yet. Turn it on from your account, then try again.</Notice>
      ) : (
        <div className="space-y-3">
          {error ? <Notice tone="red">{error}</Notice> : null}
          <CodeInput label="Code from your authenticator app" value={code} onChange={setCode} autoFocus disabled={isLoading} />
        </div>
      )}
    </Dialog>
  );
}
