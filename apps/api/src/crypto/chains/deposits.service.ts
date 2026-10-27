import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { type CoinOwner, coinWalletRef, ownerOf, ownerWhere } from '../owner.js';
import { PrismaService } from '../../database/prisma.service.js';
import { type ChainRoute, type CryptoAddress, type CryptoDeposit, type CryptoNetwork, type LedgerMode, Prisma } from '../../generated/prisma/client.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { InboxService } from '../../notifications/inbox.service.js';
import { fromUnits, maxUnits, toUnits } from '../amounts.js';
import { CryptoWalletsService, notFound } from '../crypto-wallets.service.js';
import { type AddressFamily, deriveAddress, xpubFingerprint } from '../derive.js';
import { providerKeys } from './check.js';
import { type Chain, type ChainClient, ChainError, chainFamily, chainNames, chains, checkNetwork, type Inspection, isEvm, normaliseAddress, normaliseContract, normaliseHash, tokenStandard, type Transfer } from './client.js';
import { type ChainProvider, chainProvider, chainProviders, providerChains, providerInSandbox } from './providers.js';

/** How long an address shown to a customer is watched for deposits (renewed each time it is shown). */
export const watchMs = 7 * 86_400_000;
/** EVM blocks read per scan (providers cap eth_getLogs ranges), and how far back a first scan starts. */
const evmRangeBlocks = 1_000n;
const firstScanBlocks = 200n;
/** Blocks left unscanned at the tip of EVM chains, until every node behind a provider has indexed them. */
const scanLagBlocks = 2n;
/** Unwatched addresses read per chain and run (TRON and Bitcoin list each address's history): about 36,000 a day. */
const sweepBatch = 50;
/** A deposit the chain stops showing is failed only after this long, and only when no provider shows it. */
const missingFailsAfterMs = 6 * 3_600_000;
/** Notifications whose transactions could not be read are retried by the job this many times. */
const maxNoticeAttempts = 20;
/** Recently shown addresses read every run per chain and mode; the rest wait for their sweep. */
const watchBatch = 100;
/** Addresses per request batch when each address's history is read (time is checked between batches). */
const addressChunk = 25;
/** Addresses per eth_getLogs request (providers cap the filter's size). */
const logChunk = 500;
/** Pending deposits checked per mode and run, least recently checked first. */
const settleBatch = 50;
/** The `crypto` job's time for deposits, inside Vercel's 300-second function limit (withdrawals run first). */
export const depositBudgetMs = 200_000;
/** Of that, the most settling pending deposits may take before scanning starts. */
const settleBudgetMs = 60_000;

/** A transaction a provider listed that no provider can read yet (a lagging node): unclear, never "nothing". */
class NotVisibleYet extends ChainError {}

type Route = { provider: ChainProvider; client: ChainClient };

const unavailable = (message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'deposits_unavailable', message, param);

/** On-chain units in the asset's ledger places (rounded down; the dust stays with BitoCard). */
export function ledgerUnits(raw: bigint, chainDecimals: number, assetDecimals: number) {
  return chainDecimals >= assetDecimals ? raw / 10n ** BigInt(chainDecimals - assetDecimals) : raw * 10n ** BigInt(assetDecimals - chainDecimals);
}

/** Transaction hashes in a provider's notification, whatever its shape: 0x… (EVM), 64 hex (TRON, Bitcoin, Litecoin, Dogecoin). */
export function hashesIn(body: string, chain: Chain) {
  const pattern = isEvm(chain) ? /0x[0-9a-fA-F]{64}/g : /\b[0-9a-fA-F]{64}\b/g;
  // In one case, so a hash written in capitals is the same transaction.
  return [...new Set((body.match(pattern) ?? []).map(normaliseHash))].slice(0, 100);
}

/**
 * Crypto deposits on chain. Each customer gets their own deposit address per family (Bitcoin, EVM, TRON), derived
 * from BitoCard's account xpubs (`crypto_keys`; live keys for live stores, test network keys for sandbox stores).
 * Chains are read through the blockchain providers in the order admins set per chain (Crypto > Chains), falling back
 * to the next when one fails; a provider serves sandbox stores while its Sandbox switch is on, live ones otherwise.
 *
 * Deposits are found by scanning watched addresses (the `crypto` job) and by providers' webhooks, which only name
 * transactions: every transaction is re-read from the chain before anything is recorded. A deposit is credited once
 * it has its network's confirmations, and, from `double_check_from`, once a second provider agrees on it; then
 * `crypto_custody` to the customer's `crypto_wallet`, once (`crypto_deposit:<chain>:<tx>:<index>`).
 */
@Injectable()
export class CryptoDepositsService {
  private readonly logger = new Logger(CryptoDepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly integrations: IntegrationsService,
    private readonly wallets: CryptoWalletsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  // -- Providers and routes -------------------------------------------------------------------------------------

  private values(provider: ChainProvider) {
    return this.integrations.values(providerKeys(provider));
  }

  /** Route rows for every provider that can serve a chain, made on first use (in the providers' list order). */
  private async routeRows(chain: Chain) {
    const offered = chainProviders.filter(provider => providerChains(provider).includes(chain));
    const rows = await this.prisma.chainRoute.findMany({ where: { chain } });
    const missing = offered.filter(provider => !rows.some(row => row.provider === provider.id));
    if (missing.length) {
      await this.prisma.chainRoute.createMany({ data: missing.map(provider => ({ chain, provider: provider.id, priority: (offered.indexOf(provider) + 1) * 10 })), skipDuplicates: true });
      return this.prisma.chainRoute.findMany({ where: { chain } });
    }
    return rows;
  }

  /**
   * The providers to ask for a chain in a mode, in order: enabled, set up, in the matching environment, and on the
   * matching network (a pasted endpoint still on a test network never serves live stores; checked, then cached).
   */
  async routes(chain: Chain, mode: LedgerMode): Promise<Route[]> {
    const rows = (await this.routeRows(chain)).filter(row => row.enabled).sort((a, b) => a.priority - b.priority);
    const routes: Route[] = [];
    for (const row of rows) {
      const provider = chainProvider(row.provider);
      if (!provider) continue;
      const values = this.values(provider);
      if (providerInSandbox(provider, values) !== (mode === 'test')) continue;
      const client = provider.endpoints(values, mode === 'test' ? 'sandbox' : 'live')[chain];
      if (!client) continue;
      try {
        await checkNetwork(chain, client, mode === 'test' ? 'sandbox' : 'live');
        routes.push({ provider, client });
      } catch (error) {
        await this.noteError(chain, provider.id, error);
      }
    }
    return routes;
  }

  private async noteError(chain: Chain, provider: string, error: unknown) {
    await this.prisma.chainRoute.updateMany({ where: { chain, provider }, data: { lastError: (error instanceof Error ? error.message : 'error').slice(0, 300), checkedAt: new Date() } });
  }

  /** Asks each route in turn until one answers; a failure is noted on its route and the next is tried. */
  async ask<T>(chain: Chain, routes: Route[], call: (client: ChainClient) => Promise<T>): Promise<{ value: T; provider: string }> {
    let last: unknown = null;
    for (const route of routes) {
      try {
        return { value: await call(route.client), provider: route.provider.id };
      } catch (error) {
        last = error;
        await this.noteError(chain, route.provider.id, error);
      }
    }
    throw last ?? new Error(`No provider is set up for ${chain}`);
  }

  // -- Deposit addresses ----------------------------------------------------------------------------------------

  private xpub(family: AddressFamily, mode: LedgerMode) {
    const key = `CRYPTO_${mode === 'test' ? 'TEST_' : ''}XPUB_${family.toUpperCase()}`;
    return this.integrations.values([key])[key];
  }

  /** The networks a customer can deposit an asset on now (switched on, with a key and a provider for the store's mode). */
  async depositNetworks(customer: CustomerWithStore, asset: string) {
    const context = await this.wallets.requireUse(customer);
    return this.networksOpen(context.mode, asset);
  }

  /** The networks an asset can be deposited on in a mode: switched on, with a key and a provider. */
  async networksOpen(mode: LedgerMode, asset: string) {
    const context = { mode };
    const found = await this.wallets.asset(asset);
    const networks = await this.prisma.cryptoNetwork.findMany({ where: { asset: found.code, depositsEnabled: true }, orderBy: { chain: 'asc' } });
    const usable = [];
    for (const network of networks) {
      const chain = network.chain as Chain;
      const family = chainFamily[chain];
      if (family === 'solana') continue;
      if (network.contract && !(context.mode === 'live' ? network.contract : network.testContract)) continue;
      if (!this.xpub(family, context.mode) || !(await this.routes(chain, context.mode)).length) continue;
      usable.push({ object: 'crypto_network' as const, asset: found.code, chain, name: chainNames[chain], token: network.contract ? tokenStandard(chain) : null, confirmations: network.confirmations });
    }
    return { object: 'list' as const, data: usable };
  }

  /**
   * The customer's own deposit address for an asset on a chain: made once per family from BitoCard's xpub at the
   * next free index, then the same every time; showing it watches it for deposits for a week.
   */
  async depositAddress(customer: CustomerWithStore, input: { asset: string; chain: string }) {
    const context = await this.wallets.requireUse(customer);
    return this.addressFor({ customerId: customer.id }, context.mode, input);
  }

  /** An owner's deposit address (a customer's, or a Premium reseller's own): one per family and mode, for good. */
  async addressFor(owner: CoinOwner, mode: LedgerMode, input: { asset: string; chain: string }) {
    const context = { mode };
    const asset = await this.wallets.asset(input.asset);
    const chain = input.chain.toUpperCase() as Chain;
    const network = chains.includes(chain) ? await this.prisma.cryptoNetwork.findUnique({ where: { asset_chain: { asset: asset.code, chain } } }) : null;
    if (!network?.depositsEnabled) throw unavailable(`${asset.code} deposits on this network are not open yet.`, 'chain');
    const family = chainFamily[chain];
    if (family === 'solana') throw unavailable('Solana deposits open once BitoCard’s signer issues Solana addresses.', 'chain');
    if (network.contract && !(context.mode === 'live' ? network.contract : network.testContract)) throw unavailable(`${asset.code} on ${chainNames[chain]} has no test network token yet.`, 'chain');
    const xpub = this.xpub(family, context.mode);
    if (!xpub || !(await this.routes(chain, context.mode)).length) throw unavailable(`${chainNames[chain]} deposits are not set up yet.`, 'chain');

    const watchUntil = new Date(Date.now() + watchMs);
    const mine = () => this.prisma.cryptoAddress.findFirst({ where: { ...ownerWhere(owner), mode: context.mode, family } });
    let address = await mine();
    for (let attempt = 0; !address && attempt < 5; attempt += 1) {
      const last = await this.prisma.cryptoAddress.findFirst({ where: { mode: context.mode, family }, orderBy: { index: 'desc' }, select: { index: true } });
      const index = (last?.index ?? -1) + 1;
      try {
        address = await this.prisma.cryptoAddress.create({
          data: { ...ownerWhere(owner), mode: context.mode, family, index, address: deriveAddress(family, xpub, index), keyFingerprint: xpubFingerprint(xpub), watchUntil },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        address = await mine();
      }
    }
    if (!address) throw new Error('Could not issue a deposit address');
    if (address.watchUntil < watchUntil) await this.prisma.cryptoAddress.update({ where: { id: address.id }, data: { watchUntil } });
    return {
      object: 'crypto_deposit_address' as const,
      mode: context.mode,
      asset: asset.code,
      chain,
      network: chainNames[chain],
      address: address.address,
      /** The token contract, so the customer can check they send the right token. */
      contract: network.contract ? (context.mode === 'live' ? network.contract : network.testContract) : null,
      confirmations: network.confirmations,
      watch_until: watchUntil.toISOString(),
    };
  }

  /** The customer's deposits, newest first. */
  async customerDeposits(customer: CustomerWithStore) {
    return this.depositsOf({ customerId: customer.id }, (await this.wallets.context(customer)).mode);
  }

  /** An owner's deposits in a mode, newest first. */
  async depositsOf(owner: CoinOwner, mode: LedgerMode) {
    const rows = await this.prisma.cryptoDeposit.findMany({ where: { ...ownerWhere(owner), mode }, orderBy: { createdAt: 'desc' }, take: 25 });
    return { object: 'list' as const, data: await this.present(rows) };
  }

  private async present(rows: CryptoDeposit[]) {
    const assets = new Map((await this.wallets.assets(true)).map(asset => [asset.code, asset]));
    const networks = await this.prisma.cryptoNetwork.findMany();
    return rows.map(row => {
      const network = networks.find(item => item.asset === row.asset && item.chain === row.chain);
      return {
        object: 'crypto_deposit' as const,
        id: row.id,
        mode: row.mode,
        asset: row.asset,
        chain: row.chain,
        network: chainNames[row.chain as Chain],
        tx_hash: row.txHash,
        amount: fromUnits(row.amount, assets.get(row.asset)?.decimals ?? 8),
        status: row.status,
        confirmations: row.confirmations,
        confirmations_needed: network?.confirmations ?? null,
        created_at: row.createdAt.toISOString(),
        credited_at: row.creditedAt?.toISOString() ?? null,
      };
    });
  }

  // -- Finding deposits -----------------------------------------------------------------------------------------

  /**
   * The `crypto` job: pending deposits moved on first (never held up by a slow scan), then every chain in both modes
   * scanned (starting from a different chain each run, so none is always last), then notifications retried, all
   * within `deadline` so the run ends inside the function's time limit. Safe to run twice.
   */
  async job(input: { deadline?: number } = {}) {
    const deadline = input.deadline ?? Date.now() + depositBudgetMs;
    const summary: Record<string, unknown> = {};
    summary.settled = await this.settlePending(Math.min(deadline, Date.now() + settleBudgetMs));
    const scanned = chains.filter(chain => chain !== 'SOLANA');
    const start = Math.floor(Date.now() / 120_000) % scanned.length;
    const order = [...scanned.slice(start), ...scanned.slice(0, start)];
    for (const mode of ['live', 'test'] as const) {
      for (const chain of order) {
        if (Date.now() >= deadline) {
          summary[`${mode}:${chain}`] = { skipped: 'out of time' };
          continue;
        }
        try {
          summary[`${mode}:${chain}`] = await this.scan(chain, mode, deadline);
        } catch (error) {
          summary[`${mode}:${chain}`] = { error: error instanceof Error ? error.message : 'error' };
        }
      }
    }
    summary.notices = Date.now() < deadline ? await this.retryNotices(deadline) : { skipped: 'out of time' };
    return summary;
  }

  /** The networks on a chain whose deposits are on, with the token contract for the mode. */
  private async networksFor(chain: Chain, mode: LedgerMode) {
    const networks = await this.prisma.cryptoNetwork.findMany({ where: { chain, depositsEnabled: true } });
    return networks.flatMap(network => {
      const contract = network.contract ? (mode === 'live' ? network.contract : network.testContract) : null;
      if (network.contract && !contract) return [];
      return [{ network, contract: contract ? normaliseContract(chain, contract) : null }];
    });
  }

  /**
   * One chain in one mode: transfers into customers' addresses since the last scan, each re-read before it is recorded.
   * An address is the customer's for good, so none is ever left unread: EVM token logs are filtered by address in the
   * same block range, so every address is scanned; listing an address's own history (plain ETH and BNB, TRON, Bitcoin)
   * costs a request per address, so those cover the most recently shown addresses (up to `watchBatch`) plus a turn of
   * the others, oldest sweep first. Stops at `deadline`: the EVM cursor moves only once its whole block range was read.
   */
  async scan(chain: Chain, mode: LedgerMode, deadline = Date.now() + depositBudgetMs) {
    const family = chainFamily[chain];
    const networks = await this.networksFor(chain, mode);
    if (!networks.length) return { skipped: 'no networks' };
    const evm = isEvm(chain);
    const now = new Date();
    const watched = await this.prisma.cryptoAddress.findMany({ where: { mode, family, watchUntil: { gt: now } }, orderBy: [{ watchUntil: 'desc' }, { index: 'asc' }], take: watchBatch });
    // Everything else, including watched addresses beyond the batch, is swept in turn (its whole history is read).
    const sweep = await this.prisma.cryptoAddress.findMany({
      where: { mode, family, id: { notIn: watched.map(item => item.id) } },
      orderBy: [{ sweptAt: { sort: 'asc', nulls: 'first' } }, { index: 'asc' }],
      take: sweepBatch,
    });
    if (!watched.length && !sweep.length) return { skipped: 'no addresses' };
    const routes = await this.routes(chain, mode);
    if (!routes.length) return { skipped: 'no provider' };
    const contracts = networks.flatMap(item => (item.contract ? [item.contract] : []));
    const native = networks.some(item => !item.contract);

    // Tokens and the chain's own coin are listed by the providers that can list each (a standard EVM node finds token
    // logs but not plain ETH; only TronGrid lists TRON accounts' tokens): asking one that cannot would answer "nothing".
    const tokenRoutes = routes.filter(route => route.client.scan && route.client.tokenScan);
    const coinRoutes = routes.filter(route => route.client.scan && route.client.nativeScan);
    if (contracts.length && !tokenRoutes.length && !native) return { skipped: 'no provider lists token deposits (webhooks only)' };
    const notes: string[] = [];
    if (contracts.length && !tokenRoutes.length) notes.push('token deposits: webhooks only');
    if (native && !coinRoutes.length) notes.push('coin deposits: webhooks only (no provider here lists them)');
    const found: Transfer[] = [];
    const timeLeft = () => Date.now() < deadline;
    /** Reads a list in batches while there is time; returns how many it read. */
    const batches = async <T>(list: T[], size: number, read: (part: T[]) => Promise<Transfer[]>) => {
      let done = 0;
      for (let i = 0; i < list.length && timeLeft(); i += size) {
        const part = list.slice(i, i + size);
        found.push(...(await read(part)));
        done += part.length;
      }
      return done;
    };
    const swept: string[] = [];
    let range: { from: bigint; to: bigint; complete: boolean } | null = null;

    if (evm) {
      // Scanning stops a few blocks short of the tip: a load-balanced node can report a block its logs do not cover yet.
      const tip = (await this.ask(chain, routes, client => client.latestBlock())).value;
      const latest = tip > scanLagBlocks ? tip - scanLagBlocks : tip;
      const cursor = await this.prisma.chainCursor.findUnique({ where: { chain_mode: { chain, mode } } });
      const fromBlock = cursor ? cursor.block + 1n : latest > firstScanBlocks ? latest - firstScanBlocks : 0n;
      const toBlock = fromBlock + evmRangeBlocks - 1n < latest ? fromBlock + evmRangeBlocks - 1n : latest;
      if (fromBlock <= latest) {
        let complete = true;
        if (contracts.length && tokenRoutes.length) {
          const every = (await this.prisma.cryptoAddress.findMany({ where: { mode, family }, select: { address: true } })).map(item => normaliseAddress(chain, item.address));
          const read = await batches(every, logChunk, async part => (await this.ask(chain, tokenRoutes, client => client.scan!({ addresses: part, contracts, native: false, fromBlock, toBlock }))).value);
          complete &&= read === every.length;
        }
        if (native && coinRoutes.length && watched.length) {
          const list = watched.map(item => normaliseAddress(chain, item.address));
          const read = await batches(list, addressChunk, async part => (await this.ask(chain, coinRoutes, client => client.scan!({ addresses: part, contracts: [], native: true, fromBlock, toBlock }))).value);
          complete &&= read === list.length;
        }
        range = { from: fromBlock, to: toBlock, complete };
      }
      // Plain coin transfers are listed per address over a block range: swept addresses are read over their whole history.
      if (native && coinRoutes.length) {
        await batches(sweep, addressChunk, async part => {
          const value = (await this.ask(chain, coinRoutes, client => client.scan!({ addresses: part.map(item => normaliseAddress(chain, item.address)), contracts: [], native: true, fromBlock: 0n, toBlock: latest }))).value;
          swept.push(...part.map(item => item.id));
          return value;
        });
      } else {
        // Token logs already cover every address: nothing more to read for the sweep.
        swept.push(...sweep.map(item => item.id));
      }
    } else {
      // TRON and the Bitcoin-style chains list each address's own recent history: watched addresses every run, the rest in turn.
      const sweptIds = new Set(sweep.map(item => item.id));
      await batches([...watched, ...sweep], addressChunk, async part => {
        const addresses = part.map(item => normaliseAddress(chain, item.address));
        const value: Transfer[] = [];
        if (contracts.length && tokenRoutes.length) value.push(...(await this.ask(chain, tokenRoutes, client => client.scan!({ addresses, contracts, native: false, fromBlock: 0n, toBlock: 0n }))).value);
        if (native && coinRoutes.length) value.push(...(await this.ask(chain, coinRoutes, client => client.scan!({ addresses, contracts: [], native: true, fromBlock: 0n, toBlock: 0n }))).value);
        swept.push(...part.filter(item => sweptIds.has(item.id)).map(item => item.id));
        return value;
      });
    }
    if (!timeLeft()) notes.push('out of time: the rest is read next run');

    const hashes = [...new Set(found.map(item => normaliseHash(item.hash)))];
    const known = new Set((await this.prisma.cryptoDeposit.findMany({ where: { chain, txHash: { in: hashes }, status: { not: 'failed' } }, select: { txHash: true } })).map(item => item.txHash));
    let recorded = 0;
    let deferred = 0;
    // A transaction that cannot be read now (every provider down) throws before the cursor moves, so the same blocks
    // are scanned again. One the providers answer about but none shows yet (a lagging node) is kept to be retried.
    for (const hash of hashes.filter(item => !known.has(item))) {
      try {
        recorded += await this.record(chain, mode, hash, routes);
      } catch (error) {
        if (!(error instanceof NotVisibleYet)) throw error;
        await this.defer(chain, mode, hash);
        deferred += 1;
      }
    }
    if (range?.complete) await this.prisma.chainCursor.upsert({ where: { chain_mode: { chain, mode } }, create: { chain, mode, block: range.to }, update: { block: range.to } });
    await this.markSwept(swept);
    return {
      ...(range ? { from: String(range.from), to: String(range.to) } : {}),
      seen: found.length,
      recorded,
      ...(deferred ? { deferred } : {}),
      watched: watched.length,
      swept: swept.length,
      ...(notes.length ? { notes } : {}),
    };
  }

  private async markSwept(ids: string[]) {
    if (ids.length) await this.prisma.cryptoAddress.updateMany({ where: { id: { in: ids } }, data: { sweptAt: new Date() } });
  }

  /** A transaction a scan found that no provider shows yet: kept as a notification in its mode, which the job retries. */
  private async defer(chain: Chain, mode: LedgerMode, hash: string) {
    const bodyHash = createHash('sha256').update(`scan\n${mode}\n${chain}\n${hash}`).digest('hex');
    try {
      await this.prisma.chainNotice.create({ data: { id: randomUUID(), provider: 'scan', chain, mode, bodyHash, hashes: [hash] } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }

  /**
   * Re-reads one transaction and records each transfer in it to a customer's address, in a network whose deposits
   * are on (the token's contract exactly; the coin itself for coin networks). Returns how many it recorded. Every
   * provider is asked until one shows it: one that does not know it yet is not "no transaction" (it may lag), so a
   * transaction no provider shows throws `NotVisibleYet` and is tried again later.
   */
  async record(chain: Chain, mode: LedgerMode, hash: string, routes?: Route[]) {
    const ways = routes ?? (await this.routes(chain, mode));
    if (!ways.length) throw new ChainError(`No provider is set up for ${chainNames[chain]}`);
    let inspection: Inspection | null = null;
    let provider = '';
    let failed = 0;
    let last: unknown = null;
    for (const route of ways) {
      try {
        inspection = await route.client.inspect(normaliseHash(hash));
      } catch (error) {
        failed += 1;
        last = error;
        await this.noteError(chain, route.provider.id, error);
        continue;
      }
      if (inspection) {
        provider = route.provider.id;
        break;
      }
    }
    if (!inspection) {
      if (failed === ways.length) throw last;
      throw new NotVisibleYet(`No provider shows ${hash} yet`);
    }
    if (!inspection.ok) return 0;
    const networks = await this.networksFor(chain, mode);
    const family = chainFamily[chain];
    // EVM addresses are stored checksummed and reported in lower case: compared without case.
    const ours = await this.prisma.cryptoAddress.findMany({ where: { mode, family, address: { in: [...new Set(inspection.transfers.map(item => item.to))], mode: family === 'evm' ? 'insensitive' : 'default' } } });
    const byAddress = new Map<string, CryptoAddress>(ours.map(item => [normaliseAddress(chain, item.address), item]));
    let recorded = 0;
    for (const transfer of inspection.transfers) {
      const address = byAddress.get(normaliseAddress(chain, transfer.to));
      const match = networks.find(item => (item.contract ? transfer.contract !== null && normaliseContract(chain, transfer.contract) === item.contract : transfer.contract === null));
      if (!address || !match || transfer.raw <= 0n) continue;
      // The hash as the chain gave it (one case), so the same transaction is never recorded twice.
      recorded += await this.upsertDeposit(chain, mode, address, match.network, { ...transfer, hash: normaliseHash(transfer.hash) }, inspection, provider);
    }
    return recorded;
  }

  private async upsertDeposit(chain: Chain, mode: LedgerMode, address: CryptoAddress, network: CryptoNetwork, transfer: Transfer, inspection: Inspection, provider: string) {
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: network.asset } });
    const units = ledgerUnits(transfer.raw, network.decimals, asset.decimals);
    // More than a ledger account can hold (a worthless token minted in absurd amounts): recorded as ignored, never
    // credited, so it can never jam the scan.
    const tooLarge = units > maxUnits;
    if (tooLarge) this.logger.warn({ chain, tx: transfer.hash, index: transfer.index }, 'A crypto deposit too large to credit was ignored');
    const amount = tooLarge ? 0n : units;
    try {
      await this.prisma.cryptoDeposit.create({
        data: {
          customerId: address.customerId,
          resellerId: address.resellerId,
          mode,
          chain,
          asset: network.asset,
          address: address.address,
          txHash: transfer.hash,
          outputIndex: transfer.index,
          rawAmount: transfer.raw.toString(),
          amount,
          blockNumber: inspection.block,
          status: amount > 0n ? 'pending' : 'ignored',
          confirmedBy: [provider],
        },
      });
      return 1;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      // Seen before. One marked failed (the chain had stopped showing it) that is back on chain is pending again.
      const revived = await this.prisma.cryptoDeposit.updateMany({
        where: { chain, txHash: transfer.hash, outputIndex: transfer.index, status: 'failed', rawAmount: transfer.raw.toString() },
        data: { status: 'pending', confirmations: 0, blockNumber: inspection.block, confirmedBy: [provider], checkedAt: new Date(), missingSince: null },
      });
      return revived.count;
    }
  }

  /** Operations ask for a deposit to be checked again now (a failed one goes back to pending first). */
  async recheck(adminId: string | null, id: string) {
    const deposit = await this.prisma.cryptoDeposit.findUnique({ where: { id } });
    if (!deposit) throw notFound('deposit');
    if (deposit.status === 'failed') await this.prisma.cryptoDeposit.updateMany({ where: { id, status: 'failed' }, data: { status: 'pending', missingSince: null } });
    const fresh = await this.prisma.cryptoDeposit.findUniqueOrThrow({ where: { id } });
    if (fresh.status === 'pending') await this.settle(fresh).catch(error => this.logger.warn({ err: error, deposit: id }, 'Could not check a crypto deposit'));
    await this.audit.record({ actorId: adminId, action: 'crypto.deposit_rechecked', targetType: 'crypto_deposit', targetId: id, before: { status: deposit.status }, after: null });
    return (await this.present([await this.prisma.cryptoDeposit.findUniqueOrThrow({ where: { id } })]))[0];
  }

  /**
   * Moves pending deposits on: each is re-read for its confirmations; once it has enough (and, when large, a second
   * provider has seen the same transfer), it is credited once. One that no provider shows fails 6 hours after it went
   * missing. Each mode in turn, least recently checked first, so a deposit that cannot move (no provider for its mode,
   * no second provider for a large one) never holds up the others; operations are told about those once.
   */
  async settlePending(deadline = Date.now() + settleBudgetMs) {
    let checked = 0;
    let credited = 0;
    for (const mode of ['live', 'test'] as const) {
      const pending = await this.prisma.cryptoDeposit.findMany({ where: { status: 'pending', mode }, orderBy: [{ checkedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }], take: settleBatch });
      for (const deposit of pending) {
        if (Date.now() >= deadline) break;
        checked += 1;
        // Marked before it is read, so the next run starts with others even when this one throws.
        await this.prisma.cryptoDeposit.updateMany({ where: { id: deposit.id, status: 'pending' }, data: { checkedAt: new Date() } });
        try {
          if (await this.settle(deposit)) credited += 1;
        } catch (error) {
          this.logger.warn({ err: error, deposit: deposit.id }, 'Could not check a crypto deposit');
        }
      }
    }
    return { checked, credited };
  }

  private async settle(deposit: CryptoDeposit) {
    const chain = deposit.chain as Chain;
    const routes = await this.routes(chain, deposit.mode);
    if (!routes.length) {
      await this.inbox.admins('admin.crypto.deposit_stuck', {
        subject: `no_route:${deposit.mode}:${chain}:${new Date().toISOString().slice(0, 10)}`,
        title: `${chainNames[chain]} deposits cannot be checked (${deposit.mode})`,
        body: `No blockchain provider serves ${chainNames[chain]} for ${deposit.mode === 'live' ? 'live' : 'sandbox'} stores, so pending deposits there wait. Set one up, switched ${deposit.mode === 'live' ? 'off' : 'on'} Sandbox, under Crypto > Chains.`,
        link: '/crypto/chains',
        mode: deposit.mode,
      });
      return false;
    }
    const network = await this.prisma.cryptoNetwork.findUniqueOrThrow({ where: { asset_chain: { asset: deposit.asset, chain } } });
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: deposit.asset } });
    const same = (found: Inspection | null) => found?.ok && found.transfers.some(item => item.index === deposit.outputIndex && item.raw.toString() === deposit.rawAmount && normaliseAddress(chain, item.to) === normaliseAddress(chain, deposit.address));
    // Every provider is asked until one shows it: one not showing it is not enough (a lagging node, a transaction
    // dropped from one mempool).
    let seen: { inspection: Inspection; latest: bigint; provider: string } | null = null;
    let failed = 0;
    let last: unknown = null;
    for (const route of routes) {
      try {
        const inspection = await route.client.inspect(deposit.txHash);
        if (same(inspection)) {
          seen = { inspection: inspection!, latest: await route.client.latestBlock(), provider: route.provider.id };
          break;
        }
      } catch (error) {
        failed += 1;
        last = error;
        await this.noteError(chain, route.provider.id, error);
      }
    }
    if (!seen) {
      if (failed === routes.length) throw last;
      // Only when every provider answered and none shows it does the clock run; it fails 6 hours after it went missing.
      if (failed) return false;
      const since = deposit.missingSince ?? new Date();
      if (!deposit.missingSince) await this.prisma.cryptoDeposit.updateMany({ where: { id: deposit.id, status: 'pending', missingSince: null }, data: { missingSince: since } });
      if (Date.now() - since.getTime() > missingFailsAfterMs) {
        await this.prisma.cryptoDeposit.updateMany({ where: { id: deposit.id, status: 'pending' }, data: { status: 'failed', checkedAt: new Date() } });
      }
      return false;
    }
    const { inspection, latest } = seen;
    const block = inspection.block;
    const confirmations = block === null ? 0 : Number(latest - block + 1n);
    const confirmedBy = new Set([...deposit.confirmedBy, seen.provider]);
    // Large deposits: a second, different provider must see the same transfer.
    const large = deposit.amount >= toUnits(network.doubleCheckFrom, asset.decimals);
    const others = routes.filter(item => !confirmedBy.has(item.provider.id));
    if (large && confirmedBy.size < 2) {
      for (const route of others) {
        const second = await route.client.inspect(deposit.txHash).catch(() => null);
        if (same(second)) {
          confirmedBy.add(route.provider.id);
          break;
        }
      }
    }
    await this.prisma.cryptoDeposit.update({ where: { id: deposit.id }, data: { confirmations, blockNumber: block, confirmedBy: [...confirmedBy], checkedAt: new Date(), missingSince: null } });
    if (large && confirmedBy.size < 2 && !others.length && confirmations >= network.confirmations) {
      // Confirmed, but no second provider serves this chain and mode to agree on it: it waits for operations.
      await this.inbox.admins('admin.crypto.deposit_stuck', {
        subject: `double_check:${deposit.id}`,
        title: `A large ${deposit.asset} deposit needs a second provider`,
        body: `A ${fromUnits(deposit.amount, asset.decimals)} ${deposit.asset} deposit on ${chainNames[chain]} is confirmed, but only one blockchain provider serves ${chainNames[chain]} here, and deposits from ${network.doubleCheckFrom} ${deposit.asset} need two to agree. Set up a second provider under Crypto > Chains.`,
        link: '/crypto/deposits',
        mode: deposit.mode,
      });
    }
    if (confirmations < network.confirmations || (large && confirmedBy.size < 2)) return false;
    return this.credit(deposit, asset.decimals);
  }

  /** Credits a confirmed deposit to its owner's coin wallet (a customer's, or a reseller's own), once. */
  private async credit(deposit: CryptoDeposit, decimals: number) {
    const owner = ownerOf(deposit);
    const walletRef = coinWalletRef(owner, deposit.asset);
    const custody = await this.ledger.accountId(deposit.mode, { kind: 'crypto_custody', currency: deposit.asset });
    const wallet = await this.ledger.accountId(deposit.mode, walletRef);
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.cryptoDeposit.updateMany({ where: { id: deposit.id, status: 'pending' }, data: { status: 'credited', creditedAt: new Date() } });
      if (claimed.count !== 1) return false;
      await this.ledger.write(tx, {
        mode: deposit.mode,
        type: 'crypto_deposit',
        reference: `crypto_deposit:${deposit.chain}:${deposit.txHash}:${deposit.outputIndex}`,
        resellerId: owner.resellerId ?? null,
        description: `${deposit.asset} deposit on ${chainNames[deposit.chain as Chain]}`,
        metadata: { deposit_id: deposit.id, tx_hash: deposit.txHash },
        postings: [
          { accountId: custody, kind: 'crypto_custody', amount: deposit.amount },
          { accountId: wallet, kind: walletRef.kind, amount: -deposit.amount },
        ],
      });
      return true;
    });
    if (!done) return false;
    if (owner.resellerId) {
      await this.inbox.reseller(owner.resellerId, 'crypto.deposit_credited', {
        subject: deposit.id,
        title: `${fromUnits(deposit.amount, decimals)} ${deposit.asset} arrived`,
        body: `Your ${deposit.asset} deposit on ${chainNames[deposit.chain as Chain]} is in your coin wallet.`,
        link: '/exchange/coins',
        mode: deposit.mode,
      });
      return true;
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: owner.customerId }, select: { storeId: true } });
    if (customer) {
      await this.inbox.customer({ customerId: owner.customerId!, storeId: customer.storeId }, 'customer.crypto.deposit_credited', {
        subject: deposit.id,
        title: `${fromUnits(deposit.amount, decimals)} ${deposit.asset} arrived`,
        body: `Your ${deposit.asset} deposit on ${chainNames[deposit.chain as Chain]} is in your crypto wallet.`,
        link: '/account/crypto',
        mode: deposit.mode,
      });
    }
    return true;
  }

  // -- Provider notifications -----------------------------------------------------------------------------------

  /**
   * A provider's webhook: the signature checked with its secret (else a 401 that says nothing more), the transactions
   * it names kept once per body, and each re-read from the chain after the reply. The body itself is never trusted.
   */
  async notice(providerId: string, chainName: string | undefined, input: { headers: Record<string, string | undefined>; body: Buffer | undefined; url: URL }) {
    const provider = chainProvider(providerId);
    const chain = (chainName ?? '').toUpperCase() as Chain;
    const body = input.body?.toString('utf8') ?? '';
    if (!provider?.verify || !chains.includes(chain) || !provider.verify({ headers: input.headers, body, url: input.url }, this.values(provider))) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_signature', 'This notification could not be verified.');
    }
    const bodyHash = createHash('sha256').update(`${provider.id}\n${chain}\n${body}`).digest('hex');
    const hashes = hashesIn(body, chain);
    let notice;
    try {
      notice = await this.prisma.chainNotice.create({ data: { id: randomUUID(), provider: provider.id, chain, bodyHash, hashes } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { received: true };
      throw error;
    }
    waitUntil(this.processNotice(notice.id).catch(error => this.logger.warn({ err: error }, 'Could not process a chain notification')));
    return { received: true };
  }

  /**
   * Re-reads every transaction a notification named, in the mode its provider serves (or the mode a scan kept it
   * for). A transaction no provider can read or show yet is not "nothing": the notification stays unprocessed, keeping
   * only those, and the job tries again.
   */
  async processNotice(id: string) {
    const notice = await this.prisma.chainNotice.findUnique({ where: { id } });
    if (!notice || notice.processedAt) return;
    const provider = chainProvider(notice.provider);
    const mode: LedgerMode | null = notice.mode ?? (provider ? (providerInSandbox(provider, this.values(provider)) ? 'test' : 'live') : null);
    if (!mode) return void (await this.prisma.chainNotice.update({ where: { id }, data: { processedAt: new Date(), attempts: { increment: 1 } } }));
    const chain = notice.chain as Chain;
    const unresolved: string[] = [];
    let failure: unknown = null;
    for (const hash of notice.hashes) {
      try {
        await this.record(chain, mode, hash);
      } catch (error) {
        unresolved.push(hash);
        failure ??= error;
      }
    }
    if (!unresolved.length) {
      await this.prisma.chainNotice.update({ where: { id }, data: { processedAt: new Date(), attempts: { increment: 1 } } });
      return;
    }
    // Left unprocessed: the job tries again (a provider's own retry has the same body, so it is not stored twice).
    const updated = await this.prisma.chainNotice.update({ where: { id }, data: { attempts: { increment: 1 }, hashes: unresolved } });
    if (notice.provider === 'scan' && updated.attempts >= maxNoticeAttempts) {
      // A transfer a scan listed that no provider has shown since: operations look at it (a webhook's other hashes,
      // block hashes for one, are never transactions, so only scans' are raised).
      await this.inbox.admins('admin.crypto.deposit_stuck', {
        subject: `unread:${id}`,
        title: `A ${chainNames[chain]} transfer could not be read`,
        body: `A scan listed transaction ${unresolved.join(', ')} to a customer's address, but no provider has shown it since. Check it on a block explorer and recheck the providers under Crypto > Chains.`,
        link: '/crypto/chains',
        mode,
      });
    }
    throw failure;
  }

  /** Notifications whose transactions could not be read when they came (providers down or lagging), tried again. */
  private async retryNotices(deadline = Date.now() + depositBudgetMs) {
    const stale = await this.prisma.chainNotice.findMany({
      where: { processedAt: null, attempts: { lt: maxNoticeAttempts }, createdAt: { lt: new Date(Date.now() - 60_000) } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let processed = 0;
    for (const notice of stale) {
      if (Date.now() >= deadline) break;
      try {
        await this.processNotice(notice.id);
        processed += 1;
      } catch (error) {
        this.logger.warn({ err: error, notice: notice.id }, 'Could not process a chain notification');
      }
    }
    return { retried: stale.length, processed };
  }

  // -- Admin ----------------------------------------------------------------------------------------------------

  private presentRoute(row: ChainRoute) {
    const provider = chainProvider(row.provider);
    const values = provider ? this.values(provider) : {};
    const sandbox = provider ? providerInSandbox(provider, values) : false;
    const client = provider?.endpoints(values, sandbox ? 'sandbox' : 'live')[row.chain as Chain];
    return {
      object: 'chain_route' as const,
      chain: row.chain,
      provider: row.provider,
      name: provider?.name ?? row.provider,
      priority: row.priority,
      enabled: row.enabled,
      /** Credentials saved for this chain. */
      configured: Boolean(client),
      /** live (main network, live stores) or sandbox (test network, sandbox stores). */
      environment: sandbox ? ('sandbox' as const) : ('live' as const),
      lists_deposits: Boolean(client?.scan),
      finds_coin_deposits: Boolean(client?.nativeScan),
      webhooks: Boolean(provider?.verify),
      last_block: row.lastBlock !== null ? String(row.lastBlock) : null,
      last_error: row.lastError,
      checked_at: row.checkedAt?.toISOString() ?? null,
    };
  }

  /** Crypto > Chains: each chain's providers in order, and its networks. */
  async adminChains() {
    await this.integrations.refresh();
    const networks = await this.prisma.cryptoNetwork.findMany({ orderBy: [{ chain: 'asc' }, { asset: 'asc' }] });
    return {
      object: 'list' as const,
      data: await Promise.all(
        chains.map(async chain => ({
          object: 'chain' as const,
          chain,
          name: chainNames[chain],
          family: chainFamily[chain],
          keys: { live: chainFamily[chain] !== 'solana' && Boolean(this.xpub(chainFamily[chain] as AddressFamily, 'live')), test: chainFamily[chain] !== 'solana' && Boolean(this.xpub(chainFamily[chain] as AddressFamily, 'test')) },
          routes: (await this.routeRows(chain)).sort((a, b) => a.priority - b.priority).map(row => this.presentRoute(row)),
          networks: networks.filter(item => item.chain === chain).map(presentNetwork),
        })),
      ),
    };
  }

  /** Orders a chain's providers (the list given first, in order) and switches each on or off. */
  async setRoutes(adminId: string | null, chainName: string, input: { order: string[]; disabled: string[] }) {
    const chain = chainName.toUpperCase() as Chain;
    if (!chains.includes(chain)) throw notFound('chain');
    const rows = await this.routeRows(chain);
    const unknown = [...input.order, ...input.disabled].find(id => !rows.some(row => row.provider === id));
    if (unknown) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `${unknown} does not serve ${chainNames[chain]}.`, 'order');
    const order = [...input.order, ...rows.map(row => row.provider).filter(id => !input.order.includes(id))];
    await this.prisma.$transaction(order.map((provider, position) => this.prisma.chainRoute.update({ where: { chain_provider: { chain, provider } }, data: { priority: (position + 1) * 10, enabled: !input.disabled.includes(provider) } })));
    await this.audit.record({ actorId: adminId, action: 'crypto.chain_routes_changed', targetType: 'chain', targetId: chain, before: rows.map(row => ({ provider: row.provider, priority: row.priority, enabled: row.enabled })), after: { order, disabled: input.disabled } });
    return this.adminChains();
  }

  /** Changes a network: deposits on or off, confirmations, contracts, the amount from which two providers must agree. */
  async setNetwork(
    adminId: string | null,
    id: string,
    input: { deposits_enabled?: boolean; confirmations?: number; contract?: string | null; test_contract?: string | null; double_check_from?: string; withdrawals_enabled?: boolean; withdrawal_fee?: string; min_withdrawal?: string },
  ) {
    const before = await this.prisma.cryptoNetwork.findUnique({ where: { id } });
    if (!before) throw notFound('network');
    // Amounts in the asset's own places, so a value it cannot hold is refused here, never when deposits are settled.
    const { decimals } = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: before.asset }, select: { decimals: true } });
    for (const key of ['double_check_from', 'withdrawal_fee', 'min_withdrawal'] as const) if (input[key] !== undefined) toUnits(input[key]!, decimals, key);
    const after = await this.prisma.cryptoNetwork.update({
      where: { id },
      data: {
        ...(input.deposits_enabled !== undefined ? { depositsEnabled: input.deposits_enabled } : {}),
        ...(input.confirmations !== undefined ? { confirmations: input.confirmations } : {}),
        ...(input.contract !== undefined && before.contract !== null ? { contract: input.contract } : {}),
        ...(input.test_contract !== undefined && before.contract !== null ? { testContract: input.test_contract } : {}),
        ...(input.double_check_from !== undefined ? { doubleCheckFrom: input.double_check_from } : {}),
        ...(input.withdrawals_enabled !== undefined ? { withdrawalsEnabled: input.withdrawals_enabled } : {}),
        ...(input.withdrawal_fee !== undefined ? { withdrawalFee: input.withdrawal_fee } : {}),
        ...(input.min_withdrawal !== undefined ? { minWithdrawal: input.min_withdrawal } : {}),
      },
    });
    await this.audit.record({ actorId: adminId, action: 'crypto.network_changed', targetType: 'crypto_network', targetId: id, before: presentNetwork(before), after: presentNetwork(after) });
    return presentNetwork(after);
  }

  /** Every provider's latest block on every chain it serves now (the `crypto` health job, and Crypto > Chains' Check all). */
  async checkAll() {
    const results = [];
    for (const chain of chains) {
      for (const mode of ['live', 'test'] as const) {
        for (const route of await this.routes(chain, mode)) {
          try {
            const block = await route.client.latestBlock();
            await this.prisma.chainRoute.update({ where: { chain_provider: { chain, provider: route.provider.id } }, data: { lastBlock: block, lastError: null, checkedAt: new Date() } });
            results.push({ chain, provider: route.provider.id, ok: true });
          } catch (error) {
            await this.prisma.chainRoute.update({ where: { chain_provider: { chain, provider: route.provider.id } }, data: { lastError: (error instanceof Error ? error.message : 'error').slice(0, 300), checkedAt: new Date() } });
            results.push({ chain, provider: route.provider.id, ok: false });
          }
        }
      }
    }
    return { object: 'chain_check' as const, results };
  }

  async adminDeposits(query: { mode?: LedgerMode; status?: string; customer_id?: string; reseller_id?: string }) {
    const rows = await this.prisma.cryptoDeposit.findMany({
      where: {
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.customer_id ? { customerId: query.customer_id } : {}),
        ...(query.reseller_id ? { resellerId: query.reseller_id } : {}),
      },
      include: { customer: { select: { email: true } }, reseller: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const presented = await this.present(rows);
    return {
      object: 'list' as const,
      data: presented.map((item, index) => {
        const row = rows[index];
        return {
          ...item,
          address: row.address,
          confirmed_by: row.confirmedBy,
          customer: row.customerId && row.customer ? { id: row.customerId, email: row.customer.email } : null,
          reseller: row.resellerId && row.reseller ? { id: row.resellerId, name: row.reseller.name } : null,
        };
      }),
    };
  }
}

export function presentNetwork(network: CryptoNetwork) {
  return {
    object: 'crypto_network_setting' as const,
    id: network.id,
    asset: network.asset,
    chain: network.chain,
    contract: network.contract,
    test_contract: network.testContract,
    decimals: network.decimals,
    confirmations: network.confirmations,
    deposits_enabled: network.depositsEnabled,
    double_check_from: network.doubleCheckFrom,
    withdrawals_enabled: network.withdrawalsEnabled,
    withdrawal_fee: network.withdrawalFee,
    min_withdrawal: network.minWithdrawal,
  };
}
