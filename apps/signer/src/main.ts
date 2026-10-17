import { createSigner, log } from './app.js';
import { signerServer } from './server.js';

/** The signer as a long-running server (Docker): the HTTP interface plus its worker every few seconds. */
const { config, pool, signer, vault, drivers } = await createSigner();
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
    server.close(() => void pool.end().then(() => process.exit(0)));
  });
}
