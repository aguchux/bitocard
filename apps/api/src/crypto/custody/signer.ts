import { createHash, createHmac } from 'node:crypto';
import type { IntegrationField } from '../../integrations/definitions.js';
import type { IntegrationLink } from '../../integrations/links.js';
import type { Chain } from '../chains/client.js';

/**
 * BitoCard's signer: the only thing that can spend customers' crypto. It runs off Vercel, in front of the key vault
 * (Turnkey, Dfns or an HSM, holding the keys from the offline key ceremony), and applies its own limits. The API never
 * holds a private key: it asks the signer to send a transfer, identified by a reference that is the same on every
 * request, so a repeat after a timeout never sends twice. The protocol is in `docs/crypto-signer.md`.
 *
 * Requests are signed like BitoCard's webhooks: `BitoCard-Signer-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`
 * keyed with the shared secret (for GETs the body is the path). The signer must refuse anything older than 5 minutes.
 *
 * Sandbox stores use the signer whose Sandbox switch is on (test networks); without one their withdrawals are
 * simulated. Live stores need a live signer: without one, live withdrawals are not offered.
 */
export type SignerStatus = 'pending' | 'broadcast' | 'confirmed' | 'failed';
export type SignerTransfer = { reference: string; status: SignerStatus; txHash: string | null; reason: string | null };
export type SendInput = { reference: string; chain: Chain; network: 'mainnet' | 'testnet'; asset: string; contract: string | null; to: string; rawAmount: string; decimals: number };

/** A signer's failure: `definite` when it clearly refused (bad request, credentials, its limits), so nothing was sent. */
export class SignerError extends Error {
  constructor(
    message: string,
    readonly definite = false,
  ) {
    super(message);
  }
}

export interface CryptoSigner {
  readonly simulated: boolean;
  /** Sends a transfer, or returns the one already made with this reference. */
  send(input: SendInput): Promise<SignerTransfer>;
  /** A transfer by reference; null when the signer never received it (so it is safe to send). */
  status(reference: string): Promise<SignerTransfer | null>;
  /** A Solana deposit address for a customer index (Solana keys are hardened, so only the signer can make them). */
  address?(input: { chain: 'SOLANA'; network: 'mainnet' | 'testnet'; index: number }): Promise<string>;
  /** Whether the signer answers with these credentials (Test connection). */
  health(): Promise<{ network: string | null }>;
  /** Everything the signer's wallets hold on a network (deposit addresses, hot, warm and cold), for reconciliation. */
  balances?(network: 'mainnet' | 'testnet'): Promise<SignerBalance[]>;
}

/** One holding: on-chain units (text, as 18-decimal tokens exceed 64 bits) of a coin or token on a chain. */
export type SignerBalance = { chain: Chain; asset: string; contract: string | null; amount: string; decimals: number };

const timeoutMs = 20_000;
const statuses: readonly SignerStatus[] = ['pending', 'broadcast', 'confirmed', 'failed'];

/** The signature header for a request body at a time. */
export function signerSignature(secret: string, body: string, at = Math.floor(Date.now() / 1000)) {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}

function transfer(reply: unknown, reference: string): SignerTransfer {
  const value = reply as { reference?: string; status?: string; tx_hash?: string | null; reason?: string | null };
  if (!value || value.reference !== reference || !statuses.includes(value.status as SignerStatus)) throw new SignerError('The signer gave an answer BitoCard cannot read.');
  return { reference, status: value.status as SignerStatus, txHash: value.tx_hash ?? null, reason: value.reason ?? null };
}

/** BitoCard's own signer service over HTTPS. */
export class RemoteSigner implements CryptoSigner {
  readonly simulated = false;

  constructor(
    private readonly url: string,
    private readonly secret: string,
  ) {}

  private async request(method: 'GET' | 'POST', path: string, body?: unknown) {
    const url = `${this.url.replace(/\/+$/, '')}${path}`;
    // A GET signs the path the signer receives (its own base path included); a POST signs its body.
    const text = body === undefined ? new URL(url).pathname : JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { accept: 'application/json', 'bitocard-signer-signature': signerSignature(this.secret, text), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : text,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      throw new SignerError(`unreachable (${error instanceof Error ? error.name : 'error'})`);
    }
    const reply = await res.text();
    const json = (() => {
      try {
        return reply ? JSON.parse(reply) : null;
      } catch {
        return null;
      }
    })();
    if (res.status === 404 && method === 'GET') return null;
    // 4xx: the signer refused (bad request, credentials, its own limits): nothing was sent. 5xx and the rest: unclear.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409 && res.status !== 429) {
      throw new SignerError(`refused (HTTP ${res.status}${json?.error?.message ? `: ${String(json.error.message).slice(0, 200)}` : ''})`, true);
    }
    if (!res.ok) throw new SignerError(`HTTP ${res.status}`);
    return json;
  }

  async send(input: SendInput) {
    const reply = await this.request('POST', '/v1/transfers', {
      reference: input.reference,
      chain: input.chain,
      network: input.network,
      asset: input.asset,
      contract: input.contract,
      to: input.to,
      amount: input.rawAmount,
      decimals: input.decimals,
    });
    return transfer(reply, input.reference);
  }

  async status(reference: string) {
    const reply = await this.request('GET', `/v1/transfers/${encodeURIComponent(reference)}`);
    return reply === null ? null : transfer(reply, reference);
  }

  async address(input: { chain: 'SOLANA'; network: 'mainnet' | 'testnet'; index: number }) {
    const reply = (await this.request('POST', '/v1/addresses', input)) as { address?: string } | null;
    if (!reply?.address) throw new SignerError('The signer did not return an address.');
    return reply.address;
  }

  async health() {
    const reply = (await this.request('GET', '/v1/health')) as { network?: string } | null;
    if (!reply) throw new SignerError('The signer has no health check at /v1/health.', true);
    return { network: reply.network ?? null };
  }

  async balances(network: 'mainnet' | 'testnet') {
    const reply = (await this.request('GET', `/v1/balances/${network}`)) as { balances?: unknown } | null;
    if (!reply || !Array.isArray(reply.balances)) throw new SignerError('The signer gave no balances.');
    return reply.balances.map(item => {
      const value = item as Partial<SignerBalance>;
      if (typeof value.chain !== 'string' || typeof value.asset !== 'string' || typeof value.amount !== 'string' || !/^\d+$/.test(value.amount) || typeof value.decimals !== 'number') {
        throw new SignerError('The signer gave a balance BitoCard cannot read.');
      }
      return { chain: value.chain as Chain, asset: value.asset.toUpperCase(), contract: value.contract ?? null, amount: value.amount, decimals: value.decimals };
    });
  }
}

/**
 * The sandbox stand-in when no test signer is set up: every transfer is "sent" at once with a made-up hash and
 * confirmed on the next check. Never used for live withdrawals.
 */
export class SimulatedSigner implements CryptoSigner {
  readonly simulated = true;

  private hash(reference: string) {
    return `0x${createHash('sha256').update(`sandbox:${reference}`).digest('hex')}`;
  }

  async send(input: SendInput): Promise<SignerTransfer> {
    return { reference: input.reference, status: 'confirmed', txHash: this.hash(input.reference), reason: null };
  }

  async status(reference: string): Promise<SignerTransfer> {
    return { reference, status: 'confirmed', txHash: this.hash(reference), reason: null };
  }

  async health() {
    return { network: 'simulated' };
  }
}

export const signerFields: IntegrationField[] = [
  { key: 'CRYPTO_SIGNER_URL', label: 'Signer address', secret: true, kind: 'url', required: true, help: 'The HTTPS address of BitoCard’s signer service (off Vercel, in front of the key vault).' },
  { key: 'CRYPTO_SIGNER_SECRET', label: 'Shared secret', secret: true, kind: 'text', required: true, help: 'The secret the signer checks request signatures with (at least 32 characters). Set the same value on the signer.' },
  {
    key: 'CRYPTO_SIGNER_SANDBOX',
    label: 'Sandbox (test networks)',
    secret: false,
    kind: 'flag',
    required: false,
    help: 'On: this signer sends on test networks for sandbox stores (live withdrawals are then not offered). Off: main networks, live stores.',
  },
];

export const signerLinks: IntegrationLink[] = [
  { label: 'Turnkey', url: 'https://www.turnkey.com/' },
  { label: 'Dfns', url: 'https://www.dfns.co/' },
  { label: 'AWS CloudHSM', url: 'https://aws.amazon.com/cloudhsm/' },
];
