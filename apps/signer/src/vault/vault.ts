import { secp256k1 } from '@noble/curves/secp256k1.js';

/** A secp256k1 signature over a 32-byte digest: low-S, with the recovery bit EVM and TRON need. */
export type Signature = { r: bigint; s: bigint; recovery: number };

/**
 * Where the keys live. The signer never holds a seed in production: Turnkey holds it and signs digests on request.
 * Every chain we send on signs secp256k1 digests the signer computes itself (sighashes, keccak, sha256), so the vault
 * is asked only "sign this digest with the key at this path" and never sees what is being sent.
 */
export interface KeyVault {
  readonly name: string;
  /** The compressed public key at a BIP-32 path. */
  publicKey(path: string): Promise<Uint8Array>;
  /** Signs a 32-byte digest (no hashing) with the key at a path. */
  sign(path: string, digest: Uint8Array): Promise<Signature>;
}

const n = secp256k1.Point.CURVE().n;

/**
 * Normalises a signature to low-S (Bitcoin's and Ethereum's rule) and checks it against the public key, recovering
 * the recovery bit when the vault did not give one. A signature that does not verify is never used.
 */
export function normalise(digest: Uint8Array, publicKey: Uint8Array, r: bigint, s: bigint, recovery?: number): Signature {
  let low = s;
  let bit = recovery;
  if (low > n / 2n) {
    low = n - low;
    if (bit !== undefined) bit ^= 1;
  }
  const sig = new secp256k1.Signature(r, low);
  const expected = secp256k1.Point.fromBytes(publicKey);
  const candidates = bit === undefined ? [0, 1] : [bit, bit ^ 1];
  for (const candidate of candidates) {
    try {
      if (sig.addRecoveryBit(candidate).recoverPublicKey(digest).equals(expected)) return { r, s: low, recovery: candidate };
    } catch {
      // try the other bit
    }
  }
  throw new Error('The vault returned a signature that does not match the key');
}

export function compactSignature(sig: Signature) {
  const out = new Uint8Array(64);
  out.set(bigintBytes(sig.r, 32), 0);
  out.set(bigintBytes(sig.s, 32), 32);
  return out;
}

export function bigintBytes(value: bigint, length?: number) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  if (length === undefined) return value === 0n ? new Uint8Array() : bytes;
  if (bytes.length > length) throw new Error('number too large');
  const out = new Uint8Array(length);
  out.set(bytes, length - bytes.length);
  return out;
}
