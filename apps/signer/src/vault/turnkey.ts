import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { ChainUnavailable } from '../chains/rpc.js';
import { type KeyVault, normalise } from './vault.js';

export type TurnkeyConfig = {
  apiUrl: string;
  organizationId: string;
  walletId: string;
  /** The API key pair (P-256) created for this signer in Turnkey, hex. */
  apiPublicKey: string;
  apiPrivateKey: string;
  /** Account paths and their xpubs, the same ones saved in BitoCard's admin app. */
  accounts: { path: string; xpub: string }[];
};

/**
 * Keys in Turnkey: BitoCard's recovery phrase is imported into one Turnkey wallet and never leaves it. Turnkey has no
 * xpub export, so the signer is given the account xpubs (the same ones the admin app holds) and works out public keys
 * itself; every signature Turnkey returns is checked against that key, so a wallet that is not the one behind the
 * xpubs can never sign anything.
 *
 * Requests are stamped with the API key: `X-Stamp: base64url({ publicKey, scheme: SIGNATURE_SCHEME_TK_API_P256,
 * signature })`, the signature P-256 ECDSA over the exact body, DER in hex. Turnkey signs only for wallet accounts
 * that exist, so each path is added as an account (compressed public key format: Turnkey has no Litecoin format) the
 * first time it is used.
 */
export class TurnkeyVault implements KeyVault {
  readonly name = 'turnkey';
  private readonly keys: { path: string; key: HDKey }[];
  private readonly created = new Set<string>();

  constructor(
    private readonly config: TurnkeyConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.keys = config.accounts.map(account => ({ path: account.path.replace(/\/+$/, ''), key: HDKey.fromExtendedKey(account.xpub.trim(), versionsFor(account.xpub)) }));
    if (!/^[0-9a-f]{64}$/i.test(config.apiPrivateKey)) throw new Error('TURNKEY_API_PRIVATE_KEY must be the 64-character hex private key');
    const derived = bytesToHex(p256.getPublicKey(hexToBytes(config.apiPrivateKey), true));
    if (derived !== config.apiPublicKey.toLowerCase()) throw new Error('TURNKEY_API_PUBLIC_KEY does not match TURNKEY_API_PRIVATE_KEY');
  }

  async publicKey(path: string) {
    for (const { path: account, key } of this.keys) {
      if (!path.startsWith(`${account}/`)) continue;
      const rest = path.slice(account.length + 1).split('/');
      if (rest.some(part => !/^\d+$/.test(part))) break;
      return rest.reduce((node, part) => node.deriveChild(Number(part)), key).publicKey!;
    }
    throw new Error(`No account xpub covers ${path}`);
  }

  async sign(path: string, digest: Uint8Array) {
    const publicKey = await this.publicKey(path);
    const signWith = bytesToHex(publicKey);
    let result: { r: string; s: string; v?: string };
    try {
      result = await this.signRaw(signWith, digest);
    } catch (error) {
      if (this.created.has(path) || !(error instanceof TurnkeyError) || !/not found|could not find|unknown|no .*account|invalid sign ?with/i.test(error.message)) throw error;
      await this.createAccount(path, signWith);
      result = await this.signRaw(signWith, digest);
    }
    const v = result.v ? parseInt(result.v, 16) : undefined;
    return normalise(digest, publicKey, BigInt(`0x${result.r}`), BigInt(`0x${result.s}`), v === 0 || v === 1 ? v : undefined);
  }

  private async createAccount(path: string, expected: string) {
    try {
      const activity = await this.submit('create_wallet_accounts', 'ACTIVITY_TYPE_CREATE_WALLET_ACCOUNTS', {
        walletId: this.config.walletId,
        accounts: [{ curve: 'CURVE_SECP256K1', pathFormat: 'PATH_FORMAT_BIP32', path, addressFormat: 'ADDRESS_FORMAT_COMPRESSED' }],
      });
      const addresses = find<{ addresses?: string[] }>(activity, value => Array.isArray((value as { addresses?: unknown }).addresses))?.addresses ?? [];
      // The wallet in Turnkey must be the one behind the xpubs: anything else and nothing is signed.
      if (addresses.length && addresses[0].toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`Turnkey's key at ${path} is not the xpub's: the Turnkey wallet is not the one the xpubs came from`);
      }
    } catch (error) {
      if (!(error instanceof TurnkeyError) || !/already exists|duplicate/i.test(error.message)) throw error;
    }
    this.created.add(path);
  }

  private async signRaw(signWith: string, digest: Uint8Array) {
    const activity = await this.submit('sign_raw_payload', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2', {
      signWith,
      payload: bytesToHex(digest),
      encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
      hashFunction: 'HASH_FUNCTION_NO_OP',
    });
    const result = find<{ r: string; s: string; v?: string }>(activity, value => typeof (value as { r?: unknown }).r === 'string' && typeof (value as { s?: unknown }).s === 'string');
    if (!result) throw new TurnkeyError('Turnkey returned no signature');
    return result;
  }

  /** Submits an activity and waits for it to complete (policies can make it wait for approvals). */
  private async submit(path: string, type: string, parameters: unknown) {
    const reply = await this.post<{ activity?: Activity }>(`/public/v1/submit/${path}`, { type, timestampMs: String(Date.now()), organizationId: this.config.organizationId, parameters });
    let activity = reply.activity;
    for (let attempt = 0; activity && activity.status !== 'ACTIVITY_STATUS_COMPLETED' && attempt < 10; attempt++) {
      if (activity.status === 'ACTIVITY_STATUS_FAILED' || activity.status === 'ACTIVITY_STATUS_REJECTED') {
        throw new TurnkeyError(`Turnkey ${type} ${activity.status}: ${activity.failure?.message ?? ''}`.trim());
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      activity = (await this.post<{ activity?: Activity }>('/public/v1/query/get_activity', { organizationId: this.config.organizationId, activityId: activity.id })).activity;
    }
    if (activity?.status !== 'ACTIVITY_STATUS_COMPLETED') throw new ChainUnavailable(`Turnkey ${type} is waiting (${activity?.status ?? 'no activity'})`);
    return activity;
  }

  /** Signs and sends one request: the stamp covers the exact body bytes. */
  async post<T>(path: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const signature = p256.sign(new TextEncoder().encode(body), hexToBytes(this.config.apiPrivateKey), { format: 'der' });
    const stamp = base64urlnopad.encode(new TextEncoder().encode(JSON.stringify({ publicKey: this.config.apiPublicKey.toLowerCase(), scheme: 'SIGNATURE_SCHEME_TK_API_P256', signature: bytesToHex(signature) })));
    let res: Response;
    try {
      res = await this.fetcher(`${this.config.apiUrl.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Stamp': stamp },
        body,
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
    } catch (error) {
      throw new ChainUnavailable(`Turnkey unreachable (${error instanceof Error ? error.name : 'error'})`);
    }
    const text = await res.text();
    if (res.status >= 500 || res.status === 429) throw new ChainUnavailable(`Turnkey HTTP ${res.status}`);
    if (!res.ok) throw new TurnkeyError(`Turnkey HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
}

type Activity = { id: string; status: string; failure?: { message?: string }; result?: unknown };

/** Turnkey refused a request (bad credentials, a policy, an unknown account). */
export class TurnkeyError extends Error {
  override name = 'TurnkeyError';
}

/** The first object in a reply that passes the test (Turnkey's result nesting varies between activity versions). */
function find<T>(value: unknown, test: (value: object) => boolean): T | null {
  if (!value || typeof value !== 'object') return null;
  if (test(value)) return value as T;
  for (const child of Object.values(value)) {
    const found = find<T>(child, test);
    if (found) return found;
  }
  return null;
}

/** Extended key version bytes for the prefixes people paste (the same set the API accepts). */
function versionsFor(xpub: string) {
  const prefixes: Record<string, number> = {
    xpub: 0x0488b21e,
    ypub: 0x049d7cb2,
    zpub: 0x04b24746,
    tpub: 0x043587cf,
    upub: 0x044a5262,
    vpub: 0x045f1cf6,
    Ltub: 0x019da462,
    Mtub: 0x01b26ef6,
    ttub: 0x0436f6e1,
    dgub: 0x02facafd,
    tgub: 0x0432a9a8,
  };
  const version = prefixes[xpub.trim().slice(0, 4)];
  if (!version) throw new Error('Unknown extended public key prefix');
  return { private: 0, public: version };
}
