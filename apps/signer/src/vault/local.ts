import { secp256k1 } from '@noble/curves/secp256k1.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { type KeyVault, normalise } from './vault.js';

/**
 * Keys from a recovery phrase in the signer's own environment. **Test networks only**: config refuses it for mainnet,
 * where the phrase lives in Turnkey and never in a server's memory. Used for development, tests and the sandbox signer.
 */
export class LocalVault implements KeyVault {
  readonly name = 'local';
  private readonly root: HDKey;

  constructor(mnemonic: string) {
    const words = mnemonic.trim().split(/\s+/).join(' ');
    if (!validateMnemonic(words, wordlist)) throw new Error('SIGNER_MNEMONIC is not a valid BIP-39 phrase');
    this.root = HDKey.fromMasterSeed(mnemonicToSeedSync(words));
  }

  async publicKey(path: string) {
    return this.root.derive(path).publicKey!;
  }

  async sign(path: string, digest: Uint8Array) {
    const key = this.root.derive(path);
    const sig = secp256k1.sign(digest, key.privateKey!, { prehash: false, format: 'recovered' });
    const parsed = secp256k1.Signature.fromBytes(sig, 'recovered');
    return normalise(digest, key.publicKey!, parsed.r, parsed.s, parsed.recovery);
  }
}
