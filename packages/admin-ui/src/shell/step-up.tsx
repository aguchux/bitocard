'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { setStepUpHandler } from '@bitocard/api-client';
import { useAdminStepUpMutation } from '@bitocard/api-client/admin';
import { errorMessage } from '../format';
import { CodeInput } from '../ui/code-input';
import { Dialog } from '../ui/data';
import { Notice } from '../ui/status';
import { Button } from '../ui/primitives';

/**
 * The admin app's one prompt for the step-up window: when a sensitive or money action answers `step_up_required`, the
 * admin enters their authenticator code and presses Confirm (never on the sixth digit), which opens 5 minutes on this
 * session; the action is then sent again by the API client. Cancelling leaves the action refused.
 */
export function StepUpPrompt() {
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
        <>
          <Button variant="ghost" onClick={() => finish(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button loading={isLoading} disabled={code.length !== 6} icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => void confirm()}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Notice tone="red">{error}</Notice> : null}
        <CodeInput label="Code from your authenticator app" value={code} onChange={setCode} autoFocus disabled={isLoading} />
      </div>
    </Dialog>
  );
}
