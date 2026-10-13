import { hexToTron, tronToHex } from '../derive.js';

/**
 * Talking to blockchains through rented providers. A provider (Alchemy, TronGrid…) only gives an address and
 * credentials; the protocol is the chain's own, so one client per protocol serves every provider: EVM JSON-RPC
 * (Ethereum, BNB Chain), TRON's node HTTP API (plus TronGrid's account history), Bitcoin's Esplora REST, Bitcoin Core
 * JSON-RPC and BlockCypher, and Solana JSON-RPC. Clients only read and never hold keys.
 */
/** A provider's failure: `definite` when it clearly refused (wrong credentials, unknown method), else unclear. */
export class ChainError extends Error {
  constructor(
    message: string,
    readonly definite = false,
  ) {
    super(message);
  }
}

export type Chain = 'ETHEREUM' | 'BSC' | 'TRON' | 'SOLANA' | 'BITCOIN';
export const chains: readonly Chain[] = ['ETHEREUM', 'BSC', 'TRON', 'BITCOIN', 'SOLANA'];
export const chainNames: Record<Chain, string> = { ETHEREUM: 'Ethereum', BSC: 'BNB Chain', TRON: 'TRON', BITCOIN: 'Bitcoin', SOLANA: 'Solana' };
/** Which deposit address family each chain uses. */
export const chainFamily = { ETHEREUM: 'evm', BSC: 'evm', TRON: 'tron', BITCOIN: 'bitcoin', SOLANA: 'solana' } as const satisfies Record<Chain, string>;

/** A transfer into an address: `contract` is the token (null for the chain's own coin); `raw` in on-chain units. */
export type Transfer = { hash: string; index: number; to: string; contract: string | null; raw: bigint; block: bigint | null };

/** A transaction re-read from the chain: its block (null while unconfirmed), whether it succeeded, and its transfers. */
export type Inspection = { block: bigint | null; ok: boolean; transfers: Transfer[] };

export type Endpoint = { url: string; headers?: Record<string, string>; flavor?: 'alchemy' | 'trongrid' };

export interface ChainClient {
  latestBlock(): Promise<bigint>;
  /** Transfers into these addresses since a block (where the protocol can list them), else null. */
  scan?(input: { addresses: string[]; contracts: string[]; native: boolean; fromBlock: bigint; toBlock: bigint }): Promise<Transfer[]>;
  /** One transaction, or null when the chain does not know it. */
  inspect(hash: string): Promise<Inspection | null>;
  /** Whether `scan` can find the chain's own coin (not only tokens). */
  readonly nativeScan: boolean;
}

const timeoutMs = 15_000;

async function request<T>(endpoint: Endpoint, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = path ? `${endpoint.url.replace(/\/+$/, '')}${path}` : endpoint.url;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...endpoint.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch (error) {
    throw new ChainError(`unreachable (${error instanceof Error ? error.name : 'error'})`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new ChainError(`refused the credentials (HTTP ${res.status})`, true);
  if (res.status === 404 && path) return null as T;
  if (!res.ok) throw new ChainError(`HTTP ${res.status}`);
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    // Esplora answers plain text for some calls (the tip height).
    return text as T;
  }
}

let rpcId = 0;
async function rpc<T>(endpoint: Endpoint, method: string, params: unknown[]): Promise<T> {
  const reply = await request<{ result?: T; error?: { code?: number; message?: string } }>(endpoint, '', { body: { jsonrpc: '2.0', id: (rpcId += 1), method, params } });
  if (reply?.error) throw new ChainError(`${method}: ${reply.error.message ?? 'error'}`, reply.error.code === -32601);
  return reply?.result as T;
}

const hexBig = (value: string | null | undefined) => (value ? BigInt(value) : null);
const toHex = (value: bigint) => `0x${value.toString(16)}`;
/** ERC-20 and TRC-20 Transfer(address,address,uint256). */
export const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicAddress = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase();
const padAddress = (address: string) => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;

type EvmLog = { transactionHash: string; logIndex: string; blockNumber: string | null; address: string; topics: string[]; data: string; removed?: boolean };

/** Ethereum and BNB Chain over standard JSON-RPC (every EVM provider), with Alchemy's transfers API for plain coin deposits. */
export class EvmClient implements ChainClient {
  constructor(private readonly endpoint: Endpoint) {}

  get nativeScan() {
    return this.endpoint.flavor === 'alchemy';
  }

  async latestBlock() {
    return BigInt(await rpc<string>(this.endpoint, 'eth_blockNumber', []));
  }

  async scan(input: { addresses: string[]; contracts: string[]; native: boolean; fromBlock: bigint; toBlock: bigint }) {
    const transfers: Transfer[] = [];
    if (input.contracts.length) {
      for (let i = 0; i < input.addresses.length; i += 500) {
        const logs = await rpc<EvmLog[]>(this.endpoint, 'eth_getLogs', [
          { fromBlock: toHex(input.fromBlock), toBlock: toHex(input.toBlock), address: input.contracts, topics: [transferTopic, null, input.addresses.slice(i, i + 500).map(padAddress)] },
        ]);
        for (const log of logs ?? []) {
          if (log.removed || log.topics.length < 3) continue;
          transfers.push({ hash: log.transactionHash, index: Number(BigInt(log.logIndex)), to: topicAddress(log.topics[2]), contract: log.address.toLowerCase(), raw: BigInt(log.data === '0x' ? 0 : log.data), block: hexBig(log.blockNumber) });
        }
      }
    }
    if (input.native && this.nativeScan) {
      for (const address of input.addresses) {
        const reply = await rpc<{ transfers: Array<{ hash: string; blockNum: string; to: string; rawContract: { value: string | null } }> }>(this.endpoint, 'alchemy_getAssetTransfers', [
          { fromBlock: toHex(input.fromBlock), toBlock: toHex(input.toBlock), toAddress: address, category: ['external'], excludeZeroValue: true, maxCount: '0x64' },
        ]);
        for (const item of reply?.transfers ?? []) {
          transfers.push({ hash: item.hash, index: 0, to: item.to.toLowerCase(), contract: null, raw: BigInt(item.rawContract.value ?? '0x0'), block: hexBig(item.blockNum) });
        }
      }
    }
    return transfers;
  }

  async inspect(hash: string): Promise<Inspection | null> {
    const [tx, receipt] = await Promise.all([
      rpc<{ to: string | null; value: string; blockNumber: string | null } | null>(this.endpoint, 'eth_getTransactionByHash', [hash]),
      rpc<{ status: string; blockNumber: string; logs: EvmLog[] } | null>(this.endpoint, 'eth_getTransactionReceipt', [hash]),
    ]);
    if (!tx) return null;
    const transfers: Transfer[] = [];
    const block = hexBig(receipt?.blockNumber ?? tx.blockNumber);
    if (tx.to && BigInt(tx.value) > 0n) transfers.push({ hash, index: 0, to: tx.to.toLowerCase(), contract: null, raw: BigInt(tx.value), block });
    for (const log of receipt?.logs ?? []) {
      if (log.topics[0]?.toLowerCase() !== transferTopic || log.topics.length < 3) continue;
      // Token transfers use their log index plus one, so they never clash with the coin transfer at 0.
      transfers.push({ hash, index: Number(BigInt(log.logIndex)) + 1, to: topicAddress(log.topics[2]), contract: log.address.toLowerCase(), raw: BigInt(log.data === '0x' ? 0 : log.data), block });
    }
    return { block, ok: receipt ? receipt.status === '0x1' : true, transfers };
  }
}

/** TRON through its node HTTP API (every TRON provider); TronGrid's account history lists token deposits. */
export class TronClient implements ChainClient {
  readonly nativeScan = false;
  constructor(private readonly endpoint: Endpoint) {}

  async latestBlock() {
    const block = await request<{ block_header?: { raw_data?: { number?: number } } }>(this.endpoint, '/wallet/getnowblock', { body: {} });
    const number = block?.block_header?.raw_data?.number;
    if (number === undefined) throw new ChainError('no block in the reply');
    return BigInt(number);
  }

  /** TronGrid only: each address's TRC-20 deposits (block numbers are read when each one is inspected). */
  async scan(input: { addresses: string[]; contracts: string[] }) {
    if (this.endpoint.flavor !== 'trongrid') return [];
    const transfers: Transfer[] = [];
    for (const address of input.addresses) {
      for (const contract of input.contracts) {
        const query = new URLSearchParams({ only_to: 'true', limit: '50', contract_address: contract });
        const page = await request<{ data?: Array<{ transaction_id: string; to: string; value: string; token_info?: { address?: string } }> }>(this.endpoint, `/v1/accounts/${address}/transactions/trc20?${query.toString()}`);
        for (const item of page?.data ?? []) {
          if (item.to !== address) continue;
          transfers.push({ hash: item.transaction_id, index: -1, to: address, contract: item.token_info?.address ?? contract, raw: BigInt(item.value), block: null });
        }
      }
    }
    return transfers;
  }

  async inspect(hash: string): Promise<Inspection | null> {
    const info = await request<{ id?: string; blockNumber?: number; receipt?: { result?: string }; log?: Array<{ address: string; topics: string[]; data: string }> }>(this.endpoint, '/wallet/gettransactioninfobyid', { body: { value: hash } });
    if (!info?.id) return null;
    const transfers: Transfer[] = [];
    (info.log ?? []).forEach((log, position) => {
      if (`0x${log.topics[0]}`.toLowerCase() !== transferTopic || log.topics.length < 3) return;
      transfers.push({ hash, index: position + 1, to: hexToTron(log.topics[2].slice(-40)), contract: hexToTron(log.address), raw: BigInt(`0x${log.data || '0'}`), block: info.blockNumber !== undefined ? BigInt(info.blockNumber) : null });
    });
    // A transaction with no receipt result is a plain transfer that succeeded; contracts report SUCCESS or a failure.
    return { block: info.blockNumber !== undefined ? BigInt(info.blockNumber) : null, ok: !info.receipt?.result || info.receipt.result === 'SUCCESS', transfers };
  }
}

/** A Bitcoin amount from JSON (BTC as a decimal number) in satoshis, exactly. */
const satoshis = (btc: number) => {
  const [whole, fraction = ''] = btc.toFixed(8).split('.');
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
};

type EsploraTx = { txid: string; status?: { confirmed?: boolean; block_height?: number }; vout: Array<{ scriptpubkey_address?: string; value: number }> };

/** Bitcoin through an Esplora REST API (mempool.space, Blockstream). */
export class EsploraClient implements ChainClient {
  readonly nativeScan = true;
  constructor(private readonly endpoint: Endpoint) {}

  async latestBlock() {
    return BigInt(String(await request<string | number>(this.endpoint, '/blocks/tip/height')).trim());
  }

  private parse(tx: EsploraTx): Inspection {
    const block = tx.status?.confirmed && tx.status.block_height !== undefined ? BigInt(tx.status.block_height) : null;
    return { block, ok: true, transfers: tx.vout.flatMap((out, index) => (out.scriptpubkey_address ? [{ hash: tx.txid, index, to: out.scriptpubkey_address, contract: null, raw: BigInt(out.value), block }] : [])) };
  }

  async scan(input: { addresses: string[] }) {
    const transfers: Transfer[] = [];
    for (const address of input.addresses) {
      const txs = await request<EsploraTx[]>(this.endpoint, `/address/${address}/txs`);
      for (const tx of txs ?? []) transfers.push(...this.parse(tx).transfers.filter(item => item.to === address));
    }
    return transfers;
  }

  async inspect(hash: string) {
    const tx = await request<EsploraTx | null>(this.endpoint, `/tx/${hash}`);
    return tx?.txid ? this.parse(tx) : null;
  }
}

type BlockCypherTx = { hash: string; block_height?: number; outputs: Array<{ addresses?: string[] | null; value: number }> };

/** Bitcoin through BlockCypher's REST API (its token in the query). */
export class BlockCypherClient implements ChainClient {
  readonly nativeScan = true;
  constructor(private readonly endpoint: Endpoint & { token?: string }) {}

  private path(path: string) {
    return this.endpoint.token ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.endpoint.token)}` : path;
  }

  async latestBlock() {
    const chain = await request<{ height?: number }>(this.endpoint, this.path(''));
    if (chain?.height === undefined) throw new ChainError('no height in the reply');
    return BigInt(chain.height);
  }

  private parse(tx: BlockCypherTx): Inspection {
    const block = tx.block_height !== undefined && tx.block_height >= 0 ? BigInt(tx.block_height) : null;
    return { block, ok: true, transfers: tx.outputs.flatMap((out, index) => (out.addresses?.length === 1 ? [{ hash: tx.hash, index, to: out.addresses[0], contract: null, raw: BigInt(out.value), block }] : [])) };
  }

  async scan(input: { addresses: string[] }) {
    const transfers: Transfer[] = [];
    for (const address of input.addresses) {
      const reply = await request<{ txs?: BlockCypherTx[] }>(this.endpoint, this.path(`/addrs/${address}/full?limit=50`));
      for (const tx of reply?.txs ?? []) transfers.push(...this.parse(tx).transfers.filter(item => item.to === address));
    }
    return transfers;
  }

  async inspect(hash: string) {
    const tx = await request<BlockCypherTx | null>(this.endpoint, this.path(`/txs/${hash}`));
    return tx?.hash ? this.parse(tx) : null;
  }
}

/** Bitcoin through Bitcoin Core JSON-RPC (QuickNode, GetBlock, Chainstack, Tatum): reads transactions by hash only. */
export class BitcoinRpcClient implements ChainClient {
  readonly nativeScan = false;
  constructor(private readonly endpoint: Endpoint) {}

  async latestBlock() {
    return BigInt(await rpc<number>(this.endpoint, 'getblockcount', []));
  }

  async inspect(hash: string): Promise<Inspection | null> {
    const tx = await rpc<{ txid: string; confirmations?: number; vout: Array<{ n: number; value: number; scriptPubKey: { address?: string } }> } | null>(this.endpoint, 'getrawtransaction', [hash, true]).catch(error => {
      if (error instanceof ChainError && /No such/i.test(error.message)) return null;
      throw error;
    });
    if (!tx) return null;
    const block = tx.confirmations ? (await this.latestBlock()) - BigInt(tx.confirmations) + 1n : null;
    return { block, ok: true, transfers: tx.vout.flatMap(out => (out.scriptPubKey.address ? [{ hash: tx.txid, index: out.n, to: out.scriptPubKey.address, contract: null, raw: satoshis(out.value), block }] : [])) };
  }
}

/** Solana JSON-RPC: the latest slot (deposits come once Solana addresses are issued by the signer). */
export class SolanaClient implements ChainClient {
  readonly nativeScan = false;
  constructor(private readonly endpoint: Endpoint) {}

  async latestBlock() {
    return BigInt(await rpc<number>(this.endpoint, 'getSlot', [{ commitment: 'finalized' }]));
  }

  async inspect() {
    return null;
  }
}

/** Addresses as each chain's clients report them, so ours compare equal (EVM lower case; TRON and Bitcoin as is). */
export function normaliseAddress(chain: Chain, address: string) {
  if (chain === 'ETHEREUM' || chain === 'BSC') return address.toLowerCase();
  if (chain === 'TRON' && address.startsWith('0x')) return hexToTron(address);
  return address;
}

/** A token contract as the chain's clients report it. */
export function normaliseContract(chain: Chain, contract: string) {
  if (chain === 'ETHEREUM' || chain === 'BSC') return contract.toLowerCase();
  if (chain === 'TRON' && contract.startsWith('0x')) return hexToTron(contract);
  return contract;
}

export { tronToHex };
