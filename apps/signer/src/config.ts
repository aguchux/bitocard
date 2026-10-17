import { type Chain, chains, defaultAccountPaths, type Family, nativeCoin, type Network } from './keys.js';

export type Limit = {
  chain: Chain;
  contract: string | null;
  asset: string;
  /** On-chain decimals (a token's own; the coin's for null contracts). */
  decimals: number;
  perTransfer: bigint;
  daily: bigint;
  /** Deposit addresses holding at least this much are swept to the hot wallet; null: never swept automatically. */
  sweepMin: bigint | null;
};

export type SignerConfig = {
  port: number;
  network: Network;
  secret: string;
  databaseUrl: string;
  vault: { kind: 'local'; mnemonic: string } | { kind: 'turnkey'; apiUrl: string; organizationId: string; walletId: string; apiPublicKey: string; apiPrivateKey: string };
  accountPaths: Record<Family, string>;
  xpubs: Partial<Record<Family, string>>;
  evmRpc: Partial<Record<Chain, string>>;
  tron: { url: string; apiKey: string | null } | null;
  esplora: Partial<Record<'BITCOIN' | 'LITECOIN' | 'DOGECOIN', string>>;
  blockcypherToken: string | null;
  confirmations: Record<Chain, number>;
  /** What may be sent: a coin or token without a limit is never sent. */
  limits: Limit[];
  /** How often the worker looks at unfinished transfers. */
  workerIntervalMs: number;
};

const defaultConfirmations: Record<Chain, number> = { ETHEREUM: 12, BSC: 15, POLYGON: 256, ARBITRUM: 300, BASE: 120, OPTIMISM: 120, TRON: 19, BITCOIN: 2, LITECOIN: 6, DOGECOIN: 40 };

export class ConfigError extends Error {}

/** Reads the signer's settings from its environment. Everything is checked at start, so a mistake stops it at once. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SignerConfig {
  const get = (name: string) => env[name]?.trim() || undefined;
  const need = (name: string) => {
    const value = get(name);
    if (!value) throw new ConfigError(`${name} is required`);
    return value;
  };
  const network = need('SIGNER_NETWORK');
  if (network !== 'mainnet' && network !== 'testnet') throw new ConfigError('SIGNER_NETWORK must be mainnet or testnet');
  const secret = need('SIGNER_SECRET');
  if (secret.length < 32) throw new ConfigError('SIGNER_SECRET must be at least 32 characters (the same as CRYPTO_SIGNER_SECRET in the admin app)');

  const vaultKind = get('SIGNER_VAULT') ?? 'turnkey';
  let vault: SignerConfig['vault'];
  if (vaultKind === 'local') {
    // A recovery phrase in a server's environment is acceptable only where nothing real can be lost.
    if (network === 'mainnet') throw new ConfigError('SIGNER_VAULT=local is for test networks only: use Turnkey for mainnet');
    vault = { kind: 'local', mnemonic: need('SIGNER_MNEMONIC') };
  } else if (vaultKind === 'turnkey') {
    vault = {
      kind: 'turnkey',
      apiUrl: get('TURNKEY_API_URL') ?? 'https://api.turnkey.com',
      organizationId: need('TURNKEY_ORGANIZATION_ID'),
      walletId: need('TURNKEY_WALLET_ID'),
      apiPublicKey: need('TURNKEY_API_PUBLIC_KEY'),
      apiPrivateKey: need('TURNKEY_API_PRIVATE_KEY'),
    };
  } else {
    throw new ConfigError('SIGNER_VAULT must be turnkey or local');
  }

  const families: Family[] = ['evm', 'tron', 'bitcoin', 'litecoin', 'dogecoin'];
  const accountPaths = Object.fromEntries(families.map(f => [f, get(`SIGNER_PATH_${f.toUpperCase()}`) ?? defaultAccountPaths[f][network]])) as Record<Family, string>;
  const xpubs = Object.fromEntries(families.flatMap(f => (get(`SIGNER_XPUB_${f.toUpperCase()}`) ? [[f, get(`SIGNER_XPUB_${f.toUpperCase()}`)]] : []))) as Partial<Record<Family, string>>;

  const https = (name: string, value: string | undefined) => {
    if (!value) return undefined;
    const url = new URL(value);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new ConfigError(`${name} must be https://`);
    return value;
  };
  const evmRpc: Partial<Record<Chain, string>> = {};
  for (const chain of ['ETHEREUM', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM'] as const) {
    const url = https(`SIGNER_RPC_${chain}`, get(`SIGNER_RPC_${chain}`));
    if (url) evmRpc[chain] = url;
  }
  const tronUrl = https('SIGNER_TRON_URL', get('SIGNER_TRON_URL'));
  const esplora: SignerConfig['esplora'] = {};
  for (const chain of ['BITCOIN', 'LITECOIN', 'DOGECOIN'] as const) {
    const url = https(`SIGNER_ESPLORA_${chain}`, get(`SIGNER_ESPLORA_${chain}`));
    if (url) esplora[chain] = url;
  }

  const confirmations = { ...defaultConfirmations };
  for (const chain of chains) {
    const value = get(`SIGNER_CONFIRMATIONS_${chain}`);
    if (value) confirmations[chain] = Number(value);
  }

  return {
    port: Number(get('PORT') ?? 3010),
    network,
    secret,
    databaseUrl: need('DATABASE_URL'),
    vault,
    accountPaths,
    xpubs,
    evmRpc,
    tron: tronUrl ? { url: tronUrl, apiKey: get('SIGNER_TRON_API_KEY') ?? null } : null,
    esplora,
    blockcypherToken: get('SIGNER_BLOCKCYPHER_TOKEN') ?? null,
    confirmations,
    limits: parseLimits(get('SIGNER_LIMITS') ?? '[]'),
    workerIntervalMs: Number(get('SIGNER_WORKER_INTERVAL_MS') ?? 15_000),
  };
}

/**
 * `SIGNER_LIMITS`: a JSON list of what may be sent and how much, in on-chain units:
 * `[{ "chain": "TRON", "asset": "USDT", "contract": "TR7N…", "decimals": 6, "per_transfer": "5000000000",
 * "daily": "20000000000", "sweep_min": "20000000" }]`. A coin's own entry has `"contract": null` and may leave out
 * `decimals`; `sweep_min` is optional (without it, deposits of that asset are not swept automatically).
 */
export function parseLimits(text: string): Limit[] {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    throw new ConfigError('SIGNER_LIMITS must be JSON');
  }
  if (!Array.isArray(list)) throw new ConfigError('SIGNER_LIMITS must be a JSON list');
  return list.map((item, i) => {
    const value = item as Record<string, unknown>;
    if (!chains.includes(value.chain as Chain)) throw new ConfigError(`SIGNER_LIMITS[${i}].chain is not a chain`);
    if (typeof value.asset !== 'string' || !value.asset) throw new ConfigError(`SIGNER_LIMITS[${i}].asset is required`);
    if (value.contract !== null && value.contract !== undefined && typeof value.contract !== 'string') throw new ConfigError(`SIGNER_LIMITS[${i}].contract must be text or null`);
    for (const key of ['per_transfer', 'daily', ...(value.sweep_min !== undefined ? ['sweep_min'] : [])]) {
      if (typeof value[key] !== 'string' || !/^\d+$/.test(value[key] as string)) throw new ConfigError(`SIGNER_LIMITS[${i}].${key} must be whole on-chain units as text`);
    }
    const contract = (value.contract as string | null | undefined) ?? null;
    const decimals = value.decimals ?? (contract ? undefined : nativeCoin[value.chain as Chain].decimals);
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new ConfigError(`SIGNER_LIMITS[${i}].decimals is required for a token`);
    return {
      chain: value.chain as Chain,
      asset: value.asset.toUpperCase(),
      contract,
      decimals,
      perTransfer: BigInt(value.per_transfer as string),
      daily: BigInt(value.daily as string),
      sweepMin: value.sweep_min !== undefined ? BigInt(value.sweep_min as string) : null,
    };
  });
}
