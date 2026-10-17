import pg from 'pg';
import { loadConfig } from './config.js';
import { buildDrivers } from './drivers.js';
import { type Chain, type Family, familyOf } from './keys.js';
import type { Log } from './server.js';
import { Signer } from './service.js';
import { migrate } from './store.js';
import { LocalVault } from './vault/local.js';
import { TurnkeyVault } from './vault/turnkey.js';

export const log: Log = (event, fields = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));

/** Everything the signer needs, from its environment: settings checked, tables created, vault and chains ready. */
export async function createSigner(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }
  const vault =
    config.vault.kind === 'local'
      ? new LocalVault(config.vault.mnemonic)
      : new TurnkeyVault({
          ...config.vault,
          accounts: (Object.entries(config.xpubs) as [Family, string][]).map(([family, xpub]) => ({ path: config.accountPaths[family], xpub })),
        });
  const drivers = buildDrivers(config, vault);
  // With Turnkey every chain needs its family's xpub: the signer works out public keys from it.
  for (const chain of Object.keys(drivers) as Chain[]) {
    if (config.vault.kind === 'turnkey' && !config.xpubs[familyOf(chain)]) throw new Error(`SIGNER_XPUB_${familyOf(chain).toUpperCase()} is required for ${chain}`);
  }
  const signer = new Signer(config, pool, drivers, vault, log);
  return { config, pool, signer, vault, drivers };
}
