import { addressFamilies, deriveAddress, InvalidXpubError, parseXpub } from '../derive.js';
import { type Chain, ChainError, chainNames, checkNetwork } from './client.js';
import { type ChainProvider, type ChainProviderValues, providerInSandbox } from './providers.js';

export type CheckOutcome = { environment: 'live' | 'sandbox'; ok: boolean; message: string | null; chains: Array<{ chain: Chain; ok: boolean; block: string | null; error: string | null }> };

/** A provider's fields by key, for its endpoints. */
export const providerKeys = (provider: ChainProvider) => provider.fields.map(field => field.key);

/**
 * Test connection for a blockchain provider: the latest block on every chain it is set up for, in the environment
 * its Sandbox switch says. Reads only; never a key.
 */
export async function checkProvider(provider: ChainProvider, values: ChainProviderValues): Promise<CheckOutcome> {
  const environment = providerInSandbox(provider, values) ? ('sandbox' as const) : ('live' as const);
  const clients = Object.entries(provider.endpoints(values, environment)).filter(([, client]) => client) as Array<[Chain, NonNullable<ReturnType<ChainProvider['endpoints']>[Chain]>]>;
  if (!clients.length) return { environment, ok: false, message: `Set ${provider.name}’s ${provider.fields.find(field => field.required || field.kind === 'url')?.label ?? 'settings'} first.`, chains: [] };
  const chains = await Promise.all(
    clients.map(async ([chain, client]) => {
      try {
        const block = String(await client.latestBlock());
        // An endpoint on the wrong network for the Sandbox switch is refused, so test coins never reach live wallets.
        await checkNetwork(chain, client, environment);
        return { chain, ok: true, block, error: null };
      } catch (error) {
        const refused = error instanceof ChainError && error.definite;
        return { chain, ok: false, block: null, error: `${refused ? 'refused' : 'unreachable'}: ${error instanceof Error ? error.message : 'error'}` };
      }
    }),
  );
  const failed = chains.filter(item => !item.ok);
  const where = environment === 'sandbox' ? 'test networks' : 'main networks';
  return {
    environment,
    ok: failed.length === 0,
    message: failed.length
      ? failed.map(item => `${chainNames[item.chain]}: ${item.error}`).join('; ')
      : `${chains.map(item => `${chainNames[item.chain]} block ${item.block}`).join(', ')} (${where}).`,
    chains,
  };
}

/** Test connection for the wallet keys: each key set is read, and its first address shown, so admins can check it against the vault. */
export function checkWalletKeys(values: ChainProviderValues): CheckOutcome {
  const lines: string[] = [];
  let ok = true;
  for (const mode of ['live', 'test'] as const) {
    for (const family of addressFamilies) {
      const key = `CRYPTO_${mode === 'test' ? 'TEST_' : ''}XPUB_${family.toUpperCase()}`;
      const xpub = values[key];
      if (!xpub) continue;
      try {
        const { testnet } = parseXpub(xpub);
        if (testnet !== (mode === 'test') && family === 'bitcoin') throw new InvalidXpubError(mode === 'test' ? 'a mainnet key where a testnet key belongs' : 'a testnet key where a mainnet key belongs');
        lines.push(`${family} ${mode}: first address ${deriveAddress(family, xpub, 0)}`);
      } catch (error) {
        ok = false;
        lines.push(`${family} ${mode}: ${error instanceof Error ? error.message : 'not valid'}`);
      }
    }
  }
  if (!lines.length) return { environment: 'live', ok: false, message: 'Set at least one account key first.', chains: [] };
  return { environment: 'live', ok, message: `${lines.join('. ')}.`, chains: [] };
}
