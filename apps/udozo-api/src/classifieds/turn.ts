import { ProviderError } from '../payments/provider-error.js';

/** Whether calls can be made: the TURN key and its token are set. */
export const callsConfigured = (config: { CLOUDFLARE_TURN_KEY_ID?: string; CLOUDFLARE_TURN_API_TOKEN?: string }) => Boolean(config.CLOUDFLARE_TURN_KEY_ID?.trim() && config.CLOUDFLARE_TURN_API_TOKEN?.trim());

/** One entry of an RTCPeerConnection's `iceServers`. */
export type IceServer = { urls: string[]; username?: string; credential?: string };

/** How long a call's relay credentials last: longer than any call, as they cannot be renewed mid-call here. */
export const turnTtlSeconds = 4 * 60 * 60;

/**
 * Udozo's call relay: Cloudflare Realtime TURN. Each call gets short-lived credentials made from the TURN key (the key
 * and its token stay on the server). Calls use the relay only, so neither browser learns the other's address.
 */
export class CloudflareTurn {
  constructor(private readonly options: { keyId?: string; token?: string; baseUrl: string }) {}

  configured() {
    return Boolean(this.options.keyId?.trim() && this.options.token?.trim());
  }

  /** Relay servers for one call: TURN only (browsers block port 53, so those addresses are left out). */
  async iceServers(ttl = turnTtlSeconds): Promise<IceServer[]> {
    const keyId = encodeURIComponent(this.options.keyId?.trim() ?? '');
    let res: Response;
    try {
      res = await fetch(`${this.options.baseUrl.replace(/\/+$/, '')}/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.token?.trim() ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new ProviderError('cloudflare_turn', `request failed: ${(error as Error).message}`, false);
    }
    const text = await res.text();
    if (!res.ok) throw new ProviderError('cloudflare_turn', `HTTP ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 429, res.status);
    let body: { iceServers?: unknown };
    try {
      body = JSON.parse(text) as { iceServers?: unknown };
    } catch {
      throw new ProviderError('cloudflare_turn', 'an unreadable reply', false);
    }
    return relayServers(body.iceServers);
  }
}

/** The relay entries of Cloudflare's reply (an array, or one object in its older shape), port 53 left out. */
export function relayServers(raw: unknown): IceServer[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const servers: IceServer[] = [];
  for (const entry of list as Array<{ urls?: unknown; username?: unknown; credential?: unknown }>) {
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).filter(
      (url): url is string => typeof url === 'string' && /^turns?:/.test(url) && !/:53(\?|$)/.test(url),
    );
    if (!urls.length || typeof entry.username !== 'string' || typeof entry.credential !== 'string') continue;
    servers.push({ urls, username: entry.username, credential: entry.credential });
  }
  if (!servers.length) throw new ProviderError('cloudflare_turn', 'no relay servers in the reply', false);
  return servers;
}
