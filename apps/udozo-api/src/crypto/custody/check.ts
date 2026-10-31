import type { CheckOutcome } from '../chains/check.js';
import { type Screener } from './screening.js';
import { RemoteSigner, SignerError } from './signer.js';

type Values = Record<string, string | undefined>;

/** Whether the signer's Sandbox switch is on (it then serves sandbox stores on test networks). */
export const signerInSandbox = (values: Values) => values.CRYPTO_SIGNER_SANDBOX === 'on';

/** Test connection for the signer: its health check, signed with the shared secret. Sends nothing. */
export async function checkSigner(values: Values): Promise<CheckOutcome> {
  const environment = signerInSandbox(values) ? ('sandbox' as const) : ('live' as const);
  if (!values.CRYPTO_SIGNER_URL || !values.CRYPTO_SIGNER_SECRET) return { environment, ok: false, message: 'Set the signer address and shared secret first.', chains: [] };
  try {
    const health = await new RemoteSigner(values.CRYPTO_SIGNER_URL, values.CRYPTO_SIGNER_SECRET).health();
    return { environment, ok: true, message: `The signer answered${health.network ? ` (${health.network})` : ''}.`, chains: [] };
  } catch (error) {
    const refused = error instanceof SignerError && error.definite;
    return { environment, ok: false, message: `The signer ${refused ? 'refused' : 'could not be reached'}: ${error instanceof Error ? error.message : 'error'}.`, chains: [] };
  }
}

/** A known address that is on no sanctions list (the EVM zero address), to see the screener answers. */
const probe = '0x0000000000000000000000000000000000000000';

/** Test connection for a sanctions screener: screens one harmless address. */
export async function checkScreener(item: Screener, values: Values): Promise<CheckOutcome> {
  if (!item.configured(values)) return { environment: 'live', ok: false, message: 'Set the API key first.', chains: [] };
  try {
    const result = await item.screen(values, probe);
    return { environment: 'live', ok: true, message: `${item.name} answered (a test address came back ${result.status}).`, chains: [] };
  } catch (error) {
    return { environment: 'live', ok: false, message: `${item.name}: ${error instanceof Error ? error.message : 'error'}.`, chains: [] };
  }
}
