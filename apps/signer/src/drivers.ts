import type { ChainDriver, Intent } from './chains/driver.js';
import { EvmDriver } from './chains/evm.js';
import { TronDriver } from './chains/tron.js';
import { BlockCypherSource, EsploraSource, UtxoDriver } from './chains/utxo.js';
import type { SignerConfig } from './config.js';
import { type Chain, familyOf, keyPath } from './keys.js';
import type { KeyVault } from './vault/vault.js';

/** One driver per chain this signer has a node for; a chain without one is refused. */
export function buildDrivers(config: SignerConfig, vault: KeyVault): Partial<Record<Chain, ChainDriver>> {
  const paths = (chain: Chain) => ({ path: (intent: Intent) => keyPath(config.accountPaths[familyOf(chain)], intent.from) });
  const drivers: Partial<Record<Chain, ChainDriver>> = {};
  for (const [chain, url] of Object.entries(config.evmRpc) as [Chain, string][]) {
    drivers[chain] = new EvmDriver(chain, config.network, url, vault, paths(chain), config.confirmations[chain]);
  }
  if (config.tron) drivers.TRON = new TronDriver(config.tron.url, config.tron.apiKey, config.network, vault, paths('TRON'), config.confirmations.TRON);
  for (const chain of ['BITCOIN', 'LITECOIN', 'DOGECOIN'] as const) {
    const esplora = config.esplora[chain];
    // Dogecoin has no public Esplora: BlockCypher serves its main network.
    const source = esplora ? new EsploraSource(esplora) : chain === 'DOGECOIN' && config.network === 'mainnet' && config.blockcypherToken ? new BlockCypherSource('doge', config.blockcypherToken) : null;
    if (source) drivers[chain] = new UtxoDriver(chain, config.network, source, vault, paths(chain), config.confirmations[chain]);
  }
  return drivers;
}
