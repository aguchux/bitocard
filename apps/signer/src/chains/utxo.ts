import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { Address, NETWORK, OutScript, Transaction } from '@scure/btc-signer';

type BTC_NETWORK = typeof NETWORK;
import { addressOf, hash160, type Network, type UtxoChain } from '../keys.js';
import type { KeyVault } from '../vault/vault.js';
import { type ChainDriver, type Intent, Refusal, type SignContext, type Signed, type TxState } from './driver.js';
import { ChainUnavailable, getJson } from './rpc.js';

/** Address forms per chain and network (btc-signer's network parameters). */
export const utxoNetworks: Record<UtxoChain, Record<Network, BTC_NETWORK>> = {
  BITCOIN: { mainnet: { bech32: 'bc', pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 }, testnet: { bech32: 'tb', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef } },
  LITECOIN: { mainnet: { bech32: 'ltc', pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }, testnet: { bech32: 'tltc', pubKeyHash: 0x6f, scriptHash: 0x3a, wif: 0xef } },
  DOGECOIN: { mainnet: { bech32: '', pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e }, testnet: { bech32: '', pubKeyHash: 0x71, scriptHash: 0xc4, wif: 0xf1 } },
};

/** Below this an output is dust that nodes will not relay. Dogecoin's is 0.01 DOGE. */
const dust: Record<UtxoChain, bigint> = { BITCOIN: 546n, LITECOIN: 546n, DOGECOIN: 1_000_000n };
/** Floor fee rates in base units per virtual byte (Dogecoin relays nothing under 0.01 DOGE per kB). */
const minFeeRate: Record<UtxoChain, bigint> = { BITCOIN: 1n, LITECOIN: 1n, DOGECOIN: 1_000n };
/** Ceiling, so a broken fee estimate can never spend a fortune on one transfer. */
const maxFeeRate: Record<UtxoChain, bigint> = { BITCOIN: 500n, LITECOIN: 500n, DOGECOIN: 50_000n };

export type Utxo = { txid: string; vout: number; value: bigint; confirmed: boolean };

/** Where UTXOs, fees and broadcasts come from: an Esplora server (Bitcoin, Litecoin) or BlockCypher (Dogecoin). */
export interface UtxoSource {
  utxos(address: string): Promise<Utxo[]>;
  /** Base units per virtual byte for confirmation within a few blocks. */
  feeRate(): Promise<bigint>;
  /** The full transaction, for legacy inputs (whose amounts are not signed). */
  rawTx(txid: string): Promise<string>;
  broadcast(hex: string): Promise<void>;
  /** null when the transaction is not known. */
  tx(txid: string): Promise<{ confirmations: number } | null>;
}

async function status(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    return { status: res.status, text: await res.text() };
  } catch (error) {
    throw new ChainUnavailable(`${new URL(url).host} unreachable (${error instanceof Error ? error.name : 'error'})`);
  }
}

export class EsploraSource implements UtxoSource {
  constructor(private readonly url: string) {}

  private get base() {
    return this.url.replace(/\/+$/, '');
  }

  async utxos(address: string) {
    const list = await getJson<{ txid: string; vout: number; value: number; status?: { confirmed?: boolean } }[]>(`${this.base}/address/${address}/utxo`);
    return list.map(u => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), confirmed: !!u.status?.confirmed }));
  }

  async feeRate() {
    const estimates = await getJson<Record<string, number>>(`${this.base}/fee-estimates`);
    const rate = estimates['3'] ?? estimates['2'] ?? estimates['6'];
    return BigInt(Math.ceil(rate ?? 1));
  }

  async rawTx(txid: string) {
    const reply = await status(`${this.base}/tx/${txid}/hex`);
    if (reply.status !== 200) throw new ChainUnavailable(`no transaction ${txid}`);
    return reply.text.trim();
  }

  async broadcast(hex: string) {
    let res: Response;
    try {
      res = await fetch(`${this.base}/tx`, { method: 'POST', body: hex, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch (error) {
      throw new ChainUnavailable(`broadcast unreachable (${error instanceof Error ? error.name : 'error'})`);
    }
    const text = await res.text();
    if (res.ok || /already in block ?chain|txn-already-known|txn-already-in-mempool|already have transaction/i.test(text)) return;
    throw new ChainUnavailable(`broadcast HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  async tx(txid: string) {
    const reply = await status(`${this.base}/tx/${txid}/status`);
    if (reply.status === 404) return null;
    if (reply.status !== 200) throw new ChainUnavailable(`tx status HTTP ${reply.status}`);
    const value = JSON.parse(reply.text) as { confirmed?: boolean; block_height?: number };
    if (!value.confirmed || !value.block_height) return { confirmations: 0 };
    const tip = Number((await status(`${this.base}/blocks/tip/height`)).text);
    return { confirmations: tip - value.block_height + 1 };
  }
}

export class BlockCypherSource implements UtxoSource {
  constructor(
    private readonly coin: 'doge' | 'ltc' | 'btc',
    private readonly token: string | null,
  ) {}

  private url(path: string, query: Record<string, string> = {}) {
    const params = new URLSearchParams({ ...query, ...(this.token ? { token: this.token } : {}) });
    return `https://api.blockcypher.com/v1/${this.coin}/main${path}${params.size ? `?${params}` : ''}`;
  }

  async utxos(address: string) {
    type Ref = { tx_hash: string; tx_output_n: number; value: number; confirmations: number };
    const reply = await getJson<{ txrefs?: Ref[]; unconfirmed_txrefs?: Ref[] }>(this.url(`/addrs/${address}`, { unspentOnly: 'true' }));
    return [...(reply.txrefs ?? []), ...(reply.unconfirmed_txrefs ?? [])].map(r => ({ txid: r.tx_hash, vout: r.tx_output_n, value: BigInt(r.value), confirmed: r.confirmations > 0 }));
  }

  async feeRate() {
    const reply = await getJson<{ medium_fee_per_kb?: number }>(this.url(''));
    return BigInt(Math.ceil((reply.medium_fee_per_kb ?? 0) / 1000));
  }

  async rawTx(txid: string) {
    const reply = await getJson<{ hex?: string }>(this.url(`/txs/${txid}`, { includeHex: 'true' }));
    if (!reply.hex) throw new ChainUnavailable(`no transaction ${txid}`);
    return reply.hex;
  }

  async broadcast(hex: string) {
    let res: Response;
    try {
      res = await fetch(this.url('/txs/push'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: hex }), signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch (error) {
      throw new ChainUnavailable(`broadcast unreachable (${error instanceof Error ? error.name : 'error'})`);
    }
    const text = await res.text();
    if (res.ok || /already|exists/i.test(text)) return;
    throw new ChainUnavailable(`broadcast HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  async tx(txid: string) {
    const reply = await status(this.url(`/txs/${txid}`));
    if (reply.status === 404) return null;
    if (reply.status !== 200) throw new ChainUnavailable(`tx HTTP ${reply.status}`);
    return { confirmations: (JSON.parse(reply.text) as { confirmations?: number }).confirmations ?? 0 };
  }
}

const sighashAll = 1;

export class UtxoDriver implements ChainDriver {
  readonly confirmations: number;
  private readonly net: BTC_NETWORK;

  constructor(
    private readonly chain: UtxoChain,
    private readonly network: Network,
    private readonly source: UtxoSource,
    private readonly vault: KeyVault,
    private readonly paths: { path: (intent: Intent) => string },
    confirmations: number,
  ) {
    this.net = utxoNetworks[chain][network];
    this.confirmations = confirmations;
  }

  private get segwit() {
    return this.chain !== 'DOGECOIN';
  }

  address(to: string) {
    const value = to.trim();
    try {
      const script = OutScript.encode(addressDecode(value, this.net));
      if (!script.length) return null;
      return this.segwit && value.toLowerCase().startsWith(`${this.net.bech32}1`) ? value.toLowerCase() : value;
    } catch {
      return null;
    }
  }

  async sign(intent: Intent, context: SignContext): Promise<Signed> {
    const to = this.address(intent.to);
    if (!to) throw new Refusal(`not a valid ${this.chain} address`);
    if (intent.contract) throw new Refusal(`${this.chain} has no tokens`);
    if (!intent.sweepAll && intent.amount < dust[this.chain]) throw new Refusal('below the network’s smallest amount');
    const path = this.paths.path(intent);
    const publicKey = await this.vault.publicKey(path);
    const from = addressOf(this.chain, this.network, publicKey);
    const rate = clamp(await this.source.feeRate(), minFeeRate[this.chain], maxFeeRate[this.chain]);
    const reserved = context.reserved ?? new Set<string>();
    const available = (await this.source.utxos(from))
      .filter(u => !reserved.has(`${u.txid}:${u.vout}`) && (!intent.sweepAll || u.confirmed))
      // Confirmed first, then largest first: fewer inputs, and never building on another's unconfirmed money first.
      .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
    const inputSize = this.segwit ? 68n : 148n;
    const outputSize = this.segwit ? 31n : 34n;
    const overhead = this.segwit ? 11n : 10n;
    const chosen: Utxo[] = [];
    let total = 0n;
    let fee = 0n;
    let amount = intent.amount;
    if (intent.sweepAll) {
      // A sweep spends every confirmed output to one output: everything less the fee.
      chosen.push(...available);
      total = available.reduce((sum, u) => sum + u.value, 0n);
      fee = (overhead + inputSize * BigInt(chosen.length) + outputSize) * rate;
      amount = total - fee;
      if (amount < dust[this.chain]) throw new Refusal('nothing to sweep after the fee');
    }
    for (const utxo of intent.sweepAll ? [] : available) {
      chosen.push(utxo);
      total += utxo.value;
      fee = (overhead + inputSize * BigInt(chosen.length) + outputSize * 2n) * rate;
      if (total >= amount + fee) break;
    }
    if (total < amount + fee) throw new Refusal(`the paying address holds too little (${total} for ${amount} plus fee ${fee})`);
    let change = total - amount - fee;
    if (change < dust[this.chain]) change = 0n;

    const tx = new Transaction({ allowLegacyWitnessUtxo: false });
    const ownScript = this.segwit ? OutScript.encode({ type: 'wpkh', hash: hash160(publicKey) }) : OutScript.encode({ type: 'pkh', hash: hash160(publicKey) });
    for (const utxo of chosen) {
      if (this.segwit) tx.addInput({ txid: utxo.txid, index: utxo.vout, witnessUtxo: { script: ownScript, amount: utxo.value } });
      // Legacy inputs sign no amount: the whole previous transaction proves it, so a lying source cannot inflate the fee.
      else tx.addInput({ txid: utxo.txid, index: utxo.vout, nonWitnessUtxo: hexToBytes(await this.source.rawTx(utxo.txid)) });
    }
    tx.addOutputAddress(to, amount, this.net);
    if (change) tx.addOutput({ script: ownScript, amount: change });

    const scriptCode = OutScript.encode({ type: 'pkh', hash: hash160(publicKey) });
    for (let i = 0; i < chosen.length; i++) {
      const digest = this.segwit
        ? tx.preimageWitnessV0(i, scriptCode, sighashAll, chosen[i].value)
        : (tx as unknown as { preimageLegacy(i: number, script: Uint8Array, hashType: number): Uint8Array }).preimageLegacy(i, scriptCode, sighashAll);
      const sig = await this.vault.sign(path, digest);
      const der = new secp256k1.Signature(sig.r, sig.s).toBytes('der');
      tx.updateInput(i, { partialSig: [[publicKey, Uint8Array.from([...der, sighashAll])]] }, true);
    }
    tx.finalize();
    const actualFee = total - amount - change;
    return { txHash: tx.id, raw: bytesToHex(tx.extract()), meta: { from, inputs: chosen.map(u => `${u.txid}:${u.vout}`), fee: actualFee.toString() } };
  }

  async broadcast(signed: Signed) {
    await this.source.broadcast(signed.raw);
  }

  async status(signed: Signed): Promise<TxState> {
    const tx = await this.source.tx(signed.txHash);
    if (!tx) return { state: 'unknown' };
    return tx.confirmations > 0 ? { state: 'mined', confirmations: tx.confirmations } : { state: 'pending' };
  }

  async tokenGas(): Promise<bigint> {
    throw new Refusal(`${this.chain} has no tokens`);
  }

  async balance(address: string, contract: string | null) {
    if (contract) return 0n;
    return (await this.source.utxos(address)).reduce((sum, u) => sum + u.value, 0n);
  }
}

function clamp(value: bigint, low: bigint, high: bigint) {
  return value < low ? low : value > high ? high : value;
}


function addressDecode(address: string, net: BTC_NETWORK) {
  // Dogecoin has no bech32 prefix: never let an empty prefix accept a bech32 string.
  if (!net.bech32 && /^[a-z0-9]+1/.test(address.toLowerCase()) && !/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) throw new Error('no segwit');
  return Address(net).decode(address);
}
