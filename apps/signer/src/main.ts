import pg from 'pg';
import { loadConfig } from './config.js';
import { buildDrivers } from './drivers.js';
import { type Chain, familyOf, type Family } from './keys.js';
import { signerServer } from './server.js';
import { Signer } from './service.js';
import { migrate } from './store.js';
import { LocalVault } from './vault/local.js';
import { TurnkeyVault } from './vault/turnkey.js';

const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));

const config = loadConfig();
const db = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
await migrate(db);

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
const signer = new Signer(config, db, drivers, vault, log);
log('signer.started', { network: config.network, vault: vault.name, chains: Object.keys(drivers), hot_wallets: (await signer.health()).hot_wallets });

const server = signerServer(signer, config.secret, log);
server.listen(config.port, () => log('signer.listening', { port: config.port }));

let running = false;
const timer = setInterval(() => {
  if (running) return;
  running = true;
  signer
    .runOnce()
    .catch(error => log('worker.error', { error: error instanceof Error ? error.message : String(error) }))
    .finally(() => {
      running = false;
    });
}, config.workerIntervalMs);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => void db.end().then(() => process.exit(0)));
  });
}
