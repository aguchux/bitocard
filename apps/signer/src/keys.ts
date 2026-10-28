import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base58check, bech32 } from '@scure/base';

/**
 * Chains, key families and addresses, kept identical to the API's `apps/api/src/crypto/derive.ts`: customer `i`'s
 * deposit address is the account key's child `0/i`, so the API (holding only xpubs) and the signer (asking the vault)
 * always agree. Afrippa's own hot wallet is the internal chain's first child, `1/0`, which no customer ever gets.
 */
export const chains = ['ETHEREUM', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'TRON', 'BITCOIN', 'LITECOIN', 'DOGECOIN'] as const;
export type Chain = (typeof chains)[number];
export type Network = 'mainnet' | 'testnet';
export type Family = 'evm' | 'tron' | 'bitcoin' | 'litecoin' | 'dogecoin';
export type UtxoChain = 'BITCOIN' | 'LITECOIN' | 'DOGECOIN';

export const evmChains: readonly Chain[] = ['ETHEREUM', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM'];
export const isEvm = (chain: Chain) => evmChains.includes(chain);
export const isUtxo = (chain: Chain): chain is UtxoChain => chain === 'BITCOIN' || chain === 'LITECOIN' || chain === 'DOGECOIN';

export function familyOf(chain: Chain): Family {
  if (isEvm(chain)) return 'evm';
  if (chain === 'TRON') return 'tron';
  return chain.toLowerCase() as Family;
}

/** The chain's own coin and its on-chain decimals (what gas is paid in). */
export const nativeCoin: Record<Chain, { asset: string; decimals: number }> = {
  ETHEREUM: { asset: 'ETH', decimals: 18 },
  BSC: { asset: 'BNB', decimals: 18 },
  POLYGON: { asset: 'POL', decimals: 18 },
  ARBITRUM: { asset: 'ETH', decimals: 18 },
  BASE: { asset: 'ETH', decimals: 18 },
  OPTIMISM: { asset: 'ETH', decimals: 18 },
  TRON: { asset: 'TRX', decimals: 6 },
  BITCOIN: { asset: 'BTC', decimals: 8 },
  LITECOIN: { asset: 'LTC', decimals: 8 },
  DOGECOIN: { asset: 'DOGE', decimals: 8 },
};

/** EVM chain IDs, main and test networks (Sepolia, BNB testnet, Amoy, Arbitrum/Base/OP Sepolia). */
export const evmChainIds: Record<string, Record<Network, number>> = {
  ETHEREUM: { mainnet: 1, testnet: 11155111 },
  BSC: { mainnet: 56, testnet: 97 },
  POLYGON: { mainnet: 137, testnet: 80002 },
  ARBITRUM: { mainnet: 42161, testnet: 421614 },
  BASE: { mainnet: 8453, testnet: 84532 },
  OPTIMISM: { mainnet: 10, testnet: 11155420 },
};

/** Account paths per family and network (the same as the xpubs saved in the admin app). */
export const defaultAccountPaths: Record<Family, Record<Network, string>> = {
  bitcoin: { mainnet: "m/84'/0'/0'", testnet: "m/84'/1'/0'" },
  evm: { mainnet: "m/44'/60'/0'", testnet: "m/44'/60'/0'" },
  tron: { mainnet: "m/44'/195'/0'", testnet: "m/44'/195'/0'" },
  litecoin: { mainnet: "m/84'/2'/0'", testnet: "m/84'/1'/0'" },
  dogecoin: { mainnet: "m/44'/3'/0'", testnet: "m/44'/1'/0'" },
};

/** Who owns a key: customer `index`'s deposit address, or Afrippa's hot wallet. */
export type KeyOwner = { kind: 'customer'; index: number } | { kind: 'hot' };

export function keyPath(account: string, owner: KeyOwner) {
  if (owner.kind === 'hot') return `${account}/1/0`;
  if (!Number.isInteger(owner.index) || owner.index < 0 || owner.index >= 0x80000000) throw new Error('Address index out of range');
  return `${account}/0/${owner.index}`;
}

export const hash160 = (publicKey: Uint8Array) => ripemd160(sha256(publicKey));
const check = base58check(sha256);

/** The last 20 bytes of keccak256 over the uncompressed key. */
export function evmBytes(publicKey: Uint8Array) {
  const uncompressed = secp256k1.Point.fromHex(bytesToHex(publicKey)).toBytes(false);
  return keccak_256(uncompressed.slice(1)).slice(-20);
}

export function checksumAddress(hex: string) {
  const lower = hex.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  return `0x${[...lower].map((char, i) => (parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char)).join('')}`;
}

export function tronFromBytes(bytes20: Uint8Array) {
  return check.encode(Uint8Array.from([0x41, ...bytes20]));
}

/** A TRON address's 21 bytes (0x41 then 20), or null when it is not one. */
export function tronBytes(address: string) {
  try {
    const bytes = check.decode(address);
    return bytes.length === 21 && bytes[0] === 0x41 ? bytes : null;
  } catch {
    return null;
  }
}

/** The address a compressed public key has on a chain's network. */
export function addressOf(chain: Chain, network: Network, publicKey: Uint8Array) {
  const testnet = network === 'testnet';
  if (isEvm(chain)) return checksumAddress(bytesToHex(evmBytes(publicKey)));
  if (chain === 'TRON') return tronFromBytes(evmBytes(publicKey));
  if (chain === 'BITCOIN') return bech32.encode(testnet ? 'tb' : 'bc', [0, ...bech32.toWords(hash160(publicKey))]);
  if (chain === 'LITECOIN') return bech32.encode(testnet ? 'tltc' : 'ltc', [0, ...bech32.toWords(hash160(publicKey))]);
  return check.encode(Uint8Array.from([testnet ? 0x71 : 0x1e, ...hash160(publicKey)]));
}

/** Amounts are decimal strings of on-chain units. */
export function units(text: string) {
  if (!/^\d{1,78}$/.test(text)) throw new Error('amount must be whole on-chain units');
  return BigInt(text);
}
