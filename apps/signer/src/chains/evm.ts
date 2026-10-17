import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addressOf, type Chain, checksumAddress, evmChainIds, type Network } from '../keys.js';
import { bigintBytes, type KeyVault } from '../vault/vault.js';
import { type ChainDriver, type Intent, Refusal, type SignContext, type Signed, type TxState } from './driver.js';
import { ChainUnavailable, postJson } from './rpc.js';

type RlpItem = Uint8Array | RlpItem[];

/** Recursive length prefix encoding (Ethereum's serialisation). */
export function rlp(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0] < 0x80) return item;
    return concat(lengthPrefix(item.length, 0x80), item);
  }
  const body = concat(...item.map(rlp));
  return concat(lengthPrefix(body.length, 0xc0), body);
}

function lengthPrefix(length: number, offset: number) {
  if (length < 56) return Uint8Array.of(offset + length);
  const bytes = bigintBytes(BigInt(length));
  return Uint8Array.of(offset + 55 + bytes.length, ...bytes);
}

export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const num = (value: bigint) => bigintBytes(value);
const hex = (value: string) => hexToBytes(value.replace(/^0x/, ''));

/** ERC-20 `transfer(address,uint256)` call data. */
export function erc20Transfer(to: string, amount: bigint) {
  return concat(hex('a9059cbb'), hex(to.replace(/^0x/, '').toLowerCase().padStart(64, '0')), bigintBytes(amount, 32));
}

/** A legacy EIP-155 transaction: every EVM network we use accepts it, and it needs no fee-market guesses. */
export type EvmTx = { nonce: bigint; gasPrice: bigint; gas: bigint; to: string; value: bigint; data: Uint8Array; chainId: number };

export function unsignedPayload(tx: EvmTx) {
  return rlp([num(tx.nonce), num(tx.gasPrice), num(tx.gas), hex(tx.to), num(tx.value), tx.data, num(BigInt(tx.chainId)), new Uint8Array(), new Uint8Array()]);
}

export function signedPayload(tx: EvmTx, r: bigint, s: bigint, recovery: number) {
  const v = BigInt(tx.chainId) * 2n + 35n + BigInt(recovery);
  return rlp([num(tx.nonce), num(tx.gasPrice), num(tx.gas), hex(tx.to), num(tx.value), tx.data, num(v), num(r), num(s)]);
}

type Rpc = <T>(method: string, params: unknown[]) => Promise<T>;

export class EvmDriver implements ChainDriver {
  readonly confirmations: number;
  private readonly chainId: number;
  private readonly rpc: Rpc;

  constructor(
    private readonly chain: Chain,
    private readonly network: Network,
    rpcUrl: string,
    private readonly vault: KeyVault,
    private readonly paths: { path: (intent: Intent) => string },
    confirmations: number,
  ) {
    this.chainId = evmChainIds[chain][network];
    this.confirmations = confirmations;
    let id = 0;
    this.rpc = async <T>(method: string, params: unknown[]) => {
      const reply = await postJson<{ result?: T; error?: { message?: string } }>(rpcUrl, { jsonrpc: '2.0', id: ++id, method, params });
      if (reply.error) throw new ChainUnavailable(`${method}: ${reply.error.message ?? 'error'}`);
      return reply.result as T;
    };
  }

  address(to: string) {
    const value = to.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value)) return null;
    const mixed = value.slice(2) !== value.slice(2).toLowerCase() && value.slice(2) !== value.slice(2).toUpperCase();
    if (mixed && checksumAddress(value) !== value) return null;
    return checksumAddress(value);
  }

  /** Checks the node is on the network this signer serves, so a test endpoint never signs for mainnet or the reverse. */
  async checkNetwork() {
    const id = BigInt(await this.rpc<string>('eth_chainId', []));
    if (id !== BigInt(this.chainId)) throw new ChainUnavailable(`${this.chain} node is on chain ${id}, expected ${this.chainId}`);
  }

  async sign(intent: Intent, context: SignContext): Promise<Signed> {
    const to = this.address(intent.to);
    if (!to) throw new Refusal(`not a valid ${this.chain} address`);
    await this.checkNetwork();
    const path = this.paths.path(intent);
    const publicKey = await this.vault.publicKey(path);
    const from = addressOf(this.chain, this.network, publicKey);
    const contract = intent.contract ? this.address(intent.contract) : null;
    if (intent.contract && !contract) throw new Refusal('not a valid token contract');

    let call = contract ? { to: contract, value: 0n, data: erc20Transfer(to, intent.amount) } : { to, value: intent.amount, data: new Uint8Array() };
    const [gasPriceHex, chainNonceHex, nativeHex] = await Promise.all([
      this.rpc<string>('eth_gasPrice', []),
      this.rpc<string>('eth_getTransactionCount', [from, 'pending']),
      this.rpc<string>('eth_getBalance', [from, 'latest']),
    ]);
    const gas = contract
      ? (BigInt(await this.rpc<string>('eth_estimateGas', [{ from, to: call.to, data: `0x${bytesToHex(call.data)}`, value: '0x0' }])) * 13n) / 10n
      : 21_000n;
    // 20% over the node's price, so a withdrawal is not left behind by a small rise.
    const gasPrice = (BigInt(gasPriceHex) * 12n) / 10n;
    const fee = gas * gasPrice;
    if (intent.sweepAll && !contract) {
      const value = BigInt(nativeHex) - fee;
      if (value <= 0n) throw new Refusal('nothing to sweep after gas');
      call = { ...call, value };
    } else if (contract) {
      const held = await this.balance(from, contract);
      if (held < intent.amount) throw new Refusal(`the paying address holds too little of this token (${held} < ${intent.amount})`);
      if (BigInt(nativeHex) < fee) throw new Refusal('the paying address holds too little of the chain’s coin for gas');
    } else if (BigInt(nativeHex) < intent.amount + fee) {
      throw new Refusal('the paying address holds too little for the amount and gas');
    }
    const nonce = context.nonce ? await context.nonce(from, BigInt(chainNonceHex)) : BigInt(chainNonceHex);
    const tx: EvmTx = { nonce, gasPrice, gas, to: call.to, value: call.value, data: call.data, chainId: this.chainId };
    const digest = keccak_256(unsignedPayload(tx));
    const sig = await this.vault.sign(path, digest);
    const raw = signedPayload(tx, sig.r, sig.s, sig.recovery);
    return { txHash: `0x${bytesToHex(keccak_256(raw))}`, raw: `0x${bytesToHex(raw)}`, meta: { from, nonce: nonce.toString() } };
  }

  async broadcast(signed: Signed) {
    try {
      await this.rpc('eth_sendRawTransaction', [signed.raw]);
    } catch (error) {
      // Already in the node's pool or mined: the same bytes were sent before.
      if (error instanceof ChainUnavailable && /already known|known transaction|nonce too low|already imported/i.test(error.message)) {
        if ((await this.status(signed)).state !== 'unknown') return;
      }
      throw error;
    }
  }

  async status(signed: Signed): Promise<TxState> {
    const receipt = await this.rpc<{ status?: string; blockNumber?: string } | null>('eth_getTransactionReceipt', [signed.txHash]);
    if (receipt?.blockNumber) {
      if (receipt.status === '0x0') return { state: 'reverted', reason: 'the transaction reverted on chain' };
      const tip = BigInt(await this.rpc<string>('eth_blockNumber', []));
      return { state: 'mined', confirmations: Number(tip - BigInt(receipt.blockNumber)) + 1 };
    }
    const tx = await this.rpc<unknown>('eth_getTransactionByHash', [signed.txHash]);
    return tx ? { state: 'pending' } : { state: 'unknown' };
  }

  async tokenGas(from: string, contract: string, to: string, amount: bigint) {
    const data = `0x${bytesToHex(erc20Transfer(to, amount))}`;
    const [gas, price] = await Promise.all([this.rpc<string>('eth_estimateGas', [{ from, to: contract, data, value: '0x0' }]), this.rpc<string>('eth_gasPrice', [])]);
    // The sweep pays 30% over the estimate at 20% over the price; fund a little more so a rise does not strand it.
    return (BigInt(gas) * 13n * BigInt(price) * 15n) / 100n;
  }

  async balance(address: string, contract: string | null) {
    if (!contract) return BigInt(await this.rpc<string>('eth_getBalance', [address, 'latest']));
    const data = `0x70a08231${address.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
    const result = await this.rpc<string>('eth_call', [{ to: contract, data }, 'latest']);
    return result && result !== '0x' ? BigInt(result) : 0n;
  }
}
