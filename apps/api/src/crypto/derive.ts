import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base58, base58check, bech32 } from '@scure/base';
import { HDKey } from '@scure/bip32';

/**
 * Customers' deposit addresses, derived from BitoCard's account-level extended public keys (xpubs). The API never
 * holds a private key: an xpub can make every address of its account but cannot spend from any of them. The keys
 * themselves stay in BitoCard's key vault (see PLANS.md 6b).
 *
 * Each family's xpub is the account key, and customer `i` gets the external chain's child `0/i`:
 * Bitcoin m/84'/0'/0' (native SegWit, bc1…; testnet m/84'/1'/0', tb1…), EVM m/44'/60'/0' (one 0x… address for
 * Ethereum and BNB Chain), TRON m/44'/195'/0' (T…). Solana keys are hardened only, so its addresses come from the
 * signer, never from an xpub.
 */
export type AddressFamily = 'bitcoin' | 'evm' | 'tron';
export const addressFamilies: readonly AddressFamily[] = ['bitcoin', 'evm', 'tron'];

/** Version bytes of the extended public key prefixes people paste: xpub/zpub (mainnet), tpub/vpub (testnet). */
const versions: Record<string, number> = { xpub: 0x0488b21e, zpub: 0x04b24746, ypub: 0x049d7cb2, tpub: 0x043587cf, vpub: 0x045f1cf6, upub: 0x044a5262 };
const testnetPrefixes = new Set(['tpub', 'vpub', 'upub']);

export class InvalidXpubError extends Error {}

/** Reads an account xpub (any of the prefixes above). */
export function parseXpub(xpub: string) {
  const text = xpub.trim();
  const prefix = text.slice(0, 4);
  const version = versions[prefix];
  if (!version) throw new InvalidXpubError('Paste an extended public key starting xpub, zpub, tpub or vpub.');
  try {
    const key = HDKey.fromExtendedKey(text, { private: 0, public: version });
    if (key.privateKey) throw new InvalidXpubError('This is a private key. Paste the extended public key only.');
    return { key, testnet: testnetPrefixes.has(prefix) };
  } catch (error) {
    if (error instanceof InvalidXpubError) throw error;
    throw new InvalidXpubError('This extended public key is not valid.');
  }
}

/** The public key of customer `index` on the account's external chain (0/index), compressed. */
export function childPublicKey(xpub: string, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error('Address index out of range');
  const { key, testnet } = parseXpub(xpub);
  const child = key.deriveChild(0).deriveChild(index);
  return { publicKey: child.publicKey!, testnet };
}

/** Native SegWit (P2WPKH): bc1… on mainnet, tb1… on testnet. */
export function bitcoinAddress(publicKey: Uint8Array, testnet: boolean) {
  const program = ripemd160(sha256(publicKey));
  return bech32.encode(testnet ? 'tb' : 'bc', [0, ...bech32.toWords(program)]);
}

/** The last 20 bytes of keccak256 over the uncompressed key (without its 0x04 prefix). */
function evmBytes(publicKey: Uint8Array) {
  const uncompressed = secp256k1.Point.fromHex(bytesToHex(publicKey)).toBytes(false);
  return keccak_256(uncompressed.slice(1)).slice(-20);
}

/** EIP-55 checksummed 0x address. */
export function checksumAddress(hex: string) {
  const lower = hex.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  return `0x${[...lower].map((char, i) => (parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char)).join('')}`;
}

export function evmAddress(publicKey: Uint8Array) {
  return checksumAddress(bytesToHex(evmBytes(publicKey)));
}

const tronCheck = base58check(sha256);

/** TRON: 0x41 then the same 20 bytes as EVM, in base58check (T…). */
export function tronAddress(publicKey: Uint8Array) {
  return tronCheck.encode(Uint8Array.from([0x41, ...evmBytes(publicKey)]));
}

/** A TRON address (T…) as the 0x hex its node APIs and logs use, without the 41 prefix. */
export function tronToHex(address: string) {
  const bytes = tronCheck.decode(address);
  if (bytes.length !== 21 || bytes[0] !== 0x41) throw new Error('Not a TRON address');
  return `0x${bytesToHex(bytes.slice(1))}`;
}

/** A 20-byte hex address (0x…, or 41… from TRON nodes) as a TRON address. */
export function hexToTron(hex: string) {
  const clean = hex.toLowerCase().replace(/^0x/, '').replace(/^41(?=[0-9a-f]{40}$)/, '');
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error('Not a 20-byte address');
  return tronCheck.encode(Uint8Array.from([0x41, ...Buffer.from(clean, 'hex')]));
}

/** Customer `index`'s address in a family from that family's account xpub. */
export function deriveAddress(family: AddressFamily, xpub: string, index: number) {
  const { publicKey, testnet } = childPublicKey(xpub, index);
  if (family === 'bitcoin') return bitcoinAddress(publicKey, testnet);
  if (family === 'evm') return evmAddress(publicKey);
  return tronAddress(publicKey);
}

/** A short fingerprint of the xpub an address came from, so a changed key never mixes up old addresses. */
export function xpubFingerprint(xpub: string) {
  return bytesToHex(sha256(new TextEncoder().encode(xpub.trim()))).slice(0, 16);
}

/** Whether a string is a valid address of the family (checksums included). */
export function validAddress(family: AddressFamily | 'solana', address: string) {
  try {
    if (family === 'bitcoin') {
      const decoded = bech32.decode(address as `${string}1${string}`);
      return ['bc', 'tb'].includes(decoded.prefix) && decoded.words[0] === 0;
    }
    if (family === 'evm') return /^0x[0-9a-fA-F]{40}$/.test(address) && (address === address.toLowerCase() || checksumAddress(address) === address);
    if (family === 'tron') return tronToHex(address).length === 42;
    return base58.decode(address).length === 32;
  } catch {
    return false;
  }
}
