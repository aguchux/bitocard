import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useRef, useState } from 'react';

import { newIdempotencyKey } from '@/lib/api';
import { keepKey } from '@/lib/money';

/**
 * Face ID, the fingerprint or the phone's own PIN before a money step (paying, paying out, releasing, showing a release
 * code). A phone with no lock set up at all asks nothing more: the confirm sheet that names the amount is the
 * confirmation, and the API checks the session and every rule. True when the step may go ahead.
 */
export async function confirmOnPhone(reason: string) {
  try {
    const [hardware, level] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.getEnrolledLevelAsync()]);
    if (level === LocalAuthentication.SecurityLevel.NONE) return true;
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancel', disableDeviceFallback: false, fallbackLabel: hardware ? 'Use PIN' : undefined });
    return result.success;
  } catch {
    // The phone could not ask (an emulator, a broken sensor): the confirm sheet already named the amount.
    return true;
  }
}

/**
 * A money step's Idempotency-Key: made once per attempt and kept until the step succeeds or is refused, so a retried
 * tap after no answer never pays twice (`keepKey`).
 */
export function useMoneyKey() {
  const key = useRef<string | null>(null);
  const [, redraw] = useState(0);
  const current = useCallback(() => (key.current ??= newIdempotencyKey()), []);
  const settle = useCallback((error?: unknown) => {
    if (error === undefined || !keepKey(error)) {
      key.current = null;
      redraw(value => value + 1);
    }
  }, []);
  return { current, settle };
}
