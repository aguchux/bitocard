import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useRef, useState } from 'react';

import { newIdempotencyKey } from '@/lib/api';
import { keepKey } from '@/lib/money';

/**
 * Face ID, the fingerprint or the phone's own PIN before money leaves the wallet. A phone with no lock set up asks
 * nothing more: the confirm screen that names the amount is the confirmation, and the API checks every rule.
 */
export async function confirmOnPhone(reason: string) {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return true;
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancel', disableDeviceFallback: false });
    return result.success;
  } catch {
    // The phone could not ask (an emulator, a broken sensor): the confirm screen already named the amount.
    return true;
  }
}

/** A money step's Idempotency-Key: made once per attempt and kept until it succeeds or is refused (`keepKey`). */
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
