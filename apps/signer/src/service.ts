import { type ChainDriver, type Intent, Refusal, type Signed } from './chains/driver.js';
import type { Limit, SignerConfig } from './config.js';
import { addressOf, type Chain, chains, familyOf, isEvm, isUtxo, keyPath, type KeyOwner, nativeCoin, type Network } from './keys.js';
import type { Db, TransferRow } from './store.js';
import type { KeyVault } from './vault/vault.js';

/** An answer the HTTP layer sends as is: 4xx are definite refusals (nothing was sent). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type TransferView = { reference: string; status: 'pending' | 'broadcast' | 'confirmed' | 'failed'; tx_hash: string | null; reason: string | null };

type Log = (event: string, fields?: Record<string, unknown>) => void;

/** Serialises work per key in this process (signing per chain: EVM nonces and UTXOs are never handed out twice). */
class Locks {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.tails.set(key, next);
    // The caller handles the work's own failure; this bookkeeping must never become an unhandled rejection.
    next
      .finally(() => {
        if (this.tails.get(key) === next) this.tails.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
}

const leaseMs = 3 * 60_000;

/**
 * BitoCard's signer: records each transfer the API asks for under its reference before anything else (so a second
 * request is the same transfer, never another), signs it through the vault, keeps the signed bytes before
 * broadcasting (so a retry sends exactly those bytes), and follows it on chain. Only a clear refusal before signing,
 * or a transaction the chain shows can never send (reverted, expired), is `failed`.
 */
export class Signer {
  private readonly locks = new Locks();
  private readonly hot = new Map<Chain, string>();

  constructor(
    private readonly config: SignerConfig,
    private readonly db: Db,
    private readonly drivers: Partial<Record<Chain, ChainDriver>>,
    private readonly vault: KeyVault,
    private readonly log: Log = () => undefined,
  ) {}

  private driver(chain: Chain) {
    const driver = this.drivers[chain];
    if (!driver) throw new HttpError(422, `this signer has no ${chain} node set up`);
    return driver;
  }

  /** An owner's address on a chain, from the vault's public key (the hot wallet's is cached). */
  async addressFor(chain: Chain, owner: KeyOwner) {
    if (owner.kind === 'hot' && this.hot.has(chain)) return this.hot.get(chain)!;
    const publicKey = await this.vault.publicKey(keyPath(this.config.accountPaths[familyOf(chain)], owner));
    const address = addressOf(chain, this.config.network, publicKey);
    if (owner.kind === 'hot') this.hot.set(chain, address);
    return address;
  }

  private limitFor(chain: Chain, contract: string | null): Limit | undefined {
    const same = (a: string | null, b: string | null) => (a === null || b === null ? a === b : isEvm(chain) ? a.toLowerCase() === b.toLowerCase() : a === b);
    return this.config.limits.find(limit => limit.chain === chain && same(limit.contract, contract));
  }

  async health() {
    const hot: Record<string, string> = {};
    for (const chain of chains) if (this.drivers[chain]) hot[chain] = await this.addressFor(chain, { kind: 'hot' });
    return { network: this.config.network, vault: this.vault.name, hot_wallets: hot };
  }

  // ---- Withdrawals -------------------------------------------------------------------------------------------------

  async receive(body: unknown): Promise<TransferView> {
    const input = body as Record<string, unknown>;
    const reference = input?.reference;
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(reference)) throw new HttpError(400, 'reference is required');
    const chain = input.chain as Chain;
    if (!chains.includes(chain)) throw new HttpError(400, 'chain is not supported');
    if (input.network !== this.config.network) throw new HttpError(422, `this signer serves ${this.config.network} only`);
    if (typeof input.amount !== 'string' || !/^[1-9]\d{0,77}$/.test(input.amount)) throw new HttpError(400, 'amount must be whole on-chain units, as text');
    const contract = input.contract === null || input.contract === undefined ? null : String(input.contract);
    const asset = String(input.asset ?? '').toUpperCase();
    const driver = this.driver(chain);
    const limit = this.limitFor(chain, contract);
    // A coin or token without a limit is not something this signer sends.
    if (!limit) throw new HttpError(422, `${asset || 'this asset'} on ${chain} is not allowed by this signer`);
    if (limit.asset !== asset) throw new HttpError(422, `the contract is ${limit.asset}, not ${asset}`);
    if (typeof input.decimals === 'number' && input.decimals !== limit.decimals) throw new HttpError(422, `${asset} has ${limit.decimals} decimals here, not ${input.decimals}`);
    const to = driver.address(String(input.to ?? ''));
    if (!to) throw new HttpError(422, `not a valid ${chain} address`);

    // Recorded first, atomically: a GET for this reference never answers 404 once a POST carrying it arrived.
    const inserted = await this.db.query<TransferRow>(
      `INSERT INTO transfers (reference, kind, chain, network, asset, contract, to_address, amount)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, $6, $7) ON CONFLICT (reference) DO NOTHING RETURNING *`,
      [reference, chain, this.config.network, asset, contract, to, input.amount],
    );
    if (!inserted.rows.length) return (await this.get(reference))!;
    this.log('transfer.received', { reference, chain, asset, amount: input.amount });

    const refusal = await this.locks.run(`limits:${chain}:${asset}`, () => this.checkLimits(inserted.rows[0], limit));
    if (refusal) {
      await this.fail(reference, refusal);
      return (await this.get(reference))!;
    }
    void this.process(reference).catch(error => this.log('transfer.error', { reference, error: String(error) }));
    return this.view(inserted.rows[0]);
  }

  private async checkLimits(row: TransferRow, limit: Limit) {
    const amount = BigInt(row.amount);
    if (amount > limit.perTransfer) return `above this signer's limit of ${limit.perTransfer} per transfer`;
    const sent = await this.db.query<{ total: string | null }>(
      `SELECT SUM(amount)::text AS total FROM transfers
       WHERE kind = 'withdrawal' AND chain = $1 AND asset = $2 AND status <> 'failed' AND reference <> $3 AND created_at > now() - interval '24 hours'`,
      [row.chain, row.asset, row.reference],
    );
    if (BigInt(sent.rows[0]?.total ?? '0') + amount > limit.daily) return `above this signer's daily limit of ${limit.daily}`;
    return null;
  }

  async get(reference: string) {
    const rows = await this.db.query<TransferRow>('SELECT * FROM transfers WHERE reference = $1', [reference]);
    return rows.rows[0] ? this.view(rows.rows[0]) : null;
  }

  private view(row: TransferRow): TransferView {
    const status = row.status === 'signed' ? 'pending' : row.status;
    return { reference: row.reference, status, tx_hash: status === 'pending' ? null : row.tx_hash, reason: row.reason };
  }

  private async fail(reference: string, reason: string) {
    await this.db.query(`UPDATE transfers SET status = 'failed', reason = $2, lease_until = NULL, updated_at = now() WHERE reference = $1 AND status IN ('pending', 'signed', 'broadcast')`, [reference, reason]);
    this.log('transfer.failed', { reference, reason });
  }

  /** Moves one transfer a step on: sign, broadcast, or follow it on chain. Safe to run twice: a lease claims it. */
  async process(reference: string) {
    const claimed = await this.db.query<TransferRow>(
      `UPDATE transfers SET lease_until = now() + ($2 || ' milliseconds')::interval, attempts = attempts + 1, updated_at = now()
       WHERE reference = $1 AND status IN ('pending', 'signed', 'broadcast') AND (lease_until IS NULL OR lease_until < now()) RETURNING *`,
      [reference, String(leaseMs)],
    );
    const row = claimed.rows[0];
    if (!row) return;
    const chain = row.chain as Chain;
    const driver = this.drivers[chain];
    try {
      if (!driver) throw new Error(`no ${chain} node set up`);
      if (row.status === 'pending') await this.signRow(row, driver);
      const current = (await this.db.query<TransferRow>('SELECT * FROM transfers WHERE reference = $1', [reference])).rows[0];
      if (current.status === 'signed') {
        await driver.broadcast(this.signed(current));
        await this.db.query(`UPDATE transfers SET status = 'broadcast', last_error = NULL, updated_at = now() WHERE reference = $1 AND status = 'signed'`, [reference]);
        this.log('transfer.broadcast', { reference, tx_hash: current.tx_hash });
      } else if (current.status === 'broadcast') {
        await this.follow(current, driver);
      }
      await this.release(reference, 15_000);
    } catch (error) {
      if (error instanceof Refusal && row.status === 'pending') {
        await this.fail(reference, error.message);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      // Unclear: try again later, backing off, never failed for it.
      await this.db.query('UPDATE transfers SET last_error = $2 WHERE reference = $1', [reference, message.slice(0, 500)]);
      await this.release(reference, Math.min(15_000 * 2 ** Math.min(row.attempts, 6), 10 * 60_000));
      this.log('transfer.retry', { reference, error: message });
    }
  }

  private async release(reference: string, afterMs: number) {
    await this.db.query(`UPDATE transfers SET lease_until = NULL, next_attempt_at = now() + ($2 || ' milliseconds')::interval WHERE reference = $1`, [reference, String(afterMs)]);
  }

  private signed(row: TransferRow): Signed {
    return { txHash: row.tx_hash!, raw: row.raw!, meta: row.meta ?? {} };
  }

  private intent(row: TransferRow): Intent {
    return {
      chain: row.chain as Chain,
      network: row.network as Network,
      contract: row.contract,
      to: row.to_address,
      amount: BigInt(row.amount),
      from: row.from_index === null ? { kind: 'hot' } : { kind: 'customer', index: row.from_index },
      sweepAll: row.kind === 'sweep' && !row.contract,
    };
  }

  private async signRow(row: TransferRow, driver: ChainDriver) {
    const chain = row.chain as Chain;
    await this.locks.run(`sign:${chain}`, async () => {
      const signed = await driver.sign(this.intent(row), {
        // The next nonce after every transaction this signer has signed and not seen confirmed, or the chain's.
        nonce: async (address, chainNonce) => {
          const rows = await this.db.query<{ nonce: string | null }>(
            `SELECT MAX((meta->>'nonce')::numeric)::text AS nonce FROM transfers WHERE chain = $1 AND network = $2 AND status IN ('signed', 'broadcast') AND meta->>'from' = $3`,
            [chain, row.network, address],
          );
          const ours = rows.rows[0]?.nonce;
          return ours !== null && ours !== undefined && BigInt(ours) + 1n > chainNonce ? BigInt(ours) + 1n : chainNonce;
        },
        reserved: isUtxo(chain) ? await this.reservedInputs(chain) : undefined,
      });
      const saved = await this.db.query(
        `UPDATE transfers SET status = 'signed', tx_hash = $2, raw = $3, meta = $4::jsonb, last_error = NULL, updated_at = now() WHERE reference = $1 AND status = 'pending' RETURNING reference`,
        [row.reference, signed.txHash, signed.raw, JSON.stringify(signed.meta)],
      );
      if (saved.rows.length) this.log('transfer.signed', { reference: row.reference, tx_hash: signed.txHash });
    });
  }

  private async reservedInputs(chain: Chain) {
    const rows = await this.db.query<{ meta: { inputs?: string[] } }>(`SELECT meta FROM transfers WHERE chain = $1 AND network = $2 AND status IN ('signed', 'broadcast')`, [chain, this.config.network]);
    return new Set(rows.rows.flatMap(r => r.meta?.inputs ?? []));
  }

  private async follow(row: TransferRow, driver: ChainDriver) {
    const state = await driver.status(this.signed(row));
    if (state.state === 'mined' && state.confirmations >= driver.confirmations) {
      await this.db.query(`UPDATE transfers SET status = 'confirmed', updated_at = now() WHERE reference = $1 AND status = 'broadcast'`, [row.reference]);
      this.log('transfer.confirmed', { reference: row.reference, tx_hash: row.tx_hash });
    } else if (state.state === 'reverted') {
      await this.fail(row.reference, state.reason);
    } else if (state.state === 'unknown') {
      // Dropped from the node's pool (or never reached it): send the same bytes again.
      await driver.broadcast(this.signed(row));
    }
  }

  /** One pass of the worker: every unfinished transfer that is due, then the sweeps. */
  async runOnce() {
    const due = await this.db.query<{ reference: string }>(
      `SELECT reference FROM transfers WHERE status IN ('pending', 'signed', 'broadcast') AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until < now())
       ORDER BY next_attempt_at LIMIT 50`,
    );
    for (const { reference } of due.rows) await this.process(reference);
    await this.sweep();
  }

  // ---- Deposit addresses and sweeps ----------------------------------------------------------------------------

  /** The API tells the signer about a customer's deposit address once a deposit to it is seen. */
  async track(body: unknown) {
    const input = body as Record<string, unknown>;
    const chain = input?.chain as Chain;
    if (!chains.includes(chain)) throw new HttpError(400, 'chain is not supported');
    if (input.network !== this.config.network) throw new HttpError(422, `this signer serves ${this.config.network} only`);
    const index = input.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new HttpError(400, 'index must be a whole number');
    this.driver(chain);
    const address = await this.addressFor(chain, { kind: 'customer', index });
    const given = String(input.address ?? '');
    // The API's xpub and the vault must be the same keys: a different address means they are not, and nothing is kept.
    const same = isEvm(chain) ? given.toLowerCase() === address.toLowerCase() : given === address;
    if (!same) throw new HttpError(422, `index ${index} on ${chain} is ${address} here, not ${given}: the API's xpub and the signer's keys differ`);
    await this.db.query(`INSERT INTO deposit_addresses (chain, network, address_index, address) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [chain, this.config.network, index, address]);
    return { chain, index, address };
  }

  /**
   * Moves deposits to the hot wallet. Per address, one step a pass: tokens first (sending the chain's coin for gas
   * when the address has too little, then the token once that has arrived), then the coin itself. Only assets with a
   * `sweep_min` are swept, and nothing is started while that address has a transfer still on its way.
   */
  async sweep() {
    const addresses = await this.db.query<{ chain: Chain; address_index: number; address: string }>(
      `SELECT chain, address_index, address FROM deposit_addresses WHERE network = $1 ORDER BY swept_at NULLS FIRST LIMIT 100`,
      [this.config.network],
    );
    for (const entry of addresses.rows) {
      const driver = this.drivers[entry.chain];
      if (!driver) continue;
      try {
        await this.sweepAddress(entry.chain, entry.address_index, entry.address, driver);
      } catch (error) {
        this.log('sweep.error', { chain: entry.chain, index: entry.address_index, error: error instanceof Error ? error.message : String(error) });
      }
      await this.db.query('UPDATE deposit_addresses SET swept_at = now() WHERE chain = $1 AND network = $2 AND address_index = $3', [entry.chain, this.config.network, entry.address_index]);
    }
  }

  private async sweepAddress(chain: Chain, index: number, address: string, driver: ChainDriver) {
    const busy = await this.db.query(
      `SELECT 1 FROM transfers WHERE chain = $1 AND network = $2 AND status IN ('pending', 'signed', 'broadcast') AND (from_index = $3 OR (kind = 'gas' AND to_address = $4)) LIMIT 1`,
      [chain, this.config.network, index, address],
    );
    if (busy.rows.length) return;
    const hot = await this.addressFor(chain, { kind: 'hot' });
    const sweepable = this.config.limits.filter(limit => limit.chain === chain && limit.sweepMin !== null);
    const native = await driver.balance(address, null);
    for (const limit of sweepable.filter(l => l.contract)) {
      const held = await driver.balance(address, limit.contract);
      if (held < limit.sweepMin!) continue;
      const gas = await driver.tokenGas(address, limit.contract!, hot, held);
      if (native < gas) {
        const coin = this.limitFor(chain, null);
        const amount = isEvm(chain) ? gas - native : gas;
        if (coin && amount > coin.perTransfer) throw new Error(`gas of ${amount} is above the coin's per-transfer limit`);
        await this.create('gas', chain, nativeCoin[chain].asset, null, address, amount, null);
      } else {
        await this.create('sweep', chain, limit.asset, limit.contract, hot, held, index);
      }
      return;
    }
    const coin = sweepable.find(l => !l.contract);
    if (coin && native >= coin.sweepMin!) await this.create('sweep', chain, coin.asset, null, hot, native, index);
  }

  private async create(kind: 'sweep' | 'gas', chain: Chain, asset: string, contract: string | null, to: string, amount: bigint, fromIndex: number | null) {
    const reference = `${kind}:${chain}:${fromIndex ?? to}:${asset}:${Date.now()}`;
    await this.db.query(
      `INSERT INTO transfers (reference, kind, chain, network, asset, contract, to_address, amount, from_index) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [reference, kind, chain, this.config.network, asset, contract, to, amount.toString(), fromIndex],
    );
    this.log(`${kind}.created`, { reference, amount: amount.toString() });
  }

  // ---- Balances ------------------------------------------------------------------------------------------------

  /** What every address the signer knows holds (hot wallet and tracked deposit addresses), per coin and token. */
  async balances(network: string) {
    if (network !== this.config.network) throw new HttpError(422, `this signer serves ${this.config.network} only`);
    const out: { chain: Chain; asset: string; contract: string | null; amount: string; decimals: number }[] = [];
    for (const chain of chains) {
      const driver = this.drivers[chain];
      if (!driver) continue;
      const tracked = await this.db.query<{ address: string }>('SELECT address FROM deposit_addresses WHERE chain = $1 AND network = $2', [chain, network]);
      const addresses = [await this.addressFor(chain, { kind: 'hot' }), ...tracked.rows.map(r => r.address)];
      const assets = this.config.limits.filter(limit => limit.chain === chain);
      if (!assets.some(a => !a.contract)) assets.unshift({ chain, contract: null, asset: nativeCoin[chain].asset, decimals: nativeCoin[chain].decimals, perTransfer: 0n, daily: 0n, sweepMin: null });
      for (const asset of assets) {
        let total = 0n;
        for (const address of addresses) total += await driver.balance(address, asset.contract);
        out.push({ chain, asset: asset.asset, contract: asset.contract, amount: total.toString(), decimals: asset.decimals });
      }
    }
    return { network, balances: out };
  }
}
