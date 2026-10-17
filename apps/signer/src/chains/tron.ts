import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addressOf, tronBytes } from '../keys.js';
import { bigintBytes, type KeyVault } from '../vault/vault.js';
import { type ChainDriver, type Intent, Refusal, type Signed, type TxState } from './driver.js';
import { concat, erc20Transfer } from './evm.js';
import { ChainUnavailable, postJson } from './rpc.js';

/**
 * TRON transactions are built here, field by field, never taken from a node's `createtransaction` (a dishonest node
 * could change the destination). The node only gives the latest block for the reference fields and broadcasts.
 * The transaction ID is sha256 of the raw protobuf; the signature is secp256k1 over it, r‖s‖v (v 0 or 1).
 */
function varint(value: bigint) {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest) byte |= 0x80;
    out.push(byte);
  } while (rest);
  return Uint8Array.from(out);
}

const key = (field: number, wire: number) => varint(BigInt((field << 3) | wire));
export const pbInt = (field: number, value: bigint) => concat(key(field, 0), varint(value));
export const pbBytes = (field: number, value: Uint8Array) => concat(key(field, 2), varint(BigInt(value.length)), value);
const pbText = (field: number, value: string) => pbBytes(field, new TextEncoder().encode(value));

export type TronRaw = {
  refBlockBytes: Uint8Array;
  refBlockHash: Uint8Array;
  expiration: bigint;
  timestamp: bigint;
  feeLimit: bigint;
  contract: { type: 1 | 31; typeUrl: string; value: Uint8Array };
};

export function encodeRaw(raw: TronRaw) {
  const any = concat(pbText(1, raw.contract.typeUrl), pbBytes(2, raw.contract.value));
  const contract = concat(pbInt(1, BigInt(raw.contract.type)), pbBytes(2, any));
  return concat(
    pbBytes(1, raw.refBlockBytes),
    pbBytes(4, raw.refBlockHash),
    pbInt(8, raw.expiration),
    pbBytes(11, contract),
    pbInt(14, raw.timestamp),
    ...(raw.feeLimit ? [pbInt(18, raw.feeLimit)] : []),
  );
}

/** TransferContract: plain TRX. */
export function transferContract(owner: Uint8Array, to: Uint8Array, amount: bigint) {
  return { type: 1 as const, typeUrl: 'type.googleapis.com/protocol.TransferContract', value: concat(pbBytes(1, owner), pbBytes(2, to), pbInt(3, amount)) };
}

/** TriggerSmartContract calling a TRC-20 token's `transfer`. */
export function trc20Contract(owner: Uint8Array, token: Uint8Array, to: Uint8Array, amount: bigint) {
  const data = erc20Transfer(`0x${bytesToHex(to.slice(1))}`, amount);
  return { type: 31 as const, typeUrl: 'type.googleapis.com/protocol.TriggerSmartContract', value: concat(pbBytes(1, owner), pbBytes(2, token), pbBytes(4, data)) };
}

/** The reference fields from a block: bytes 6–8 of its number and bytes 8–16 of its ID. */
export function refFields(blockNumber: bigint, blockId: string) {
  return { refBlockBytes: bigintBytes(blockNumber, 8).slice(6, 8), refBlockHash: hexToBytes(blockId).slice(8, 16) };
}

/** Most a TRC-20 transfer may burn in fees (100 TRX), in sun. */
const trc20FeeLimit = 100_000_000n;
/** TRX an address needs to send a TRC-20 transfer without staked energy (USDT burns about 14 to 28 TRX). */
export const tronTokenGas = 30_000_000n;
/** Left behind by a TRX sweep for its bandwidth (about 0.27 TRX burnt without free bandwidth). */
const tronSweepReserve = 1_100_000n;

export class TronDriver implements ChainDriver {
  readonly confirmations: number;

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string | null,
    private readonly network: 'mainnet' | 'testnet',
    private readonly vault: KeyVault,
    private readonly paths: { path: (intent: Intent) => string },
    confirmations: number,
  ) {
    this.confirmations = confirmations;
  }

  private call<T>(path: string, body: unknown) {
    return postJson<T>(`${this.apiUrl.replace(/\/+$/, '')}${path}`, body, this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {});
  }

  address(to: string) {
    return tronBytes(to.trim()) ? to.trim() : null;
  }

  async sign(intent: Intent): Promise<Signed> {
    const to = tronBytes(intent.to.trim());
    if (!to) throw new Refusal('not a valid TRON address');
    const path = this.paths.path(intent);
    const publicKey = await this.vault.publicKey(path);
    const fromAddress = addressOf('TRON', this.network, publicKey);
    const owner = tronBytes(fromAddress)!;
    const token = intent.contract ? tronBytes(intent.contract) : null;
    if (intent.contract && !token) throw new Refusal('not a valid TRC-20 contract');

    const held = await this.balance(fromAddress, intent.contract);
    // A TRX sweep leaves enough for the transfer's bandwidth.
    const amount = intent.sweepAll && !token ? held - tronSweepReserve : intent.amount;
    if (amount <= 0n) throw new Refusal('nothing to sweep after the fee');
    if (held < amount) throw new Refusal(`the paying address holds too little (${held} < ${amount})`);
    if (token && (await this.balance(fromAddress, null)) < tronTokenGas) throw new Refusal('the paying address holds too little TRX for the token fee');

    const block = await this.call<{ blockID?: string; block_header?: { raw_data?: { number?: number; timestamp?: number } } }>('/wallet/getnowblock', {});
    const number = block.block_header?.raw_data?.number;
    const time = block.block_header?.raw_data?.timestamp;
    if (!block.blockID || number === undefined || !time) throw new ChainUnavailable('TRON node gave no latest block');
    const raw: TronRaw = {
      ...refFields(BigInt(number), block.blockID),
      expiration: BigInt(time) + 10n * 60_000n,
      timestamp: BigInt(time),
      feeLimit: token ? trc20FeeLimit : 0n,
      contract: token ? trc20Contract(owner, token, to, amount) : transferContract(owner, to, amount),
    };
    const rawBytes = encodeRaw(raw);
    const txId = sha256(rawBytes);
    const sig = await this.vault.sign(path, txId);
    const signature = concat(bigintBytes(sig.r, 32), bigintBytes(sig.s, 32), Uint8Array.of(sig.recovery));
    const transaction = concat(pbBytes(1, rawBytes), pbBytes(2, signature));
    return { txHash: bytesToHex(txId), raw: bytesToHex(transaction), meta: { from: fromAddress, expiration: raw.expiration.toString() } };
  }

  async broadcast(signed: Signed) {
    const reply = await this.call<{ result?: boolean; code?: string; message?: string }>('/wallet/broadcasthex', { transaction: signed.raw });
    if (reply.result || reply.code === 'DUP_TRANSACTION_ERROR') return;
    const message = reply.message ? Buffer.from(reply.message, 'hex').toString('utf8') : '';
    throw new ChainUnavailable(`TRON broadcast: ${reply.code ?? 'error'} ${message}`.trim());
  }

  async status(signed: Signed): Promise<TxState> {
    const info = await this.call<{ id?: string; blockNumber?: number; receipt?: { result?: string }; result?: string }>('/wallet/gettransactioninfobyid', { value: signed.txHash });
    if (info.blockNumber) {
      if (info.result === 'FAILED' || (info.receipt?.result && info.receipt.result !== 'SUCCESS')) return { state: 'reverted', reason: `the transaction failed on chain (${info.receipt?.result ?? info.result})` };
      const block = await this.call<{ block_header?: { raw_data?: { number?: number } } }>('/wallet/getnowblock', {});
      return { state: 'mined', confirmations: (block.block_header?.raw_data?.number ?? info.blockNumber) - info.blockNumber + 1 };
    }
    const tx = await this.call<{ txID?: string }>('/wallet/gettransactionbyid', { value: signed.txHash });
    if (tx.txID) return { state: 'pending' };
    // Past its expiration and never seen: it can never be mined.
    const expiration = Number(signed.meta.expiration ?? 0);
    if (expiration && Date.now() > expiration + 5 * 60_000) return { state: 'reverted', reason: 'the transaction expired before it was mined' };
    return { state: 'unknown' };
  }

  async tokenGas() {
    return tronTokenGas;
  }

  async balance(address: string, contract: string | null) {
    if (!contract) {
      const account = await this.call<{ balance?: number }>('/wallet/getaccount', { address, visible: true });
      return BigInt(account.balance ?? 0);
    }
    const holder = tronBytes(address)!;
    const reply = await this.call<{ constant_result?: string[] }>('/wallet/triggerconstantcontract', {
      owner_address: address,
      contract_address: contract,
      function_selector: 'balanceOf(address)',
      parameter: bytesToHex(holder.slice(1)).padStart(64, '0'),
      visible: true,
    });
    const result = reply.constant_result?.[0];
    if (result === undefined) throw new ChainUnavailable('TRON node gave no token balance');
    return result ? BigInt(`0x${result}`) : 0n;
  }
}
