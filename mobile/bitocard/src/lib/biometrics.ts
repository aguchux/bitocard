import { useCallback, useRef, useState } from 'react';

import { newIdempotencyKey } from '@/lib/api';
import { keepKey } from '@/lib/money';
import { activeTransactionPin, authenticateDevice, savedTransactionPin, setActiveTransactionPin } from '@/lib/transaction-pin';

/**
 * Face ID, fingerprint or device passcode before money leaves the wallet. It fails closed. The server still checks the
 * transaction PIN; successful device authentication unlocks the encrypted copy saved when the customer set that PIN.
 */
export async function confirmOnPhone(reason: string) {
  if (activeTransactionPin()) return true;
  if (!(await authenticateDevice(reason))) return false;
  const pin = await savedTransactionPin();
  if (!pin) return false;
  setActiveTransactionPin(pin);
  return true;
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
